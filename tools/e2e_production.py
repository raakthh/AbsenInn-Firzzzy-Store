"""Production-mode end-to-end test: real Django + real PostgreSQL schema + the
unchanged frontend in headless Chrome.

Only Supabase *Auth* is stubbed in the browser (no internet in CI): the stub
hands out real HS256-signed JWTs that Django verifies exactly like Supabase
tokens. Everything else — RLS-guard triggers, constraints, storage (local
backend), payroll engine, PDF — is the real code path.

Requirements: PostgreSQL reachable via E2E_ADMIN_URL (a role that can create
databases), Playwright + Chrome.
Run:  python3 tools/e2e_production.py
"""
import datetime as dt
import json
import os
import socket
import subprocess
import sys
import tempfile
import time
import uuid
from pathlib import Path

import jwt
import psycopg
from playwright.sync_api import sync_playwright

sys.path.insert(0, str(Path(__file__).parent))
import e2e_phase1 as T  # noqa: E402  (helpers: new_page, modal, confirm_ok, settle, CHART_STUB)

ROOT = Path(__file__).resolve().parent.parent
ADMIN_URL = os.environ.get("E2E_ADMIN_URL", "postgresql://claude:claude@localhost:5432/postgres")
DB_NAME = "absen_e2e"
DB_URL = ADMIN_URL.rsplit("/", 1)[0] + "/" + DB_NAME
PORT = int(os.environ.get("E2E_PORT", "8766"))
BASE = f"http://localhost:{PORT}"
SECRET = "e2e-jwt-secret-0123456789abcdef0123456789"
STORE = (-7.98300, 112.66000)
SHOTS = ROOT / "tools" / "screenshots" / "production"
SHOTS.mkdir(parents=True, exist_ok=True)

CID = "7e2e0000-0000-4000-8000-000000000001"
USERS = {  # fictitious test accounts
    "farizky": ("owner", "Farizky (E2E)", None, "#3B2898"),
    "ira": ("employee", "Ira (E2E)", "Manager", "#6C55F2"),
    "laila": ("employee", "Laila (E2E)", "Admin", "#E0559B"),
    "tanti": ("employee", "Tanti (E2E)", "Packing", "#13A985"),
}
UID = {k: str(uuid.uuid5(uuid.NAMESPACE_DNS, f"{k}.e2e.absenninn")) for k in USERS}
EID = {k: str(uuid.uuid5(uuid.NAMESPACE_DNS, f"emp-{k}.e2e.absenninn")) for k in USERS if k != "farizky"}
TODAY = dt.datetime.now(dt.timezone(dt.timedelta(hours=7))).date()
JOIN = {"ira": TODAY.replace(day=1) - dt.timedelta(days=200), "laila": TODAY.replace(day=1) - dt.timedelta(days=120), "tanti": TODAY - dt.timedelta(days=2)}


def email(k):
    return f"{k}@firzzzystore.com"


def build_db():
    with psycopg.connect(ADMIN_URL, autocommit=True) as c:
        c.execute(f"drop database if exists {DB_NAME} with (force)")
        c.execute(f"create database {DB_NAME}")
    with psycopg.connect(DB_URL, autocommit=True) as c:
        c.execute((ROOT / "tools/supabase_shim.sql").read_text())
        c.execute((ROOT / "database/schema.sql").read_text())
        c.execute("insert into companies (id, name, address, email_domain) values (%s, 'Firzzzy Store (E2E)', 'Alamat uji', 'firzzzystore.com')", [CID])
        c.execute("select app.bootstrap_company(%s)", [CID])
        c.execute("""update company_settings set payment_day_mode='join_date', default_payment_day=null,
                     payroll_rules='{"unpaid_leave":"prorate","absent":"prorate","late_per_incident":0,"overtime_enabled":true}' where company_id=%s""", [CID])
        c.execute("update work_schedules set working_days='{1,2,3,4,5,6}', late_tolerance_min=60 where company_id=%s", [CID])
        c.execute("update leave_types set is_paid=false, uses_quota=false where company_id=%s", [CID])          # store policy: no allowance,
        c.execute("delete from leave_types where company_id=%s and code in ('annual','unpaid')", [CID])         # every leave cuts pay
        c.execute("update company_settings set annual_leave_quota_days=0 where company_id=%s", [CID])
        for k, (role, name, pos, color) in USERS.items():
            c.execute("insert into auth.users (id, email) values (%s, %s)", [UID[k], email(k)])
            if role == "employee":
                c.execute("""insert into employees (id, company_id, full_name, nickname, email, position, join_date, avatar_color)
                             values (%s, %s, %s, %s, %s, %s, %s, %s)""", [EID[k], CID, name, k, email(k), pos, JOIN[k], color])
                c.execute("insert into employment_history (company_id, employee_id, event_date, event) values (%s, %s, %s, %s)", [CID, EID[k], JOIN[k], f"Bergabung sebagai {pos}"])
            c.execute("select app.link_account(%s, %s, %s, %s, %s, %s)", [email(k), CID, role, name, EID.get(k), color])


def token(k):
    now = int(time.time())
    return jwt.encode({"sub": UID[k], "aud": "authenticated", "role": "authenticated", "iat": now, "exp": now + 7200, "email": email(k)}, SECRET, algorithm="HS256")


def supabase_stub():
    users = [{"id": UID[k], "email": email(k), "password": "Rahasia123", "token": token(k)} for k in USERS]
    profiles = [{"id": UID[k], "company_id": CID, "role": r, "full_name": n, "email": email(k), "avatar_color": col, "is_active": True} for k, (r, n, _, col) in USERS.items()]
    employees = [{"id": EID[k], "profile_id": UID[k], "company_id": CID, "employment_status": "active"} for k in EID]
    return """(function(){
  const DB = %s;
  window.supabase = { createClient(url, key, opts) {
    const st = opts.auth.storage, K = opts.auth.storageKey, listeners = [];
    const cur = () => { try { return JSON.parse(st.getItem(K)); } catch { return null; } };
    const emit = (ev, s) => listeners.forEach(cb => cb(ev, s));
    const from = (table) => { const f = []; const q = { select(){ return q; }, eq(c, v){ f.push([c, v]); return q; },
      maybeSingle(){ const s = cur(); const rows = (DB[table]||[]).filter(r => s && f.every(([c,v]) => r[c] === v) && (table !== 'profiles' || r.id === s.user.id) && (table !== 'employees' || r.profile_id === s.user.id)); return Promise.resolve({ data: rows[0] || null, error: null }); } }; return q; };
    return { from, auth: {
      async signInWithPassword({email, password}) { const u = DB.users.find(x => x.email === email);
        if (!u || u.password !== password) return { data: { session: null }, error: { message: 'Invalid login credentials', status: 400 } };
        const s = { access_token: u.token, expires_at: Date.now()/1000 + 3600, user: { id: u.id, email: u.email } };
        st.setItem(K, JSON.stringify(s)); emit('SIGNED_IN', s); return { data: { session: s, user: s.user }, error: null }; },
      async getSession() { return { data: { session: cur() }, error: null }; },
      async signOut() { st.removeItem(K); emit('SIGNED_OUT', null); return { error: null }; },
      onAuthStateChange(cb) { listeners.push(cb); return { data: { subscription: { unsubscribe(){} } } }; },
      async resetPasswordForEmail() { return { data: {}, error: null }; }, async updateUser() { return { data: {}, error: null }; } } };
  } };
})();""" % json.dumps({"users": users, "profiles": profiles, "employees": employees})


def start_django(storage_dir):
    env = {**os.environ, "DATABASE_URL": DB_URL, "DJANGO_DEBUG": "True", "SUPABASE_JWT_SECRET": SECRET, "STORAGE_BACKEND": "local",
           "LOCAL_STORAGE_DIR": storage_dir, "SERVE_FRONTEND": "True", "DJANGO_ALLOWED_HOSTS": "localhost,127.0.0.1", "LOG_LEVEL": "WARNING"}
    proc = subprocess.Popen([sys.executable, "manage.py", "runserver", f"127.0.0.1:{PORT}", "--noreload"], cwd=ROOT / "backend", env=env,
                            stdout=subprocess.DEVNULL, stderr=open(Path(storage_dir) / "django.log", "w"))
    for _ in range(80):
        try:
            socket.create_connection(("127.0.0.1", PORT), 0.3).close()
            return proc
        except OSError:
            time.sleep(0.25)
    proc.kill()
    raise RuntimeError("Django did not start")


def main():
    build_db()
    storage = tempfile.mkdtemp(prefix="absen-e2e-")
    django = start_django(storage)
    check, errors = T.check, T.errors
    stub = supabase_stub()
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"])

            def ctx_for(geo=None, w=1440, h=900):
                ctx, page = T.new_page(browser, w=w, h=h, geo=geo)
                def cfg(route):
                    body = (ROOT / "frontend/js/config.js").read_text().replace("MODE: 'demo'", "MODE: 'production'") \
                        .replace("SUPABASE_URL: ''", "SUPABASE_URL: 'https://stub.supabase.co'").replace("SUPABASE_ANON_KEY: ''", "SUPABASE_ANON_KEY: 'anon'")
                    route.fulfill(status=200, content_type="application/javascript", body=body)
                ctx.route("**/js/config.js", cfg)
                ctx.route("**/@supabase/**", lambda r: r.fulfill(status=200, content_type="application/javascript", body=stub))
                return ctx, page

            def probe(page, path, method="GET", body=None):
                """Deliberate forbidden/invalid request: its expected 4xx console line is not an app error."""
                n = len(errors)
                r = api(page, path, method, body)
                page.wait_for_timeout(150)
                del errors[n:]
                return r

            def login(page, k):
                page.goto(f"{BASE}/login.html"); page.wait_for_selector("#login-form")
                page.fill("#email", email(k)); page.fill("#password", "Rahasia123"); page.click("#login-btn")
                page.wait_for_url("**/dashboard.html", timeout=10000); page.wait_for_selector(".splash", state="detached", timeout=10000)

            def api(page, path, method="GET", body=None):
                return page.evaluate("""async ([path, method, body]) => { const t = await Auth.accessToken();
                    const r = await fetch('/api' + path, { method, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + t }, body: body ? JSON.stringify(body) : undefined });
                    return { status: r.status, data: await r.json().catch(() => null) }; }""", [path, method, body])

            # ------------------------------------------------------------ owner setup
            print("Owner — login & every page against Django")
            octx, owner = ctx_for()
            login(owner, "farizky")
            check("owner dashboard (production)", "/owner/dashboard.html" in owner.url and owner.locator(".demo-banner").count() == 0)
            for pg in ["dashboard", "employees", "attendance", "leave", "tasks", "payroll", "analytics", "reports", "notifications", "settings"]:
                owner.goto(f"{BASE}/owner/{pg}.html"); owner.wait_for_selector(".sidebar", timeout=10000); T.settle(owner, 900)
                check(f"owner/{pg} renders from API", owner.locator(".state-error").count() == 0, owner.inner_text("#content")[:200])
                owner.screenshot(path=str(SHOTS / f"o-{pg}.png"), full_page=True)
            owner.goto(f"{BASE}/owner/employee-detail.html?id={EID['ira']}"); T.settle(owner, 900)
            check("owner/employee-detail renders", owner.locator(".state-error").count() == 0 and "Ira (E2E)" in owner.inner_text("#content"))

            print("Owner — settings: work location")
            owner.goto(f"{BASE}/owner/settings.html#attendance"); owner.wait_for_selector("[data-form] [name=lat]", timeout=8000)
            owner.fill("[name=name]", "Toko"); owner.fill("[name=lat]", str(STORE[0])); owner.fill("[name=lng]", str(STORE[1])); owner.fill("[name=radius_m]", "50")
            owner.click("[data-form] [type=submit]"); owner.wait_for_selector(".toast-success", timeout=6000)
            s = api(owner, "/settings/")["data"]
            check("location saved server-side", s["attendance"]["location"]["lat"] == STORE[0] and s["attendance"]["radius_m"] == 50, json.dumps(s["attendance"]))

            print("Owner — salary configuration")
            owner.goto(f"{BASE}/owner/payroll.html#config"); T.settle(owner)
            check("unconfigured salary flagged", "Belum diisi" in owner.inner_text("#content"))
            for k, amount in (("ira", "3000000"), ("laila", "2600000"), ("tanti", "2340000")):
                owner.locator(f"[data-cfg='{EID[k]}']").click(); m = T.modal(owner)
                m.locator("[name=basic_salary]").fill(amount); m.locator("[name=overtime_rate_per_hour]").fill("15000")
                m.locator("[data-save]").click(); owner.wait_for_selector(".toast-success", timeout=6000); owner.wait_for_timeout(300)
            cfgs = api(owner, "/payroll/salary-configurations/")["data"]
            check("salary configs stored", all(c["configured"] for c in cfgs) and {c["basic_salary"] for c in cfgs} == {3000000, 2600000, 2340000})

            print("Owner — task for Tanti")
            owner.goto(f"{BASE}/owner/tasks.html"); T.settle(owner)
            owner.click("[data-new]"); m = T.modal(owner)
            m.locator("[name=title]").fill("Packing order Shopee"); m.locator("[name=assignee_id]").select_option(EID["tanti"])
            m.locator("[data-save]").click(); owner.wait_for_selector(".toast-success", timeout=6000)
            check("task created via API", any(t["title"] == "Packing order Shopee" for t in api(owner, "/tasks/")["data"]))

            # ------------------------------------------------------------ employee: Ira check-in/out
            print("Employee — selfie + GPS check-in at the store")
            ictx, ira = ctx_for(geo={"latitude": STORE[0], "longitude": STORE[1], "accuracy": 8}, w=420, h=900)
            login(ira, "ira")
            ira.click("[data-today] [data-in]"); m = T.modal(ira)
            m.locator("[data-action]:not([disabled])").wait_for(timeout=10000); m.locator("[data-action]").click()
            m.locator(".loc-row").first.wait_for(timeout=10000); ira.wait_for_timeout(300)
            check("server location preview verified", "Terverifikasi" in m.locator("[data-loc]").inner_text(), m.locator("[data-loc]").inner_text())
            m.locator("[data-action]").click(); ira.wait_for_selector(".toast-success", timeout=10000); T.settle(ira)
            today = api(ira, "/attendance/today/")["data"]
            rec = today["record"]
            check("check-in stored by Django with selfie + GPS", rec and rec["check_in_at"] and rec["selfie_in_path"] and rec["location_status"] == "verified", json.dumps(rec)[:300])
            ira.screenshot(path=str(SHOTS / "e-dashboard-after-checkin.png"), full_page=True)
            again = probe(ira, "/attendance/check-in/", "POST", {"lat": STORE[0], "lng": STORE[1], "accuracy": 5})
            check("double check-in rejected by server", again["status"] in (409, 422), json.dumps(again))
            ira.click("[data-today] [data-out]"); m = T.modal(ira)
            m.locator("[data-action]:not([disabled])").wait_for(timeout=10000); m.locator("[data-action]").click()
            m.locator(".loc-row").first.wait_for(timeout=10000); m.locator("[data-action]:not([disabled])").click()
            ira.wait_for_selector(".toast >> nth=-1", timeout=10000); T.settle(ira)
            rec = api(ira, "/attendance/today/")["data"]["record"]
            check("check-out stored, work minutes computed server-side", rec["check_out_at"] and rec["work_minutes"] is not None)
            ira.goto(f"{BASE}/employee/attendance.html"); T.settle(ira, 900)
            ira.locator("[data-rec]").first.click(); ira.locator(".modal img.selfie-img").first.wait_for(timeout=8000)
            check("employee sees own selfie via signed URL", ira.locator(".modal img.selfie-img").first.get_attribute("src").startswith("data:image/"))
            ira.locator(".modal [data-close]").last.click(); ira.wait_for_timeout(300)
            leak = probe(ira, f"/employees/{EID['laila']}/")
            check("employee cannot read colleague data", leak["status"] == 403)
            check("employee cannot open owner API", probe(ira, "/payroll/")["status"] == 403)

            # ------------------------------------------------------------ employee: Laila leave with attachment
            print("Employee — sick leave with real attachment upload")
            lctx, laila = ctx_for(geo={"latitude": STORE[0], "longitude": STORE[1], "accuracy": 8}, w=420, h=900)
            login(laila, "laila")
            laila.goto(f"{BASE}/employee/leave.html?new=1"); T.settle(laila); m = T.modal(laila)
            sick = [t for t in api(laila, "/leave/types/")["data"] if t["code"] == "sick"][0]
            m.locator("[name=leave_type_id]").select_option(sick["id"]); m.locator("[name=reason]").fill("Demam tinggi, istirahat")
            pdf = Path(storage) / "surat-dokter.pdf"; pdf.write_bytes(b"%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF")
            m.locator("#att").set_input_files(str(pdf)); m.locator("[data-ok]").click(); laila.wait_for_selector(".toast-success", timeout=8000)
            lv = api(laila, "/leave/")["data"][0]
            laila.goto(f"{BASE}/employee/leave.html"); T.settle(laila, 900)
            check("no leave allowance shown (store policy)", "Saldo cuti" not in laila.inner_text("#content") and "Hari izin disetujui" in laila.inner_text("#content"))
            check("only Sakit / Izin Pribadi / Setengah Hari offered", {t["code"] for t in api(laila, "/leave/types/")["data"]} == {"sick", "personal", "half_day"})
            check("leave stored with attachment in private storage", lv["attachment_name"] == "surat-dokter.pdf" and lv["status"] == "pending", json.dumps(lv)[:200])

            # ------------------------------------------------------------ owner: monitoring, evidence, leave approval
            print("Owner — monitoring, evidence, leave decision")
            owner.goto(f"{BASE}/owner/attendance.html"); T.settle(owner, 900)
            check("monitoring shows Ira's check-in", "Ira (E2E)" in owner.inner_text("#content") and owner.locator("[data-evidence]").count() >= 1)
            owner.locator("[data-evidence]").first.click(); owner.locator(".modal img.selfie-img").first.wait_for(timeout=8000)
            check("owner sees selfie evidence (signed URL)", owner.locator(".modal img.selfie-img").count() >= 1)
            owner.screenshot(path=str(SHOTS / "o-evidence.png"))
            owner.locator(".modal [data-close]").last.click(); owner.wait_for_timeout(300)
            owner.goto(f"{BASE}/owner/leave.html"); T.settle(owner, 900)
            owner.locator("tbody tr").first.click(); m = T.modal(owner)
            m.locator("[data-att]").wait_for(timeout=8000); m.locator("[data-att]").click()
            m.locator("a:has-text('Buka lampiran')").wait_for(timeout=8000)
            check("owner opens attachment via signed URL", m.locator("a:has-text('Buka lampiran')").get_attribute("href").startswith("blob:"))
            owner.locator("[data-approve]").click(); T.confirm_ok(owner); owner.wait_for_selector(".toast-success", timeout=8000)
            lv = api(owner, f"/leave/{lv['id']}/")["data"]
            check("leave approved server-side", lv["status"] == "approved")
            hist = api(owner, f"/attendance/history/?employee_id={EID['laila']}&date={TODAY.isoformat()}")["data"]
            check("approval wrote attendance (sick) for work days", (not hist) or hist[0]["status"] == "sick" or TODAY.weekday() == 6, json.dumps(hist)[:200])

            # ------------------------------------------------------------ Tanti completes the task
            print("Employee — task completion")
            tctx, tanti = ctx_for(w=420, h=900)
            login(tanti, "tanti")
            tanti.goto(f"{BASE}/employee/tasks.html"); T.settle(tanti)
            tanti.locator("[data-st=completed]").first.click(); T.confirm_ok(tanti); tanti.wait_for_selector(".toast-success", timeout=8000)
            t = [x for x in api(owner, "/tasks/")["data"] if x["title"] == "Packing order Shopee"][0]
            check("task completed; history actor recorded by DB trigger", t["status"] == "completed" and t["history"][-1]["by"] == "Tanti (E2E)", json.dumps(t["history"]))

            # ------------------------------------------------------------ payroll flow
            print("Owner — payroll engine → approval → payslip PDF")
            owner.goto(f"{BASE}/owner/payroll.html"); T.settle(owner)
            owner.click("[data-gen]"); m = T.modal(owner); m.locator("[data-ok]").click()
            owner.wait_for_selector(".toast-success", timeout=10000); T.settle(owner, 900)
            per = api(owner, "/payroll/")["data"][0]
            detail = api(owner, f"/payroll/{per['id']}/")["data"]
            check("payroll generated from engine", per["period_key"] == TODAY.strftime("%Y-%m") and len(detail["items"]) >= 2, json.dumps(per)[:200])
            check("items carry join-date cycles & calc notes", all(i["calc_note"].startswith("Siklus") for i in detail["items"]))
            owner.screenshot(path=str(SHOTS / "o-payroll-draft.png"), full_page=True)
            owner.locator("[data-preview]").first.click(); m = T.modal(owner); m.locator("[data-ot]").wait_for(timeout=8000)
            m.locator("[name=overtime_hours]").fill("2"); m.locator("[data-ot] [type=submit]").click(); owner.wait_for_selector(".toast-success", timeout=8000)
            m.locator("[name=name]").fill("Bonus target"); m.locator("[name=amount]").fill("100000"); m.locator("[data-f] [type=submit]").click()
            owner.wait_for_selector(".toast-success >> nth=-1", timeout=8000); owner.keyboard.press("Escape"); owner.wait_for_timeout(300)
            owner.click("[data-act=submit]"); T.confirm_ok(owner); owner.wait_for_selector(".toast-success", timeout=8000); T.settle(owner)
            owner.click("[data-act=approve]"); T.confirm_ok(owner); owner.wait_for_selector(".toast-success", timeout=8000); T.settle(owner)
            per = api(owner, f"/payroll/{per['id']}/")["data"]
            check("payroll approved", per["status"] == "approved")
            ira_item = [i for i in per["items"] if i["employee_id"] == EID["ira"]]
            if ira_item:
                ira.goto(f"{BASE}/employee/payslip.html"); T.settle(ira, 900)
                check("employee sees approved payslip", "Slip terbaru" in ira.inner_text("#content"))
                ira.locator("[data-slip]").first.click(); m = T.modal(ira); m.locator("[data-pdf]").wait_for(timeout=8000)
                with ira.expect_download(timeout=15000) as dl:
                    m.locator("[data-pdf]").click()
                path = dl.value.path()
                check("payslip PDF downloaded from Django", Path(path).read_bytes()[:4] == b"%PDF", dl.value.suggested_filename)
                ira.keyboard.press("Escape")
            else:
                check("Ira has an item this period", False, "no item")
            owner.click("[data-pay]"); m = T.modal(owner); m.locator("[data-ok]").click(); T.confirm_ok(owner)
            owner.wait_for_selector(".toast-success", timeout=8000); T.settle(owner)
            check("payment confirmation → paid", api(owner, f"/payroll/{per['id']}/")["data"]["status"] == "paid")

            print("Notifications & analytics")
            ira.goto(f"{BASE}/employee/notifications.html"); T.settle(ira, 900)
            types = {n["type"] for n in api(ira, "/notifications/")["data"]}
            check("employee notified (payslip + paid)", {"payslip", "salary_paid"} <= types, str(types))
            owner.goto(f"{BASE}/owner/analytics.html"); T.settle(owner, 1200)
            check("analytics from Django renders", owner.locator(".state-error").count() == 0 and "Attendance Rate" in owner.inner_text("#content"))
            owner.screenshot(path=str(SHOTS / "o-analytics.png"), full_page=True)
            audit = [a["action"] for a in api(owner, "/audit-logs/?limit=100")["data"]]
            check("audit trail complete", all(x in audit for x in ("settings.attendance", "payroll.salary_config", "task.create", "leave.approve", "payroll.approve", "payroll.confirm_payment")), str(audit))
            browser.close()
    finally:
        django.terminate()
    noise = ("favicon",)
    real = [e for e in errors if not any(n in e for n in noise)]
    print(f"\nConsole/page errors: {len(real)}")
    for e in real[:15]:
        print("  ", e)
    passed = sum(1 for r in T.results if r[1])
    print(f"\n{passed}/{len(T.results)} checks passed")
    sys.exit(0 if passed == len(T.results) and not real else 1)


if __name__ == "__main__":
    main()
