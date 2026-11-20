"""Company settings: read (role-aware) and update per section."""
import re
from decimal import Decimal

from django.db import transaction

from core.context import get_location, get_schedule, get_settings, hm_minutes, parse_hm
from core.events import audit
from core.exceptions import ApiError, validation
from employees.models import Employee
from leave_management.models import LeaveType

from .models import Profile, WorkLocation

EMAIL_RE = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")


def _hm(t):
    return t.strftime("%H:%M") if t else ""


def leave_type_out(t):
    return {"id": t.id, "company_id": t.company_id, "code": t.code, "name": t.name, "name_en": t.name_en or "",
            "is_paid": t.is_paid, "uses_quota": t.uses_quota, "requires_attachment": t.requires_attachment,
            "half_day": t.half_day, "attendance_status": t.attendance_status, "active": t.active}


def company_out(c):
    return {"id": c.id, "name": c.name, "address": c.address or "", "phone": c.phone or "", "email": c.email or "",
            "logo_url": None, "timezone": c.timezone, "email_domain": c.email_domain, "created_at": c.created_at}


def work_out(s):
    return {"start": _hm(s.work_start), "end": _hm(s.work_end), "break_start": _hm(s.break_start), "break_end": _hm(s.break_end),
            "working_days": sorted(int(d) for d in s.working_days), "late_tolerance_min": s.late_tolerance_min,
            "early_leave_tolerance_min": s.early_leave_tolerance_min}


def attendance_out(st, loc):
    return {"location": {"name": loc.name if loc else "", "address": (loc.address or "") if loc else "",
                         "lat": float(loc.latitude) if loc and loc.latitude is not None else None,
                         "lng": float(loc.longitude) if loc and loc.longitude is not None else None},
            "radius_m": loc.radius_m if loc else 100, "selfie_required": st.selfie_required, "gps_required": st.gps_required,
            "max_gps_accuracy_m": st.max_gps_accuracy_m}


def payroll_out(st):
    rules = {"unpaid_leave": "prorate", "absent": "none", "late_per_incident": 0, "overtime_enabled": True, **(st.payroll_rules or {})}
    return {"period": st.payroll_period, "payment_day_mode": st.payment_day_mode, "payment_day": st.default_payment_day,
            "rules": rules, "default_components": st.default_components or []}


def settings_for(user):
    company = user.company
    st, sch, loc = get_settings(company), get_schedule(company), get_location(company)
    att = attendance_out(st, loc)
    if user.is_employee:
        return {"work": work_out(sch),
                "attendance": {"radius_m": att["radius_m"], "selfie_required": st.selfie_required, "gps_required": st.gps_required,
                               "location": {"name": att["location"]["name"]}},
                "profile_editable_fields": list(st.profile_editable_fields or []), "company": {"name": company.name}}
    emp_status = dict(Employee.objects.filter(company_id=company.id, profile_id__isnull=False).values_list("profile_id", "employment_status"))
    users = [{"id": p.id, "company_id": p.company_id, "email": p.email, "role": p.role, "full_name": p.full_name,
              "avatar_color": p.avatar_color, "is_active": p.is_active,
              "status": ("inactive" if not p.is_active else emp_status.get(p.id, "active"))}
             for p in Profile.objects.filter(company_id=company.id).order_by("-role", "full_name")]
    return {"company_id": company.id, "company": company_out(company), "work": work_out(sch), "attendance": att,
            "payroll": payroll_out(st),
            "leave": {"annual_quota_days": st.annual_leave_quota_days, "approval": st.leave_approval, "min_notice_days": 0},
            "notifications": {"leave_requests": True, "attendance_reminder": True, "task_deadline": True, "payroll": True, **(st.notification_prefs or {})},
            "profile_editable_fields": list(st.profile_editable_fields or []),
            "leave_types": [leave_type_out(t) for t in LeaveType.objects.filter(company_id=company.id).order_by("created_at", "code")],
            "users": users}


def _int(v, default=None):
    try:
        return int(float(v))
    except (TypeError, ValueError):
        return default


def _num(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _bool(v):
    return v in (True, 1, "1", "true", "on", "True")


@transaction.atomic
def update_settings(user, section, d):
    company = user.company
    st = get_settings(company)
    errors = {}
    d = d or {}
    if section == "company":
        name = (d.get("name") or "").strip()
        if len(name) < 2:
            errors["name"] = "Nama perusahaan wajib diisi"
        if d.get("email") and not EMAIL_RE.match(d["email"]):
            errors["email"] = "Email tidak valid"
        validation(errors, "Periksa kembali pengaturan")
        company.name, company.address, company.phone, company.email = name, d.get("address") or "", d.get("phone") or "", d.get("email") or ""
        company.save(update_fields=["name", "address", "phone", "email", "updated_at"])
    elif section == "work":
        sch = get_schedule(company)
        start, end = parse_hm(d.get("start")), parse_hm(d.get("end"))
        bs, be = parse_hm(d.get("break_start")), parse_hm(d.get("break_end"))
        if not start or not end:
            errors["start"] = "Jam kerja wajib diisi"
        elif hm_minutes(end) <= hm_minutes(start):
            errors["end"] = "Jam selesai harus setelah jam mulai"
        if bs and be and hm_minutes(be) <= hm_minutes(bs):
            errors["break_end"] = "Jam istirahat selesai harus setelah mulai"
        days = d.get("working_days") or []
        try:
            days = sorted({int(x) for x in days})
        except (TypeError, ValueError):
            days = []
        if not days or any(x < 0 or x > 6 for x in days):
            errors["working_days"] = "Pilih minimal satu hari kerja"
        late = _int(d.get("late_tolerance_min"))
        if late is None or not 0 <= late <= 120:
            errors["late_tolerance_min"] = "Toleransi 0–120 menit"
        early = _int(d.get("early_leave_tolerance_min"), 0)
        if not 0 <= early <= 120:
            errors["early_leave_tolerance_min"] = "Toleransi 0–120 menit"
        validation(errors, "Periksa kembali pengaturan")
        sch.work_start, sch.work_end, sch.break_start, sch.break_end = start, end, bs if (bs and be) else None, be if (bs and be) else None
        sch.working_days, sch.late_tolerance_min, sch.early_leave_tolerance_min = days, late, early
        sch.save()
    elif section == "attendance":
        has_lat = d.get("lat") not in ("", None)
        has_lng = d.get("lng") not in ("", None)
        lat, lng = _num(d.get("lat")) if has_lat else None, _num(d.get("lng")) if has_lng else None
        if has_lat != has_lng:
            errors["lat"] = "Isi latitude dan longitude bersamaan"
        if has_lat and (lat is None or not -90 <= lat <= 90):
            errors["lat"] = "Latitude harus −90 s/d 90"
        if has_lng and (lng is None or not -180 <= lng <= 180):
            errors["lng"] = "Longitude harus −180 s/d 180"
        radius = _int(d.get("radius_m"))
        if radius is None or not 10 <= radius <= 5000:
            errors["radius_m"] = "Radius 10–5000 meter"
        acc = _int(d.get("max_gps_accuracy_m"))
        if acc is None or not 5 <= acc <= 1000:
            errors["max_gps_accuracy_m"] = "Akurasi 5–1000 meter"
        if has_lat and not (d.get("name") or "").strip():
            errors["name"] = "Nama lokasi wajib diisi"
        validation(errors, "Periksa kembali pengaturan")
        loc = get_location(company) or WorkLocation(company_id=company.id, is_primary=True, active=True)
        loc.name = (d.get("name") or "").strip() or "Lokasi Kerja Utama"
        loc.address = d.get("address") or ""
        loc.latitude = Decimal(str(round(lat, 6))) if has_lat else None
        loc.longitude = Decimal(str(round(lng, 6))) if has_lng else None
        loc.radius_m = radius
        loc.save()
        st.max_gps_accuracy_m, st.selfie_required, st.gps_required = acc, _bool(d.get("selfie_required")), _bool(d.get("gps_required"))
        st.save(update_fields=["max_gps_accuracy_m", "selfie_required", "gps_required", "updated_at"])
    elif section == "payroll":
        mode = "join_date" if d.get("payment_day_mode") == "join_date" else "fixed"
        day = _int(d.get("payment_day"))
        if mode == "fixed" and (day is None or not 1 <= day <= 31):
            errors["payment_day"] = "Tanggal 1–31"
        comps = []
        for i, c in enumerate(d.get("default_components") or []):
            amt = _num(c.get("amount")) if isinstance(c, dict) else None
            if not isinstance(c, dict) or not (c.get("name") or "").strip() or amt is None or amt < 0:
                errors[f"component_{i}"] = "Komponen tidak valid"
            else:
                comps.append({"name": c["name"].strip(), "amount": amt})
        rules_in = d.get("rules") or {}
        late_fee = _num(rules_in.get("late_per_incident") or 0)
        if late_fee is None or late_fee < 0:
            errors["late_per_incident"] = "Tidak boleh negatif"
        validation(errors, "Periksa kembali pengaturan")
        rules = {**(st.payroll_rules or {}),
                 "unpaid_leave": "prorate" if rules_in.get("unpaid_leave") == "prorate" else "none",
                 "absent": "prorate" if rules_in.get("absent") == "prorate" else "none",
                 "late_per_incident": late_fee, "overtime_enabled": _bool(rules_in.get("overtime_enabled"))}
        st.payment_day_mode = mode
        if mode == "fixed":
            st.default_payment_day = day
        st.payroll_period = "monthly"
        st.payroll_rules, st.default_components = rules, comps
        st.save()
    elif section == "leave":
        q = _int(d.get("annual_quota_days"))
        if q is None or not 0 <= q <= 60:
            errors["annual_quota_days"] = "0–60 hari"
        validation(errors, "Periksa kembali pengaturan")
        st.annual_leave_quota_days = q
        st.save(update_fields=["annual_leave_quota_days", "updated_at"])
        for u in d.get("types") or []:
            t = LeaveType.objects.filter(company_id=company.id, id=u.get("id")).first()
            if t:
                t.is_paid, t.requires_attachment, t.active = _bool(u.get("is_paid")), _bool(u.get("requires_attachment")), _bool(u.get("active"))
                t.save(update_fields=["is_paid", "requires_attachment", "active"])
    elif section == "notifications":
        keys = ("leave_requests", "attendance_reminder", "task_deadline", "payroll")
        st.notification_prefs = {**(st.notification_prefs or {}), **{k: _bool(d.get(k)) for k in keys if k in d}}
        st.save(update_fields=["notification_prefs", "updated_at"])
    elif section == "profile_fields":
        allowed = [f for f in (d.get("fields") or []) if f in ("phone", "address")]
        st.profile_editable_fields = allowed
        st.save(update_fields=["profile_editable_fields", "updated_at"])
    else:
        raise ApiError("Bagian pengaturan tidak dikenal", "VALIDATION", 422)
    audit(user, f"settings.{section}", "company_settings", company.id, f"Memperbarui pengaturan: {section}")
    return settings_for(user)
