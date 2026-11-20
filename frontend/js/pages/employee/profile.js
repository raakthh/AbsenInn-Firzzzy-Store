/* AbsenInn — Employee: My Profile */
(async function () {
  const s = await Layout.init({ role: 'employee', page: 'profile', title: 'My Profile' });
  const { icon, esc, $ } = UI;
  const el = $('#content');

  async function load() {
    el.innerHTML = UI.loading(8);
    try {
      const [e, settings] = await Promise.all([API.employees.get(s.employee_id), API.settings.get()]);
      const editable = settings.profile_editable_fields;
      el.innerHTML = `${Layout.pageHeader({ title: 'My Profile', subtitle: 'Data pribadi & kepegawaian Anda.' })}
        <div class="card"><div class="profile-cover"></div><div class="profile-head-wrap"><div class="profile-head">${UI.avatar(e, 'xl')}<div style="padding-top:36px"><h2>${esc(e.full_name)}</h2><div class="text-2">${esc(e.position)} · <span class="mono">${esc(e.employee_code)}</span></div></div></div></div></div>
        <div class="grid grid-2 mt-6">
          <div class="card"><div class="card-header"><div class="card-title">Informasi Kepegawaian</div><span class="text-xs text-3">${icon('lock', 12)} dikelola owner</span></div><div class="card-body"><dl class="kv">
            <dt>Nama lengkap</dt><dd>${esc(e.full_name)}</dd><dt>Employee ID</dt><dd class="mono">${esc(e.employee_code)}</dd><dt>Email</dt><dd>${esc(e.email)}</dd><dt>Jabatan</dt><dd>${esc(e.position)}</dd><dt>Tanggal bergabung</dt><dd>${Fmt.date(e.join_date)}</dd><dt>Status</dt><dd>${UI.badge(e.employment_status)} <span class="text-xs text-3">${esc(e.employment_type || '')}</span></dd></dl></div></div>
          <form class="card" novalidate data-f><div class="card-header"><div class="card-title">Kontak & Alamat</div></div><div class="card-body" style="display:grid;gap:16px">
            ${UI.field({ name: 'phone', label: 'No. telepon', value: e.phone, attrs: editable.includes('phone') ? '' : 'disabled', hint: editable.includes('phone') ? '' : 'Tidak dapat diubah — hubungi owner.' })}
            ${UI.field({ name: 'address', label: 'Alamat', type: 'textarea', value: e.address, rows: 3, attrs: editable.includes('address') ? '' : 'disabled', hint: editable.includes('address') ? '' : 'Tidak dapat diubah — hubungi owner.' })}
            <div class="text-xs text-3">${icon('info', 12)} ${API.isDemo() ? 'Ganti password tersedia di mode produksi.' : 'Foto profil memakai inisial nama Anda.'}</div>
            ${API.isDemo() ? '' : `<button type="button" class="btn btn-outline" data-cpw style="justify-self:start">${icon('key-round')}Ganti password</button>`}</div>
            <div class="card-footer flex justify-between items-center"><span class="text-xs text-3">Kolom yang dapat diedit ditentukan owner.</span><button class="btn btn-primary" type="submit" ${editable.length ? '' : 'disabled'}>${icon('check')}Simpan</button></div></form>
        </div>`;
      const form = $('[data-f]');
      const cpw = el.querySelector('[data-cpw]'); if (cpw) cpw.addEventListener('click', () => Layout.changePasswordDialog());
      form.addEventListener('submit', async (ev) => {
        ev.preventDefault();
        const d = UI.validate(form, { phone: [UI.rules.phone()] }); if (!d) return;
        const payload = {}; editable.forEach((k) => { if (d[k] !== undefined) payload[k] = d[k]; });
        const r = await UI.submit(form.querySelector('[type=submit]'), form, () => API.employees.update(s.employee_id, payload));
        if (r) UI.toast('Profil diperbarui.', 'success');
      });
    } catch (err) { UI.errorState(el, err, load); }
  }
  load();
})();
