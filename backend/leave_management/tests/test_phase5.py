"""Phase 5 — leave & task backend."""
from django.core.files.uploadedfile import SimpleUploadedFile

from attendance.models import AttendanceRecord
from core.testing import TINY_JPEG, ApiTestCase, frozen, jkt
from leave_management.models import LeaveType
from notifications.models import Notification

NOW = jkt(2026, 11, 20, 10)
PDF = b"%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF"


class LeaveTests(ApiTestCase):
    def lt(self, code):
        return str(LeaveType.objects.get(company_id=self.company.id, code=code).id)

    def req(self, nick="ira", **d):
        with frozen(NOW):
            return self.emp(nick).post("/api/leave/request/", d, format="json")

    def test_types_and_validation(self):
        types = self.assertStatus(self.emp("ira").get("/api/leave/types/"), 200)
        self.assertEqual(len(types), 5); self.assertTrue(all(t["is_paid"] is False for t in types))
        r = self.assertStatus(self.req(reason="x", start_date="2026-11-25", end_date="2026-11-23"), 422)
        for k in ("leave_type_id", "end_date", "reason"):
            self.assertIn(k, r)
        r = self.assertStatus(self.req(leave_type_id=self.lt("half_day"), start_date="2026-11-23", end_date="2026-11-24", reason="Urusan bank"), 422)
        self.assertIn("1 tanggal", r["end_date"])
        r = self.assertStatus(self.req(leave_type_id=self.lt("sick"), start_date="2026-11-23", end_date="2026-11-23", reason="Demam tinggi"), 422)
        self.assertIn("Lampiran wajib", r["attachment"])
        r = self.assertStatus(self.req(leave_type_id=self.lt("personal"), start_date="2026-11-22", end_date="2026-11-22", reason="Hari Minggu"), 422)
        self.assertIn("hari kerja", r["start_date"])
        self.assertStatus(self.owner.post("/api/leave/request/", {}, format="json"), 403)

    def test_sick_leave_with_real_attachment(self):
        f = SimpleUploadedFile("surat dokter.pdf", PDF, content_type="application/pdf")
        with frozen(NOW):
            lr = self.assertStatus(self.emp("laila").post("/api/leave/request/", {"leave_type_id": self.lt("sick"), "start_date": "2026-11-20",
                                                                                   "end_date": "2026-11-20", "reason": "Demam tinggi", "attachment": f}, format="multipart"), 201)
        self.assertEqual(lr["attachment_name"], "surat dokter.pdf"); self.assertEqual(lr["days"], 1)
        a = self.assertStatus(self.owner.get(f"/api/leave/{lr['id']}/attachment/"), 200)
        self.assertTrue(a["url"].startswith("data:application/pdf;base64,"))
        self.assertStatus(self.emp("ira").get(f"/api/leave/{lr['id']}/attachment/"), 404)
        self.assertTrue(Notification.objects.filter(recipient_id=self.owner_profile.id, type="leave_request").exists())
        bad = SimpleUploadedFile("x.pdf", b"<html>not a pdf</html>", content_type="application/pdf")
        with frozen(NOW):
            r = self.assertStatus(self.emp("ira").post("/api/leave/request/", {"leave_type_id": self.lt("sick"), "start_date": "2026-11-21",
                                                                                "end_date": "2026-11-21", "reason": "Demam tinggi", "attachment": bad}, format="multipart"), 422)
        self.assertIn("attachment", r)

    def test_overlap_and_quota(self):
        self.assertStatus(self.req(leave_type_id=self.lt("annual"), start_date="2026-11-23", end_date="2026-11-25", reason="Acara keluarga"), 201)
        r = self.assertStatus(self.req(leave_type_id=self.lt("personal"), start_date="2026-11-25", end_date="2026-11-26", reason="Urusan lain"), 422)
        self.assertIn("Bertabrakan", r["start_date"])
        with frozen(NOW):
            self.owner.put("/api/settings/leave/", {"annual_quota_days": 2, "types": []}, format="json")
        r = self.assertStatus(self.req("laila", leave_type_id=self.lt("annual"), start_date="2026-11-23", end_date="2026-11-25", reason="Liburan keluarga"), 422)
        self.assertIn("Saldo cuti tidak cukup", r["end_date"])

    def test_approve_writes_attendance_and_balance(self):
        with frozen(jkt(2026, 11, 23, 7, 50)):                    # Ira already checked in on Monday
            self.emp("ira").post("/api/attendance/check-in/", {"selfie": TINY_JPEG, "lat": -7.983, "lng": 112.66, "accuracy": 5}, format="json")
        with frozen(jkt(2026, 11, 21, 9)):
            lr = self.assertStatus(self.emp("ira").post("/api/leave/request/", {"leave_type_id": self.lt("annual"), "start_date": "2026-11-21",
                                                                               "end_date": "2026-11-24", "reason": "Acara keluarga"}, format="json"), 201)
            self.assertEqual(lr["days"], 3)                       # Sat, (Sun off), Mon, Tue
            self.assertStatus(self.emp("ira").post(f"/api/leave/{lr['id']}/approve/", {}, format="json"), 403)
            r = self.assertStatus(self.owner.post(f"/api/leave/{lr['id']}/approve/", {"notes": "Selamat berlibur"}, format="json"), 200)
            self.assertEqual(r["status"], "approved")
            self.assertStatus(self.owner.post(f"/api/leave/{lr['id']}/reject/", {"notes": "Batal"}, format="json"), 409)
            bal = self.assertStatus(self.emp("ira").get("/api/leave/balance/"), 200)
        self.assertEqual({k: bal[k] for k in ("enabled", "quota", "used", "remaining", "taken_days")},
                         {"enabled": True, "quota": 12, "used": 3, "remaining": 9, "taken_days": 3})
        recs = {str(r.attendance_date): r for r in AttendanceRecord.objects.filter(employee_id=self.emps["ira"].id)}
        self.assertEqual(recs["2026-11-21"].status, "paid_leave"); self.assertEqual(recs["2026-11-21"].source, "leave")
        self.assertNotIn("2026-11-22", recs)                       # Sunday
        self.assertEqual(recs["2026-11-23"].status, "present")    # real check-in kept
        self.assertEqual(recs["2026-11-24"].status, "paid_leave")
        self.assertTrue(Notification.objects.filter(recipient_id=self.emp_profiles["ira"].id, type="leave_approved").exists())

    def test_reject_needs_notes_cancel_and_isolation(self):
        lr = self.assertStatus(self.req(leave_type_id=self.lt("personal"), start_date="2026-11-23", end_date="2026-11-23", reason="Urusan keluarga"), 201)
        with frozen(NOW):
            self.assertStatus(self.owner.post(f"/api/leave/{lr['id']}/reject/", {"notes": ""}, format="json"), 422)
            self.assertStatus(self.client_for(self.other_owner).post(f"/api/leave/{lr['id']}/approve/", {}, format="json"), 404)
            self.assertEqual(self.assertStatus(self.client_for(self.other_owner).get("/api/leave/"), 200), [])
            self.assertEqual(self.assertStatus(self.emp("laila").get("/api/leave/"), 200), [])
            self.assertStatus(self.emp("laila").post(f"/api/leave/{lr['id']}/cancel/"), 404)
            self.assertEqual(self.assertStatus(self.emp("ira").post(f"/api/leave/{lr['id']}/cancel/"), 200)["status"], "cancelled")
            self.assertEqual(len(self.assertStatus(self.owner.get(f"/api/leave/?employee_id={self.emps['ira'].id}"), 200)), 1)
            self.assertEqual(self.assertStatus(self.owner.get(f"/api/leave/balance/?employee_id={self.emps['ira'].id}"), 200)["used"], 0)


class NoQuotaStoreTests(ApiTestCase):
    """Firzzzy Store: no leave allowance — leave is free to request and simply cuts pay."""
    def test_no_quota_policy(self):
        LeaveType.objects.filter(company_id=self.company.id, code__in=["annual", "unpaid"]).delete()
        LeaveType.objects.filter(company_id=self.company.id).update(uses_quota=False, is_paid=False)
        with frozen(NOW):
            self.owner.put("/api/settings/leave/", {"annual_quota_days": 0, "types": []}, format="json")
            codes = {t["code"] for t in self.assertStatus(self.emp("ira").get("/api/leave/types/"), 200)}
            self.assertEqual(codes, {"sick", "personal", "half_day"})
            for start, end in (("2026-11-23", "2026-11-28"), ("2026-11-30", "2026-12-12")):   # 6 + 12 days: no quota limit
                lr = self.assertStatus(self.emp("ira").post("/api/leave/request/", {"leave_type_id": self.lt("personal"), "start_date": start,
                                                                                   "end_date": end, "reason": "Libur keluarga"}, format="json"), 201)
                self.assertStatus(self.owner.post(f"/api/leave/{lr['id']}/approve/", {}, format="json"), 200)
            bal = self.assertStatus(self.emp("ira").get("/api/leave/balance/"), 200)
        self.assertFalse(bal["enabled"]); self.assertEqual(bal["taken_days"], 6 + 12)          # Mon–Sat working days, Sundays excluded

    def lt(self, code):
        return str(LeaveType.objects.get(company_id=self.company.id, code=code).id)


class TaskTests(ApiTestCase):
    def create(self, **kw):
        d = {"title": "Packing order Shopee", "description": "Batch pagi", "assignee_id": str(self.emps["tanti"].id), "priority": "high", "deadline": "2026-11-21", **kw}
        with frozen(NOW):
            return self.owner.post("/api/tasks/", d, format="json")

    def test_validation(self):
        r = self.assertStatus(self.create(title="ab", priority="urgent", deadline="2026-11-01"), 422)
        for k in ("title", "priority", "deadline"):
            self.assertIn(k, r)
        self.assertStatus(self.create(assignee_id=str(self.other_emp.id)), 422)
        e = self.emps["laila"]; e.employment_status = "inactive"; e.save()
        self.assertEqual(self.assertStatus(self.create(assignee_id=str(e.id)), 422)["assignee_id"], "Karyawan tidak aktif")
        with frozen(NOW):
            self.assertStatus(self.emp("ira").post("/api/tasks/", {"title": "Hack"}, format="json"), 403)

    def test_lifecycle(self):
        t = self.assertStatus(self.create(), 201)
        self.assertEqual(t["assignee"]["full_name"], "Tanti (uji)"); self.assertEqual(t["status_display"], "todo")
        self.assertTrue(Notification.objects.filter(recipient_id=self.emp_profiles["tanti"].id, type="task_assigned").exists())
        with frozen(NOW):
            self.assertEqual(len(self.assertStatus(self.emp("tanti").get("/api/tasks/"), 200)), 1)
            self.assertEqual(self.assertStatus(self.emp("ira").get("/api/tasks/"), 200), [])
            self.assertStatus(self.emp("ira").get(f"/api/tasks/{t['id']}/"), 404)
            self.assertStatus(self.emp("ira").patch(f"/api/tasks/{t['id']}/status/", {"status": "completed"}, format="json"), 404)
            self.assertStatus(self.emp("tanti").put(f"/api/tasks/{t['id']}/", {"title": "x"}, format="json"), 403)
            r = self.assertStatus(self.emp("tanti").patch(f"/api/tasks/{t['id']}/status/", {"status": "in_progress", "progress": 150}, format="json"), 200)
            self.assertEqual(r["progress"], 99)
            self.assertStatus(self.emp("tanti").patch(f"/api/tasks/{t['id']}/status/", {"status": "done"}, format="json"), 422)
            r = self.assertStatus(self.emp("tanti").patch(f"/api/tasks/{t['id']}/status/", {"status": "completed"}, format="json"), 200)
        self.assertEqual((r["progress"], r["status_display"]), (100, "completed")); self.assertTrue(r["completed_at"])
        self.assertEqual([h["action"] for h in r["history"]], ["Tugas dibuat", "Status diubah", "Status diubah"])
        self.assertTrue(Notification.objects.filter(recipient_id=self.owner_profile.id, type="task_completed").exists())

    def test_overdue_reassign_delete(self):
        t = self.assertStatus(self.create(), 201)
        with frozen(jkt(2026, 11, 23, 9)):
            self.assertEqual(self.assertStatus(self.owner.get("/api/tasks/?status=overdue"), 200)[0]["id"], t["id"])
            r = self.assertStatus(self.owner.put(f"/api/tasks/{t['id']}/", {"title": "Packing order Shopee", "assignee_id": str(self.emps["laila"].id),
                                                                           "priority": "medium", "deadline": "2026-11-21"}, format="json"), 200)
            self.assertEqual(r["assignee_id"], str(self.emps["laila"].id)); self.assertEqual(r["history"][-1]["action"], "Dialihkan ke Laila (uji)")
            self.assertEqual(self.assertStatus(self.emp("tanti").get("/api/tasks/"), 200), [])
            self.assertEqual(len(self.assertStatus(self.owner.get(f"/api/tasks/?assignee_id={self.emps['laila'].id}"), 200)), 1)
            self.assertStatus(self.client_for(self.other_owner).delete(f"/api/tasks/{t['id']}/"), 404)
            self.assertStatus(self.owner.delete(f"/api/tasks/{t['id']}/"), 200)
        self.assertEqual(self.assertStatus(self.owner.get("/api/audit-logs/?limit=1"), 200)[0]["action"], "task.delete")
