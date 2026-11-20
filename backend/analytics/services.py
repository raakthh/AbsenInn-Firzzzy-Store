"""Performance analytics — server-side port of frontend/js/core/metrics.js.

Definitions (identical to the reference formulas shown in the UI):
* attendance rate  = attended / (attended + absent) — leave days are excused
* punctuality rate = on-time / (on-time + late), on-time = present + early_leave
* task completion  = completed / assigned tasks in range
* productivity     = 40% attendance + 30% punctuality + 30% task completion
"""
import calendar
import datetime as dt

from attendance.models import AttendanceRecord
from core import context as ctx
from core.exceptions import validation
from employees.models import Employee
from task_management.models import Task, TaskAssignment

ATTENDED = ("present", "late", "early_leave", "needs_review")
ON_TIME = ("present", "early_leave")
LEAVE = ("sick", "paid_leave", "unpaid_leave")
RANGES = ("this_month", "last_month", "last_90")


def pct(v, d=0):
    return f"{v:.{d}f}".replace(".", ",") + "%"


def summarize(records):
    c = {k: 0 for k in ("present", "late", "early_leave", "needs_review", "absent", "sick", "paid_leave", "unpaid_leave")}
    for r in records:
        if r["status"] in c:
            c[r["status"]] += 1
    attended = sum(c[k] for k in ATTENDED)
    on_time = sum(c[k] for k in ON_TIME)
    leave = sum(c[k] for k in LEAVE)
    expected = attended + c["absent"]
    total_min = sum(r["work_minutes"] or 0 for r in records)
    with_min = len([r for r in records if r["work_minutes"]])
    return {"counts": c, "attended": attended, "onTime": on_time, "leave": leave, "expected": expected,
            "attendanceRate": (attended / expected * 100) if expected else 0,
            "punctualityRate": (on_time / (on_time + c["late"]) * 100) if (on_time + c["late"]) else 0,
            "avgWorkMinutes": (total_min / with_min) if with_min else 0, "totalMinutes": total_min}


def task_summary(tasks):
    c = {"todo": 0, "in_progress": 0, "completed": 0, "overdue": 0}
    for t in tasks:
        c[t["status_display"]] += 1
    total = len(tasks)
    on_time = len([t for t in tasks if t["status"] == "completed" and t["completed_on"] and t["completed_on"] <= t["deadline"]])
    return {"counts": c, "total": total, "completionRate": (c["completed"] / total * 100) if total else 0,
            "onTimeCompletion": (on_time / c["completed"] * 100) if c["completed"] else 0}


def productivity(a, p, t):
    return round(a * 0.4 + p * 0.3 + t * 0.3)


def bounds(rng, today):
    if rng == "last_month":
        y, m = (today.year - 1, 12) if today.month == 1 else (today.year, today.month - 1)
        s, e = dt.date(y, m, 1), dt.date(y, m, calendar.monthrange(y, m)[1])
        py, pm = (y - 1, 12) if m == 1 else (y, m - 1)
        return s, e, dt.date(py, pm, 1), dt.date(py, pm, calendar.monthrange(py, pm)[1])
    if rng == "last_90":
        return today - dt.timedelta(days=89), today, today - dt.timedelta(days=179), today - dt.timedelta(days=90)
    s = today.replace(day=1)
    ln = (today - s).days
    py, pm = (today.year - 1, 12) if today.month == 1 else (today.year, today.month - 1)
    ps = dt.date(py, pm, 1)
    return s, today, ps, ps + dt.timedelta(days=ln)          # same number of days last month


def last_months(n, today):
    out = []
    for i in range(n - 1, -1, -1):
        y, m = today.year, today.month - i
        while m <= 0:
            y, m = y - 1, m + 12
        out.append(f"{y:04d}-{m:02d}")
    return out


def insights(rows, cur, prev):
    out = []
    if cur and prev and prev["expected"]:
        diff = cur["attendanceRate"] - prev["attendanceRate"]
        delta = f"{abs(diff):.1f}".replace(".", ",")
        out.append({"icon": "trending-up" if diff >= 0 else "trending-down",
                    "text": f"Tingkat kehadiran {'naik' if diff >= 0 else 'turun'} {delta} poin dibanding bulan lalu ({pct(prev['attendanceRate'], 1)} → {pct(cur['attendanceRate'], 1)})."})
    with_data = [r for r in rows if r["att"]["onTime"] + r["att"]["counts"]["late"] > 0]
    if with_data:
        best = sorted(with_data, key=lambda r: -r["att"]["punctualityRate"])[0]
        worst = sorted(with_data, key=lambda r: -r["att"]["counts"]["late"])[0]
        out.append({"icon": "award", "text": f"{best['employee']['full_name']} paling tepat waktu ({pct(best['att']['punctualityRate'])} kedatangan tepat waktu)."})
        if worst["att"]["counts"]["late"] > 0:
            out.append({"icon": "clock", "text": f"{worst['employee']['full_name']} tercatat terlambat {worst['att']['counts']['late']}× pada periode ini — pertimbangkan untuk dibicarakan."})
    overdue = sum(r["task"]["counts"]["overdue"] for r in rows)
    if overdue:
        out.append({"icon": "alert-triangle", "text": f"{overdue} tugas melewati deadline dan belum selesai."})
    review = sum(r["att"]["counts"]["needs_review"] for r in rows)
    if review:
        out.append({"icon": "map-pin", "text": f"{review} absensi berstatus \"Perlu Review\" (mis. di luar radius) menunggu pemeriksaan owner."})
    if not out:
        out.append({"icon": "info", "text": "Belum cukup data untuk menghasilkan insight pada periode ini."})
    return out


def _emp(e):
    return {"id": e.id, "full_name": e.full_name, "position": e.position, "employee_code": e.employee_code, "avatar_color": e.avatar_color,
            "photo_url": None, "employment_status": e.employment_status}


def performance(user, rng="this_month", employee_id=None):
    if rng not in RANGES:
        validation({"range": "Pilih this_month, last_month, atau last_90"}, "Rentang tidak valid")
    company = user.company
    today = ctx.today(company)
    frm, to, pfrm, pto = bounds(rng, today)
    emps = Employee.objects.filter(company_id=company.id, employment_status="active").order_by("employee_code")
    if employee_id:
        emps = emps.filter(id=employee_id)
    emps = list(emps)
    ids = [e.id for e in emps]
    lo = min(today - dt.timedelta(days=200), pfrm)
    recs = [{"employee_id": r[0], "date": r[1], "status": r[2], "work_minutes": r[3]} for r in AttendanceRecord.objects.filter(
        company_id=company.id, employee_id__in=ids, attendance_date__gte=lo, attendance_date__lte=today).values_list("employee_id", "attendance_date", "status", "work_minutes")]
    assignee = dict(TaskAssignment.objects.filter(company_id=company.id).values_list("task_id", "employee_id"))
    tasks = []
    for t in Task.objects.filter(company_id=company.id):
        tasks.append({"id": t.id, "assignee_id": assignee.get(t.id), "deadline": t.deadline, "status": t.status,
                      "status_display": "overdue" if t.status != "completed" and t.deadline < today else t.status,
                      "completed_on": ctx.local(t.completed_at, company).date() if t.completed_at else None})
    if employee_id:
        tasks = [t for t in tasks if t["assignee_id"] in ids]
    cur = [r for r in recs if frm <= r["date"] <= to]
    prev = [r for r in recs if pfrm <= r["date"] <= pto]
    cur_tasks = [t for t in tasks if frm <= t["deadline"] <= to or (t["status"] != "completed" and t["deadline"] < frm and rng == "this_month")]
    scope = cur_tasks or tasks
    S, P, T = summarize(cur), summarize(prev), task_summary(scope)
    rows = []
    for e in emps:
        a = summarize([r for r in cur if r["employee_id"] == e.id])
        tk = task_summary([t for t in scope if t["assignee_id"] == e.id])
        rows.append({"employee": _emp(e), "att": a, "task": tk, "score": productivity(a["attendanceRate"], a["punctualityRate"], tk["completionRate"])})
    rows.sort(key=lambda r: -r["score"])
    months = last_months(6, today)
    monthly = [{"key": k, **summarize([r for r in recs if r["date"].strftime("%Y-%m") == k])} for k in months]
    return {"range": rng, "from": frm, "to": to, "prev_from": pfrm, "prev_to": pto, "current": S, "previous": P, "tasks": T, "rows": rows,
            "avg_score": round(sum(r["score"] for r in rows) / len(rows)) if rows else 0, "months": monthly, "insights": insights(rows, S, P)}
