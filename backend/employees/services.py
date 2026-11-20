import re

from django.db import IntegrityError, transaction

from accounts.models import Profile
from core import supabase_admin
from core.context import get_settings, parse_date, today
from core.events import audit
from core.exceptions import forbidden, get_or_404, validation
from core.shapes import num

from .models import Employee, EmploymentHistory

EMAIL_RE = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")
PHONE_RE = re.compile(r"^[0-9+\-\s()]{8,20}$")
COLORS = ["#6C55F2", "#4F8DF7", "#E0559B", "#13A985", "#F08A10", "#8B5CF6", "#0EA5E9"]


def employee_out(e, history=None):
    if history is None:
        history = list(e.history.order_by("event_date", "created_at"))
    return {"id": e.id, "company_id": e.company_id, "employee_code": e.employee_code, "full_name": e.full_name, "nickname": e.nickname,
            "email": e.email, "phone": e.phone or "", "address": e.address or "", "position": e.position, "join_date": e.join_date,
            "employment_status": e.employment_status, "employment_type": e.employment_type, "avatar_color": e.avatar_color,
            "photo_url": None, "user_id": e.profile_id, "history": [{"date": h.event_date, "event": h.event} for h in history],
            "created_at": e.created_at}


def salary_config_out(c):
    if c is None:
        return None
    return {"employee_id": c.employee_id, "company_id": c.company_id, "basic_salary": num(c.basic_salary),
            "allowances": [{"name": a.get("name"), "amount": num(a.get("amount"))} for a in (c.allowances or [])],
            "overtime_rate_per_hour": num(c.overtime_rate_per_hour), "pay_day": c.pay_day, "effective_from": c.effective_from}


def current_salary_config(employee, on=None):
    from payroll.models import SalaryConfiguration
    qs = SalaryConfiguration.objects.filter(employee_id=employee.id)
    if on:
        qs = qs.filter(effective_from__lte=on)
    return qs.order_by("-effective_from", "-created_at").first() or SalaryConfiguration.objects.filter(employee_id=employee.id).order_by("effective_from").first()


def get_company_employee(user, emp_id):
    return get_or_404(Employee.objects.filter(company_id=user.company_id), "Karyawan tidak ditemukan", id=emp_id)


def list_employees(user, q):
    qs = Employee.objects.filter(company_id=user.company_id).prefetch_related("history").order_by("employee_code")
    if q.get("status"):
        qs = qs.filter(employment_status=q["status"])
    if q.get("position"):
        qs = qs.filter(position=q["position"])
    rows = [employee_out(e, sorted(e.history.all(), key=lambda h: (h.event_date, h.created_at))) for e in qs]
    if q.get("search"):
        t = q["search"].lower()
        rows = [r for r in rows if any(t in (r[k] or "").lower() for k in ("full_name", "email", "employee_code", "position"))]
    return rows


def validate_employee(user, d, is_new, self_id=None):
    errors = {}
    name = (d.get("full_name") or "").strip()
    email = (d.get("email") or "").strip().lower()
    if len(name) < 3:
        errors["full_name"] = "Nama minimal 3 karakter"
    if not EMAIL_RE.match(email):
        errors["email"] = "Format email tidak valid"
    else:
        domain = (user.company.email_domain or "").lower()
        if domain and not email.endswith("@" + domain):
            errors["email"] = f"Email harus memakai domain @{domain}"
        elif Employee.objects.filter(company_id=user.company_id, email__iexact=email).exclude(id=self_id).exists():
            errors["email"] = "Email sudah digunakan"
        elif (Profile.objects.filter(email__iexact=email).exclude(employee__id=self_id) if self_id
              else Profile.objects.filter(email__iexact=email)).exists():
            errors["email"] = "Email sudah dipakai akun lain"
    if d.get("phone") and not PHONE_RE.match(str(d["phone"])):
        errors["phone"] = "Nomor telepon tidak valid"
    if not (d.get("position") or "").strip():
        errors["position"] = "Jabatan wajib diisi"
    if not parse_date(d.get("join_date")):
        errors["join_date"] = "Tanggal bergabung wajib diisi"
    if is_new:
        try:
            ok = float(d.get("basic_salary")) > 0
        except (TypeError, ValueError):
            ok = False
        if not ok:
            errors["basic_salary"] = "Gaji pokok harus lebih dari 0"
        try:
            if float(d.get("overtime_rate_per_hour") or 0) < 0:
                errors["overtime_rate_per_hour"] = "Tidak boleh negatif"
        except (TypeError, ValueError):
            errors["overtime_rate_per_hour"] = "Tarif lembur tidak valid"
    validation(errors)
    return name, email


@transaction.atomic
def create_employee(user, d):
    from payroll.models import SalaryConfiguration
    name, email = validate_employee(user, d, True)
    company = user.company
    n = Employee.objects.filter(company_id=company.id).count() + 1
    join = parse_date(d["join_date"])
    e = Employee.objects.create(company_id=company.id, full_name=name, email=email, phone=(d.get("phone") or "").strip() or None,
                                address=(d.get("address") or "").strip() or None, position=d["position"].strip(),
                                employment_type=d.get("employment_type") or "Tetap", join_date=join,
                                nickname=email.split("@")[0], avatar_color=COLORS[n % len(COLORS)])
    e.refresh_from_db()  # employee_code assigned by trigger
    EmploymentHistory.objects.create(company_id=company.id, employee=e, event_date=join, event=f"Bergabung sebagai {e.position}", created_by_id=user.profile.id)
    st = get_settings(company)
    SalaryConfiguration.objects.create(company_id=company.id, employee=e, basic_salary=d["basic_salary"],
                                       allowances=[{"name": c["name"], "amount": c["amount"]} for c in (st.default_components or [])],
                                       overtime_rate_per_hour=d.get("overtime_rate_per_hour") or 0, effective_from=join)
    if d.get("create_account") in (True, "true", "on", 1, "1"):
        uid = supabase_admin.invite_user(email, name)
        Profile.objects.update_or_create(id=uid, defaults={"company_id": company.id, "role": "employee", "full_name": name, "email": email,
                                                           "avatar_color": e.avatar_color, "is_active": True})
        e.profile_id = uid
        e.save(update_fields=["profile_id", "updated_at"])
    audit(user, "employee.create", "employee", e.id, f"Menambahkan karyawan {e.full_name} ({e.employee_code})")
    return employee_out(e)


@transaction.atomic
def update_employee(user, emp_id, d):
    e = get_company_employee(user, emp_id)
    if user.is_employee:
        if user.employee_id != e.id:
            raise forbidden()
        allowed = get_settings(user.company).profile_editable_fields or []
        if d.get("phone") and not PHONE_RE.match(str(d["phone"])):
            validation({"phone": "Nomor telepon tidak valid"}, "Periksa kembali data")
        changed = [k for k in ("phone", "address") if k in d and k in allowed]
        for k in changed:
            setattr(e, k, (d.get(k) or "").strip() or None)
        if changed:
            e.save(update_fields=changed + ["updated_at"])
        return employee_out(e)
    merged = {**employee_out(e), **{k: v for k, v in d.items() if v is not None}}
    name, email = validate_employee(user, merged, False, e.id)
    before_pos = e.position
    e.full_name, e.email = name, email
    for k in ("phone", "address"):
        if k in d:
            setattr(e, k, (d.get(k) or "").strip() or None)
    if d.get("position"):
        e.position = d["position"].strip()
    if d.get("join_date"):
        e.join_date = parse_date(d["join_date"])
    if d.get("employment_type"):
        e.employment_type = d["employment_type"]
    try:
        e.save()
    except IntegrityError:
        validation({"email": "Email sudah digunakan"})
    if before_pos != e.position:
        EmploymentHistory.objects.create(company_id=e.company_id, employee=e, event_date=today(user.company),
                                         event=f"Jabatan berubah: {before_pos} → {e.position}", created_by_id=user.profile.id)
    if e.profile_id:
        Profile.objects.filter(id=e.profile_id).update(full_name=e.full_name, email=e.email)
    audit(user, "employee.update", "employee", e.id, f"Memperbarui data {e.full_name}")
    return employee_out(e)


@transaction.atomic
def set_status(user, emp_id, status):
    e = get_company_employee(user, emp_id)
    if e.employment_status == status:
        return employee_out(e)
    e.employment_status = status
    e.save(update_fields=["employment_status", "updated_at"])
    EmploymentHistory.objects.create(company_id=e.company_id, employee=e, event_date=today(user.company),
                                     event="Akun dinonaktifkan" if status == "inactive" else "Akun diaktifkan kembali", created_by_id=user.profile.id)
    audit(user, "employee.deactivate" if status == "inactive" else "employee.activate", "employee", e.id,
          f"{'Menonaktifkan' if status == 'inactive' else 'Mengaktifkan'} {e.full_name}")
    return employee_out(e)
