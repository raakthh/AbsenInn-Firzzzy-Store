"""Phase 3 — token verification, server-side authorization, validation,
company isolation, settings, announcements, notifications."""
from unittest import mock

from rest_framework.test import APIClient

from core.testing import ApiTestCase, fake_invite, make_token


class AuthTests(ApiTestCase):
    def test_no_token_is_401(self):
        r = APIClient().get("/api/auth/me/")
        self.assertStatus(r, 401)

    def test_garbage_token_is_401(self):
        c = APIClient(); c.credentials(HTTP_AUTHORIZATION="Bearer abc.def.ghi")
        self.assertEqual(self.assertStatus(c.get("/api/auth/me/"), 401)["code"], "UNAUTHORIZED")

    def test_wrong_secret_is_401(self):
        c = APIClient(); c.credentials(HTTP_AUTHORIZATION=f"Bearer {make_token(self.owner_profile.id, secret='x' * 40)}")
        self.assertStatus(c.get("/api/auth/me/"), 401)

    def test_expired_token_is_401(self):
        c = APIClient(); c.credentials(HTTP_AUTHORIZATION=f"Bearer {make_token(self.owner_profile.id, exp_minutes=-10)}")
        self.assertStatus(c.get("/api/auth/me/"), 401)

    def test_wrong_audience_is_401(self):
        c = APIClient(); c.credentials(HTTP_AUTHORIZATION=f"Bearer {make_token(self.owner_profile.id, aud='other')}")
        self.assertStatus(c.get("/api/auth/me/"), 401)

    def test_anon_role_token_rejected(self):
        c = APIClient(); c.credentials(HTTP_AUTHORIZATION=f"Bearer {make_token(self.owner_profile.id, role='anon')}")
        self.assertStatus(c.get("/api/auth/me/"), 401)

    def test_unknown_user_is_403(self):
        import uuid
        self.assertStatus(self.client_for(uuid.uuid4()).get("/api/auth/me/"), 403)

    def test_inactive_employee_is_403(self):
        e = self.emps["laila"]; e.employment_status = "inactive"; e.save()
        self.assertStatus(self.emp("laila").get("/api/auth/me/"), 403)

    def test_me_owner_and_employee(self):
        me = self.assertStatus(self.owner.get("/api/auth/me/"), 200)
        self.assertEqual(me["role"], "owner"); self.assertEqual(me["company"]["name"], "Firzzzy Store (uji)")
        me = self.assertStatus(self.emp("ira").get("/api/auth/me/"), 200)
        self.assertEqual(me["employee"]["id"], str(self.emps["ira"].id))

    def test_health_is_public(self):
        self.assertStatus(APIClient().get("/api/health/"), 200)


class EmployeeTests(ApiTestCase):
    def test_employee_cannot_list_employees(self):
        self.assertStatus(self.emp("ira").get("/api/employees/"), 403)

    def test_owner_lists_only_own_company(self):
        rows = self.assertStatus(self.owner.get("/api/employees/"), 200)
        self.assertEqual({r["full_name"] for r in rows}, {"Ira (uji)", "Laila (uji)", "Tanti (uji)"})
        self.assertTrue(all(r["employee_code"].startswith("EMP-") for r in rows))

    def test_owner_cannot_read_foreign_employee(self):
        self.assertStatus(self.owner.get(f"/api/employees/{self.other_emp.id}/"), 404)

    def test_bad_uuid_is_404(self):
        self.assertStatus(self.owner.get("/api/employees/not-a-uuid/"), 404)

    def test_employee_reads_self_but_not_others_and_never_salary(self):
        me = self.assertStatus(self.emp("ira").get(f"/api/employees/{self.emps['ira'].id}/"), 200)
        self.assertNotIn("salary_config", me)
        self.assertStatus(self.emp("ira").get(f"/api/employees/{self.emps['laila'].id}/"), 403)

    def test_owner_sees_salary_config(self):
        d = self.assertStatus(self.owner.get(f"/api/employees/{self.emps['ira'].id}/"), 200)
        self.assertEqual(d["salary_config"]["basic_salary"], 3000000)

    def test_create_validation(self):
        r = self.assertStatus(self.owner.post("/api/employees/", {"full_name": "A", "email": "bad", "position": "", "join_date": ""}, format="json"), 422)
        self.assertEqual(r["code"], "VALIDATION")
        for k in ("full_name", "email", "position", "join_date", "basic_salary"):
            self.assertIn(k, r)

    def test_create_requires_company_domain(self):
        r = self.assertStatus(self.owner.post("/api/employees/", {"full_name": "Dina Baru", "email": "dina@gmail.com", "position": "Kasir",
                                                                  "join_date": "2026-11-01", "basic_salary": 2000000}, format="json"), 422)
        self.assertIn("firzzzystore.com", r["email"])

    def test_create_duplicate_email(self):
        r = self.assertStatus(self.owner.post("/api/employees/", {"full_name": "Ira Lagi", "email": "ira@firzzzystore.com", "position": "Kasir",
                                                                  "join_date": "2026-11-01", "basic_salary": 2000000}, format="json"), 422)
        self.assertEqual(r["email"], "Email sudah digunakan")

    def test_create_with_account_invite(self):
        with mock.patch("core.supabase_admin.invite_user", side_effect=fake_invite) as inv:
            e = self.assertStatus(self.owner.post("/api/employees/", {"full_name": "Dina Baru", "email": "Dina@firzzzystore.com", "position": "Kasir",
                                                                      "join_date": "2026-11-01", "basic_salary": 2000000, "create_account": True}, format="json"), 201)
        inv.assert_called_once()
        self.assertEqual(e["employee_code"], "EMP-004"); self.assertEqual(e["email"], "dina@firzzzystore.com")
        self.assertTrue(e["user_id"]); self.assertEqual(e["history"][0]["event"], "Bergabung sebagai Kasir")
        d = self.assertStatus(self.owner.get(f"/api/employees/{e['id']}/"), 200)
        self.assertEqual(d["salary_config"]["basic_salary"], 2000000)
        self.assertStatus(self.client_for(e["user_id"]).get("/api/auth/me/"), 200)  # the invited account can sign in
        logs = self.assertStatus(self.owner.get("/api/audit-logs/?limit=5"), 200)
        self.assertEqual(logs[0]["action"], "employee.create")

    def test_employee_self_update_limited_to_allowed_fields(self):
        r = self.assertStatus(self.emp("ira").put(f"/api/employees/{self.emps['ira'].id}/", {"phone": "0812-1111-2222", "position": "CEO", "full_name": "Hacker"}, format="json"), 200)
        self.assertEqual(r["phone"], "0812-1111-2222"); self.assertEqual(r["position"], "Manager"); self.assertEqual(r["full_name"], "Ira (uji)")

    def test_owner_update_records_position_history(self):
        r = self.assertStatus(self.owner.put(f"/api/employees/{self.emps['laila'].id}/", {"position": "Supervisor"}, format="json"), 200)
        self.assertIn("Jabatan berubah: Admin → Supervisor", [h["event"] for h in r["history"]])

    def test_deactivate_blocks_login_and_activate_restores(self):
        self.assertStatus(self.owner.delete(f"/api/employees/{self.emps['tanti'].id}/"), 200)
        self.assertStatus(self.emp("tanti").get("/api/auth/me/"), 403)
        self.assertStatus(self.owner.post(f"/api/employees/{self.emps['tanti'].id}/activate/"), 200)
        self.assertStatus(self.emp("tanti").get("/api/auth/me/"), 200)

    def test_employee_cannot_deactivate(self):
        self.assertStatus(self.emp("ira").delete(f"/api/employees/{self.emps['laila'].id}/"), 403)


class SettingsTests(ApiTestCase):
    def test_employee_settings_are_redacted(self):
        s = self.assertStatus(self.emp("ira").get("/api/settings/"), 200)
        self.assertNotIn("payroll", s); self.assertNotIn("lat", s["attendance"]["location"])
        self.assertEqual(s["work"]["working_days"], [1, 2, 3, 4, 5, 6])

    def test_owner_settings_shape(self):
        s = self.assertStatus(self.owner.get("/api/settings/"), 200)
        self.assertEqual(s["payroll"]["payment_day_mode"], "join_date")
        self.assertEqual(s["payroll"]["rules"]["absent"], "prorate")
        self.assertEqual(s["attendance"]["radius_m"], 10)
        self.assertEqual(len(s["leave_types"]), 5)
        self.assertEqual(len(s["users"]), 4)

    def test_employee_cannot_update_settings(self):
        self.assertStatus(self.emp("ira").put("/api/settings/work/", {}, format="json"), 403)

    def test_update_work_validates_and_audits(self):
        r = self.assertStatus(self.owner.put("/api/settings/work/", {"start": "16:00", "end": "08:00", "working_days": [], "late_tolerance_min": 500}, format="json"), 422)
        for k in ("end", "working_days", "late_tolerance_min"):
            self.assertIn(k, r)
        s = self.assertStatus(self.owner.put("/api/settings/work/", {"start": "08:00", "end": "16:00", "break_start": "12:00", "break_end": "13:00",
                                                                    "working_days": [1, 2, 3, 4, 5, 6], "late_tolerance_min": 15, "early_leave_tolerance_min": 0}, format="json"), 200)
        self.assertEqual(s["work"]["late_tolerance_min"], 15)
        self.assertEqual(self.assertStatus(self.owner.get("/api/audit-logs/"), 200)[0]["action"], "settings.work")

    def test_update_attendance_location(self):
        s = self.assertStatus(self.owner.put("/api/settings/attendance/", {"name": "Firzzzy", "address": "Malang", "lat": "-7.98", "lng": "112.66",
                                                                          "radius_m": 25, "max_gps_accuracy_m": 50, "selfie_required": True, "gps_required": True}, format="json"), 200)
        self.assertEqual(s["attendance"]["location"]["lat"], -7.98); self.assertEqual(s["attendance"]["radius_m"], 25)
        r = self.assertStatus(self.owner.put("/api/settings/attendance/", {"lat": "-7.98", "lng": "", "radius_m": 5, "max_gps_accuracy_m": 50}, format="json"), 422)
        self.assertIn("lat", r); self.assertIn("radius_m", r)

    def test_update_payroll_and_leave(self):
        s = self.assertStatus(self.owner.put("/api/settings/payroll/", {"period": "monthly", "payment_day_mode": "fixed", "payment_day": 25,
                                                                       "default_components": [{"name": "Transport", "amount": "100000"}],
                                                                       "rules": {"unpaid_leave": "prorate", "absent": "none", "late_per_incident": 0, "overtime_enabled": True}}, format="json"), 200)
        self.assertEqual(s["payroll"]["payment_day"], 25); self.assertEqual(s["payroll"]["default_components"][0]["amount"], 100000)
        lt = s["leave_types"][0]
        s = self.assertStatus(self.owner.put("/api/settings/leave/", {"annual_quota_days": 14, "types": [{"id": lt["id"], "is_paid": True, "requires_attachment": False, "active": True}]}, format="json"), 200)
        self.assertEqual(s["leave"]["annual_quota_days"], 14)
        self.assertTrue([t for t in s["leave_types"] if t["id"] == lt["id"]][0]["is_paid"])

    def test_unknown_section(self):
        self.assertStatus(self.owner.put("/api/settings/hack/", {}, format="json"), 422)


class AnnouncementNotificationTests(ApiTestCase):
    def test_announcement_flow_notifies_active_employees(self):
        self.assertStatus(self.emp("ira").post("/api/announcements/", {"title": "Hai", "body": "Isi pengumuman panjang"}, format="json"), 403)
        self.assertStatus(self.owner.post("/api/announcements/", {"title": "Hi", "body": "x"}, format="json"), 422)
        a = self.assertStatus(self.owner.post("/api/announcements/", {"title": "Libur", "body": "Toko libur hari Minggu ini.", "pinned": True}, format="json"), 201)
        n = self.assertStatus(self.emp("laila").get("/api/notifications/"), 200)
        self.assertEqual(n[0]["type"], "announcement"); self.assertFalse(n[0]["read"])
        self.assertEqual(self.assertStatus(self.emp("laila").get("/api/notifications/unread-count/"), 200)["unread"], 1)
        # other company sees nothing
        self.assertEqual(self.assertStatus(self.client_for(self.other_owner).get("/api/announcements/"), 200), [])
        self.assertStatus(self.owner.delete(f"/api/announcements/{a['id']}/"), 200)

    def test_notifications_are_private(self):
        self.owner.post("/api/announcements/", {"title": "Libur", "body": "Toko libur hari Minggu ini."}, format="json")
        laila_n = self.assertStatus(self.emp("laila").get("/api/notifications/"), 200)[0]
        self.assertStatus(self.emp("ira").post(f"/api/notifications/{laila_n['id']}/read/"), 404)
        self.assertStatus(self.owner.post(f"/api/notifications/{laila_n['id']}/read/"), 404)
        self.assertTrue(self.assertStatus(self.emp("laila").post(f"/api/notifications/{laila_n['id']}/read/"), 200)["read"])
        self.assertStatus(self.emp("ira").post("/api/notifications/read-all/"), 200)
        self.assertEqual(self.assertStatus(self.emp("ira").get("/api/notifications/unread-count/"), 200)["unread"], 0)
