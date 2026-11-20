"""Phase 6 — payroll engine, workflow, PDF."""
import datetime as dt
from decimal import ROUND_HALF_UP, Decimal

from attendance.models import AttendanceRecord
from core.testing import ApiTestCase, frozen, jkt
from employees.models import Employee
from leave_management.models import LeaveRequest, LeaveType
from notifications.models import Notification
from payroll import engine

NOW = jkt(2026, 11, 20, 10)


def rp(v):
    return int(Decimal(v).quantize(Decimal("1"), rounding=ROUND_HALF_UP))


def workdays(start, end):
    return [start + dt.timedelta(days=i) for i in range((end - start).days + 1) if (start + dt.timedelta(days=i)).weekday() != 6]


class EngineUnitTests(ApiTestCase):
    def test_cycle_rules(self):
        self.assertEqual(engine.cycle_for("2026-11", "join_date", None, 20), (dt.date(2026, 10, 20), dt.date(2026, 11, 19), dt.date(2026, 11, 20)))
        # joined on the 31st → paid on the last day of shorter months
        self.assertEqual(engine.cycle_for("2026-02", "join_date", None, 31), (dt.date(2026, 1, 31), dt.date(2026, 2, 27), dt.date(2026, 2, 28)))
        self.assertEqual(engine.cycle_for("2026-03", "join_date", None, 31), (dt.date(2026, 2, 28), dt.date(2026, 3, 30), dt.date(2026, 3, 31)))
        self.assertEqual(engine.cycle_for("2026-01", "join_date", None, 14), (dt.date(2025, 12, 14), dt.date(2026, 1, 13), dt.date(2026, 1, 14)))
        self.assertEqual(engine.cycle_for("2026-02", "fixed", 30, 1), (dt.date(2026, 2, 1), dt.date(2026, 2, 28), dt.date(2026, 2, 28)))
        self.assertIsNone(engine.parse_period_key("2026-13")); self.assertIsNone(engine.parse_period_key("26-1"))


class PayrollTests(ApiTestCase):
    @classmethod
    def setUpTestData(cls):
        super().setUpTestData()
        ira = cls.emps["ira"]
        cls.cycle = (dt.date(2026, 10, 20), dt.date(2026, 11, 19))
        cls.wd = workdays(*cls.cycle)
        annual = LeaveType.objects.get(company_id=cls.company.id, code="annual")       # is_paid = False for this store
        lr = LeaveRequest.objects.create(company_id=cls.company.id, employee_id=ira.id, leave_type=annual, start_date=dt.date(2026, 11, 2),
                                         end_date=dt.date(2026, 11, 3), reason="Acara keluarga", status="approved")
        special = {dt.date(2026, 10, 27): "absent", dt.date(2026, 11, 2): "leave", dt.date(2026, 11, 3): "leave",
                   dt.date(2026, 11, 5): "late", dt.date(2026, 11, 6): "overtime", dt.date(2026, 11, 7): "missing", dt.date(2026, 11, 9): "review"}
        for d in cls.wd:
            kind = special.get(d, "present")
            if kind == "missing":
                continue
            base = dict(company_id=cls.company.id, employee_id=ira.id, attendance_date=d, flags=[])
            if kind == "absent":
                AttendanceRecord.objects.create(**base, status="absent", source="reconciliation")
            elif kind == "leave":
                AttendanceRecord.objects.create(**base, status="paid_leave", source="leave", leave_request_id=lr.id)
            else:
                cin = jkt(d.year, d.month, d.day, 9, 15) if kind == "late" else jkt(d.year, d.month, d.day, 7, 55)
                cout = jkt(d.year, d.month, d.day, 18, 40) if kind == "overtime" else jkt(d.year, d.month, d.day, 16, 20)
                AttendanceRecord.objects.create(**base, status={"late": "late", "review": "needs_review"}.get(kind, "present"),
                                                check_in_at=cin, check_out_at=cout, work_minutes=400, source="app")
        # A Sunday shift counts fully as overtime (3 whole hours of 3h30)
        AttendanceRecord.objects.create(company_id=cls.company.id, employee_id=ira.id, attendance_date=dt.date(2026, 11, 8), flags=[], status="present",
                                        check_in_at=jkt(2026, 11, 8, 9), check_out_at=jkt(2026, 11, 8, 12, 30), work_minutes=210, source="app")

    def generate(self, key="2026-11", at=NOW, client=None):
        with frozen(at):
            return (client or self.owner).post("/api/payroll/generate/", {"period_key": key}, format="json")

    def ira_item(self, period):
        return [i for i in period["items"] if i["employee_id"] == str(self.emps["ira"].id)][0]

    def test_ira_calculation_matches_rules(self):
        p = self.assertStatus(self.generate(), 200)
        self.assertEqual(p["status"], "draft")
        names = {i["employee"]["full_name"] for i in p["items"]}
        self.assertEqual(names, {"Ira (uji)", "Laila (uji)"})                  # Tanti joined after the Nov cycle
        it = self.ira_item(p)
        n = len(self.wd)
        daily = Decimal(3_000_000) / n
        self.assertEqual((it["cycle_start"], it["cycle_end"], it["payment_date"]), ("2026-10-20", "2026-11-19", "2026-11-20"))
        self.assertEqual(it["overtime_hours"], 2 + 3)                          # 18:40 → 2 h ; Sunday 3h30 → 3 h ; needs_review excluded
        self.assertEqual(it["overtime_amount"], 5 * 15000)
        ded = {d["name"]: d["amount"] for d in it["deductions"]}
        self.assertEqual(ded["Absen tanpa keterangan (1 hari)"], rp(daily))
        self.assertEqual(ded["Izin/cuti tidak dibayar (2 hari)"], rp(daily * 2))
        self.assertFalse(any("Keterlambatan" in k for k in ded))              # no late deduction
        self.assertEqual(it["net_salary"], 3_000_000 + 200_000 + 75_000 - rp(daily) - rp(daily * 2))
        self.assertTrue(any("1 hari kerja belum tercatat" in w for w in it["warnings"]))
        self.assertTrue(any("Perlu Review" in w for w in it["warnings"]))
        self.assertIn("1× terlambat (tidak dipotong)", it["calc_note"])
        laila = [i for i in p["items"] if i["employee_id"] == str(self.emps["laila"].id)][0]
        self.assertEqual((laila["payment_date"], laila["net_salary"]), ("2026-11-14", 2_800_000))   # no records → warnings, no deduction
        self.assertTrue(any("belum tercatat" in w for w in laila["warnings"]))
        self.assertEqual(p["payment_date"], "2026-11-14")                     # earliest payday in the period

    def test_tanti_first_cycle_in_december(self):
        p = self.assertStatus(self.generate("2026-12"), 200)
        t = [i for i in p["items"] if i["employee_id"] == str(self.emps["tanti"].id)][0]
        self.assertEqual((t["cycle_start"], t["cycle_end"], t["payment_date"]), ("2026-11-16", "2026-12-15", "2026-12-16"))
        self.assertTrue(any("Siklus belum selesai" in w for w in t["warnings"]))
        self.assertStatus(self.generate("2027-03"), 422)                      # too far ahead

    def test_rules_follow_settings(self):
        with frozen(NOW):
            self.owner.put("/api/settings/payroll/", {"payment_day_mode": "join_date", "default_components": [],
                                                      "rules": {"unpaid_leave": "none", "absent": "none", "late_per_incident": 25000, "overtime_enabled": False}}, format="json")
        it = self.ira_item(self.assertStatus(self.generate(), 200))
        self.assertEqual([d["name"] for d in it["deductions"]], ["Keterlambatan (1×)"])
        self.assertEqual(it["overtime_amount"], 0)
        LeaveType.objects.filter(company_id=self.company.id, code="annual").update(is_paid=True)
        with frozen(NOW):
            self.owner.put("/api/settings/payroll/", {"payment_day_mode": "join_date", "default_components": [],
                                                      "rules": {"unpaid_leave": "prorate", "absent": "prorate", "late_per_incident": 0, "overtime_enabled": True}}, format="json")
        it = self.ira_item(self.assertStatus(self.generate(), 200))
        self.assertEqual([d["name"] for d in it["deductions"]], ["Absen tanpa keterangan (1 hari)"])   # paid leave no longer deducted

    def test_workflow_privacy_and_payment(self):
        p = self.assertStatus(self.generate(), 200)
        it = self.ira_item(p)
        with frozen(NOW):
            self.assertStatus(self.emp("ira").get(f"/api/payroll/items/{it['id']}/"), 404)          # draft → invisible
            self.assertEqual(self.assertStatus(self.emp("ira").get("/api/payroll/my-payslips/"), 200), [])
            self.assertStatus(self.emp("ira").get("/api/payroll/"), 403)
            # owner adjustments & overtime override survive recalculation
            r = self.assertStatus(self.owner.post(f"/api/payroll/items/{it['id']}/adjustments/", {"type": "addition", "name": "Bonus target", "amount": 100000}, format="json"), 201)
            self.assertEqual(r["net_salary"], it["net_salary"] + 100000)
            r = self.assertStatus(self.owner.patch(f"/api/payroll/items/{it['id']}/", {"overtime_hours": 1}, format="json"), 200)
            self.assertEqual((r["overtime_hours"], r["overtime_amount"]), (1, 15000)); self.assertIn("(diubah owner)", r["calc_note"])
            self.assertStatus(self.owner.post(f"/api/payroll/items/{it['id']}/adjustments/", {"type": "x", "name": "a", "amount": -1}, format="json"), 422)
        it2 = self.ira_item(self.assertStatus(self.generate(), 200))
        self.assertEqual(it2["overtime_hours"], 1); self.assertEqual(len(it2["adjustments"]), 1)
        with frozen(NOW):
            self.assertStatus(self.owner.post(f"/api/payroll/{p['id']}/approve/"), 409)            # must submit first
            self.assertStatus(self.owner.post(f"/api/payroll/{p['id']}/submit/"), 200)
            self.assertStatus(self.owner.post(f"/api/payroll/{p['id']}/reopen/"), 200)
            self.assertStatus(self.owner.post(f"/api/payroll/{p['id']}/submit/"), 200)
            self.assertEqual(self.assertStatus(self.owner.post(f"/api/payroll/{p['id']}/approve/"), 200)["status"], "approved")
            self.assertEqual(self.assertStatus(self.generate(), 409)["code"], "LOCKED")
            self.assertStatus(self.owner.post(f"/api/payroll/items/{it['id']}/adjustments/", {"type": "addition", "name": "Telat", "amount": 1}, format="json"), 409)
            slip = self.assertStatus(self.emp("ira").get(f"/api/payroll/items/{it['id']}/"), 200)
            self.assertEqual(slip["period"]["employees"], 1)                                         # no leak of colleagues' totals
            self.assertStatus(self.emp("laila").get(f"/api/payroll/items/{it['id']}/"), 404)
            self.assertEqual(len(self.assertStatus(self.emp("ira").get("/api/payroll/my-payslips/"), 200)), 1)
            self.assertTrue(Notification.objects.filter(recipient_id=self.emp_profiles["ira"].id, type="payslip").exists())
            # PDF
            r = self.emp("ira").get(f"/api/payroll/items/{it['id']}/pdf/")
            self.assertEqual(r.status_code, 200); self.assertEqual(r["Content-Type"], "application/pdf"); self.assertTrue(r.content.startswith(b"%PDF"))
            self.assertEqual(self.emp("laila").get(f"/api/payroll/items/{it['id']}/pdf/").status_code, 404)
            # payment: paid only after manual confirmation
            r = self.assertStatus(self.owner.post(f"/api/payroll/{p['id']}/confirm-payment/", {"item_ids": [it["id"]], "paid_at": "2026-11-21", "method": "Transfer"}, format="json"), 422)
            self.assertIn("paid_at", r)
            r = self.assertStatus(self.owner.post(f"/api/payroll/{p['id']}/confirm-payment/", {"item_ids": [it["id"]], "paid_at": "2026-11-20", "method": "Transfer bank (manual)", "reference": "TRF1"}, format="json"), 200)
            self.assertEqual((r["status"], r["paid_count"]), ("approved", 1))
        with frozen(jkt(2026, 11, 21, 9)):
            per = self.assertStatus(self.owner.get(f"/api/payroll/{p['id']}/"), 200)
            self.assertEqual(per["status_display"], "overdue")                                       # Laila's payday (14th) passed unpaid
            laila_id = [i["id"] for i in per["items"] if i["status"] != "paid"]
            r = self.assertStatus(self.owner.post(f"/api/payroll/{p['id']}/confirm-payment/", {"item_ids": laila_id, "paid_at": "2026-11-21", "method": "Tunai"}, format="json"), 200)
        self.assertEqual(r["status"], "paid")
        pdf = self.emp("ira").get(f"/api/payroll/items/{it['id']}/pdf/")
        self.assertTrue(pdf.content.startswith(b"%PDF"))
        self.assertTrue(Notification.objects.filter(recipient_id=self.emp_profiles["ira"].id, type="salary_paid").exists())
        actions = [a["action"] for a in self.assertStatus(self.owner.get("/api/audit-logs/?limit=50"), 200)]
        for a in ("payroll.generate", "payroll.recalculate", "payroll.adjust", "payroll.item_update", "payroll.approve", "payroll.confirm_payment"):
            self.assertIn(a, actions)

    def test_custom_pay_day(self):
        with frozen(NOW):
            self.assertStatus(self.owner.put(f"/api/payroll/salary-configurations/{self.emps['laila'].id}/", {"basic_salary": 2600000, "pay_day": 40}, format="json"), 422)
            c = self.assertStatus(self.owner.put(f"/api/payroll/salary-configurations/{self.emps['laila'].id}/", {"basic_salary": 2600000, "pay_day": 25, "allowances": []}, format="json"), 200)
        self.assertEqual(c["pay_day"], 25)
        it = [i for i in self.assertStatus(self.generate("2026-12"), 200)["items"] if i["employee_id"] == str(self.emps["laila"].id)][0]
        self.assertEqual((it["cycle_start"], it["cycle_end"], it["payment_date"]), ("2026-11-25", "2026-12-24", "2026-12-25"))
        with frozen(NOW):
            c = self.assertStatus(self.owner.put(f"/api/payroll/salary-configurations/{self.emps['laila'].id}/", {"basic_salary": 2600000, "pay_day": "", "allowances": []}, format="json"), 200)
        self.assertIsNone(c["pay_day"])                                           # back to join date (14th)

    def test_salary_configuration(self):
        new = Employee.objects.create(company_id=self.company.id, full_name="Dina (uji)", email="dina@firzzzystore.com", position="Kasir", join_date=dt.date(2026, 9, 5))
        cfgs = self.assertStatus(self.owner.get("/api/payroll/salary-configurations/"), 200)
        dina = [c for c in cfgs if c["employee_id"] == str(new.id)][0]
        self.assertFalse(dina["configured"])
        p = self.assertStatus(self.generate(), 200)
        self.assertTrue(any("Dina (uji)" in w for w in p["warnings"]))
        with frozen(NOW):
            self.assertStatus(self.owner.put(f"/api/payroll/salary-configurations/{new.id}/", {"basic_salary": 0, "allowances": [{"name": "", "amount": 1}]}, format="json"), 422)
            c = self.assertStatus(self.owner.put(f"/api/payroll/salary-configurations/{new.id}/", {"basic_salary": 2500000, "overtime_rate_per_hour": 12000,
                                                                                                 "allowances": [{"name": "Transport", "amount": 100000}]}, format="json"), 200)
            self.assertEqual(c["effective_from"], "2026-09-05")                 # first config applies from join date
            c = self.assertStatus(self.owner.put(f"/api/payroll/salary-configurations/{self.emps['ira'].id}/", {"basic_salary": 3200000, "allowances": []}, format="json"), 200)
            self.assertEqual(c["effective_from"], "2026-11-20")                 # later change → effective today
            self.assertStatus(self.emp("ira").get("/api/payroll/salary-configurations/"), 403)
        p = self.assertStatus(self.generate(), 200)
        self.assertIn("Dina (uji)", {i["employee"]["full_name"] for i in p["items"]})
        self.assertEqual(self.ira_item(p)["basic_salary"], 3000000)            # Nov cycle ended before the raise
