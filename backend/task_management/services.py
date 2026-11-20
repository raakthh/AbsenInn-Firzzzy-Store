"""Tasks: one assignee per task (via task_assignments), status flow, history."""
import uuid

from django.db import transaction

from core import context as ctx
from core.db import db_actor
from core.events import audit, notify_employee, notify_owners
from core.exceptions import ApiError, get_or_404, validation
from core.shapes import pick_emp
from employees.models import Employee

from .models import Task, TaskAssignment, TaskHistory

PRIORITIES = ("low", "medium", "high")
STATUSES = ("todo", "in_progress", "completed")


def status_display(t, today):
    return "overdue" if t.status != "completed" and t.deadline < today else t.status


def task_out(t, today, assignee=None, history=None):
    if assignee is None:
        a = t.assignments.select_related("employee").first()
        assignee = a.employee if a else None
    if history is None:
        history = list(t.history.select_related("actor").order_by("created_at"))
    return {"id": t.id, "company_id": t.company_id, "title": t.title, "description": t.description or "",
            "assignee_id": assignee.id if assignee else None, "priority": t.priority, "deadline": t.deadline, "status": t.status,
            "progress": t.progress, "created_by": t.created_by_id, "created_at": t.created_at, "completed_at": t.completed_at,
            "history": [{"at": h.created_at, "by": h.actor.full_name if h.actor_id else "Sistem", "action": h.action,
                         "from": h.from_status, "to": h.to_status} for h in history],
            "status_display": status_display(t, today), "assignee": pick_emp(assignee)}


def _base(user):
    qs = Task.objects.filter(company_id=user.company_id)
    return qs.filter(assignments__employee_id=user.employee_id) if user.is_employee else qs


def list_tasks(user, q):
    today = ctx.today(user.company)
    qs = _base(user)
    if user.is_owner and q.get("assignee_id"):
        try:
            qs = qs.filter(assignments__employee_id=uuid.UUID(str(q["assignee_id"])))
        except ValueError:
            return []
    tasks = list(qs.distinct().order_by("deadline", "created_at"))
    ids = [t.id for t in tasks]
    assignees = {a.task_id: a.employee for a in TaskAssignment.objects.filter(task_id__in=ids).select_related("employee")}
    hist = {}
    for h in TaskHistory.objects.filter(task_id__in=ids).select_related("actor").order_by("created_at"):
        hist.setdefault(h.task_id, []).append(h)
    rows = [task_out(t, today, assignees.get(t.id), hist.get(t.id, [])) for t in tasks]
    if q.get("status"):
        rows = [r for r in rows if r["status_display"] == q["status"]]
    return rows


def get_task(user, pk):
    return task_out(get_or_404(_base(user), "Tugas tidak ditemukan", id=pk), ctx.today(user.company))


def _validate(user, d, is_new):
    errors = {}
    title = (d.get("title") or "").strip()
    if len(title) < 3:
        errors["title"] = "Judul minimal 3 karakter"
    emp = None
    try:
        emp = Employee.objects.filter(company_id=user.company_id, id=uuid.UUID(str(d.get("assignee_id")))).first()
    except (TypeError, ValueError):
        emp = None
    if not emp:
        errors["assignee_id"] = "Pilih karyawan"
    elif emp.employment_status != "active":
        errors["assignee_id"] = "Karyawan tidak aktif"
    if d.get("priority") not in PRIORITIES:
        errors["priority"] = "Pilih prioritas"
    deadline = ctx.parse_date(d.get("deadline"))
    if not deadline:
        errors["deadline"] = "Deadline wajib diisi"
    elif is_new and deadline < ctx.today(user.company):
        errors["deadline"] = "Deadline tidak boleh di masa lalu"
    validation(errors, "Periksa kembali data tugas")
    return title, emp, deadline


@transaction.atomic
def save_task(user, pk, d):
    d = d or {}
    title, emp, deadline = _validate(user, d, pk is None)
    today = ctx.today(user.company)
    if pk:
        t = get_or_404(Task.objects.select_for_update().filter(company_id=user.company_id), "Tugas tidak ditemukan", id=pk)
        current = t.assignments.first()
        reassigned = not current or current.employee_id != emp.id
        t.title, t.description, t.priority, t.deadline = title, (d.get("description") or "").strip(), d["priority"], deadline
        with db_actor(user):
            t.save()                                   # trigger logs "Detail tugas diperbarui" if details changed
        if reassigned:
            TaskAssignment.objects.filter(task_id=t.id).delete()
            TaskAssignment.objects.create(company_id=t.company_id, task=t, employee=emp)
            notify_employee(emp, "task_assigned", "Tugas baru", f"Anda mendapat tugas: {t.title}.", "employee/tasks.html")
            TaskHistory.objects.create(company_id=t.company_id, task=t, actor_id=user.profile.id, action=f"Dialihkan ke {emp.full_name}")
        audit(user, "task.update", "task", t.id, f'Memperbarui tugas "{t.title}"')
    else:
        with db_actor(user):                           # trigger logs "Tugas dibuat"
            t = Task.objects.create(company_id=user.company_id, title=title, description=(d.get("description") or "").strip(),
                                    priority=d["priority"], deadline=deadline, status="todo", progress=0, created_by_id=user.profile.id)
        TaskAssignment.objects.create(company_id=t.company_id, task=t, employee=emp)
        notify_employee(emp, "task_assigned", "Tugas baru", f"Anda mendapat tugas: {t.title} (deadline {deadline:%d/%m/%Y}).", "employee/tasks.html")
        audit(user, "task.create", "task", t.id, f'Membuat tugas "{t.title}" untuk {emp.full_name}')
    return task_out(Task.objects.get(id=t.id), today)


@transaction.atomic
def delete_task(user, pk):
    t = get_or_404(Task.objects.filter(company_id=user.company_id), "Tugas tidak ditemukan", id=pk)
    title = t.title
    t.delete()
    audit(user, "task.delete", "task", pk, f'Menghapus tugas "{title}"')
    return True


@transaction.atomic
def set_status(user, pk, status, progress=None):
    t = get_or_404(_base(user).select_for_update(), "Tugas tidak ditemukan", id=pk)
    if status not in STATUSES:
        raise ApiError("Status tidak valid", "VALIDATION", 422, {"status": "Status tidak valid"})
    frm = t.status
    t.status = status
    if status == "completed":
        t.progress = 100
    elif status == "todo":
        t.progress = 0
    else:
        try:
            p = int(progress if progress is not None else (t.progress or 10))
        except (TypeError, ValueError):
            p = t.progress or 10
        t.progress = min(99, max(1, p))
    t.completed_at = ctx.now() if status == "completed" else None
    with db_actor(user):                               # trigger logs status/progress change with the actor
        t.save()
    if user.is_employee and status == "completed" and frm != "completed":
        notify_owners(user.company, "task_completed", "Tugas selesai", f'{user.full_name} menyelesaikan "{t.title}".', "owner/tasks.html", pref="task_deadline")
    return task_out(Task.objects.get(id=t.id), ctx.today(user.company))
