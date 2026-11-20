"""Payroll engine — turns attendance, leave and salary configuration into
payroll items. Pure calculation lives in ``compute_item``; persistence in
services.py.

Rules (all from Settings → Payroll, nothing hard-coded):

* Cycle & payday
  - ``payment_day_mode = join_date``: each employee is paid on the day-of-month
    they joined (or ``pay_day`` on their salary configuration). If the month is
    shorter, the last day of the month is used. The cycle paid in month M runs
    from the payday in M-1 up to the day before the payday in M.
  - ``fixed``: everyone is paid on ``default_payment_day`` of month M for the
    calendar month M.
* Daily rate = basic salary ÷ scheduled working days in the full cycle.
* ``absent = prorate``      → each ``absent`` day deducts one daily rate.
* ``unpaid_leave = prorate`` → each day of leave whose leave type is unpaid
  (or a manual ``unpaid_leave`` status) deducts one daily rate; half-day = ½.
* ``late_per_incident``     → fixed amount × number of late days (0 = none).
* Overtime (``overtime_enabled``): for each completed day, whole hours worked
  after the scheduled end time — or all whole hours on a non-working day —
  × the employee's hourly overtime rate. Owners can override the hours.
* Joined mid-cycle → working days before the join date are not paid.
* Working days without any record are NOT deducted automatically; they are
  reported as warnings so the owner reconciles first.
"""
import calendar
import datetime as dt
from dataclasses import dataclass, field
from decimal import ROUND_HALF_UP, Decimal

from attendance.models import AttendanceRecord
from core import context as ctx
from leave_management.models import LeaveRequest

ATTENDED = ("present", "late", "early_leave", "needs_review")
D0 = Decimal("0")


def money(v):
    return Decimal(v).quantize(Decimal("1"), rounding=ROUND_HALF_UP)


def clamp_day(year, month, day):
    return dt.date(year, month, min(day, calendar.monthrange(year, month)[1]))


def prev_month(year, month):
    return (year - 1, 12) if month == 1 else (year, month - 1)


def parse_period_key(key):
    try:
        y, m = str(key).split("-")
        y, m = int(y), int(m)
        if not (2000 <= y <= 2100 and 1 <= m <= 12) or len(str(key)) != 7:
            raise ValueError
        return y, m
    except (TypeError, ValueError):
        return None


def cycle_for(period_key, mode, fixed_day, anchor_day):
    """Return (cycle_start, cycle_end, payment_date) for the period."""
    y, m = parse_period_key(period_key)
    if mode == "join_date":
        pay = clamp_day(y, m, anchor_day)
        py, pm = prev_month(y, m)
        start = clamp_day(py, pm, anchor_day)
        return start, pay - dt.timedelta(days=1), pay
    start = dt.date(y, m, 1)
    end = dt.date(y, m, calendar.monthrange(y, m)[1])
    return start, end, clamp_day(y, m, fixed_day or 28)


def period_bounds(period_key):
    y, m = parse_period_key(period_key)
    return dt.date(y, m, 1), dt.date(y, m, calendar.monthrange(y, m)[1])


def fmt_rp(v):
    return "Rp " + f"{int(money(v)):,}".replace(",", ".")


def fmt_d(d):
    months = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"]
    return f"{d.day} {months[d.month - 1]} {d.year}"


def _days(v):
    v = float(v)
    return str(int(v)) if v.is_integer() else str(v).replace(".", ",")


@dataclass
class ItemCalc:
    cycle_start: dt.date
    cycle_end: dt.date
    payment_date: dt.date
    basic_salary: Decimal
    allowances: list
    overtime_hours: Decimal
    overtime_amount: Decimal
    deductions: list
    snapshot: dict
    warnings: list = field(default_factory=list)
    note: str = ""


def compute_item(company, employee, cfg, period_key, settings, schedule, today, overtime_override=None):
    rules = {"unpaid_leave": "prorate", "absent": "none", "late_per_incident": 0, "overtime_enabled": True, **(settings.payroll_rules or {})}
    anchor = cfg.pay_day or employee.join_date.day
    start, end, pay = cycle_for(period_key, settings.payment_day_mode, settings.default_payment_day, anchor)
    if employee.join_date > end:
        return None                                    # not employed in this cycle yet
    work_days = [d for d in ctx.date_range(start, end) if ctx.is_work_day(schedule, d)]
    n_work = len(work_days)
    basic = Decimal(cfg.basic_salary)
    daily = (basic / n_work) if n_work else D0
    eff_start = max(start, employee.join_date)

    records = {r.attendance_date: r for r in AttendanceRecord.objects.filter(employee_id=employee.id, attendance_date__gte=eff_start,
                                                                           attendance_date__lte=end).select_related("leave_request__leave_type")}
    counts = {"present": 0, "late": 0, "early_leave": 0, "needs_review": 0, "absent": 0, "sick": 0, "paid_leave": 0, "unpaid_leave": 0}
    unpaid_days, paid_leave_days = 0.0, 0.0
    ot_minutes_total, ot_hours = 0, 0
    end_min = ctx.hm_minutes(schedule.work_end)
    for d, r in records.items():
        if r.status in counts:
            counts[r.status] += 1
        if r.status in ("sick", "paid_leave", "unpaid_leave"):
            lt = r.leave_request.leave_type if r.leave_request_id and r.leave_request else None
            is_paid = lt.is_paid if lt else (r.status != "unpaid_leave")
            if is_paid:
                paid_leave_days += 1
            else:
                unpaid_days += 1
        if rules.get("overtime_enabled") and r.status in ATTENDED and r.status != "needs_review" and r.check_in_at and r.check_out_at:
            if ctx.is_work_day(schedule, d):
                out_local = ctx.local(r.check_out_at, company)
                out_min = (out_local - dt.datetime.combine(d, dt.time(0), tzinfo=out_local.tzinfo)).total_seconds() / 60
                extra = max(0, int(out_min) - end_min)
            else:
                extra = int(r.work_minutes or 0)
            ot_minutes_total += extra
            ot_hours += extra // 60
    # Half-day leaves don't create attendance rows; count unpaid ones here.
    for lr in LeaveRequest.objects.filter(employee_id=employee.id, status="approved", leave_type__half_day=True,
                                          start_date__gte=eff_start, start_date__lte=end).select_related("leave_type"):
        if not lr.leave_type.is_paid and ctx.is_work_day(schedule, lr.start_date):
            unpaid_days += 0.5

    deductions, warnings = [], []
    before_join = len([d for d in work_days if d < employee.join_date])
    if before_join:
        deductions.append({"name": f"Prorata masuk kerja ({before_join} hari kerja sebelum {fmt_d(employee.join_date)})", "amount": money(daily * before_join)})
    if rules.get("absent") == "prorate" and counts["absent"]:
        deductions.append({"name": f"Absen tanpa keterangan ({counts['absent']} hari)", "amount": money(daily * counts["absent"])})
    if rules.get("unpaid_leave") == "prorate" and unpaid_days:
        deductions.append({"name": f"Izin/cuti tidak dibayar ({_days(unpaid_days)} hari)", "amount": money(daily * Decimal(str(unpaid_days)))})
    late_fee = Decimal(str(rules.get("late_per_incident") or 0))
    if late_fee > 0 and counts["late"]:
        deductions.append({"name": f"Keterlambatan ({counts['late']}×)", "amount": money(late_fee * counts["late"])})
    total_ded = sum((x["amount"] for x in deductions), D0)
    if total_ded > basic:                               # never deduct more than the basic salary
        deductions.append({"name": "Batas potongan (maks. gaji pokok)", "amount": -(total_ded - basic)})

    hours = Decimal(str(overtime_override)) if overtime_override is not None else Decimal(ot_hours)
    rate = Decimal(cfg.overtime_rate_per_hour or 0)
    ot_amount = money(hours * rate) if rules.get("overtime_enabled") else D0

    last_past = min(end, today - dt.timedelta(days=1))
    missing = [d for d in work_days if eff_start <= d <= last_past and d not in records]
    if missing:
        warnings.append(f"{len(missing)} hari kerja belum tercatat (belum check-in/izin) — lakukan rekonsiliasi agar potongan absen akurat.")
    if counts["needs_review"]:
        warnings.append(f"{counts['needs_review']} absensi berstatus Perlu Review — tidak dihitung lembur sampai direview.")
    if end >= today:
        warnings.append(f"Siklus belum selesai (berakhir {fmt_d(end)}) — hitung ulang setelah tanggal tersebut.")
    if not n_work:
        warnings.append("Tidak ada hari kerja terjadwal pada siklus ini.")

    parts = [f"Siklus {fmt_d(start)} – {fmt_d(end)}", f"{n_work} hari kerja", f"tarif harian {fmt_rp(daily)}"]
    if counts["absent"]:
        parts.append(f"{counts['absent']} hari absen")
    if unpaid_days:
        parts.append(f"{_days(unpaid_days)} hari izin tidak dibayar")
    if counts["late"]:
        parts.append(f"{counts['late']}× terlambat (tidak dipotong)" if late_fee <= 0 else f"{counts['late']}× terlambat")
    parts.append(f"lembur {hours} jam" + (" (diubah owner)" if overtime_override is not None else ""))
    snapshot = {"cycle_start": start.isoformat(), "cycle_end": end.isoformat(), "payment_date": pay.isoformat(), "working_days": n_work,
                "daily_rate": float(money(daily)), "counts": counts, "unpaid_leave_days": unpaid_days, "paid_leave_days": paid_leave_days,
                "missing_days": [d.isoformat() for d in missing], "overtime_minutes": ot_minutes_total, "overtime_hours_auto": ot_hours,
                "overtime_override": overtime_override, "rules": rules, "salary_config_id": str(cfg.id),
                "warnings": warnings, "computed_at": ctx.now().isoformat()}
    return ItemCalc(cycle_start=start, cycle_end=end, payment_date=pay, basic_salary=basic,
                    allowances=[{"name": a.get("name"), "amount": float(a.get("amount") or 0)} for a in (cfg.allowances or [])],
                    overtime_hours=hours, overtime_amount=ot_amount,
                    deductions=[{"name": x["name"], "amount": float(x["amount"])} for x in deductions],
                    snapshot=snapshot, warnings=warnings, note=" · ".join(parts))


def net_of(item, adjustments):
    allow = sum(Decimal(str(a.get("amount") or 0)) for a in (item.allowances or []))
    ded = sum(Decimal(str(a.get("amount") or 0)) for a in (item.deductions or []))
    adj = sum((a.amount if a.type == "addition" else -a.amount) for a in adjustments)
    total = Decimal(item.basic_salary) + allow + Decimal(item.bonus) + Decimal(item.incentives) + Decimal(item.overtime_amount) - ded + adj
    return money(max(total, D0))
