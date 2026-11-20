"""Company-scoped helpers: local time, schedule, settings, work location.
"Today" is always evaluated in the company's timezone (Asia/Jakarta for
Firzzzy Store), never in the server's timezone."""
import datetime as dt
from zoneinfo import ZoneInfo

from django.utils import timezone

from accounts.models import CompanySettings, WorkLocation, WorkSchedule


def tz(company):
    try:
        return ZoneInfo(company.timezone or "Asia/Jakarta")
    except Exception:
        return ZoneInfo("Asia/Jakarta")


def now():
    return timezone.now()


def local(value, company):
    return value.astimezone(tz(company)) if value else None


def today(company):
    return now().astimezone(tz(company)).date()


def parse_date(value):
    if isinstance(value, dt.date):
        return value
    try:
        return dt.date.fromisoformat(str(value)[:10])
    except (TypeError, ValueError):
        return None


def parse_hm(value):
    if value in (None, ""):
        return None
    if isinstance(value, dt.time):
        return value
    try:
        h, m = str(value)[:5].split(":")
        return dt.time(int(h), int(m))
    except (TypeError, ValueError):
        return None


def combine(date, hm, company):
    """Local date + HH:MM (company tz) → aware datetime."""
    return dt.datetime.combine(date, hm).replace(tzinfo=tz(company))


def minutes_of_day(value, company):
    loc = local(value, company)
    return loc.hour * 60 + loc.minute


def hm_minutes(t):
    return t.hour * 60 + t.minute if t else None


def js_weekday(date):
    """0 = Minggu … 6 = Sabtu (same convention as the schema and JS getDay())."""
    return (date.weekday() + 1) % 7


def date_range(start, end):
    d = start
    while d <= end:
        yield d
        d += dt.timedelta(days=1)


def get_schedule(company):
    s = WorkSchedule.objects.filter(company_id=company.id).order_by("-is_default", "created_at").first()
    if s is None:  # should not happen after app.bootstrap_company(); keep the API usable anyway
        s = WorkSchedule.objects.create(company_id=company.id, work_start=dt.time(8), work_end=dt.time(16),
                                        break_start=dt.time(12), break_end=dt.time(13), working_days=[1, 2, 3, 4, 5])
    return s


def get_settings(company):
    st = CompanySettings.objects.filter(company_id=company.id).first()
    if st is None:
        st = CompanySettings.objects.create(company_id=company.id, default_payment_day=28,
                                            payroll_rules={"unpaid_leave": "prorate", "absent": "none", "late_per_incident": 0, "overtime_enabled": True},
                                            notification_prefs={"leave_requests": True, "attendance_reminder": True, "task_deadline": True, "payroll": True},
                                            profile_editable_fields=["phone", "address"])
    return st


def get_location(company):
    return WorkLocation.objects.filter(company_id=company.id, active=True).order_by("-is_primary", "created_at").first()


def is_work_day(schedule, date):
    return js_weekday(date) in (schedule.working_days or [])
