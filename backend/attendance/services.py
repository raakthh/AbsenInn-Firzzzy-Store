"""Attendance domain logic (server-authoritative).

Time, distance and status are always computed here — the browser only
supplies the selfie, raw GPS coordinates and accuracy. GPS from a browser
can be spoofed; suspicious data is flagged for owner review rather than
silently accepted or rejected.
"""
import datetime as dt
import math
import uuid
from decimal import Decimal

from django.conf import settings as dj
from django.db import IntegrityError, transaction

from core import context as ctx
from core.events import audit, notify_employee, notify_owners
from core.exceptions import ApiError, forbidden, get_or_404, not_found, validation
from core.shapes import num, pick_emp
from core.storage import decode_data_url, get_storage
from employees.models import Employee
from leave_management.models import LeaveRequest

from .models import AttendanceCorrection, AttendanceEvidence, AttendanceRecord

STATUSES = ("present", "late", "early_leave", "sick", "paid_leave", "unpaid_leave", "absent", "needs_review")
LEAVE_STATUSES = ("sick", "paid_leave", "unpaid_leave")
ATTENDED = ("present", "late", "early_leave", "needs_review")
STALE_CAPTURE_MIN = 10


def haversine(lat1, lon1, lat2, lon2):
    r = 6371000.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi, dl = math.radians(lat2 - lat1), math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def _f(v):
    try:
        f = float(v)
        return f if math.isfinite(f) else None
    except (TypeError, ValueError):
        return None


# ---------------------------------------------------------------- shapes
def record_out(r, evidence=None, with_employee=True):
    ev = evidence if evidence is not None else (AttendanceEvidence.objects.filter(attendance_id=r.id).first() or _NoEv)
    out = {"id": r.id, "company_id": r.company_id, "employee_id": r.employee_id, "date": r.attendance_date,
           "check_in_at": r.check_in_at, "check_out_at": r.check_out_at, "work_minutes": r.work_minutes, "status": r.status,
           "location_status": r.location_status, "source": r.source, "leave_request_id": r.leave_request_id,
           "flags": list(r.flags or []), "notes": r.notes or "",
           "lat_in": num(ev.check_in_lat) if ev and ev.check_in_lat is not None else None,
           "lng_in": num(ev.check_in_lng) if ev and ev.check_in_lng is not None else None,
           "lat_out": num(ev.check_out_lat) if ev and ev.check_out_lat is not None else None,
           "lng_out": num(ev.check_out_lng) if ev and ev.check_out_lng is not None else None,
           "accuracy_in_m": round(num(ev.check_in_accuracy_m)) if ev and ev.check_in_accuracy_m is not None else None,
           "accuracy_out_m": round(num(ev.check_out_accuracy_m)) if ev and ev.check_out_accuracy_m is not None else None,
           "distance_in_m": round(num(ev.check_in_distance_m)) if ev and ev.check_in_distance_m is not None else None,
           "distance_out_m": round(num(ev.check_out_distance_m)) if ev and ev.check_out_distance_m is not None else None,
           "selfie_in_path": ev.check_in_selfie_path if ev else None,
           "selfie_out_path": ev.check_out_selfie_path if ev else None}
    if with_employee:
        out["employee"] = pick_emp(r.employee)
    return out


class _NoEvidence:
    check_in_lat = check_in_lng = check_out_lat = check_out_lng = None
    check_in_accuracy_m = check_out_accuracy_m = check_in_distance_m = check_out_distance_m = None
    check_in_selfie_path = check_out_selfie_path = None


_NoEv = _NoEvidence()


def records_out(qs):
    rows = list(qs.select_related("employee"))
    evs = {e.attendance_id: e for e in AttendanceEvidence.objects.filter(attendance_id__in=[r.id for r in rows])}
    return [record_out(r, evidence=evs.get(r.id) or _NoEv) for r in rows]


def correction_out(c):
    return {"id": c.id, "company_id": c.company_id, "attendance_id": c.attendance_id, "employee_id": c.employee_id,
            "date": c.attendance_date, "source": c.source, "status": c.status,
            "requested_check_in": c.requested_check_in.strftime("%H:%M") if c.requested_check_in else None,
            "requested_check_out": c.requested_check_out.strftime("%H:%M") if c.requested_check_out else None,
            "before": c.before_data or {}, "after": c.after_data or {}, "reason": c.reason, "owner_notes": c.owner_notes or "",
            "corrected_by": c.resolved_by_id, "corrected_by_name": c.resolved_by.full_name if c.resolved_by_id else None,
            "created_at": c.created_at, "resolved_at": c.resolved_at, "employee": pick_emp(c.employee)}


# ---------------------------------------------------------------- rules
def check_in_status(at, company, sch):
    return "late" if ctx.minutes_of_day(at, company) > ctx.hm_minutes(sch.work_start) + (sch.late_tolerance_min or 0) else "present"


def work_minutes(check_in, check_out, company, sch):
    if not check_in or not check_out:
        return None
    mins = (check_out - check_in).total_seconds() / 60
    a, b = ctx.minutes_of_day(check_in, company), ctx.minutes_of_day(check_out, company)
    if ctx.local(check_out, company).date() != ctx.local(check_in, company).date():
        b += 24 * 60
    overlap = 0
    if sch.break_start and sch.break_end:
        bs, be = ctx.hm_minutes(sch.break_start), ctx.hm_minutes(sch.break_end)
        overlap = max(0, min(b, be) - max(a, bs))
    return max(0, round(mins - overlap))


def location_check(company, lat, lng, accuracy):
    st, loc = ctx.get_settings(company), ctx.get_location(company)
    lat, lng, accuracy = _f(lat), _f(lng), _f(accuracy)
    radius = loc.radius_m if loc else 100
    if lat is None or lng is None or not (-90 <= lat <= 90 and -180 <= lng <= 180):
        return {"status": "gps_unavailable", "distance_m": None, "radius_m": radius}
    if not loc or loc.latitude is None:
        return {"status": "not_configured", "distance_m": None, "radius_m": radius}
    dist = haversine(lat, lng, float(loc.latitude), float(loc.longitude))
    status = "verified" if dist <= radius else "outside"
    if status == "verified" and accuracy is not None and accuracy > st.max_gps_accuracy_m:
        status = "needs_review"
    return {"status": status, "distance_m": round(dist), "radius_m": radius,
            "work_location": {"name": loc.name, "lat": float(loc.latitude), "lng": float(loc.longitude)}}


def _record_for(user, date):
    return AttendanceRecord.objects.filter(employee_id=user.employee_id, attendance_date=date).first()


# ---------------------------------------------------------------- queries
def history(user, q):
    qs = AttendanceRecord.objects.filter(company_id=user.company_id)
    if user.is_employee:
        qs = qs.filter(employee_id=user.employee_id)
    elif q.get("employee_id"):
        try:
            qs = qs.filter(employee_id=uuid.UUID(str(q["employee_id"])))
        except ValueError:
            return []
    for key, lookup in (("date", "attendance_date"), ("from", "attendance_date__gte"), ("to", "attendance_date__lte")):
        if q.get(key):
            d = ctx.parse_date(q[key])
            if not d:
                validation({key: "Tanggal tidak valid"})
            qs = qs.filter(**{lookup: d})
    if q.get("status"):
        qs = qs.filter(status=q["status"])
    if q.get("location_status"):
        qs = qs.filter(location_status__isnull=True) if q["location_status"] == "none" else qs.filter(location_status=q["location_status"])
    return records_out(qs.order_by("-attendance_date", "-check_in_at"))


def monitoring(user, date=None):
    company = user.company
    d = ctx.parse_date(date) if date else ctx.today(company)
    if not d:
        validation({"date": "Tanggal tidak valid"})
    sch = ctx.get_schedule(company)
    today = ctx.today(company)
    emps = list(Employee.objects.filter(company_id=company.id, employment_status="active", join_date__lte=d).order_by("employee_code"))
    recs = {r["employee_id"]: r for r in records_out(AttendanceRecord.objects.filter(company_id=company.id, attendance_date=d))}
    pending = set(LeaveRequest.objects.filter(company_id=company.id, status="pending", start_date__lte=d, end_date__gte=d).values_list("employee_id", flat=True))
    rows = []
    for e in emps:
        r = recs.get(e.id)
        rows.append({"employee": pick_emp(e), "record": r, "state": r["status"] if r else ("unreconciled" if d < today else "not_checked_in"),
                     "pending_leave": e.id in pending})
    return {"date": d, "is_work_day": ctx.is_work_day(sch, d), "rows": rows}


def get_record(user, rec_id):
    qs = AttendanceRecord.objects.filter(company_id=user.company_id).select_related("employee")
    if user.is_employee:
        qs = qs.filter(employee_id=user.employee_id)
    return get_or_404(qs, "Data absensi tidak ditemukan", id=rec_id)


def detail(user, rec_id):
    r = get_record(user, rec_id)
    out = record_out(r)
    out["corrections"] = [correction_out(c) for c in AttendanceCorrection.objects.filter(attendance_id=r.id).select_related("employee", "resolved_by").order_by("created_at")]
    return out


def evidence(user, rec_id):
    r = get_record(user, rec_id)
    ev = AttendanceEvidence.objects.filter(attendance_id=r.id).first()
    storage = get_storage() if ev and (ev.check_in_selfie_path or ev.check_out_selfie_path) else None

    def side(prefix, at):
        path = getattr(ev, f"{prefix}_selfie_path") if ev else None
        g = (lambda k: num(getattr(ev, f"{prefix}_{k}")) if ev and getattr(ev, f"{prefix}_{k}") is not None else None)
        return {"selfie_url": storage.signed_url(dj.BUCKET_SELFIES, path) if (storage and path) else None, "placeholder": False,
                "lat": g("lat"), "lng": g("lng"), "distance_m": g("distance_m"), "accuracy_m": g("accuracy_m"), "at": at}

    return {"attendance_id": r.id, "check_in": side("check_in", r.check_in_at), "check_out": side("check_out", r.check_out_at),
            "location_status": r.location_status, "flags": list(r.flags or []), "expires_in": dj.SIGNED_URL_EXPIRES_SECONDS}


def today_view(user):
    company = user.company
    d = ctx.today(company)
    sch = ctx.get_schedule(company)
    rec = AttendanceRecord.objects.filter(employee_id=user.employee_id, attendance_date=d).select_related("employee").first()
    st, loc = ctx.get_settings(company), ctx.get_location(company)
    from accounts.services import work_out
    return {"date": d, "is_work_day": ctx.is_work_day(sch, d), "schedule": work_out(sch), "record": record_out(rec) if rec else None,
            "location_configured": bool(loc and loc.latitude is not None),
            "settings": {"radius_m": loc.radius_m if loc else 100, "selfie_required": st.selfie_required, "gps_required": st.gps_required,
                         "max_gps_accuracy_m": st.max_gps_accuracy_m, "location": {"name": loc.name if loc else ""}}}


# ---------------------------------------------------------------- check-in / out
def check(user, kind, p):
    company = user.company
    st, sch = ctx.get_settings(company), ctx.get_schedule(company)
    d = ctx.today(company)
    at = ctx.now()
    p = p or {}
    lat, lng, acc = _f(p.get("lat")), _f(p.get("lng")), _f(p.get("accuracy"))
    if st.selfie_required and not p.get("selfie"):
        raise ApiError("Selfie wajib untuk absensi", "SELFIE_REQUIRED", 422)
    if st.gps_required and (lat is None or lng is None):
        raise ApiError("Lokasi GPS tidak tersedia", "GPS_UNAVAILABLE", 422)
    image = decode_data_url(p["selfie"]) if p.get("selfie") else None
    loc = location_check(company, lat, lng, acc)
    request_review = p.get("request_review") in (True, "true", 1, "1")
    if not request_review and loc["status"] in ("outside", "not_configured"):
        if loc["status"] == "outside":
            raise ApiError(f"Anda berada {loc['distance_m']} m dari lokasi kerja (radius {loc['radius_m']} m).", "OUTSIDE_RADIUS", 422, extra=loc)
        raise ApiError("Lokasi kerja belum diatur oleh owner.", "LOCATION_NOT_CONFIGURED", 422, extra=loc)
    review = request_review or loc["status"] == "needs_review"
    flags = set()
    if review:
        flags.add({"outside": "outside_radius", "not_configured": "location_not_configured", "gps_unavailable": "gps_unavailable"}.get(loc["status"], "low_gps_accuracy"))
    cap = p.get("captured_at")
    if cap:
        try:
            cap_dt = dt.datetime.fromisoformat(str(cap).replace("Z", "+00:00"))
            if cap_dt.tzinfo and abs((at - cap_dt).total_seconds()) > STALE_CAPTURE_MIN * 60:
                flags.add("stale_capture")
        except ValueError:
            pass

    rec = _record_for(user, d)
    if kind == "in":
        if rec and rec.check_in_at:
            raise ApiError("Anda sudah check-in hari ini", "ALREADY_CHECKED_IN", 409)
        if rec and rec.status in LEAVE_STATUSES:
            raise ApiError("Anda tercatat sedang izin/cuti hari ini", "ON_LEAVE", 409)
    else:
        if not rec or not rec.check_in_at:
            raise ApiError("Belum ada check-in yang valid hari ini. Ajukan koreksi absensi ke owner.", "NO_CHECK_IN", 409)
        if rec.check_out_at:
            raise ApiError("Anda sudah check-out hari ini", "ALREADY_CHECKED_OUT", 409)

    # Upload first: if storage fails nothing is recorded and the employee can retry.
    path = None
    if image:
        data, mime = image
        ext = {"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp"}[mime]
        path = f"{company.id}/{user.employee_id}/{d.isoformat()}-{kind}-{uuid.uuid4().hex[:8]}.{ext}"
        get_storage().upload(dj.BUCKET_SELFIES, path, data, mime)

    dist = Decimal(str(loc["distance_m"])) if loc["distance_m"] is not None else None
    try:
        with transaction.atomic():
            rec = AttendanceRecord.objects.select_for_update().filter(employee_id=user.employee_id, attendance_date=d).first()
            if kind == "in":
                if rec and rec.check_in_at:
                    raise ApiError("Anda sudah check-in hari ini", "ALREADY_CHECKED_IN", 409)
                if not ctx.is_work_day(sch, d):
                    flags.add("non_work_day")
                status = "needs_review" if review else check_in_status(at, company, sch)
                loc_status = ("needs_review" if loc["status"] == "verified" else loc["status"]) if review else loc["status"]
                if rec is None:
                    rec = AttendanceRecord(company_id=company.id, employee_id=user.employee_id, attendance_date=d, source="app")
                rec.check_in_at, rec.status, rec.location_status = at, status, loc_status
                rec.flags = sorted(set(rec.flags or []) | flags)
                rec.notes = (p.get("note") or "Perlu review owner") if review else (rec.notes or "")
                rec.save()
                ev, _ = AttendanceEvidence.objects.get_or_create(attendance_id=rec.id, defaults={"company_id": company.id, "employee_id": user.employee_id, "attendance_date": d})
                ev.check_in_selfie_path, ev.check_in_lat, ev.check_in_lng = path, _dec(lat), _dec(lng)
                ev.check_in_accuracy_m, ev.check_in_distance_m, ev.location_status = _dec(acc, 2), dist, loc_status
                ev.save()
                if review:
                    notify_owners(company, "attendance_review", "Absensi perlu review",
                                  f"{user.full_name} check-in dengan status lokasi: {loc['status']}.", "owner/attendance.html")
            else:
                if rec.check_out_at:
                    raise ApiError("Anda sudah check-out hari ini", "ALREADY_CHECKED_OUT", 409)
                rec.check_out_at = at
                rec.work_minutes = work_minutes(rec.check_in_at, at, company, sch)
                if review:
                    rec.status = "needs_review"
                    flags.add("checkout_location")
                elif rec.status != "needs_review" and ctx.minutes_of_day(at, company) < ctx.hm_minutes(sch.work_end) - (sch.early_leave_tolerance_min or 0):
                    if rec.status == "present":
                        rec.status = "early_leave"
                    else:
                        flags.add("early_leave")     # keep "late" for punctuality stats, but mark leaving early
                if review and rec.location_status == "verified":
                    rec.location_status = "needs_review"
                rec.flags = sorted(set(rec.flags or []) | flags)
                rec.save()
                ev, _ = AttendanceEvidence.objects.get_or_create(attendance_id=rec.id, defaults={"company_id": company.id, "employee_id": user.employee_id, "attendance_date": d})
                ev.check_out_selfie_path, ev.check_out_lat, ev.check_out_lng = path, _dec(lat), _dec(lng)
                ev.check_out_accuracy_m, ev.check_out_distance_m = _dec(acc, 2), dist
                ev.save()
                if review:
                    notify_owners(company, "attendance_review", "Absensi perlu review",
                                  f"{user.full_name} check-out dengan status lokasi: {loc['status']}.", "owner/attendance.html")
    except IntegrityError:
        if path:
            get_storage().delete(dj.BUCKET_SELFIES, path)
        raise ApiError("Anda sudah check-in hari ini", "ALREADY_CHECKED_IN", 409)
    except ApiError:
        if path:
            get_storage().delete(dj.BUCKET_SELFIES, path)
        raise
    rec = AttendanceRecord.objects.select_related("employee").get(id=rec.id)
    return record_out(rec)


def _dec(v, places=6):
    return None if v is None else Decimal(str(round(v, places)))


# ---------------------------------------------------------------- corrections
@transaction.atomic
def correct(user, rec_id, d, reason_prefix=None):
    company = user.company
    sch = ctx.get_schedule(company)
    d = d or {}
    reason = (d.get("reason") or "").strip()
    errors = {}
    if len(reason) < 5:
        errors["reason"] = "Alasan koreksi wajib diisi (min. 5 karakter)"
    if d.get("status") not in STATUSES:
        errors["status"] = "Pilih status kehadiran"
    validation(errors, errors.get("reason") or "Periksa kembali data koreksi")
    r = None
    if rec_id and rec_id != "new":
        r = get_or_404(AttendanceRecord.objects.select_for_update().filter(company_id=company.id), "Data absensi tidak ditemukan", id=rec_id)
    if r is None:
        date = ctx.parse_date(d.get("date"))
        emp = None
        if d.get("employee_id"):
            emp = get_or_404(Employee.objects.filter(company_id=company.id), "Karyawan tidak ditemukan", id=d["employee_id"])
        if not emp or not date:
            raise ApiError("Data tidak lengkap", "VALIDATION", 422, {"employee_id": "Pilih karyawan", "date": "Tanggal wajib diisi"})
        if date > ctx.today(company):
            validation({"date": "Tidak bisa mengoreksi tanggal mendatang"})
        r = AttendanceRecord.objects.select_for_update().filter(employee_id=emp.id, attendance_date=date).first() or \
            AttendanceRecord(company_id=company.id, employee_id=emp.id, attendance_date=date, source="correction", flags=[])
    before = {"status": r.status if r.pk and r.status else None, "check_in_at": _iso(r.check_in_at), "check_out_at": _iso(r.check_out_at)}
    if "check_in" in d:
        t = ctx.parse_hm(d.get("check_in"))
        r.check_in_at = ctx.combine(r.attendance_date, t, company) if t else None
    if "check_out" in d:
        t = ctx.parse_hm(d.get("check_out"))
        r.check_out_at = ctx.combine(r.attendance_date, t, company) if t else None
    if r.check_out_at and not r.check_in_at:
        validation({"check_in": "Isi jam check-in jika ada jam check-out"})
    if r.check_in_at and r.check_out_at and r.check_out_at <= r.check_in_at:
        raise ApiError("Jam check-out harus setelah check-in", "VALIDATION", 422, {"check_out": "Harus setelah check-in"})
    r.status = d["status"]
    r.work_minutes = work_minutes(r.check_in_at, r.check_out_at, company, sch)
    r.notes = f"Dikoreksi owner: {reason}"
    if r.location_status == "needs_review" and r.status != "needs_review":
        r.location_status = "reviewed"
    if r.status not in LEAVE_STATUSES:
        r.leave_request_id = None
    r.save()
    after = {"status": r.status, "check_in_at": _iso(r.check_in_at), "check_out_at": _iso(r.check_out_at)}
    full_reason = f"{reason_prefix}{reason}" if reason_prefix else reason
    corr = AttendanceCorrection.objects.create(company_id=company.id, attendance_id=r.id, employee_id=r.employee_id, attendance_date=r.attendance_date,
                                               source="owner", status="applied", before_data=before, after_data=after, reason=full_reason,
                                               requested_by_id=user.profile.id, resolved_by_id=user.profile.id, resolved_at=ctx.now())
    emp = Employee.objects.get(id=r.employee_id)
    audit(user, "attendance.correct", "attendance", r.id,
          f"Koreksi absensi {emp.full_name} ({r.attendance_date:%d/%m/%Y}): {before['status'] or '—'} → {r.status}",
          {"correction_id": str(corr.id), "before": before, "after": after, "reason": full_reason})
    notify_employee(emp, "attendance_corrected", "Absensi dikoreksi", f"Absensi {r.attendance_date:%d/%m/%Y} dikoreksi owner.", "employee/attendance.html")
    r = AttendanceRecord.objects.select_related("employee").get(id=r.id)
    return record_out(r)


def _iso(v):
    return v.isoformat() if v else None


@transaction.atomic
def request_correction(user, d):
    company = user.company
    d = d or {}
    date = ctx.parse_date(d.get("date"))
    if not date:
        validation({"date": "Tanggal wajib diisi"}, "Tanggal wajib diisi")
    if date > ctx.today(company):
        validation({"date": "Tanggal tidak valid"}, "Tidak bisa mengajukan koreksi untuk tanggal mendatang")
    reason = (d.get("reason") or "").strip()
    if len(reason) < 10:
        validation({"reason": "Jelaskan alasan (min. 10 karakter)"}, "Jelaskan alasan (min. 10 karakter)")
    cin, cout = ctx.parse_hm(d.get("check_in")), ctx.parse_hm(d.get("check_out"))
    if cin and cout and cout <= cin:
        validation({"check_out": "Harus setelah jam check-in"})
    if AttendanceCorrection.objects.filter(employee_id=user.employee_id, attendance_date=date, source="employee", status="pending").exists():
        validation({"date": "Masih ada permintaan koreksi pending untuk tanggal ini"})
    c = AttendanceCorrection.objects.create(company_id=company.id, employee_id=user.employee_id, attendance_date=date, source="employee",
                                            status="pending", requested_check_in=cin, requested_check_out=cout, reason=reason,
                                            requested_by_id=user.profile.id)
    notify_owners(company, "correction_request", "Permintaan koreksi absensi",
                  f"{user.full_name} mengajukan koreksi untuk {date:%d/%m/%Y}.", "owner/attendance.html")
    return correction_out(AttendanceCorrection.objects.select_related("employee", "resolved_by").get(id=c.id))


def correction_requests(user):
    qs = AttendanceCorrection.objects.filter(company_id=user.company_id, source="employee").select_related("employee", "resolved_by")
    if user.is_employee:
        qs = qs.filter(employee_id=user.employee_id)
    return [correction_out(c) for c in qs.order_by("-created_at")]


@transaction.atomic
def resolve_correction(user, corr_id, decision, payload):
    if decision not in ("approve", "reject"):
        raise not_found()
    c = get_or_404(AttendanceCorrection.objects.select_for_update().filter(company_id=user.company_id, source="employee"),
                   "Permintaan tidak ditemukan / sudah diproses", id=corr_id)
    if c.status != "pending":
        raise ApiError("Permintaan tidak ditemukan / sudah diproses", "ALREADY_DECIDED", 409)
    payload = payload or {}
    if decision == "approve":
        existing = AttendanceRecord.objects.filter(employee_id=c.employee_id, attendance_date=c.attendance_date).first()
        rec = correct(user, existing.id if existing else None,
                      {"employee_id": c.employee_id, "date": c.attendance_date.isoformat(), "check_in": payload.get("check_in"),
                       "check_out": payload.get("check_out"), "status": payload.get("status"),
                       "reason": f"Permintaan karyawan disetujui: {c.reason}"})
        c.attendance_id = rec["id"]
    c.status = "approved" if decision == "approve" else "rejected"
    c.resolved_at, c.resolved_by_id, c.owner_notes = ctx.now(), user.profile.id, (payload.get("notes") or "").strip()
    c.save()
    label = "disetujui" if c.status == "approved" else "ditolak"
    notify_employee(c.employee, f"correction_{c.status}", f"Koreksi absensi {label}",
                    f"Permintaan koreksi {c.attendance_date:%d/%m/%Y} {label}.{(' Catatan: ' + c.owner_notes) if c.owner_notes else ''}", "employee/attendance.html")
    if c.status == "rejected":
        audit(user, "attendance.correction_reject", "attendance_correction", c.id, f"Menolak permintaan koreksi {c.employee.full_name} ({c.attendance_date:%d/%m/%Y})")
    return correction_out(AttendanceCorrection.objects.select_related("employee", "resolved_by").get(id=c.id))


# ---------------------------------------------------------------- reconciliation
def reconcile_preview(user, date):
    company = user.company
    d = ctx.parse_date(date)
    if not d:
        validation({"date": "Tanggal tidak valid"})
    if d >= ctx.today(company):
        raise ApiError("Rekonsiliasi hanya untuk tanggal yang sudah lewat", "VALIDATION", 422, {"date": "Pilih tanggal yang sudah lewat"})
    if not ctx.is_work_day(ctx.get_schedule(company), d):
        return {"date": d, "candidates": [], "is_work_day": False}
    m = monitoring(user, d)
    return {"date": d, "is_work_day": True, "candidates": [{"employee": r["employee"], "pending_leave": r["pending_leave"]} for r in m["rows"] if not r["record"]]}


@transaction.atomic
def reconcile(user, date, employee_ids):
    company = user.company
    prev = reconcile_preview(user, date)
    allowed = {str(c["employee"]["id"]) for c in prev["candidates"]}
    ids = [str(i) for i in (employee_ids or []) if str(i) in allowed]
    if not ids:
        validation({"employee_ids": "Pilih minimal satu karyawan"}, "Pilih minimal satu karyawan yang belum tercatat")
    d = prev["date"]
    for eid in ids:
        AttendanceRecord.objects.get_or_create(employee_id=eid, attendance_date=d, defaults={
            "company_id": company.id, "status": "absent", "source": "reconciliation", "flags": [],
            "notes": "Tidak ada check-in & tidak ada izin (rekonsiliasi owner)"})
    audit(user, "attendance.reconcile", "attendance", None, f"Rekonsiliasi {d:%d/%m/%Y}: {len(ids)} karyawan ditandai Absent", {"employee_ids": ids})
    return {"count": len(ids)}


def ensure_employee(user):
    if not user.is_employee:
        raise forbidden("Akses ditolak: khusus Employee")
