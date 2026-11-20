/* AbsenInn — Login page (demo accounts or Supabase Auth) */
(async function () {
  if (Auth.blockedByFileProtocol) return;
  const { $, icon, esc } = UI;
  Icons.hydrate();
  const form = $('#login-form'), btn = $('#login-btn'), alertEl = $('#login-alert');
  const showAlert = (html, tone = 'danger', ic = 'alert-circle') => { alertEl.innerHTML = `<div class="alert alert-${tone}">${icon(ic)}<div>${html}</div></div>`; };

  // Messages handed over from other pages
  const authErr = sessionStorage.getItem('absenninn_auth_error');
  if (authErr) { sessionStorage.removeItem('absenninn_auth_error'); showAlert(esc(authErr), 'warning', 'alert-triangle'); }
  if (UI.qs('reset') === 'done') showAlert('Password berhasil diubah. Silakan login dengan password baru.', 'success', 'check-circle');

  // Already signed in?
  const existing = await Auth.current();
  if (existing) {
    if (UI.qs('next') && API.isDemo()) {
      /* A protected page sent us back although a session exists → it can't read it. Break the loop. */
      Auth.clear();
      showAlert('<strong>Sesi tidak terbaca di halaman dashboard.</strong> Biasanya karena aplikasi dibuka langsung sebagai file atau penyimpanan browser diblokir. Jalankan lewat <b>Live Server</b> / <code>http://localhost</code>, lalu login lagi.', 'warning', 'alert-triangle');
    } else { location.replace(Auth.homeFor(existing.role)); return; }
  }

  if (API.isDemo()) {
    $('#demo-list').innerHTML = Auth.demoAccounts().map((a) => `
      <button type="button" class="demo-account" data-email="${esc(a.email)}">
        <span><span class="fw-600">${esc(a.full_name)}</span><br><span class="text-xs text-3">${esc(a.email)}</span></span>
        <span class="badge ${a.role === 'owner' ? 'badge-primary' : 'badge-mint'} no-dot">${a.role === 'owner' ? 'Owner' : 'Employee'}</span>
      </button>`).join('');
    document.querySelectorAll('.demo-account').forEach((b) => b.addEventListener('click', () => {
      form.email.value = b.dataset.email; form.password.value = 'demo1234'; UI.clearErrors(form); form.password.focus();
    }));
  } else {
    $('#demo-accounts').remove();
    if (!APP_CONFIG.SUPABASE_URL || !APP_CONFIG.SUPABASE_ANON_KEY) showAlert('<strong>Supabase belum dikonfigurasi.</strong> Isi <code>SUPABASE_URL</code> dan <code>SUPABASE_ANON_KEY</code> di <code>js/config.js</code>.', 'warning', 'alert-triangle');
  }

  $('#toggle-pw').addEventListener('click', (e) => {
    const b = e.currentTarget, show = form.password.type === 'password';
    form.password.type = show ? 'text' : 'password';
    b.innerHTML = icon(show ? 'eye-off' : 'eye');
    b.setAttribute('aria-label', show ? 'Sembunyikan password' : 'Tampilkan password');
  });

  $('#forgot').addEventListener('click', () => {
    if (API.isDemo()) return UI.toast('Di mode demo gunakan password demo1234. Reset password lewat email aktif di mode produksi (Supabase).', 'info', 'Lupa password');
    const m = UI.modal({ title: 'Reset password', size: 'sm',
      body: `<p class="text-2 mb-4">Masukkan email akun Anda. Link untuk membuat password baru akan dikirim ke email tersebut.</p><form novalidate data-f>${UI.field({ name: 'email', label: 'Email', type: 'email', value: form.email.value, required: true, placeholder: 'nama@firzzzystore.com' })}</form>`,
      footer: `<button class="btn btn-outline" data-close>Batal</button><button class="btn btn-primary" data-ok>${icon('send')}Kirim link</button>` });
    const f = m.el.querySelector('[data-f]');
    m.el.querySelector('[data-ok]').addEventListener('click', async (ev) => {
      const btn2 = ev.currentTarget;
      const d = UI.validate(f, { email: [UI.rules.required(), UI.rules.email()] }); if (!d) return;
      const ok = await UI.submit(btn2, f, () => Auth.requestPasswordReset(d.email));
      if (ok) { m.close(); showAlert(`Jika <b>${esc(d.email)}</b> terdaftar, link reset password sudah dikirim. Periksa inbox/spam.`, 'info', 'mail'); }
    });
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault(); alertEl.innerHTML = '';
    const data = UI.validate(form, { email: [UI.rules.required('Email wajib diisi'), UI.rules.email()], password: [UI.rules.required('Password wajib diisi')] });
    if (!data) return;
    btn.classList.add('is-loading'); btn.disabled = true;
    try {
      const s = await Auth.login(data.email, form.password.value, data.remember);
      UI.toast(`Masuk sebagai ${s.full_name}`, 'success');
      setTimeout(() => location.replace(Auth.homeFor(s.role)), 350);
    } catch (err) {
      showAlert(esc(err.message));
      btn.classList.remove('is-loading'); btn.disabled = false;
    }
  });
})();
