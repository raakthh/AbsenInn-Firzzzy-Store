"""Phase 2 — production-mode authentication E2E (headless Chrome).
The real Supabase is not reachable from CI/sandbox, so supabase-js is replaced
by a small in-browser stub with the same API surface the app uses
(signInWithPassword, getSession, signOut, onAuthStateChange,
resetPasswordForEmail, updateUser, from().select().eq().maybeSingle())
and RLS-like row filtering. Database-side security is tested separately
with database/tests/rls_tests.sql on real PostgreSQL.
Run: python3 tools/e2e_phase2_auth.py"""
import sys, re, json
sys.path.insert(0, __import__("os").path.dirname(__file__))
import e2e_phase1 as T
from playwright.sync_api import sync_playwright

STUB = r"""
(function(){
  const DB = {
    users: [
      {id:'u-owner', email:'farizky@firzzzystore.com', password:'Rahasia123'},
      {id:'u-ira', email:'ira@firzzzystore.com', password:'Rahasia123'},
      {id:'u-old', email:'mantan@firzzzystore.com', password:'Rahasia123'},
      {id:'u-orphan', email:'orphan@firzzzystore.com', password:'Rahasia123'}],
    profiles: [
      {id:'u-owner', company_id:'c1', role:'owner', full_name:'Muhammad Farizky Alvianandy', email:'farizky@firzzzystore.com', avatar_color:'#3B2898', is_active:true},
      {id:'u-ira', company_id:'c1', role:'employee', full_name:'Ira Oktavianti', email:'ira@firzzzystore.com', avatar_color:'#6C55F2', is_active:true},
      {id:'u-old', company_id:'c1', role:'employee', full_name:'Mantan Karyawan', email:'mantan@firzzzystore.com', avatar_color:'#999', is_active:true}],
    employees: [
      {id:'e-ira', profile_id:'u-ira', company_id:'c1', employment_status:'active', full_name:'Ira Oktavianti'},
      {id:'e-old', profile_id:'u-old', company_id:'c1', employment_status:'inactive', full_name:'Mantan Karyawan'}],
    companies: [{id:'c1', name:'Firzzzy Store'}]
  };
  try { const pw = JSON.parse(localStorage.getItem('stub_pw')||'{}'); DB.users.forEach(u => { if (pw[u.id]) u.password = pw[u.id]; }); } catch {}
  window.__resetCalls = [];
  window.supabase = { createClient(url, key, opts) {
    const st = opts.auth.storage, K = opts.auth.storageKey, listeners = [];
    const cur = () => { try { return JSON.parse(st.getItem(K)); } catch { return null; } };
    const emit = (ev, s) => listeners.forEach(cb => cb(ev, s));
    const visible = (table, row, s) => {           // RLS-like filtering
      if (!s) return false;
      if (table === 'profiles') return row.id === s.user.id;
      if (table === 'employees') return row.profile_id === s.user.id && row.employment_status === 'active';
      if (table === 'companies') { const p = DB.profiles.find(x => x.id === s.user.id); return p && p.company_id === row.id; }
      return false;
    };
    const from = (table) => { const f = []; const q = {
      select(){ return q; }, eq(c, v){ f.push([c, v]); return q; },
      maybeSingle(){ const s = cur(); const rows = (DB[table]||[]).filter(r => visible(table, r, s) && f.every(([c,v]) => r[c] === v)); return Promise.resolve({ data: rows[0] || null, error: null }); } }; return q; };
    return {
      from,
      auth: {
        async signInWithPassword({email, password}) {
          const u = DB.users.find(x => x.email === email);
          if (!u || u.password !== password) return { data: { session: null, user: null }, error: { message: 'Invalid login credentials', status: 400 } };
          const s = { access_token: 'tok-' + u.id, expires_at: Date.now()/1000 + 3600, user: { id: u.id, email: u.email } };
          st.setItem(K, JSON.stringify(s)); emit('SIGNED_IN', s); return { data: { session: s, user: s.user }, error: null };
        },
        async getSession() { return { data: { session: cur() }, error: null }; },
        async signOut() { st.removeItem(K); emit('SIGNED_OUT', null); return { error: null }; },
        onAuthStateChange(cb) { listeners.push(cb); return { data: { subscription: { unsubscribe(){} } } }; },
        async resetPasswordForEmail(email, o) { window.__resetCalls.push({ email, redirectTo: o.redirectTo }); return { data: {}, error: null }; },
        async updateUser({ password }) {
          const s = cur(); if (!s) return { data: null, error: { message: 'Auth session missing!' } };
          if (password.length < 8) return { data: null, error: { message: 'Password should be at least 8 characters' } };
          const u = DB.users.find(x => x.id === s.user.id); u.password = password;
          const pw = JSON.parse(localStorage.getItem('stub_pw')||'{}'); pw[u.id] = password; localStorage.setItem('stub_pw', JSON.stringify(pw));
          return { data: { user: s.user }, error: null };
        },
      },
    };
  } };
})();
"""

EXPECTED_NOISE = ("Server API", "API_UNAVAILABLE", "net::ERR", "Failed to load resource", "Failed to fetch", "badge refresh failed")


def ctx_prod(browser):
    ctx, page = T.new_page(browser)
    def cfg(route):
        body = (T.FRONT / "js/config.js").read_text()
        body = body.replace("MODE: 'demo'", "MODE: 'production'").replace("SUPABASE_URL: ''", "SUPABASE_URL: 'https://stub.supabase.co'").replace("SUPABASE_ANON_KEY: ''", "SUPABASE_ANON_KEY: 'public-anon-key'")
        route.fulfill(status=200, content_type="application/javascript", body=body)
    ctx.route("**/js/config.js", cfg)
    ctx.route("**/@supabase/**", lambda r: r.fulfill(status=200, content_type="application/javascript", body=STUB))
    ctx.route("**/api/**", lambda r: r.abort())   # auth-only test: Django API deliberately unreachable (see e2e_production.py for the full stack)
    return ctx, page


def wait_login(page, timeout=6000):
    """Logout triggers two redirects (Auth.logout + onAuthStateChange); the first may be aborted
    by the second, which makes page.wait_for_url raise ERR_ABORTED. Poll the final URL instead."""
    import time
    end = time.time() + timeout / 1000
    while time.time() < end:
        try:
            if page.url.split("?")[0].endswith("login.html") and page.evaluate("document.readyState") == "complete":
                return
        except Exception:
            pass
        page.wait_for_timeout(100)
    raise AssertionError(f"not on login.html: {page.url}")


def do_login(page, email, pw, remember=False):
    page.goto(f"{T.BASE}/login.html"); page.wait_for_selector("#login-form")
    page.fill("#email", email); page.fill("#password", pw)
    if remember: page.check("[name=remember]")
    page.click("#login-btn")


def main():
    httpd = T.serve()
    check = T.check
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path="/usr/bin/google-chrome")
        ctx, page = ctx_prod(browser)

        print("Login errors")
        page.goto(f"{T.BASE}/login.html"); page.wait_for_selector("#login-form")
        check("demo accounts hidden in production", page.locator("#demo-accounts").count() == 0)
        do_login(page, "farizky@firzzzystore.com", "salah123"); page.wait_for_selector("#login-alert .alert", timeout=5000)
        check("wrong password → friendly message", "Email atau password salah" in page.inner_text("#login-alert"))
        do_login(page, "orphan@firzzzystore.com", "Rahasia123"); page.wait_for_selector("#login-alert .alert", timeout=5000)
        check("account without profile is refused", "belum terhubung" in page.inner_text("#login-alert"))
        check("refused login leaves no session", page.evaluate("Auth.session()") is None)
        do_login(page, "mantan@firzzzystore.com", "Rahasia123"); page.wait_for_selector("#login-alert .alert", timeout=5000)
        check("inactive employee is refused", "nonaktif" in page.inner_text("#login-alert"))

        print("Owner session")
        do_login(page, "farizky@firzzzystore.com", "Rahasia123")
        page.wait_for_url("**/owner/dashboard.html", timeout=6000); page.wait_for_selector(".sidebar", timeout=6000); page.wait_for_timeout(800)
        check("owner reaches owner dashboard", "/owner/dashboard.html" in page.url)
        check("real name from profiles shown", "Muhammad Farizky" in page.inner_text(".sidebar-user"))
        check("demo banner hidden in production", page.locator(".demo-banner").count() == 0)
        check("unreachable API reported honestly", page.locator(".state-error").count() >= 1 and "Server API" in page.inner_text("#content"))
        tok = page.evaluate("Auth.accessToken()")
        check("access token available for Django calls", tok == "tok-u-owner")
        page.reload(); page.wait_for_selector(".sidebar", timeout=6000)
        check("session survives reload", "/owner/dashboard.html" in page.url)
        page.goto(f"{T.BASE}/employee/dashboard.html"); page.wait_for_url("**/owner/dashboard.html**", timeout=6000)
        check("owner blocked from employee pages", "/owner/dashboard.html" in page.url)
        p2 = ctx.new_page(); p2.goto(f"{T.BASE}/owner/dashboard.html"); p2.wait_for_url("**/login.html**", timeout=6000)
        check("without 'Ingat saya' a new tab must log in again", "login.html" in p2.url); p2.close()

        print("Change password + logout")
        page.goto(f"{T.BASE}/owner/settings.html#account"); page.wait_for_selector("[data-cpw]", timeout=6000)
        page.click("[data-cpw]"); m = T.modal(page)
        m.locator("[name=password]").fill("BaruSekali9"); m.locator("[name=confirm]").fill("BedaSekali9"); m.locator("[data-ok]").click(); page.wait_for_timeout(300)
        check("change password: mismatch validated", m.locator("[data-field=confirm].has-error").count() == 1)
        m.locator("[name=confirm]").fill("BaruSekali9"); m.locator("[data-ok]").click(); page.wait_for_selector(".toast-success", timeout=5000)
        check("change password succeeds", True)
        page.click(".sidebar [data-logout]"); T.confirm_ok(page); wait_login(page)
        check("logout returns to login", page.url.endswith("login.html"))
        check("logout clears Supabase session", page.evaluate("Auth.client().then(c=>c.auth.getSession()).then(r=>r.data.session)") is None)
        do_login(page, "farizky@firzzzystore.com", "Rahasia123"); page.wait_for_selector("#login-alert .alert", timeout=5000)
        check("old password no longer works", "salah" in page.inner_text("#login-alert"))

        print("Employee session (remember me)")
        do_login(page, "ira@firzzzystore.com", "Rahasia123", remember=True)
        page.wait_for_url("**/employee/dashboard.html", timeout=6000); page.wait_for_selector(".sidebar", timeout=6000)
        check("employee reaches employee dashboard", "/employee/dashboard.html" in page.url)
        check("employee_id resolved from employees table", page.evaluate("Auth.session().employee_id") == "e-ira")
        page.goto(f"{T.BASE}/owner/payroll.html"); page.wait_for_url("**/employee/dashboard.html**", timeout=6000)
        check("employee blocked from owner pages", "/employee/dashboard.html" in page.url)
        p2 = ctx.new_page(); p2.goto(f"{T.BASE}/employee/dashboard.html"); p2.wait_for_selector(".sidebar", timeout=6000)
        check("with 'Ingat saya' a new tab stays logged in", "/employee/dashboard.html" in p2.url); p2.close()
        page.goto(f"{T.BASE}/index.html"); page.wait_for_url("**/employee/dashboard.html", timeout=6000)
        check("index routes signed-in employee to dashboard", True)
        page.evaluate("Auth.logout()"); wait_login(page)

        print("Forgot / reset password")
        page.click("#forgot"); m = T.modal(page)
        m.locator("[name=email]").fill("ira@firzzzystore.com"); m.locator("[data-ok]").click(); page.wait_for_selector("#login-alert .alert-info", timeout=5000)
        calls = page.evaluate("window.__resetCalls")
        check("reset email requested with redirect to reset-password.html", calls and calls[0]["redirectTo"].endswith("/reset-password.html"), json.dumps(calls))
        page.goto(f"{T.BASE}/reset-password.html"); page.wait_for_timeout(3600)
        check("reset page without recovery session explains the problem", "tidak valid" in page.inner_text("#rp-alert"))
        # simulate the recovery link having signed the user in
        page.evaluate("Auth.client().then(c=>c.auth.signInWithPassword({email:'ira@firzzzystore.com',password:'Rahasia123'}))")
        page.goto(f"{T.BASE}/reset-password.html"); page.wait_for_selector("#rp-form:not(.hidden)", timeout=6000)
        page.fill("#password", "pendek"); page.fill("#confirm", "pendek"); page.click("#rp-btn"); page.wait_for_timeout(300)
        check("reset: min length validated", page.locator("[data-field=password].has-error").count() == 1)
        page.fill("#password", "PasswordBaru1"); page.fill("#confirm", "PasswordBaru1"); page.click("#rp-btn")
        page.wait_for_url("**/login.html?reset=done", timeout=6000)
        check("reset done → login shows success", "berhasil diubah" in page.inner_text("#login-alert"))
        do_login(page, "ira@firzzzystore.com", "PasswordBaru1"); page.wait_for_url("**/employee/dashboard.html", timeout=6000)
        check("login with new password works", True)
        ctx.close()

        print("Unconfigured production")
        ctx, page = T.new_page(browser)
        ctx.route("**/js/config.js", lambda r: r.fulfill(status=200, content_type="application/javascript", body=(T.FRONT / "js/config.js").read_text().replace("MODE: 'demo'", "MODE: 'production'")))
        page.goto(f"{T.BASE}/login.html"); page.wait_for_selector("#login-alert .alert", timeout=5000)
        check("missing Supabase keys → clear setup message", "belum dikonfigurasi" in page.inner_text("#login-alert"))
        ctx.close()
        browser.close()
    httpd.shutdown()
    errs = [e for e in T.errors if not any(n in e for n in EXPECTED_NOISE)]
    print("\nUnexpected console/page errors:", len(errs)); [print("  ", e) for e in errs[:20]]
    failed = [r for r in T.results if not r[1]]
    print(f"\n{len(T.results) - len(failed)}/{len(T.results)} checks passed")
    sys.exit(1 if failed or errs else 0)


if __name__ == "__main__":
    main()
