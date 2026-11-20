"""Leave requests: validation, quota, approval → attendance integration."""
import os
import uuid

from django.conf import settings as dj
from django.db import transaction

from accounts.services import leave_type_out
from attendance.models import AttendanceRecord
from core import context as ctx
from core.events import audit, notify_employee, notify_owners
from core.exceptions import ApiError, get_or_404, validation
from core.shapes import pick_emp
from core.storage import check_upload, get_storage
from employees.models import Employee

from .models import LeaveRequest, LeaveType


def leave_days(lr_or_type, start, end, sch):
    t = lr_or_type
    n = 0.0
    for d in ctx.date_range(start, end):
        if ctx.is_work_day(sch, d):
            n += 0.5 if t.half_day else 1
    return int(n) if float(n).is_integer() else n


def leave_out(lr, sch=None):
    sch = sch or ctx.get_schedule(lr.company)
    return {"id": lr.id, "company_id": lr.company_id, "employee_id": lr.employee_id, "leave_type_id": lr.leave_type_id,
            "start_date": lr.start_date, "end_date": lr.end_date, "reason": lr.reason,
            "attachment_name": os.path.basename(lr.attachment_path).split("__", 1)[-1] if lr.attachment_path else None,
            "has_attachment": bool(lr.attachment_path), "status": lr.status, "owner_notes": lr.owner_notes or "",
            "requested_at": lr.requested_at, "decided_at": lr.decided_at, "decided_by": lr.decided_by_id,
            "employee": pick_emp(lr.employee), "leave_type": leave_type_out(lr.leave_type),
            "days": leave_days(lr.leave_type, lr.start_date, lr.end_date, sch)}


def _qs(user):
    qs = LeaveRequest.objects.filter(company_id=user.company_id).select_related("employee", "leave_type", "company")
    return qs.filter(employee_id=user.employee_id) if user.is_employee else qs


def types(user):
    return [leave_type_out(t) for t in LeaveType.objects.filter(company_id=user.company_id).order_by("created_at", "code")]


def list_requests(user, q):
    qs = _qs(user)
    if user.is_owner and q.get("employee_id"):
        try:
            qs = qs.filter(employee_id=uuid.UUID(str(q["employee_id"])))
        except ValueError:
            return []
    if q.get("status"):
        qs = qs.filter(status=q["status"])
    sch = ctx.get_schedule(user.company)
    return [leave_out(lr, sch) for lr in qs.order_by("-requested_at")]


def get_request(user, pk):
    return leave_out(get_or_404(_qs(user), "Pengajuan tidak ditemukan", id=pk))


def balance(user, employee_id=None):
    company = user.company
    emp_id = user.employee_id if user.is_employee else employee_id
    if not emp_id:
        validation({"employee_id": "Pilih karyawan"})
    get_or_404(Employee.objects.filter(company_id=company.id), "Karyawan tidak ditemukan", id=emp_id)
    year = ctx.today(company).year
    sch = ctx.get_schedule(company)
    used = 0.0
    for lr in LeaveRequest.objects.filter(employee_id=emp_id, status="approved", leave_type__uses_quota=True,
                                          start_date__year=year).select_related("leave_type"):
        used += leave_days(lr.leave_type, lr.start_date, lr.end_date, sch)
    quota = ctx.get_settings(company).annual_leave_quota_days or 0
    used = int(used) if used.is_integer() else used
    # No active leave type uses a quota (e.g. Firzzzy Store: every leave simply cuts pay) → no "saldo cuti".
    enabled = quota > 0 and LeaveType.objects.filter(company_id=company.id, active=True, uses_quota=True).exists()
    taken = 0.0
    for lr in LeaveRequest.objects.filter(employee_id=emp_id, status="approved", start_date__year=year).select_related("leave_type"):
        taken += leave_days(lr.leave_type, lr.start_date, lr.end_date, sch)
    taken = int(taken) if float(taken).is_integer() else taken
    return {"enabled": enabled, "quota": quota, "used": used, "remaining": max(0, quota - used), "taken_days": taken}


@transaction.atomic
def request_leave(user, d, file=None):
    company = user.company
    errors = {}
    try:
        t = LeaveType.objects.filter(company_id=company.id, id=uuid.UUID(str(d.get("leave_type_id"))), active=True).first()
    except (TypeError, ValueError):
        t = None
    if not t:
        errors["leave_type_id"] = "Pilih jenis izin"
    start, end = ctx.parse_date(d.get("start_date")), ctx.parse_date(d.get("end_date"))
    if not start:
        errors["start_date"] = "Tanggal mulai wajib diisi"
    if not end:
        errors["end_date"] = "Tanggal selesai wajib diisi"
    if start and end and end < start:
        errors["end_date"] = "Tanggal selesai harus setelah tanggal mulai"
    if start and end and (end - start).days > 60:
        errors["end_date"] = "Maksimal 60 hari per pengajuan"
    if t and t.half_day and start and end and start != end:
        errors["end_date"] = "Izin setengah hari hanya untuk 1 tanggal"
    reason = (d.get("reason") or "").strip()
    if len(reason) < 5:
        errors["reason"] = "Alasan minimal 5 karakter"
    if t and t.requires_attachment and not file:
        errors["attachment"] = f"Lampiran wajib untuk {t.name}"
    sch = ctx.get_schedule(company)
    if "start_date" not in errors and "end_date" not in errors and start and end:
        if LeaveRequest.objects.filter(employee_id=user.employee_id, status__in=["pending", "approved"],
                                       start_date__lte=end, end_date__gte=start).exists():
            errors["start_date"] = "Bertabrakan dengan pengajuan lain yang masih aktif"
        elif leave_days(t or LeaveType(half_day=False), start, end, sch) == 0:
            errors["start_date"] = "Rentang tanggal tidak mencakup hari kerja"
    if t and t.uses_quota and start and end and "end_date" not in errors and "start_date" not in errors:
        bal = balance(user)
        days = leave_days(t, start, end, sch)
        if days > bal["remaining"]:
            errors["end_date"] = f"Saldo cuti tidak cukup (sisa {bal['remaining']} hari)"
    validation(errors, "Periksa kembali pengajuan")
    path = None
    if file:
        data, mime = check_upload(file)
        safe = "".join(ch for ch in os.path.basename(file.name) if ch.isalnum() or ch in "._- ")[:80].strip() or "lampiran"
        path = f"{company.id}/{user.employee_id}/{uuid.uuid4().hex[:10]}__{safe}"
        get_storage().upload(dj.BUCKET_ATTACHMENTS, path, data, mime)
    lr = LeaveRequest.objects.create(company_id=company.id, employee_id=user.employee_id, leave_type=t, start_date=start, end_date=end,
                                     reason=reason, attachment_path=path, status="pending")
    span = f"{start:%d/%m/%Y}" + (f" – {end:%d/%m/%Y}" if end != start else "")
    notify_owners(company, "leave_request", "Pengajuan izin baru", f"{user.full_name} mengajukan {t.name} ({span}).", "owner/leave.html", pref="leave_requests")
    return leave_out(LeaveRequest.objects.select_related("employee", "leave_type", "company").get(id=lr.id), sch)


@transaction.atomic
def decide(user, pk, decision, notes):
    company = user.company
    lr = get_or_404(LeaveRequest.objects.select_for_update().filter(company_id=company.id), "Pengajuan tidak ditemukan", id=pk)
    if lr.status != "pending":
        raise ApiError("Pengajuan sudah diproses", "ALREADY_DECIDED", 409)
    notes = (notes or "").strip()
    if decision == "rejected" and len(notes) < 3:
        raise ApiError("Berikan catatan alasan penolakan", "VALIDATION", 422, {"notes": "Catatan wajib saat menolak"})
    t = lr.leave_type
    lr.status, lr.owner_notes, lr.decided_at, lr.decided_by_id = decision, notes, ctx.now(), user.profile.id
    lr.save()
    sch = ctx.get_schedule(company)
    if decision == "approved" and not t.half_day:
        for d in ctx.date_range(lr.start_date, lr.end_date):
            if not ctx.is_work_day(sch, d):
                continue
            ex = AttendanceRecord.objects.filter(employee_id=lr.employee_id, attendance_date=d).first()
            if ex and ex.check_in_at:
                continue                       # never overwrite a real check-in
            if ex:
                ex.status, ex.leave_request_id, ex.notes = t.attendance_status, lr.id, t.name
                ex.save(update_fields=["status", "leave_request_id", "notes", "updated_at"])
            else:
                AttendanceRecord.objects.create(company_id=company.id, employee_id=lr.employee_id, attendance_date=d, status=t.attendance_status,
                                                leave_request_id=lr.id, source="leave", notes=t.name, flags=[])
    emp = lr.employee
    ok = decision == "approved"
    notify_employee(emp, "leave_approved" if ok else "leave_rejected", "Izin disetujui" if ok else "Izin ditolak",
                    f"{t.name} ({lr.start_date:%d/%m/%Y}) {'disetujui' if ok else 'ditolak'}.{(' Catatan: ' + notes) if notes else ''}", "employee/leave.html")
    audit(user, f"leave.{'approve' if ok else 'reject'}", "leave_request", lr.id, f"{'Menyetujui' if ok else 'Menolak'} {t.name} — {emp.full_name}")
    return leave_out(LeaveRequest.objects.select_related("employee", "leave_type", "company").get(id=lr.id), sch)


@transaction.atomic
def cancel(user, pk):
    lr = get_or_404(LeaveRequest.objects.select_for_update().filter(employee_id=user.employee_id), "Pengajuan tidak ditemukan", id=pk)
    if lr.status != "pending":
        raise ApiError("Hanya pengajuan pending yang bisa dibatalkan", "ALREADY_DECIDED", 409)
    lr.status = "cancelled"
    lr.save(update_fields=["status"])
    return leave_out(LeaveRequest.objects.select_related("employee", "leave_type", "company").get(id=lr.id))


def attachment_url(user, pk):
    lr = get_or_404(_qs(user), "Pengajuan tidak ditemukan", id=pk)
    if not lr.attachment_path:
        raise ApiError("Pengajuan ini tidak memiliki lampiran", "NOT_FOUND", 404)
    url = get_storage().signed_url(dj.BUCKET_ATTACHMENTS, lr.attachment_path)
    if not url:
        raise ApiError("Lampiran tidak dapat diambil dari storage", "STORAGE_ERROR", 502)
    return {"url": url, "expires_in": dj.SIGNED_URL_EXPIRES_SECONDS, "name": leave_out(lr)["attachment_name"]}

