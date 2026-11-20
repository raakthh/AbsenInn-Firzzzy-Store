/* =========================================================
   AbsenInn — Authentication & page guards
   • demo        : fictitious demo accounts, session cached in the browser.
   • production  : Supabase Auth (email + password). The Supabase session
                   (JWT) is sent to Django as Bearer token; the role comes
                   from public.profiles, which RLS lets a user read only
                   for themselves.
   Page guards are UX only — real access control is RLS + Django.
   Only the public anon key is used here; never the service role key.
   ========================================================= */
(function () {
  const C = window.APP_CONFIG;
  const DEMO_PASSWORD = 'demo1234';               // demo-only, fictitious accounts
  const REMEMBER_KEY = 'absenninn_remember';
  const SUPABASE_CDN = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.min.js';
  const isDemo = () => C.MODE === 'demo';
  const Err = (msg, code, status) => Object.assign(new Error(msg), { code, status });

  /* Opening pages as file:// breaks sessions in some browsers and blocks camera/GPS. */
  function fileProtocolNotice() {
    if (location.protocol !== 'file:') return false;
    const render = () => {
      document.body.innerHTML = `<div style="min-height:100vh;display:grid;place-items:center;padding:24px;font-family:system-ui,sans-serif;background:#F7F6FE;color:#17153B">
        <div style="max-width:520px;background:#fff;border:1px solid #E4E6F1;border-radius:16px;padding:28px;box-shadow:0 8px 24px rgba(42,29,110,.08)">
          <div style="font-weight:800;font-size:20px">Absen<span style="color:#6C55F2">Inn</span> perlu dijalankan lewat server lokal</div>
          <p style="color:#5B6182;line-height:1.6">Halaman ini dibuka langsung sebagai file (<code>file://</code>). Di mode ini login bisa berulang terus dan kamera/GPS diblokir browser.</p>
          <ol style="color:#3F4565;line-height:1.8;padding-left:20px"><li>Di VS Code, pasang ekstensi <b>Live Server</b>.</li><li>Klik kanan <code>frontend/index.html</code> → <b>Open with Live Server</b>.</li><li>Atau di terminal: <code>cd frontend</code> lalu <code>python -m http.server 8000</code>, buka <b>http://localhost:8000</b>.</li></ol>
        </div></div>`;
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', render); else render();
    return true;
  }

  /* ---------- Supabase client (production only) ---------- */
  let clientPromise = null;
  function loadScript(src) {
    return new Promise((resolve, reject) => {
      if (window.supabase && window.supabase.createClient) return resolve();
      const s = document.createElement('script'); s.src = src; s.async = true;
      s.onload = () => resolve(); s.onerror = () => reject(Err('Library Supabase gagal dimuat. Periksa koneksi internet.', 'SDK_LOAD_FAILED', 0));
      document.head.appendChild(s);
    });
  }
  /* "Ingat saya" → localStorage; otherwise the session lives only in this tab (sessionStorage). */
  const authStorage = {
    getItem: (k) => sessionStorage.getItem(k) ?? localStorage.getItem(k),
    setItem: (k, v) => { if (localStorage.getItem(REMEMBER_KEY) === '1') { localStorage.setItem(k, v); sessionStorage.removeItem(k); } else { sessionStorage.setItem(k, v); localStorage.removeItem(k); } },
    removeItem: (k) => { sessionStorage.removeItem(k); localStorage.removeItem(k); },
  };
  function client() {
    if (isDemo()) return Promise.reject(Err('Supabase tidak dipakai di mode demo', 'DEMO_MODE', 0));
    if (!C.SUPABASE_URL || !C.SUPABASE_ANON_KEY) return Promise.reject(Err('SUPABASE_URL dan SUPABASE_ANON_KEY belum diisi di js/config.js.', 'NOT_CONFIGURED', 0));
    if (!clientPromise) {
      clientPromise = loadScript(SUPABASE_CDN).then(() => window.supabase.createClient(C.SUPABASE_URL, C.SUPABASE_ANON_KEY, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storage: authStorage, storageKey: 'absenninn-auth' },
      }));
      clientPromise.catch(() => { clientPromise = null; });
    }
    return clientPromise;
  }

  function mapAuthError(error) {
    const m = String((error && error.message) || '').toLowerCase();
    if (m.includes('invalid login credentials')) return Err('Email atau password salah.', 'INVALID_CREDENTIALS', 401);
    if (m.includes('email not confirmed')) return Err('Email belum dikonfirmasi. Minta owner mengonfirmasi akun di Supabase.', 'EMAIL_NOT_CONFIRMED', 401);
    if (m.includes('rate limit') || m.includes('too many')) return Err('Terlalu banyak percobaan. Tunggu beberapa saat lalu coba lagi.', 'RATE_LIMITED', 429);
    if (m.includes('failed to fetch') || m.includes('network')) return Err('Tidak dapat terhubung ke Supabase. Periksa internet dan SUPABASE_URL.', 'NETWORK', 0);
    if (m.includes('password should be') || m.includes('weak')) return Err('Password terlalu lemah (minimal 8 karakter).', 'WEAK_PASSWORD', 422);
    if (m.includes('different from the old')) return Err('Password baru harus berbeda dari password lama.', 'SAME_PASSWORD', 422);
    return Err((error && error.message) || 'Autentikasi gagal.', 'AUTH_ERROR', (error && error.status) || 400);
  }

  /* Build the app session from the Supabase user + profiles row (RLS: own row only). */
  async function buildSession(sb, session) {
    const { data: p, error } = await sb.from('profiles').select('id, company_id, role, full_name, email, avatar_color, is_active').eq('id', session.user.id).maybeSingle();
    if (error) throw Err('Gagal membaca profil: ' + error.message, 'PROFILE_ERROR', 500);
    if (!p) throw Err('Akun belum terhubung ke perusahaan. Owner perlu menjalankan seed / link_account di Supabase.', 'NO_PROFILE', 403);
    if (!p.is_active) throw Err('Akun ini telah dinonaktifkan. Hubungi owner.', 'ACCOUNT_DISABLED', 403);
    let employee_id = null;
    if (p.role === 'employee') {
      const { data: e } = await sb.from('employees').select('id, employment_status').eq('profile_id', p.id).maybeSingle();
      if (!e || e.employment_status !== 'active') throw Err('Akun karyawan ini nonaktif atau belum terhubung. Hubungi owner.', 'ACCOUNT_DISABLED', 403);
      employee_id = e.id;
    }
    return { user_id: p.id, role: p.role, company_id: p.company_id, employee_id, full_name: p.full_name, email: p.email, avatar_color: p.avatar_color,
      access_token: session.access_token, expires_at: session.expires_at, signed_in_at: new Date().toISOString() };
  }

  const Auth = {
    blockedByFileProtocol: fileProtocolNotice(),
    client,
    root() { return document.body ? (document.body.dataset.root || '') : ''; },
    loginUrl() { return Auth.root() + 'login.html'; },
    homeFor(role) { return Auth.root() + (role === 'owner' ? 'owner/dashboard.html' : 'employee/dashboard.html'); },

    /* Cached app session (role, names). The token itself is managed by Supabase. */
    session() {
      try { return JSON.parse(sessionStorage.getItem(C.SESSION_KEY) || localStorage.getItem(C.SESSION_KEY) || 'null'); } catch { return null; }
    },
    setSession(s, remember) {
      const raw = JSON.stringify(s);
      sessionStorage.setItem(C.SESSION_KEY, raw);
      if (remember) localStorage.setItem(C.SESSION_KEY, raw); else localStorage.removeItem(C.SESSION_KEY);
    },
    clear() { sessionStorage.removeItem(C.SESSION_KEY); localStorage.removeItem(C.SESSION_KEY); },

    demoAccounts() {
      const db = DemoStore.db;
      return db.profiles.filter((p) => p.role === 'owner' || (db.employees.find((e) => e.id === p.employee_id) || {}).employment_status === 'active')
        .slice(0, 4).map((p) => ({ email: p.email, role: p.role, full_name: p.full_name }));
    },

    async login(email, password, remember) {
      email = String(email || '').trim().toLowerCase();
      if (isDemo()) {
        await new Promise((r) => setTimeout(r, 450));
        const db = DemoStore.db;
        const p = db.profiles.find((x) => x.email.toLowerCase() === email);
        if (!p || password !== DEMO_PASSWORD) throw Err('Email atau password salah.', 'INVALID_CREDENTIALS', 401);
        if (p.employee_id) {
          const e = db.employees.find((x) => x.id === p.employee_id);
          if (!e || e.employment_status !== 'active') throw Err('Akun ini telah dinonaktifkan. Hubungi owner.', 'ACCOUNT_DISABLED', 403);
        }
        const s = { user_id: p.id, role: p.role, company_id: p.company_id, employee_id: p.employee_id, full_name: p.full_name, email: p.email, avatar_color: p.avatar_color, access_token: 'demo-token', signed_in_at: new Date().toISOString() };
        Auth.setSession(s, remember);
        return s;
      }
      const sb = await client();
      try { if (remember) localStorage.setItem(REMEMBER_KEY, '1'); else localStorage.removeItem(REMEMBER_KEY); } catch {}
      const { data, error } = await sb.auth.signInWithPassword({ email, password });
      if (error) throw mapAuthError(error);
      try {
        const s = await buildSession(sb, data.session);
        Auth.setSession(s, remember);
        return s;
      } catch (e) { await sb.auth.signOut(); Auth.clear(); throw e; }
    },

    async logout() {
      if (!isDemo()) { try { const sb = await client(); await sb.auth.signOut(); } catch (e) { console.warn('signOut', e); } }
      Auth.clear();
      location.href = Auth.loginUrl();
    },

    /* Fresh access token for API calls (auto-refreshed by Supabase). */
    async accessToken() {
      if (isDemo()) return 'demo-token';
      const sb = await client();
      const { data } = await sb.auth.getSession();
      return data.session ? data.session.access_token : null;
    },

    /* Resolve the current session; in production verify it with Supabase. */
    async current() {
      if (isDemo()) {
        const s = Auth.session(); if (!s) return null;
        return DemoStore.db.profiles.some((x) => x.id === s.user_id) ? s : (Auth.clear(), null);
      }
      try {
        const sb = await client();
        const { data } = await sb.auth.getSession();
        if (!data.session) { Auth.clear(); return null; }
        const cached = Auth.session();
        if (cached && cached.user_id === data.session.user.id) { cached.access_token = data.session.access_token; return cached; }
        const s = await buildSession(sb, data.session);
        Auth.setSession(s, localStorage.getItem(REMEMBER_KEY) === '1');
        return s;
      } catch (e) {
        console.warn('[auth] session check failed:', e.message);
        if (['NO_PROFILE', 'ACCOUNT_DISABLED'].includes(e.code)) {
          try { sessionStorage.setItem('absenninn_auth_error', e.message); (await client()).auth.signOut(); } catch {}
        }
        Auth.clear(); Auth.lastError = e; return null;
      }
    },

    /* Call at the top of each protected page. Returns the session or redirects. */
    async guard(requiredRole) {
      if (Auth.blockedByFileProtocol) return null;
      const s = await Auth.current();
      if (!s) { location.replace(Auth.loginUrl() + '?next=' + encodeURIComponent(location.pathname)); return null; }
      if (requiredRole && s.role !== requiredRole) { location.replace(Auth.homeFor(s.role) + '?denied=1'); return null; }
      if (!isDemo()) Auth.watch();
      return s;
    },

    /* Signed out in another tab / token revoked → back to login. */
    async watch() {
      if (Auth._watching) return; Auth._watching = true;
      const sb = await client();
      sb.auth.onAuthStateChange((event) => { if (event === 'SIGNED_OUT') { Auth.clear(); location.replace(Auth.loginUrl()); } });
    },

    async requestPasswordReset(email) {
      const sb = await client();
      const redirectTo = new URL(Auth.root() + 'reset-password.html', location.href).href;
      const { error } = await sb.auth.resetPasswordForEmail(String(email).trim().toLowerCase(), { redirectTo });
      if (error) throw mapAuthError(error);
      return true;
    },
    async changePassword(newPassword) {
      if (isDemo()) throw Err('Ganti password tersedia di mode produksi (Supabase Auth).', 'DEMO_MODE', 400);
      if (!newPassword || newPassword.length < 8) throw Err('Password minimal 8 karakter.', 'WEAK_PASSWORD', 422);
      const sb = await client();
      const { error } = await sb.auth.updateUser({ password: newPassword });
      if (error) throw mapAuthError(error);
      return true;
    },
  };
  window.Auth = Auth;
})();
