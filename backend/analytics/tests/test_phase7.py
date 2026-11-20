"""Phase 7 — analytics formulas & access."""
import datetime as dt

from analytics import services as svc
from attendance.models import AttendanceRecord
from core.testing import ApiTestCase, frozen, jkt
from task_management.models import Task, TaskAssignment

NOW = jkt(2026, 11, 20, 12)


class AnalyticsTests(ApiTestCase):
    @classmethod
    def setUpTestData(cls):
        super().setUpTestData()
        ira, laila = cls.emps["ira"], cls.emps["laila"]
        rows = [(ira, "2026-11-02", "present", 420), (ira, "2026-11-03", "late", 400), (ira, "2026-11-04", "present", 430), (ira, "2026-11-05", "absent", None),
                (ira, "2026-11-06", "sick", None), (laila, "2026-11-02", "late", 380), (laila, "2026-11-03", "late", 390),
                (ira, "2026-10-02", "present", 420), (ira, "2026-10-03", "absent", None)]
        for e, d, st, wm in rows:
            AttendanceRecord.objects.create(company_id=cls.company.id, employee_id=e.id, attendance_date=d, status=st, work_minutes=wm, flags=[], source="seed")
        for title, emp, dl, st in [("A", ira, "2026-11-10", "completed"), ("B", ira, "2026-11-25", "todo"), ("C", laila, "2026-11-15", "in_progress")]:
            t = Task.objects.create(company_id=cls.company.id, title=f"Tugas {title}", deadline=dl, status=st, progress=100 if st == "completed" else 0,
                                    completed_at=jkt(2026, 11, 9, 15) if st == "completed" else None)
            TaskAssignment.objects.create(company_id=cls.company.id, task=t, employee=emp)

    def test_formulas(self):
        s = svc.summarize([{"status": x, "work_minutes": m} for x, m in [("present", 400), ("late", 380), ("absent", None), ("sick", None), ("early_leave", 300)]])
        self.assertEqual((s["attended"], s["expected"], s["leave"]), (3, 4, 1))
        self.assertAlmostEqual(s["attendanceRate"], 75.0); self.assertAlmostEqual(s["punctualityRate"], 200 / 3)
        self.assertEqual(svc.productivity(75, 50, 100), 75)
        self.assertEqual(svc.bounds("this_month", dt.date(2026, 11, 20)), (dt.date(2026, 11, 1), dt.date(2026, 11, 20), dt.date(2026, 10, 1), dt.date(2026, 10, 20)))
        self.assertEqual(svc.bounds("last_month", dt.date(2026, 1, 5))[:2], (dt.date(2025, 12, 1), dt.date(2025, 12, 31)))
        self.assertEqual(svc.last_months(3, dt.date(2026, 1, 5)), ["2025-11", "2025-12", "2026-01"])

    def test_performance_endpoint(self):
        with frozen(NOW):
            self.assertStatus(self.emp("ira").get("/api/analytics/performance/"), 403)
            self.assertStatus(self.owner.get("/api/analytics/performance/?range=year"), 422)
            d = self.assertStatus(self.owner.get("/api/analytics/performance/?range=this_month"), 200)
        self.assertEqual((d["from"], d["to"], d["prev_from"], d["prev_to"]), ("2026-11-01", "2026-11-20", "2026-10-01", "2026-10-20"))
        self.assertEqual(d["current"]["counts"]["late"], 3); self.assertEqual(d["current"]["counts"]["absent"], 1)
        self.assertAlmostEqual(d["current"]["attendanceRate"], 5 / 6 * 100)
        self.assertAlmostEqual(d["previous"]["attendanceRate"], 50.0)
        ira = [r for r in d["rows"] if r["employee"]["full_name"] == "Ira (uji)"][0]
        self.assertAlmostEqual(ira["att"]["attendanceRate"], 75.0); self.assertEqual(ira["task"]["total"], 1)   # task B (deadline 25 Nov) is outside the range
        self.assertEqual(ira["score"], round(75 * 0.4 + (2 / 3 * 100) * 0.3 + 100 * 0.3))
        self.assertEqual([m["key"] for m in d["months"]][-2:], ["2026-10", "2026-11"])
        texts = " ".join(i["text"] for i in d["insights"])
        self.assertIn("naik", texts); self.assertIn("Laila (uji) tercatat terlambat 2×", texts)
        with frozen(NOW):
            one = self.assertStatus(self.owner.get(f"/api/analytics/performance/?employee_id={self.emps['laila'].id}"), 200)
            self.assertEqual(len(one["rows"]), 1)
            self.assertStatus(self.owner.get(f"/api/analytics/performance/?employee_id={self.other_emp.id}"), 404)
            other = self.assertStatus(self.client_for(self.other_owner).get("/api/analytics/performance/"), 200)
            self.assertEqual([r["employee"]["full_name"] for r in other["rows"]], ["Staf Lain"])   # own company only
