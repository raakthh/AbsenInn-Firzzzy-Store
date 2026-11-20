"""Payroll persistence & workflow:
draft → pending_approval → approved → scheduled → paid.
"Paid" is set ONLY when the owner confirms a manual transfer."""
import datetime as dt
from decimal import Decimal, InvalidOperation

from django.db import transaction

from core import context as ctx
from core.events import audit, notify_employee, notify_owners
from core.exceptions import ApiError, get_or_404, validation
from core.shapes import num, pick_emp
from employees.models import Employee
from employees.services import current_salary_config

from . import engine
from .models import Payment, PayrollAdjustment, PayrollItem, PayrollPeriod, Payslip, SalaryConfiguration

EDITABLE = ("draft", "pending_approval")
VISIBLE_TO_EMPLOYEE = ("approved", "scheduled", "paid")
MONTHS = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"]


def month_label(key):
    y, m = engine.parse_period_key(key)
    return f"{MONTHS[m - 1]} {y}"


# ---------------------------------------------------------------- shapes
def adjustment_out(a):
    return {"id": a.id, "type": a.type, "name": a.name, "amount": num(a.amount),
            "by": a.created_by.full_name if a.created_by_id else "", "at": a.created_at}


def payment_out(p):
    if p is None:
        return None
    return {"id": p.id, "company_id": p.company_id, "payroll_item_id": p.payroll_item_id, "employee_id": p.employee_id,
            "amount": num(p.amount), "paid_at": p.paid_at, "method": p.method, "reference": p.reference or "",
            "note": p.note or "", "confirmed_by": p.confirmed_by_id}


def _payment(item):
    try:
        return item.payment
    except Payment.DoesNotExist:
        return None


def item_out(i, adjustments=None, payment=False, with_employee=True):
    adjs = adjustments if adjustments is not None else list(i.adjustments.select_related("created_by").order_by("created_at"))
    snap = i.calc_snapshot or {}
    out = {"id": i.id, "company_id": i.company_id, "period_id": i.period_id, "employee_id": i.employee_id,
           "cycle_start": i.cycle_start, "cycle_end": i.cycle_end, "payment_date": i.payment_date,
           "basic_salary": num(i.basic_salary),
           "allowances": [{"name": a.get("name"), "amount": num(a.get("amount"))} for a in (i.allowances or [])],
           "bonus": num(i.bonus), "incentives": num(i.incentives), "overtime_hours": num(i.overtime_hours),
           "overtime_amount": num(i.overtime_amount),
           "deductions": [{"name": a.get("name"), "amount": num(a.get("amount"))} for a in (i.deductions or [])],
           "adjustments": [adjustment_out(a) for a in adjs], "net_salary": num(i.net_salary), "status": i.status,
           "calc_note": snap.get("note", ""), "warnings": snap.get("warnings", []),
           "overtime_hours_auto": snap.get("overtime_hours_auto"), "overtime_override": snap.get("overtime_override")}
    if with_employee:
        out["employee"] = pick_emp(i.employee)
    if payment is not False:
        out["payment"] = payment_out(payment if payment is not None else _payment(i))
    return out


def period_status_display(p, items, today):
    if p.status in ("approved", "scheduled") and any(i.status != "paid" and i.payment_date < today for i in items):
        return "overdue"
    return p.status


def period_out(p, items, today, detailed=False):
    out = {"id": p.id, "company_id": p.company_id, "period_key": p.period_key, "start_date": p.start_date, "end_date": p.end_date,
           "payment_date": p.payment_date, "status": p.status, "status_display": period_status_display(p, items, today),
           "approved_at": p.approved_at, "approved_by": p.approved_by_id, "created_at": p.created_at,
           "total_net": num(sum((i.net_salary for i in items), Decimal(0))), "employees": len(items),
           "paid_count": len([i for i in items if i.status == "paid"])}
    if detailed:
        ids = [i.id for i in items]
        adjs = {}
        for a in PayrollAdjustment.objects.filter(payroll_item_id__in=ids).select_related("created_by").order_by("created_at"):
            adjs.setdefault(a.payroll_item_id, []).append(a)
        pays = {x.payroll_item_id: x for x in Payment.objects.filter(payroll_item_id__in=ids)}
        out["items"] = [item_out(i, adjs.get(i.id, []), pays.get(i.id)) for i in items]
        out["warnings"] = list(dict.fromkeys((p_warn for p_warn in _period_warnings(p))))
    return out


def _period_warnings(p):
    missing = [e.full_name for e in Employee.objects.filter(company_id=p.company_id, employment_status="active")
               if not SalaryConfiguration.objects.filter(employee_id=e.id).exists()]
    if missing:
        yield f"Konfigurasi gaji belum diisi untuk: {', '.join(missing)} — isi di tab Konfigurasi Gaji lalu hitung ulang."


def _items(p):
    return list(PayrollItem.objects.filter(period_id=p.id).select_related("employee").order_by("payment_date", "employee__employee_code"))


# ---------------------------------------------------------------- queries
def periods(user):
    today = ctx.today(user.company)
    return [period_out(p, _items(p), today) for p in PayrollPeriod.objects.filter(company_id=user.company_id).order_by("-period_key")]


def get_period(user, pk):
    p = get_or_404(PayrollPeriod.objects.filter(company_id=user.company_id), "Periode tidak ditemukan", id=pk)
    return period_out(p, _items(p), ctx.today(user.company), detailed=True)


def _item_for(user, pk, lock=False):
    qs = PayrollItem.objects.filter(company_id=user.company_id).select_related("employee", "period")
    if lock:
        qs = qs.select_for_update(of=("self",))
    if user.is_employee:
        qs = qs.filter(employee_id=user.employee_id, period__status__in=VISIBLE_TO_EMPLOYEE)
    return get_or_404(qs, "Data payroll tidak ditemukan", id=pk)


def get_item(user, pk):
    from accounts.services import company_out
    i = _item_for(user, pk)
    today = ctx.today(user.company)
    out = item_out(i)
    out["period"] = period_out(i.period, _items(i.period) if user.is_owner else [i], today)
    out["company"] = company_out(user.company)
    return out


def my_payslips(user):
    today = ctx.today(user.company)
    qs = PayrollItem.objects.filter(employee_id=user.employee_id, period__status__in=VISIBLE_TO_EMPLOYEE).select_related("employee", "period")
    rows = []
    for i in qs.order_by("-period__period_key"):
        o = item_out(i)
        o["period"] = period_out(i.period, [i], today)
        rows.append(o)
    return rows


def employee_items(user, emp_id):
    get_or_404(Employee.objects.filter(company_id=user.company_id), "Karyawan tidak ditemukan", id=emp_id)
    today = ctx.today(user.company)
    rows = []
    for i in PayrollItem.objects.filter(employee_id=emp_id, company_id=user.company_id).select_related("employee", "period").order_by("-period__period_key"):
        o = item_out(i)
        o["period"] = period_out(i.period, _items(i.period), today)
        rows.append(o)
    return rows


# ---------------------------------------------------------------- generation
def _eligible_employees(company, period_key):
    start, end = engine.period_bounds(period_key)
    lo = start - dt.timedelta(days=31)
    from attendance.models import AttendanceRecord
    with_records = set(AttendanceRecord.objects.filter(company_id=company.id, attendance_date__gte=lo, attendance_date__lte=end).values_list("employee_id", flat=True))
    for e in Employee.objects.filter(company_id=company.id).order_by("employee_code"):
        if e.employment_status == "active" or e.id in with_records:
            yield e


def _compute_into(period, company, today):
    st, sch = ctx.get_settings(company), ctx.get_schedule(company)
    existing = {i.employee_id: i for i in PayrollItem.objects.filter(period_id=period.id)}
    seen = set()
    for e in _eligible_employees(company, period.period_key):
        prior = existing.get(e.id)
        anchor_ref = engine.cycle_for(period.period_key, st.payment_day_mode, st.default_payment_day, e.join_date.day)[1]
        cfg = current_salary_config(e, on=anchor_ref)
        if cfg is None:
            continue
        override = (prior.calc_snapshot or {}).get("overtime_override") if prior else None
        calc = engine.compute_item(company, e, cfg, period.period_key, st, sch, today, overtime_override=override)
        if calc is None:
            continue
        if e.employment_status != "active":
            from attendance.models import AttendanceRecord
            if not AttendanceRecord.objects.filter(employee_id=e.id, attendance_date__gte=calc.cycle_start, attendance_date__lte=calc.cycle_end).exists():
                continue
        seen.add(e.id)
        item = prior or PayrollItem(company_id=company.id, period_id=period.id, employee_id=e.id)
        item.cycle_start, item.cycle_end, item.payment_date = calc.cycle_start, calc.cycle_end, calc.payment_date
        item.basic_salary, item.allowances = calc.basic_salary, calc.allowances
        item.overtime_hours, item.overtime_amount, item.deductions = calc.overtime_hours, calc.overtime_amount, calc.deductions
        item.calc_snapshot = {**calc.snapshot, "note": calc.note}
        item.status = period.status
        if not prior:
            item.bonus = item.incentives = Decimal(0)
        item.save()
        item.net_salary = engine.net_of(item, list(item.adjustments.all()))
        item.save(update_fields=["net_salary", "updated_at"])
    PayrollItem.objects.filter(period_id=period.id).exclude(employee_id__in=seen).delete()
    items = _items(period)
    if st.payment_day_mode == "join_date":
        period.payment_date = min((i.payment_date for i in items), default=None)
    else:
        period.payment_date = engine.cycle_for(period.period_key, "fixed", st.default_payment_day, 1)[2]
    period.start_date = min([i.cycle_start for i in items] + [engine.period_bounds(period.period_key)[0]])
    period.end_date = max([i.cycle_end for i in items] + [engine.period_bounds(period.period_key)[1]])
    period.save()
    return items


@transaction.atomic
def generate(user, period_key):
    company = user.company
    if not engine.parse_period_key(period_key):
        validation({"period_key": "Format periode YYYY-MM"}, "Periode tidak valid")
    today = ctx.today(company)
    if period_key > today.strftime("%Y-%m"):
        nxt = (today.replace(day=1) + dt.timedelta(days=32)).strftime("%Y-%m")
        if period_key > nxt:
            validation({"period_key": "Periode terlalu jauh di masa depan"}, "Periode terlalu jauh di masa depan")
    p = PayrollPeriod.objects.select_for_update().filter(company_id=company.id, period_key=period_key).first()
    if p and p.status != "draft":
        raise ApiError("Payroll periode ini sudah diajukan/disetujui — kembalikan ke draft untuk menghitung ulang", "LOCKED", 409)
    created = p is None
    if created:
        s, e = engine.period_bounds(period_key)
        p = PayrollPeriod.objects.create(company_id=company.id, period_key=period_key, start_date=s, end_date=e, status="draft")
    items = _compute_into(p, company, today)
    audit(user, "payroll.generate" if created else "payroll.recalculate", "payroll_period", p.id,
          f"{'Membuat' if created else 'Menghitung ulang'} payroll {month_label(period_key)} ({len(items)} karyawan)")
    return period_out(p, _items(p), today, detailed=True)


@transaction.atomic
def recalculate(user, pk):
    p = get_or_404(PayrollPeriod.objects.filter(company_id=user.company_id), "Periode tidak ditemukan", id=pk)
    return generate(user, p.period_key)


def _locked_check(item):
    if item.period.status not in EDITABLE:
        raise ApiError("Payroll sudah disetujui — adjustment terkunci", "LOCKED", 409)


def _refresh_net(item):
    item.net_salary = engine.net_of(item, list(item.adjustments.all()))
    item.save(update_fields=["net_salary", "updated_at"])


@transaction.atomic
def update_item(user, pk, d):
    """Owner edits on a draft item: overtime hours override, bonus, incentives."""
    item = _item_for(user, pk, lock=True)
    _locked_check(item)
    errors, d = {}, d or {}

    def amount(key, maxv=Decimal("1e12")):
        try:
            v = Decimal(str(d.get(key)))
        except (InvalidOperation, TypeError):
            errors[key] = "Nominal tidak valid"
            return None
        if v < 0 or v > maxv:
            errors[key] = "Nominal tidak valid"
            return None
        return v

    snap = dict(item.calc_snapshot or {})
    if "overtime_hours" in d:
        if d.get("overtime_hours") in (None, ""):
            snap["overtime_override"] = None
        else:
            v = amount("overtime_hours", Decimal(400))
            if v is not None:
                snap["overtime_override"] = float(v)
    for k in ("bonus", "incentives"):
        if k in d:
            v = amount(k)
            if v is not None:
                setattr(item, k, v)
    validation(errors, "Periksa kembali data payroll")
    company = user.company
    cfg = SalaryConfiguration.objects.filter(id=snap.get("salary_config_id")).first() or current_salary_config(item.employee)
    calc = engine.compute_item(company, item.employee, cfg, item.period.period_key, ctx.get_settings(company), ctx.get_schedule(company),
                               ctx.today(company), overtime_override=snap.get("overtime_override"))
    if calc:
        item.overtime_hours, item.overtime_amount = calc.overtime_hours, calc.overtime_amount
        item.calc_snapshot = {**calc.snapshot, "note": calc.note}
    item.save()
    _refresh_net(item)
    audit(user, "payroll.item_update", "payroll_item", item.id, f"Mengubah komponen payroll {item.employee.full_name} ({month_label(item.period.period_key)})",
          {k: d.get(k) for k in ("overtime_hours", "bonus", "incentives") if k in d})
    return item_out(PayrollItem.objects.select_related("employee").get(id=item.id))


@transaction.atomic
def add_adjustment(user, item_id, d):
    item = _item_for(user, item_id, lock=True)
    _locked_check(item)
    d, errors = d or {}, {}
    name = (d.get("name") or "").strip()
    if len(name) < 3:
        errors["name"] = "Keterangan minimal 3 karakter"
    try:
        amt = Decimal(str(d.get("amount")))
        if amt <= 0 or amt > Decimal("1e12"):
            raise InvalidOperation
    except (InvalidOperation, TypeError):
        errors["amount"] = "Nominal harus lebih dari 0"
        amt = None
    if d.get("type") not in ("addition", "deduction"):
        errors["type"] = "Pilih jenis"
    validation(errors, "Periksa kembali adjustment")
    PayrollAdjustment.objects.create(company_id=item.company_id, payroll_item=item, type=d["type"], name=name, amount=amt, created_by_id=user.profile.id)
    _refresh_net(item)
    sign = "−" if d["type"] == "deduction" else "+"
    audit(user, "payroll.adjust", "payroll_item", item.id, f"Adjustment {sign}{engine.fmt_rp(amt)} untuk {item.employee.full_name}: {name}")
    return item_out(PayrollItem.objects.select_related("employee").get(id=item.id))


@transaction.atomic
def remove_adjustment(user, item_id, adj_id):
    item = _item_for(user, item_id, lock=True)
    _locked_check(item)
    adj = get_or_404(PayrollAdjustment.objects.filter(payroll_item_id=item.id), "Adjustment tidak ditemukan", id=adj_id)
    adj.delete()
    _refresh_net(item)
    audit(user, "payroll.adjust_remove", "payroll_item", item.id, f"Menghapus adjustment \"{adj.name}\" untuk {item.employee.full_name}")
    return item_out(PayrollItem.objects.select_related("employee").get(id=item.id))


FLOW = {"submit": ("draft", "pending_approval"), "approve": ("pending_approval", "approved"),
        "schedule": ("approved", "scheduled"), "reopen": ("pending_approval", "draft")}


@transaction.atomic
def transition(user, pk, action, d):
    company = user.company
    p = get_or_404(PayrollPeriod.objects.select_for_update().filter(company_id=company.id), "Periode tidak ditemukan", id=pk)
    if action not in FLOW or p.status != FLOW[action][0]:
        raise ApiError(f"Aksi tidak valid untuk status {p.status}", "INVALID_TRANSITION", 409)
    items = _items(p)
    if action in ("submit", "approve") and not items:
        raise ApiError("Belum ada karyawan dalam payroll ini. Isi konfigurasi gaji lalu hitung ulang.", "EMPTY_PAYROLL", 409)
    d = d or {}
    st = ctx.get_settings(company)
    if action == "schedule":
        pd = ctx.parse_date(d.get("payment_date"))
        if not pd:
            raise ApiError("Tanggal pembayaran wajib", "VALIDATION", 422, {"payment_date": "Wajib diisi"})
        p.payment_date = pd
        if st.payment_day_mode != "join_date":
            PayrollItem.objects.filter(period_id=p.id).exclude(status="paid").update(payment_date=pd)
    p.status = FLOW[action][1]
    if action == "approve":
        p.approved_at, p.approved_by_id = ctx.now(), user.profile.id
    p.save()
    PayrollItem.objects.filter(period_id=p.id).exclude(status="paid").update(status=p.status)
    label = month_label(p.period_key)
    items = _items(p)
    if action == "approve":
        for i in items:
            Payslip.objects.update_or_create(payroll_item_id=i.id, defaults={"company_id": company.id, "employee_id": i.employee_id})
            notify_employee(i.employee, "payslip", "Slip gaji tersedia",
                            f"Slip gaji {label} sudah dapat dilihat. Pembayaran dijadwalkan {i.payment_date:%d/%m/%Y}.", "employee/payslip.html")
        notify_owners(company, "payroll_approved", "Payroll disetujui", f"Payroll {label} disetujui.", "owner/payroll.html", pref="payroll")
    if action == "schedule":
        for i in items:
            if i.status != "paid":
                notify_employee(i.employee, "salary_upcoming", "Gaji akan dibayarkan", f"Gaji {label} dijadwalkan {i.payment_date:%d/%m/%Y}.", "employee/payslip.html")
    text = {"submit": "Mengajukan payroll untuk approval", "approve": "Menyetujui payroll", "schedule": "Menjadwalkan pembayaran",
            "reopen": "Membuka kembali payroll ke draft"}[action]
    audit(user, f"payroll.{action}", "payroll_period", p.id, f"{text} {label}")
    return period_out(p, items, ctx.today(company))


@transaction.atomic
def confirm_payment(user, pk, d):
    company = user.company
    p = get_or_404(PayrollPeriod.objects.select_for_update().filter(company_id=company.id), "Periode tidak ditemukan", id=pk)
    if p.status not in ("approved", "scheduled"):
        raise ApiError("Payroll harus disetujui sebelum konfirmasi pembayaran", "INVALID_TRANSITION", 409)
    d, errors = d or {}, {}
    paid_at = ctx.parse_date(d.get("paid_at"))
    today = ctx.today(company)
    if not paid_at:
        errors["paid_at"] = "Tanggal transfer wajib diisi"
    elif paid_at > today:
        errors["paid_at"] = "Tanggal transfer tidak boleh di masa depan"
    method = (d.get("method") or "").strip()
    if not method:
        errors["method"] = "Metode wajib diisi"
    ids = [str(x) for x in (d.get("item_ids") or [])]
    if not ids:
        errors["items"] = "Pilih minimal satu karyawan"
    validation(errors, "Periksa data pembayaran")
    label = month_label(p.period_key)
    count = 0
    for it in PayrollItem.objects.select_for_update().filter(period_id=p.id).select_related("employee"):
        if str(it.id) not in ids or it.status == "paid":
            continue
        it.status = "paid"
        it.save(update_fields=["status", "updated_at"])
        Payment.objects.create(company_id=company.id, payroll_item=it, employee_id=it.employee_id, amount=it.net_salary,
                               paid_at=ctx.combine(paid_at, dt.time(12), company), method=method,
                               reference=(d.get("reference") or "").strip() or None, note=(d.get("note") or "").strip() or None,
                               confirmed_by_id=user.profile.id)
        notify_employee(it.employee, "salary_paid", "Gaji telah dibayar", f"Gaji {label} sebesar {engine.fmt_rp(it.net_salary)} telah ditransfer.", "employee/payslip.html")
        count += 1
    if not count:
        validation({"items": "Karyawan yang dipilih sudah dibayar / bukan bagian periode ini"}, "Tidak ada pembayaran yang dikonfirmasi")
    if not PayrollItem.objects.filter(period_id=p.id).exclude(status="paid").exists():
        p.status = "paid"
        p.save(update_fields=["status", "updated_at"])
    audit(user, "payroll.confirm_payment", "payroll_period", p.id, f"Mengonfirmasi pembayaran {count} karyawan — {label}")
    return period_out(p, _items(p), today)


# ---------------------------------------------------------------- salary configuration
def salary_configs(user):
    out = []
    for e in Employee.objects.filter(company_id=user.company_id).order_by("employee_code"):
        c = current_salary_config(e)
        out.append({"employee_id": e.id, "company_id": e.company_id, "configured": c is not None,
                    "basic_salary": num(c.basic_salary) if c else 0,
                    "allowances": [{"name": a.get("name"), "amount": num(a.get("amount"))} for a in (c.allowances or [])] if c else [],
                    "overtime_rate_per_hour": num(c.overtime_rate_per_hour) if c else 0, "pay_day": c.pay_day if c else None,
                    "effective_from": c.effective_from if c else None, "employee": pick_emp(e)})
    return out


@transaction.atomic
def update_salary_config(user, emp_id, d):
    e = get_or_404(Employee.objects.filter(company_id=user.company_id), "Karyawan tidak ditemukan", id=emp_id)
    d, errors = d or {}, {}

    def dec(key, positive=False):
        try:
            v = Decimal(str(d.get(key) if d.get(key) not in (None, "") else (None if positive else 0)))
        except (InvalidOperation, TypeError):
            return None
        return v

    basic = dec("basic_salary", positive=True)
    if basic is None or basic <= 0 or basic > Decimal("1e12"):
        errors["basic_salary"] = "Gaji pokok harus lebih dari 0"
    ot = dec("overtime_rate_per_hour")
    if ot is None or ot < 0:
        errors["overtime_rate_per_hour"] = "Tidak boleh negatif"
    allowances = []
    for i, a in enumerate(d.get("allowances") or []):
        try:
            amt = Decimal(str(a.get("amount")))
            ok = (a.get("name") or "").strip() and amt >= 0
        except (InvalidOperation, TypeError, AttributeError):
            ok = False
        if not ok:
            errors[f"allowance_{i}"] = "Nama & nominal tunjangan wajib valid"
        else:
            allowances.append({"name": a["name"].strip(), "amount": float(amt)})
    pay_day = d.get("pay_day")
    if pay_day not in (None, ""):
        try:
            pay_day = int(pay_day)
            if not 1 <= pay_day <= 31:
                raise ValueError
        except (TypeError, ValueError):
            errors["pay_day"] = "Tanggal 1–31"
    else:
        pay_day = None
    validation(errors, "Periksa konfigurasi gaji")
    today = ctx.today(user.company)
    latest = SalaryConfiguration.objects.filter(employee_id=e.id).order_by("-effective_from").first()
    if latest is None:
        eff = e.join_date                                  # first configuration applies from the join date
    elif latest.effective_from >= today:
        eff = latest.effective_from                        # same-day (or future) correction → update in place
    else:
        eff = today
    cfg, _ = SalaryConfiguration.objects.update_or_create(employee_id=e.id, effective_from=eff, defaults={
        "company_id": e.company_id, "basic_salary": basic, "allowances": allowances, "overtime_rate_per_hour": ot, "pay_day": pay_day})
    SalaryConfiguration.objects.filter(employee_id=e.id, effective_from__lt=eff, effective_to__isnull=True).update(effective_to=eff - dt.timedelta(days=1))
    audit(user, "payroll.salary_config", "employee_salary_configuration", e.id, f"Memperbarui konfigurasi gaji {e.full_name}")
    return {"employee_id": e.id, "company_id": e.company_id, "configured": True, "basic_salary": num(cfg.basic_salary), "allowances": allowances,
            "overtime_rate_per_hour": num(cfg.overtime_rate_per_hour), "pay_day": cfg.pay_day, "effective_from": cfg.effective_from, "employee": pick_emp(e)}
