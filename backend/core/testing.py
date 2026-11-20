"""Test infrastructure.

``SchemaTestRunner`` builds the test database from the *real* SQL migrations
(database/schema.sql, plus tools/supabase_shim.sql which emulates the few
Supabase objects — auth.users, auth.uid(), storage.* — on plain PostgreSQL).
So every API test runs against the same constraints, triggers and RLS-guard
triggers as production.

``ApiTestCase`` seeds two companies (one shaped like Firzzzy Store, one
foreign company for isolation checks) and issues HS256 Supabase-style JWTs.
"""
import base64
import datetime as dt
import tempfile
import uuid
from contextlib import contextmanager
from unittest import mock

import jwt
from django.conf import settings
from django.db import connection
from django.test import TestCase, override_settings
from django.test.runner import DiscoverRunner
from django.utils import timezone
from rest_framework.test import APIClient

TEST_JWT_SECRET = "test-jwt-secret-for-unit-tests-only-0123456789"
JKT = dt.timezone(dt.timedelta(hours=7))


class SchemaTestRunner(DiscoverRunner):
    def setup_databases(self, **kwargs):
        import logging
        logging.getLogger("django.request").setLevel(logging.ERROR)
        config = super().setup_databases(**kwargs)
        root = settings.PROJECT_DIR
        shim = (root / "tools" / "supabase_shim.sql").read_text(encoding="utf-8")
        schema = (root / "database" / "schema.sql").read_text(encoding="utf-8")
        with connection.cursor() as c:
            c.execute(shim)
            c.execute(schema)
        return config


def make_token(sub, secret=TEST_JWT_SECRET, exp_minutes=60, aud="authenticated", role="authenticated", alg="HS256"):
    now = int(timezone.now().timestamp())
    payload = {"sub": str(sub), "aud": aud, "role": role, "iat": now, "exp": now + exp_minutes * 60, "email": "x@example.com"}
    return jwt.encode(payload, secret, algorithm=alg)


def jkt(y, m, d, hh=0, mm=0):
    """Aware datetime in Asia/Jakarta."""
    return dt.datetime(y, m, d, hh, mm, tzinfo=JKT)


@contextmanager
def frozen(at):
    """Freeze the app clock (core.context.now) at ``at``."""
    with mock.patch("core.context.now", return_value=at):
        yield


def fake_invite(email, full_name):
    """Stand-in for Supabase Auth admin invite: creates the auth.users row."""
    uid = uuid.uuid4()
    with connection.cursor() as c:
        c.execute("insert into auth.users (id, email) values (%s, %s)", [uid, email])
    return uid


TINY_JPEG = "data:image/jpeg;base64," + base64.b64encode(b"\xff\xd8\xff\xe0" + b"\x00" * 64 + b"\xff\xd9").decode()


@override_settings(SUPABASE_JWT_SECRET=TEST_JWT_SECRET, STORAGE_BACKEND="local",
                   LOCAL_STORAGE_DIR=tempfile.mkdtemp(prefix="absen-test-"),
                   REST_FRAMEWORK={**settings.REST_FRAMEWORK, "DEFAULT_THROTTLE_CLASSES": []})
class ApiTestCase(TestCase):
    """Fixture company "Firzzzy Store (uji)": owner farizky + Ira, Laila, Tanti.
    Rules mirror the real store: Mon–Sat 08:00–16:00, break 12–13, payday =
    join date, absent & unpaid leave prorated, no late deduction, overtime
    per hour. Join dates/amounts here are test values, not real data."""

    @classmethod
    def setUpTestData(cls):
        from accounts.models import Company, CompanySettings, Profile, WorkLocation, WorkSchedule
        from employees.models import Employee
        from leave_management.models import LeaveType
        from payroll.models import SalaryConfiguration

        cls.company = Company.objects.create(name="Firzzzy Store (uji)", email_domain="firzzzystore.com", timezone="Asia/Jakarta")
        with connection.cursor() as c:
            c.execute("select app.bootstrap_company(%s)", [cls.company.id])
        CompanySettings.objects.filter(company_id=cls.company.id).update(
            payment_day_mode="join_date", default_payment_day=None,
            payroll_rules={"unpaid_leave": "prorate", "absent": "prorate", "late_per_incident": 0, "overtime_enabled": True})
        WorkSchedule.objects.filter(company_id=cls.company.id).update(
            working_days=[1, 2, 3, 4, 5, 6], late_tolerance_min=60, work_start=dt.time(8), work_end=dt.time(16),
            break_start=dt.time(12), break_end=dt.time(13))
        cls.location = WorkLocation.objects.create(company_id=cls.company.id, name="Toko", latitude="-7.983000", longitude="112.660000", radius_m=10)
        LeaveType.objects.filter(company_id=cls.company.id).update(is_paid=False)

        def auth_user(email):
            uid = uuid.uuid4()
            with connection.cursor() as c:
                c.execute("insert into auth.users (id, email) values (%s, %s)", [uid, email])
            return uid

        cls.owner_profile = Profile.objects.create(id=auth_user("farizky@firzzzystore.com"), company_id=cls.company.id, role="owner",
                                                   full_name="Farizky (uji)", email="farizky@firzzzystore.com")
        cls.emps, cls.emp_profiles = {}, {}
        for nick, name, pos, join, salary in [("ira", "Ira (uji)", "Manager", dt.date(2024, 1, 20), 3_000_000),
                                              ("laila", "Laila (uji)", "Admin", dt.date(2024, 3, 14), 2_600_000),
                                              ("tanti", "Tanti (uji)", "Packing", dt.date(2026, 11, 16), 2_340_000)]:
            email = f"{nick}@firzzzystore.com"
            p = Profile.objects.create(id=auth_user(email), company_id=cls.company.id, role="employee", full_name=name, email=email)
            e = Employee.objects.create(company_id=cls.company.id, profile_id=p.id, full_name=name, nickname=nick, email=email,
                                        position=pos, join_date=join)
            e.refresh_from_db()
            SalaryConfiguration.objects.create(company_id=cls.company.id, employee_id=e.id, basic_salary=salary,
                                               allowances=[{"name": "Uang makan", "amount": 200000}], overtime_rate_per_hour=15000,
                                               effective_from=join)
            cls.emps[nick], cls.emp_profiles[nick] = e, p

        # A second, unrelated company — must never be visible to the first.
        cls.other_company = Company.objects.create(name="Toko Lain")
        with connection.cursor() as c:
            c.execute("select app.bootstrap_company(%s)", [cls.other_company.id])
        cls.other_owner = Profile.objects.create(id=auth_user("owner@lain.test"), company_id=cls.other_company.id, role="owner",
                                                 full_name="Owner Lain", email="owner@lain.test")
        op = Profile.objects.create(id=auth_user("staf@lain.test"), company_id=cls.other_company.id, role="employee",
                                    full_name="Staf Lain", email="staf@lain.test")
        cls.other_emp = Employee.objects.create(company_id=cls.other_company.id, profile_id=op.id, full_name="Staf Lain",
                                                email="staf@lain.test", position="Staf", join_date=dt.date(2025, 1, 1))

    def client_for(self, profile_or_id):
        c = APIClient()
        pid = getattr(profile_or_id, "id", profile_or_id)
        c.credentials(HTTP_AUTHORIZATION=f"Bearer {make_token(pid)}")
        return c

    @property
    def owner(self):
        return self.client_for(self.owner_profile)

    def emp(self, nick):
        return self.client_for(self.emp_profiles[nick])

    def assertStatus(self, resp, code):
        self.assertEqual(resp.status_code, code, getattr(resp, "data", None) if resp.status_code != code else None)
        return resp.json() if resp.content else None
