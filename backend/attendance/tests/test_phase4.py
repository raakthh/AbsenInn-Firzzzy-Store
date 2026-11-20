"""Phase 4 — attendance backend."""
from unittest import mock

from attendance.models import AttendanceRecord
from core.storage import StorageUnavailable
from core.testing import TINY_JPEG, ApiTestCase, frozen, jkt
from notifications.models import Notification

IN = {"lat": -7.983, "lng": 112.66, "accuracy": 8}           # at the store
OUT = {"lat": -7.984, "lng": 112.66, "accuracy": 8}          # ≈111 m away (radius 10 m)


def payload(**kw):
    return {"selfie": TINY_JPEG, **IN, "captured_at": None, **kw}


class CheckInOutTests(ApiTestCase):
    def check_in(self, nick="ira", at=jkt(2026, 11, 20, 7, 55), **kw):
        with frozen(at):
            return self.emp(nick).post("/api/attendance/check-in/", payload(**kw), format="json")

    def check_out(self, nick="ira", at=jkt(2026, 11, 20, 16, 5), **kw):
        with frozen(at):
            return self.emp(nick).post("/api/attendance/check-out/", payload(**kw), format="json")

    def test_on_time_check_in_and_out(self):
        r = self.assertStatus(self.check_in(), 201)
        self.assertEqual(r["status"], "present"); self.assertEqual(r["location_status"], "verified")
        self.assertEqual(r["date"], "2026-11-20"); self.assertEqual(r["distance_in_m"], 0)
        self.assertTrue(r["selfie_in_path"].startswith(f"{self.company.id}/{self.emps['ira'].id}/2026-11-20-in-"))
        r = self.assertStatus(self.check_out(), 200)
        self.assertEqual(r["status"], "present")
        self.assertEqual(r["work_minutes"], 490 - 60)          # 07:55–16:05 minus 1 h break

    def test_late_after_tolerance(self):
        self.assertEqual(self.assertStatus(self.check_in(at=jkt(2026, 11, 20, 8, 59)), 201)["status"], "present")   # tolerance 60 min
        self.assertEqual(self.assertStatus(self.check_in("laila", at=jkt(2026, 11, 20, 9, 1)), 201)["status"], "late")

    def test_early_leave_and_late_plus_early(self):
        self.check_in()
        self.assertEqual(self.assertStatus(self.check_out(at=jkt(2026, 11, 20, 14, 0)), 200)["status"], "early_leave")
        self.check_in("laila", at=jkt(2026, 11, 20, 9, 30))
        r = self.assertStatus(self.check_out("laila", at=jkt(2026, 11, 20, 14, 0)), 200)
        self.assertEqual(r["status"], "late"); self.assertIn("early_leave", r["flags"])

    def test_outside_radius_blocked_then_review(self):
        r = self.assertStatus(self.check_in(**OUT), 422)
        self.assertEqual(r["code"], "OUTSIDE_RADIUS"); self.assertGreater(r["distance_m"], 100)
        self.assertFalse(AttendanceRecord.objects.exists())
        r = self.assertStatus(self.check_in(**OUT, request_review=True, note="Antar barang"), 201)
        self.assertEqual(r["status"], "needs_review"); self.assertEqual(r["location_status"], "outside")
        self.assertIn("outside_radius", r["flags"]); self.assertEqual(r["notes"], "Antar barang")
        self.assertTrue(Notification.objects.filter(recipient_id=self.owner_profile.id, type="attendance_review").exists())

    def test_low_accuracy_needs_review(self):
        r = self.assertStatus(self.check_in(accuracy=500), 201)
        self.assertEqual(r["status"], "needs_review"); self.assertEqual(r["location_status"], "needs_review")
        self.assertIn("low_gps_accuracy", r["flags"])

    def test_selfie_and_gps_required(self):
        self.assertEqual(self.assertStatus(self.check_in(selfie=None), 422)["code"], "SELFIE_REQUIRED")
        self.assertEqual(self.assertStatus(self.check_in(lat=None), 422)["code"], "GPS_UNAVAILABLE")
        bad = "data:image/jpeg;base64," + "PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg=="    # "<script>…" pretending to be a JPEG
        self.assertEqual(self.assertStatus(self.check_in(selfie=bad), 422)["code"], "VALIDATION")

    def test_duplicates_and_order(self):
        self.assertEqual(self.assertStatus(self.check_out(), 409)["code"], "NO_CHECK_IN")
        self.check_in()
        self.assertEqual(self.assertStatus(self.check_in(), 409)["code"], "ALREADY_CHECKED_IN")
        self.check_out()
        self.assertEqual(self.assertStatus(self.check_out(), 409)["code"], "ALREADY_CHECKED_OUT")

    def test_upload_failure_records_nothing(self):
        with mock.patch("core.storage.LocalStorage.upload", side_effect=StorageUnavailable()):
            self.assertEqual(self.assertStatus(self.check_in(), 502)["code"], "UPLOAD_FAILED")
        self.assertFalse(AttendanceRecord.objects.exists())
        self.assertStatus(self.check_in(), 201)                    # retry works

    def test_owner_cannot_check_in(self):
        with frozen(jkt(2026, 11, 20, 8)):
            self.assertStatus(self.owner.post("/api/attendance/check-in/", payload(), format="json"), 403)

    def test_today_and_location_preview(self):
        self.check_in()
        with frozen(jkt(2026, 11, 20, 10)):
            t = self.assertStatus(self.emp("ira").get("/api/attendance/today/"), 200)
            self.assertTrue(t["is_work_day"]); self.assertTrue(t["location_configured"]); self.assertEqual(t["record"]["status"], "present")
            p = self.assertStatus(self.emp("ira").post("/api/attendance/location-preview/", OUT, format="json"), 200)
        self.assertEqual(p["status"], "outside")

    def test_evidence_signed_urls_and_privacy(self):
        rec = self.assertStatus(self.check_in(), 201)
        ev = self.assertStatus(self.owner.get(f"/api/attendance/{rec['id']}/evidence/"), 200)
        self.assertTrue(ev["check_in"]["selfie_url"].startswith("data:image/jpeg;base64,"))
        self.assertEqual(ev["expires_in"], 300)
        self.assertStatus(self.emp("ira").get(f"/api/attendance/{rec['id']}/evidence/"), 200)
        self.assertStatus(self.emp("laila").get(f"/api/attendance/{rec['id']}/evidence/"), 404)
        self.assertStatus(self.client_for(self.other_owner).get(f"/api/attendance/{rec['id']}/evidence/"), 404)


class MonitoringCorrectionTests(ApiTestCase):
    def setUp(self):
        with frozen(jkt(2026, 11, 20, 7, 50)):
            self.rec = self.emp("ira").post("/api/attendance/check-in/", payload(), format="json").json()

    def test_monitoring_states(self):
        with frozen(jkt(2026, 11, 20, 10)):
            m = self.assertStatus(self.owner.get("/api/attendance/monitoring/?date=2026-11-20"), 200)
            states = {r["employee"]["full_name"]: r["state"] for r in m["rows"]}
            self.assertEqual(states, {"Ira (uji)": "present", "Laila (uji)": "not_checked_in", "Tanti (uji)": "not_checked_in"})
            m = self.assertStatus(self.owner.get("/api/attendance/monitoring/?date=2026-11-10"), 200)
        self.assertEqual({r["state"] for r in m["rows"]}, {"unreconciled"})
        self.assertEqual(len(m["rows"]), 2)                    # Tanti joined 16 Nov
        self.assertStatus(self.emp("ira").get("/api/attendance/monitoring/"), 403)

    def test_history_scoping(self):
        self.assertEqual(len(self.assertStatus(self.emp("ira").get("/api/attendance/history/"), 200)), 1)
        self.assertEqual(self.assertStatus(self.emp("laila").get(f"/api/attendance/history/?employee_id={self.emps['ira'].id}"), 200), [])
        self.assertEqual(len(self.assertStatus(self.owner.get(f"/api/attendance/history/?employee_id={self.emps['ira'].id}&from=2026-11-01"), 200)), 1)
        self.assertEqual(self.assertStatus(self.client_for(self.other_owner).get("/api/attendance/history/"), 200), [])
        self.assertStatus(self.emp("laila").get(f"/api/attendance/{self.rec['id']}/"), 404)

    def test_owner_correction(self):
        with frozen(jkt(2026, 11, 20, 18)):
            r = self.assertStatus(self.owner.post(f"/api/attendance/{self.rec['id']}/correction/", {"status": "present", "check_in": "08:00", "check_out": "16:00", "reason": ""}, format="json"), 422)
            self.assertIn("reason", r)
            r = self.assertStatus(self.owner.post(f"/api/attendance/{self.rec['id']}/correction/", {"status": "present", "check_in": "08:00", "check_out": "07:00", "reason": "Lupa check-out"}, format="json"), 422)
            self.assertIn("check_out", r)
            r = self.assertStatus(self.owner.post(f"/api/attendance/{self.rec['id']}/correction/", {"status": "present", "check_in": "08:00", "check_out": "16:00", "reason": "Lupa check-out"}, format="json"), 200)
            self.assertEqual(r["work_minutes"], 420); self.assertTrue(r["check_out_at"].startswith("2026-11-20T16:00:00+07:00") or r["check_out_at"].startswith("2026-11-20T09:00:00"))
            d = self.assertStatus(self.owner.get(f"/api/attendance/{self.rec['id']}/"), 200)
            self.assertEqual(d["corrections"][0]["before"]["status"], "present"); self.assertEqual(d["corrections"][0]["corrected_by_name"], "Farizky (uji)")
            # new record for a day without data; future date refused
            r = self.assertStatus(self.owner.post("/api/attendance/new/correction/", {"employee_id": str(self.emps["laila"].id), "date": "2026-11-19", "status": "sick", "reason": "Surat dokter menyusul"}, format="json"), 200)
            self.assertEqual(r["status"], "sick"); self.assertEqual(r["source"], "correction")
            self.assertStatus(self.owner.post("/api/attendance/new/correction/", {"employee_id": str(self.emps["laila"].id), "date": "2026-12-01", "status": "present", "reason": "Masa depan"}, format="json"), 422)
            self.assertStatus(self.owner.post("/api/attendance/new/correction/", {"employee_id": str(self.other_emp.id), "date": "2026-11-19", "status": "present", "reason": "Bukan karyawan"}, format="json"), 404)
            self.assertStatus(self.emp("ira").post(f"/api/attendance/{self.rec['id']}/correction/", {"status": "present", "reason": "Hack hack"}, format="json"), 403)
        self.assertTrue(Notification.objects.filter(recipient_id=self.emp_profiles["ira"].id, type="attendance_corrected").exists())
        self.assertEqual(self.assertStatus(self.owner.get("/api/audit-logs/?limit=1"), 200)[0]["action"], "attendance.correct")

    def test_employee_request_and_owner_approve_or_reject(self):
        with frozen(jkt(2026, 11, 20, 18)):
            self.assertStatus(self.emp("laila").post("/api/attendance/correction-requests/", {"date": "2026-11-21", "reason": "Masa depan tidak boleh"}, format="json"), 422)
            self.assertStatus(self.emp("laila").post("/api/attendance/correction-requests/", {"date": "2026-11-19", "reason": "pendek"}, format="json"), 422)
            c = self.assertStatus(self.emp("laila").post("/api/attendance/correction-requests/", {"date": "2026-11-19", "check_in": "08:00", "check_out": "16:00", "reason": "HP mati, lupa absen kemarin"}, format="json"), 201)
            self.assertEqual(c["status"], "pending")
            self.assertStatus(self.emp("laila").post("/api/attendance/correction-requests/", {"date": "2026-11-19", "reason": "Dobel pengajuan hari sama"}, format="json"), 422)
            self.assertEqual(len(self.assertStatus(self.emp("ira").get("/api/attendance/correction-requests/"), 200)), 0)
            self.assertStatus(self.emp("laila").post(f"/api/attendance/correction-requests/{c['id']}/approve/", {"status": "present"}, format="json"), 403)
            r = self.assertStatus(self.owner.post(f"/api/attendance/correction-requests/{c['id']}/approve/", {"status": "present", "check_in": "08:00", "check_out": "16:00", "notes": "ok"}, format="json"), 200)
            self.assertEqual(r["status"], "approved")
            self.assertStatus(self.owner.post(f"/api/attendance/correction-requests/{c['id']}/approve/", {"status": "present"}, format="json"), 409)
            recs = self.assertStatus(self.emp("laila").get("/api/attendance/history/?date=2026-11-19"), 200)
            self.assertEqual(recs[0]["status"], "present")
            c2 = self.assertStatus(self.emp("laila").post("/api/attendance/correction-requests/", {"date": "2026-11-18", "reason": "Minta koreksi lagi ya"}, format="json"), 201)
            r = self.assertStatus(self.owner.post(f"/api/attendance/correction-requests/{c2['id']}/reject/", {"notes": "Tidak ada bukti"}, format="json"), 200)
        self.assertEqual(r["status"], "rejected")
        self.assertTrue(Notification.objects.filter(recipient_id=self.emp_profiles["laila"].id, type="correction_rejected").exists())

    def test_reconcile(self):
        with frozen(jkt(2026, 11, 20, 18)):
            self.assertStatus(self.owner.get("/api/attendance/reconcile/?date=2026-11-20"), 422)
            self.assertFalse(self.assertStatus(self.owner.get("/api/attendance/reconcile/?date=2026-11-15"), 200)["is_work_day"])  # Sunday
            p = self.assertStatus(self.owner.get("/api/attendance/reconcile/?date=2026-11-19"), 200)
            self.assertEqual({c["employee"]["full_name"] for c in p["candidates"]}, {"Ira (uji)", "Laila (uji)", "Tanti (uji)"})
            ids = [str(self.emps["laila"].id), str(self.other_emp.id)]
            r = self.assertStatus(self.owner.post("/api/attendance/reconcile/", {"date": "2026-11-19", "employee_ids": ids}, format="json"), 200)
        self.assertEqual(r["count"], 1)                            # foreign employee ignored
        rec = AttendanceRecord.objects.get(employee_id=self.emps["laila"].id, attendance_date="2026-11-19")
        self.assertEqual((rec.status, rec.source), ("absent", "reconciliation"))
