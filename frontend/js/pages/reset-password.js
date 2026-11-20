/* AbsenInn — Reset password (Supabase recovery link → set new password) */
(async function () {
  if (Auth.blockedByFileProtocol) return;
  const { $, icon, esc } = UI;
  Icons.hydrate();
  const form = $('#rp-form'), sub = $('#rp-sub'), alertEl = $('#rp-alert');
  const alertBox = (msg, tone = 'danger', ic = 'alert-circle') => { alertEl.innerHTML = `<div class="alert alert-${tone}">${icon(ic)}<div>${msg}</div></div>`; };

  if (API.isDemo()) { sub.textContent = 'Reset password hanya tersedia di mode produksi (Supabase Auth).'; return; }
  let sb;
  try { sb = await Auth.client(); } catch (e) { sub.textContent = ''; return alertBox(esc(e.message)); }

  // The recovery link signs the user in temporarily (token in the URL); wait briefly for it.
  let session = null;
  for (let i = 0; i < 10 && !session; i += 1) { ({ data: { session } } = await sb.auth.getSession()); if (!session) await new Promise((r) => setTimeout(r, 300)); }
  const hashErr = new URLSearchParams(location.hash.slice(1)).get('error_description');
  if (!session) {
    sub.textContent = '';
    return alertBox(esc(hashErr || 'Link reset tidak valid atau sudah kedaluwarsa. Minta link baru dari halaman login (Lupa password?).'), 'warning', 'alert-triangle');
  }
  sub.textContent = `Akun: ${session.user.email}`;
  form.classList.remove('hidden');
  form.password.focus();

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const d = UI.validate(form, {
      password: [UI.rules.required('Password wajib diisi'), UI.rules.min(8, 'Minimal 8 karakter')],
      confirm: [UI.rules.required('Ulangi password'), (v, x) => (v !== x.password ? 'Password tidak sama' : null)],
    });
    if (!d) return;
    const ok = await UI.submit($('#rp-btn'), form, () => Auth.changePassword(d.password));
    if (ok) {
      await sb.auth.signOut(); Auth.clear();
      location.replace('login.html?reset=done');
    }
  });
})();
