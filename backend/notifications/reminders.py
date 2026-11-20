"""Scheduled reminders (Phase 8).

Run every 15–30 minutes (``python manage.py send_reminders``, or POST
/api/cron/reminders/ with the CRON_SECRET header). Every reminder is
idempotent: the same reminder is sent at most once per recipient per local
day, so running the job more often never spams anyone.

Respects Settings → Notifikasi:
  attendance_reminder → belum check-in / lupa check-out / rekonsiliasi kemarin
  task_deadline       → deadline besok / hari ini / terlewat
  payroll             → tanggal gajian & gaji belum dibayar
"""
import calendar
import datetime as dt
import logging

from django.utils import timezone

from accounts.models import Company
from attendance.models import AttendanceRecord
from core import context as ctx
from core.events import owner_ids
from employees.models import Employee
from leave_management.models import LeaveRequest
from payroll.models import PayrollItem
from task_management.models import Task, TaskAssignment

from .models import Notification

log = logging.getLogger("absenninn.reminders")
CHECKIN_GRACE_MIN = 15          # employees are reminded this long after work starts
CHECKOUT_GRACE_MIN = 30         # remind this long after work ends


class Sender:
    def __init__(self, company, now):
        self.company, self.now = company, now
        local = ctx.local(now, company)
        self.today = local.date()
        self.minute = local.hour * 60 + local.minute
        self.sent = []

    def once(self, recipient_id, type, title, message, link=None):
        """Create the notification unless an identical one exists. Every message
        carries its date, so "identical" means "already sent for that day"."""
        if not recipient_id:
            return False
        recent = timezone.now() - dt.timedelta(days=14)
        if Notification.objects.filter(recipient_id=recipient_id, type=type, message=message, created_at__gte=recent).exists():
            return False
        Notification.objects.create(company_id=self.company.id, recipient_id=recipient_id, type=type, title=title, message=message, link=link)
        self.sent.append((type, str(recipient_id)))
        return True


def _prefs(company):
    return {"leave_requests": True, "attendance_reminder": True, "task_deadline": True, "payroll": True, **(ctx.get_settings(company).notification_prefs or {})}


def attendance_reminders(s, sch):
    if not ctx.is_work_day(sch, s.today):
        return
    start, end = ctx.hm_minutes(sch.work_start), ctx.hm_minutes(sch.work_end)
    emps = list(Employee.objects.filter(company_id=s.company.id, employment_status="active", join_date__lte=s.today, profile_id__isnull=False))
    recs = {r.employee_id: r for r in AttendanceRecord.objects.filter(company_id=s.company.id, attendance_date=s.today)}
    on_leave = set(LeaveRequest.objects.filter(company_id=s.company.id, status="approved", start_date__lte=s.today, end_date__gte=s.today,
                                               leave_type__half_day=False).values_list("employee_id", flat=True))
    if start + CHECKIN_GRACE_MIN <= s.minute < end:
        missing = [e for e in emps if e.id not in recs and e.id not in on_leave]
        for e in missing:
            s.once(e.profile_id, "attendance_reminder", "Belum check-in", f"Anda belum check-in hari ini ({s.today:%d/%m/%Y}). Jam kerja mulai {sch.work_start:%H:%M}.",
                   "employee/attendance.html")
        if missing and s.minute >= start + (sch.late_tolerance_min or 0):
            names = ", ".join(e.full_name for e in missing)
            for oid in owner_ids(s.company.id):
                s.once(oid, "attendance_reminder", "Karyawan belum check-in", f"{len(missing)} karyawan belum check-in hari ini ({s.today:%d/%m/%Y}): {names}.",
                       "owner/attendance.html")
    if s.minute >= end + CHECKOUT_GRACE_MIN:
        for e in emps:
            r = recs.get(e.id)
            if r and r.check_in_at and not r.check_out_at:
                s.once(e.profile_id, "checkout_reminder", "Jangan lupa check-out", f"Anda belum check-out hari ini ({s.today:%d/%m/%Y}).", "employee/attendance.html")


def reconcile_reminder(s, sch):
    """Morning nudge for the owner: yesterday's working day still has employees without any record."""
    y = s.today - dt.timedelta(days=1)
    if not ctx.is_work_day(sch, y) or s.minute < ctx.hm_minutes(sch.work_start):
        return
    emps = Employee.objects.filter(company_id=s.company.id, employment_status="active", join_date__lte=y)
    have = set(AttendanceRecord.objects.filter(company_id=s.company.id, attendance_date=y).values_list("employee_id", flat=True))
    missing = [e for e in emps if e.id not in have]
    if missing:
        for oid in owner_ids(s.company.id):
            s.once(oid, "reconcile_reminder", "Rekonsiliasi absensi kemarin",
                   f"{len(missing)} karyawan tanpa catatan absensi/izin pada {y:%d/%m/%Y}. Buka Attendance → Rekonsiliasi.", "owner/attendance.html")


def task_reminders(s):
    open_tasks = Task.objects.filter(company_id=s.company.id).exclude(status="completed")
    assignees = {a.task_id: a.employee for a in TaskAssignment.objects.filter(company_id=s.company.id).select_related("employee")}
    tomorrow, yesterday = s.today + dt.timedelta(days=1), s.today - dt.timedelta(days=1)
    for t in open_tasks.filter(deadline__in=[tomorrow, s.today, yesterday]):
        e = assignees.get(t.id)
        pid = e.profile_id if e and e.employment_status == "active" else None
        if t.deadline == tomorrow:
            s.once(pid, "task_deadline", "Deadline besok", f'Tugas "{t.title}" jatuh tempo besok ({t.deadline:%d/%m/%Y}).', "employee/tasks.html")
        elif t.deadline == s.today:
            s.once(pid, "task_deadline", "Deadline hari ini", f'Tugas "{t.title}" jatuh tempo hari ini ({t.deadline:%d/%m/%Y}).', "employee/tasks.html")
        else:
            s.once(pid, "task_deadline", "Tugas melewati deadline", f'Tugas "{t.title}" melewati deadline ({t.deadline:%d/%m/%Y}).', "employee/tasks.html")
            for oid in owner_ids(s.company.id):
                s.once(oid, "task_deadline", "Tugas melewati deadline",
                       f'"{t.title}"{(" (" + e.full_name + ")") if e else ""} melewati deadline {t.deadline:%d/%m/%Y} dan belum selesai.', "owner/tasks.html")


def payroll_reminders(s):
    st = ctx.get_settings(s.company)
    owners = owner_ids(s.company.id)
    # Paydays today/tomorrow: unpaid items, or no approved payroll yet.
    for e in Employee.objects.filter(company_id=s.company.id, employment_status="active", join_date__lt=s.today):
        for d, when in ((s.today, "hari ini"), (s.today + dt.timedelta(days=1), "besok")):
            day = e.join_date.day if st.payment_day_mode == "join_date" else (st.default_payment_day or 28)
            pay = d.replace(day=min(day, calendar.monthrange(d.year, d.month)[1]))
            if pay != d:
                continue
            item = PayrollItem.objects.filter(employee_id=e.id, payment_date=d).select_related("period").first()
            if item and item.status == "paid":
                continue
            if item and item.period.status in ("approved", "scheduled"):
                msg = f"Gaji {e.full_name} jatuh tempo {when} ({d:%d/%m/%Y}). Setelah transfer, konfirmasi pembayaran di Payroll."
            else:
                msg = f"Tanggal gajian {e.full_name} {when} ({d:%d/%m/%Y}) — payroll {d:%m/%Y} belum disetujui. Hitung & setujui di Payroll."
            for oid in owners:
                s.once(oid, "payroll_reminder", "Pengingat gajian", msg, "owner/payroll.html")
    # Approved but unpaid after the payday → daily until confirmed.
    for item in PayrollItem.objects.filter(company_id=s.company.id, payment_date__lt=s.today, status__in=["approved", "scheduled"]).select_related("employee"):
        for oid in owners:
            s.once(oid, "salary_delayed", "Gaji belum dibayar",
                   f"Gaji {item.employee.full_name} (jatuh tempo {item.payment_date:%d/%m/%Y}) belum dikonfirmasi dibayar.", "owner/payroll.html")


def run(now=None, company_ids=None):
    now = now or ctx.now()
    total = {}
    qs = Company.objects.all()
    if company_ids:
        qs = qs.filter(id__in=company_ids)
    for company in qs:
        try:
            s = Sender(company, now)
            prefs, sch = _prefs(company), ctx.get_schedule(company)
            if prefs.get("attendance_reminder"):
                attendance_reminders(s, sch)
                reconcile_reminder(s, sch)
            if prefs.get("task_deadline"):
                task_reminders(s)
            if prefs.get("payroll"):
                payroll_reminders(s)
            total[str(company.id)] = len(s.sent)
        except Exception:                      # one broken company must not stop the others
            log.exception("reminders failed for company %s", company.id)
            total[str(company.id)] = "error"
    return total
