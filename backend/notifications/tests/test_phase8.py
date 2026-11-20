"""Phase 8 — scheduled reminders."""
import datetime as dt
import io

from django.core.management import call_command
from django.test import override_settings
from rest_framework.test import APIClient

from accounts.models import CompanySettings
from attendance.models import AttendanceRecord
from core.testing import ApiTestCase, frozen, jkt
from leave_management.models import LeaveRequest, LeaveType
from notifications import reminders
from notifications.models import Notification
from payroll.models import PayrollItem, PayrollPeriod
from task_management.models import Task, TaskAssignment


def types_for(profile):
    return sorted(Notification.objects.filter(recipient_id=profile.id).values_list("type", flat=True))


class ReminderTests(ApiTestCase):
    def run_at(self, at):
        return reminders.run(now=at, company_ids=[self.company.id])

    def setUp(self):
        AttendanceRecord.objects.create(company_id=self.company.id, employee_id=self.emps["laila"].id, attendance_date="2026-11-20",
                                        status="present", check_in_at=jkt(2026, 11, 20, 7, 50), flags=[], source="app")
        annual = LeaveType.objects.get(company_id=self.company.id, code="annual")
        lr = LeaveRequest.objects.create(company_id=self.company.id, employee_id=self.emps["tanti"].id, leave_type=annual, start_date="2026-11-20",
                                         end_date="2026-11-20", reason="Acara keluarga", status="approved")
        AttendanceRecord.objects.create(company_id=self.company.id, employee_id=self.emps["tanti"].id, attendance_date="2026-11-20",   # as leave approval does
                                        status="paid_leave", leave_request_id=lr.id, flags=[], source="leave")

    def test_check_in_reminders_are_idempotent(self):
        self.run_at(jkt(2026, 11, 20, 8, 5))                                  # before grace → nothing
        self.assertEqual(types_for(self.emp_profiles["ira"]), [])
        self.run_at(jkt(2026, 11, 20, 8, 20))
        self.run_at(jkt(2026, 11, 20, 8, 40))                                 # repeated run → no duplicate
        self.assertEqual(types_for(self.emp_profiles["ira"]), ["attendance_reminder"])
        self.assertEqual(types_for(self.emp_profiles["laila"]), [])           # already checked in
        self.assertEqual(types_for(self.emp_profiles["tanti"]), [])           # on approved leave
        self.assertNotIn("attendance_reminder", types_for(self.owner_profile))  # owner waits for late tolerance (60 min)
        self.run_at(jkt(2026, 11, 20, 9, 5))
        msg = Notification.objects.get(recipient_id=self.owner_profile.id, type="attendance_reminder").message
        self.assertIn("1 karyawan belum check-in", msg); self.assertIn("Ira (uji)", msg)

    def test_checkout_reminder_and_prefs(self):
        self.run_at(jkt(2026, 11, 20, 16, 35))
        self.assertIn("checkout_reminder", types_for(self.emp_profiles["laila"]))
        Notification.objects.all().delete()
        CompanySettings.objects.filter(company_id=self.company.id).update(notification_prefs={"attendance_reminder": False, "task_deadline": False, "payroll": False})
        self.run_at(jkt(2026, 11, 20, 16, 35))
        self.assertFalse(Notification.objects.exists())

    def test_non_work_day_and_reconcile(self):
        self.run_at(jkt(2026, 11, 22, 9))                                     # Sunday: no attendance reminders
        self.assertEqual(types_for(self.emp_profiles["ira"]), [])
        self.run_at(jkt(2026, 11, 21, 8, 30))                                 # Saturday morning: Friday not reconciled
        msgs = list(Notification.objects.filter(recipient_id=self.owner_profile.id, type="reconcile_reminder").values_list("message", flat=True))
        self.assertEqual(len(msgs), 2)                                        # Sunday run flagged Saturday 21/11, Saturday run flagged Friday 20/11
        fri = [m for m in msgs if "20/11/2026" in m][0]
        self.assertIn("1 karyawan", fri)                                      # only Ira (Laila checked in, Tanti on leave)

    def test_task_deadline_reminders(self):
        for title, dl in [("Besok", "2026-11-21"), ("Hari ini", "2026-11-20"), ("Kemarin", "2026-11-19"), ("Jauh", "2026-12-01")]:
            t = Task.objects.create(company_id=self.company.id, title=f"Tugas {title}", deadline=dl)
            TaskAssignment.objects.create(company_id=self.company.id, task=t, employee=self.emps["ira"])
        self.run_at(jkt(2026, 11, 20, 7, 0))
        self.run_at(jkt(2026, 11, 20, 7, 30))
        titles = sorted(Notification.objects.filter(recipient_id=self.emp_profiles["ira"].id, type="task_deadline").values_list("title", flat=True))
        self.assertEqual(titles, ["Deadline besok", "Deadline hari ini", "Tugas melewati deadline"])
        self.assertEqual(Notification.objects.filter(recipient_id=self.owner_profile.id, type="task_deadline").count(), 1)

    def test_payroll_reminders(self):
        self.run_at(jkt(2026, 11, 19, 10))                                    # Ira's payday (20th) is tomorrow
        self.assertIn("besok", Notification.objects.get(recipient_id=self.owner_profile.id, type="payroll_reminder").message)
        p = PayrollPeriod.objects.create(company_id=self.company.id, period_key="2026-11", start_date="2026-11-01", end_date="2026-11-30", status="approved")
        PayrollItem.objects.create(company_id=self.company.id, period=p, employee_id=self.emps["laila"].id, cycle_start="2026-10-14",
                                   cycle_end="2026-11-13", payment_date="2026-11-14", net_salary=1, status="approved")
        self.run_at(jkt(2026, 11, 20, 10))
        owner_msgs = list(Notification.objects.filter(recipient_id=self.owner_profile.id).values_list("type", "message"))
        self.assertTrue(any(t == "payroll_reminder" and "hari ini" in m and "belum disetujui" in m for t, m in owner_msgs))
        self.assertTrue(any(t == "salary_delayed" and "Laila (uji)" in m for t, m in owner_msgs))

    def test_command_and_cron_endpoint(self):
        out = io.StringIO()
        call_command("send_reminders", stdout=out)
        self.assertIn('"sent"', out.getvalue())
        self.assertEqual(APIClient().post("/api/cron/reminders/").status_code, 403)          # no secret configured
        with override_settings(CRON_SECRET="s3cret-value"):
            self.assertEqual(APIClient().post("/api/cron/reminders/", HTTP_X_CRON_SECRET="wrong").status_code, 403)
            r = APIClient().post("/api/cron/reminders/", HTTP_X_CRON_SECRET="s3cret-value")
            self.assertEqual(r.status_code, 200); self.assertIn(str(self.company.id), r.json()["sent"])
        _ = dt
