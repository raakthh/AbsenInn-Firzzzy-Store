/* AbsenInn — Owner: Settings */
(async function () {
  const session = await Layout.init({ role: 'owner', page: 'settings', title: 'Settings' });
  const { icon, esc, $, $$ } = UI;
  const el = $('#content');
  const SECTIONS = [['company', 'Perusahaan', 'building'], ['work', 'Jam & Hari Kerja', 'clock'], ['attendance', 'Absensi & Lokasi', 'map-pin'], ['payroll', 'Payroll', 'wallet'], ['leave', 'Izin & Cuti', 'file-text'], ['notifications', 'Notifikasi', 'bell'], ['users', 'Pengguna', 'users'], ['account', 'Akun', 'user']];
  const DAYS = [[1, 'Sen'], [2, 'Sel'], [3, 'Rab'], [4, 'Kam'], [5, 'Jum'], [6, 'Sab'], [0, 'Min']];
  let S, section = (location.hash || '#company').slice(1);
  if (!SECTIONS.some(([k]) => k === section)) section = 'company';

  el.innerHTML = `${Layout.pageHeader({ title: 'Settings', subtitle: 'Semua aturan bisnis dapat dikonfigurasi di sini — tidak ada aturan yang di-hardcode.' })}
    <div class="settings"><nav class="card settings-nav" aria-label="Bagian pengaturan">${SECTIONS.map(([k, l, ic]) => `<button data-sec="${k}" class="${k === section ? 'is-active' : ''}">${icon(ic)}${l}</button>`).join('')}</nav><div data-panel>${UI.loading(6)}</div></div>`;

  const sw = (name, checked, label, sub) => `<label class="settings-row" style="cursor:pointer"><div><div class="fw-600">${label}</div>${sub ? `<div class="text-xs text-3">${sub}</div>` : ''}</div><span class="switch"><input type="checkbox" name="${name}" ${checked ? 'checked' : ''}><span class="switch-track"></span></span></label>`;
  const card = (title, sub, body, save = true) => `<form class="card" novalidate data-form><div class="card-header"><div><div class="settings-section-title">${title}</div>${sub ? `<div class="card-subtitle">${sub}</div>` : ''}</div></div><div class="card-body">${body}</div>${save ? `<div class="card-footer flex justify-between items-center"><span class="text-xs text-3">Perubahan tercatat di audit log.</span><button class="btn btn-primary" type="submit">${icon('check')}Simpan</button></div>` : ''}</form>`;

  let loadError = null;
  async function load() { try { S = await API.settings.get(); loadError = null; } catch (e) { S = null; loadError = e; } render(); }

  function render() {
    const p = $('[data-panel]');
    // The Account section works without the settings API (auth is handled by Supabase).
    if (!S && section !== 'account') { UI.errorState(p, loadError, load); return; }
    const R = {
      company: () => card('Informasi Perusahaan', 'Ditampilkan di slip gaji dan laporan.', `<div class="form-grid">
        ${UI.field({ name: 'name', label: 'Nama perusahaan', value: S.company.name, required: true, span: true })}
        ${UI.field({ name: 'email', label: 'Email kontak', type: 'email', value: S.company.email })}${UI.field({ name: 'phone', label: 'Telepon', value: S.company.phone })}
        ${UI.field({ name: 'address', label: 'Alamat', type: 'textarea', value: S.company.address, span: true, rows: 2 })}
        <div class="span-2 flex items-center gap-4"><img src="${Auth.root()}assets/images/logo-mark.svg" alt="" style="width:56px;height:56px"><div><div class="fw-600">Logo perusahaan</div><div class="text-xs text-3">Slip gaji dan laporan memakai nama perusahaan di atas. Logo kustom belum didukung — tampilan memakai logo AbsenInn.</div></div></div></div>`),
      work: () => card('Jam & Hari Kerja', 'Dipakai untuk deteksi terlambat, pulang awal, durasi kerja, dan rekonsiliasi.', `<div class="form-grid">
        ${UI.field({ name: 'start', label: 'Jam mulai kerja', type: 'time', value: S.work.start, required: true })}${UI.field({ name: 'end', label: 'Jam selesai kerja', type: 'time', value: S.work.end, required: true })}
        ${UI.field({ name: 'break_start', label: 'Istirahat mulai', type: 'time', value: S.work.break_start })}${UI.field({ name: 'break_end', label: 'Istirahat selesai', type: 'time', value: S.work.break_end, hint: 'Durasi istirahat dikurangkan dari jam kerja.' })}
        ${UI.field({ name: 'late_tolerance_min', label: 'Toleransi keterlambatan (menit)', type: 'number', value: S.work.late_tolerance_min, attrs: 'min="0" max="120"', hint: `Check-in setelah jam mulai + toleransi = Terlambat.` })}
        ${UI.field({ name: 'early_leave_tolerance_min', label: 'Toleransi pulang awal (menit)', type: 'number', value: S.work.early_leave_tolerance_min || 0, attrs: 'min="0" max="120"' })}
        <div class="field span-2" data-field="working_days"><span class="label">Hari kerja<span class="req">*</span></span><div class="day-picker">${DAYS.map(([v, l]) => `<label><input type="checkbox" data-multi="1" name="working_days" value="${v}" ${S.work.working_days.includes(v) ? 'checked' : ''}><span>${l}</span></label>`).join('')}</div><span class="field-error"></span></div></div>`),
      attendance: () => card('Absensi & Lokasi Kerja', 'Lokasi dan radius dipakai untuk validasi GPS (Haversine) di server.', `
        ${S.attendance.location.lat == null ? `<div class="alert alert-warning mb-4">${icon('map-pin')}<div><strong>Lokasi kerja belum diatur.</strong> Isi koordinat secara manual atau gunakan lokasi perangkat Anda saat berada di tempat kerja.</div></div>` : ''}
        <div class="form-grid">${UI.field({ name: 'name', label: 'Nama lokasi kerja', value: S.attendance.location.name, placeholder: 'Mis. Gudang Utama' })}${UI.field({ name: 'address', label: 'Alamat lokasi', value: S.attendance.location.address })}
        ${UI.field({ name: 'lat', label: 'Latitude', type: 'number', value: S.attendance.location.lat ?? '', attrs: 'step="any"', placeholder: '-6.2xxxxx' })}${UI.field({ name: 'lng', label: 'Longitude', type: 'number', value: S.attendance.location.lng ?? '', attrs: 'step="any"', placeholder: '106.8xxxxx' })}
        <div class="span-2 flex gap-2 wrap"><button type="button" class="btn btn-secondary btn-sm" data-geo>${icon('crosshair', 15)}Gunakan lokasi saya saat ini</button>${S.attendance.location.lat != null ? `<a class="btn btn-ghost btn-sm" target="_blank" rel="noopener" href="https://www.google.com/maps?q=${S.attendance.location.lat},${S.attendance.location.lng}">${icon('map-pin', 15)}Lihat di Google Maps</a>` : ''}<span class="text-xs text-3" data-geo-msg style="align-self:center"></span></div>
        ${UI.field({ name: 'radius_m', label: 'Radius absensi (meter)', type: 'number', value: S.attendance.radius_m, required: true, attrs: 'min="10" max="5000"', hint: 'Contoh awal 100 m.' })}
        ${UI.field({ name: 'max_gps_accuracy_m', label: 'Batas akurasi GPS (meter)', type: 'number', value: S.attendance.max_gps_accuracy_m, attrs: 'min="5" max="1000"', hint: 'Akurasi lebih buruk dari ini → Perlu Review.' })}</div>
        <div class="mt-4">${sw('selfie_required', S.attendance.selfie_required, 'Wajib selfie', 'Check-in/out normal tidak bisa dilakukan tanpa selfie.')}${sw('gps_required', S.attendance.gps_required, 'Wajib GPS', 'Koordinat & akurasi disimpan bersama absensi.')}</div>
        <div class="alert alert-info mt-4">${icon('shield')}<div>GPS browser dapat dimanipulasi. AbsenInn memvalidasi di server dan menandai data mencurigakan untuk Anda review — bukan sistem anti-kecurangan sempurna.</div></div>`),
      payroll: () => card('Payroll', 'Aturan potongan bersifat opsional & dapat dikonfigurasi. Pastikan sesuai kebijakan perusahaan dan ketentuan ketenagakerjaan yang berlaku.', `<div class="form-grid">
        ${UI.field({ name: 'period', label: 'Periode payroll', type: 'select', value: S.payroll.period, options: [['monthly', 'Bulanan']], hint: 'Periode mingguan/dua mingguan dapat ditambahkan nanti.' })}
        ${UI.field({ name: 'payment_day_mode', label: 'Aturan tanggal gajian', type: 'select', value: S.payroll.payment_day_mode || 'fixed', options: [['fixed', 'Tanggal tetap untuk semua karyawan'], ['join_date', 'Mengikuti tanggal masuk kerja tiap karyawan']] })}
        ${UI.field({ name: 'payment_day', label: 'Tanggal pembayaran gaji', type: 'number', value: S.payroll.payment_day, attrs: `min="1" max="31" ${S.payroll.payment_day_mode === 'join_date' ? 'disabled' : ''}`, hint: S.payroll.payment_day_mode === 'join_date' ? 'Tidak dipakai — tiap karyawan gajian di tanggal masuk kerjanya (mis. masuk tgl 20 → gajian tgl 20).' : 'Jika bulan lebih pendek, dipakai hari terakhir bulan.' })}
        ${UI.field({ name: 'unpaid_leave', label: 'Cuti tidak dibayar', type: 'select', value: S.payroll.rules.unpaid_leave, options: [['prorate', 'Potong prorata gaji pokok per hari'], ['none', 'Tidak dipotong']] })}
        ${UI.field({ name: 'absent', label: 'Absen tanpa keterangan', type: 'select', value: S.payroll.rules.absent, options: [['none', 'Tidak dipotong otomatis'], ['prorate', 'Potong prorata per hari']] })}
        ${UI.field({ name: 'late_per_incident', label: 'Potongan per keterlambatan (Rp)', type: 'number', value: S.payroll.rules.late_per_incident, attrs: 'min="0" step="1000"', hint: '0 = tidak ada potongan.' })}
        <div class="field"><span class="label">Lembur</span>${sw('overtime_enabled', S.payroll.rules.overtime_enabled, 'Hitung lembur', 'Pakai tarif lembur per karyawan.')}</div>
        <div class="span-2"><div class="label mb-4">Komponen gaji default (untuk karyawan baru)</div><div data-comps style="display:flex;flex-direction:column;gap:8px">${S.payroll.default_components.map((c, i) => compRow(c, i)).join('')}</div><button type="button" class="btn btn-ghost btn-sm mt-2" data-add-comp>${icon('plus')}Tambah komponen</button><div class="field-error" data-comp-err></div></div>
        <div class="span-2 alert alert-primary">${icon('info')}<div>Izin <b>sakit</b> dan izin lain <b>tidak otomatis memotong gaji</b> — status dibayar/tidak per jenis izin diatur di tab Izin & Cuti.</div></div></div>`),
      leave: () => card('Izin & Cuti', 'Jenis izin, status dibayar, dan kebutuhan lampiran.', `<div class="form-grid">${UI.field({ name: 'annual_quota_days', label: 'Kuota cuti tahunan (hari)', type: 'number', value: S.leave.annual_quota_days, attrs: 'min="0" max="60"', hint: '0 = tidak ada jatah cuti (izin tidak dibayar memotong gaji per hari).' })}
        ${UI.field({ name: 'approval', label: 'Alur persetujuan', type: 'select', value: S.leave.approval, options: [['owner', 'Disetujui oleh Owner']] })}</div>
        <div class="table-wrap mt-4"><table class="table"><thead><tr><th>Jenis izin</th><th>Status absensi</th><th class="text-center">Dibayar</th><th class="text-center">Wajib lampiran</th><th class="text-center">Aktif</th></tr></thead><tbody>
        ${S.leave_types.map((t) => `<tr data-lt="${t.id}"><td><div class="fw-600">${esc(t.name)}</div><div class="text-xs text-3">${esc(t.name_en)}${t.uses_quota ? ' · memakai kuota' : ''}${t.half_day ? ' · ½ hari' : ''}</div></td><td>${UI.badge(t.attendance_status)}</td>
          <td class="text-center"><input type="checkbox" class="check" data-k="is_paid" ${t.is_paid ? 'checked' : ''} aria-label="${esc(t.name)} dibayar"></td><td class="text-center"><input type="checkbox" class="check" data-k="requires_attachment" ${t.requires_attachment ? 'checked' : ''} aria-label="${esc(t.name)} wajib lampiran"></td><td class="text-center"><input type="checkbox" class="check" data-k="active" ${t.active ? 'checked' : ''} aria-label="${esc(t.name)} aktif"></td></tr>`).join('')}</tbody></table></div>`),
      notifications: () => card('Preferensi Notifikasi', 'Notifikasi in-app & pengingat terjadwal (dikirim server tiap 15–30 menit).', `${sw('leave_requests', S.notifications.leave_requests, 'Pengajuan izin baru')}${sw('attendance_reminder', S.notifications.attendance_reminder, 'Pengingat absensi', 'Karyawan yang belum check-in / lupa check-out, dan ringkasan rekonsiliasi untuk owner.')}${sw('task_deadline', S.notifications.task_deadline, 'Deadline tugas', 'Pengingat H-1, hari H, dan tugas yang melewati deadline.')}${sw('payroll', S.notifications.payroll, 'Payroll & pembayaran gaji', 'Pengingat tanggal gajian tiap karyawan dan gaji yang belum dikonfirmasi dibayar.')}
        <div class="settings-row" style="display:block"><div class="fw-600">Kolom profil yang boleh diedit karyawan</div><div class="day-picker mt-2">${[['phone', 'Telepon'], ['address', 'Alamat']].map(([k, l]) => `<label><input type="checkbox" data-multi="1" name="profile_fields" value="${k}" ${S.profile_editable_fields.includes(k) ? 'checked' : ''}><span>${l}</span></label>`).join('')}</div></div>`),
      users: () => card('Manajemen Pengguna', 'Akun yang terhubung ke perusahaan ini.', `<div class="table-wrap"><table class="table"><thead><tr><th>Pengguna</th><th>Email</th><th>Role</th><th>Status</th></tr></thead><tbody>${S.users.map((u) => `<tr><td>${UI.person(u, false)}</td><td>${esc(u.email)}</td><td><span class="badge ${u.role === 'owner' ? 'badge-primary' : 'badge-mint'} no-dot">${u.role === 'owner' ? 'Owner' : 'Employee'}</span></td><td>${UI.badge(u.status)}</td></tr>`).join('')}</tbody></table></div>
        <p class="text-xs text-3 mt-4">Akun karyawan dibuat dari halaman <a href="${Auth.root()}owner/employees.html">Employees</a>. Menonaktifkan karyawan juga menonaktifkan login-nya.</p>`, false),
      account: () => card('Akun Saya', '', `<div class="flex items-center gap-4">${UI.avatar(session, 'lg')}<div><div class="fw-700 text-lg">${esc(session.full_name)}</div><div class="text-3">${esc(session.email)} · Owner</div></div></div>
        <div class="alert alert-info mt-6">${icon('key-round')}<div>${API.isDemo() ? 'Mode demo memakai password tetap <b>demo1234</b>. Ganti password tersedia di mode produksi (Supabase Auth).' : 'Akun dikelola Supabase Auth. Password disimpan terenkripsi oleh Supabase, tidak pernah oleh AbsenInn.'}</div></div>
        <div class="flex gap-2 mt-4 wrap">${API.isDemo() ? `<button type="button" class="btn btn-danger-soft" data-reset>${icon('rotate-ccw')}Reset data demo</button>` : `<button type="button" class="btn btn-primary" data-cpw>${icon('key-round')}Ganti password</button>`}<button type="button" class="btn btn-outline" data-logout2>${icon('log-out')}Keluar</button></div>`, false),
    };
    p.innerHTML = R[section]();
    const form = $('[data-form]', p);
    wire(form);
  }

  function compRow(c = { name: '', amount: '' }, i) { return `<div class="flex gap-2" data-comp><input class="input input-sm" data-cn value="${esc(c.name)}" placeholder="Nama komponen" aria-label="Nama komponen ${i + 1}"><input class="input input-sm" data-ca type="number" min="0" step="10000" value="${c.amount}" placeholder="Nominal" style="max-width:160px" aria-label="Nominal komponen ${i + 1}"><button type="button" class="btn btn-ghost btn-icon btn-sm text-danger" data-rm-comp aria-label="Hapus">${icon('trash', 15)}</button></div>`; }

  function wire(form) {
    const geo = $('[data-geo]', form);
    if (geo) geo.addEventListener('click', async () => {
      const msg = $('[data-geo-msg]', form); geo.classList.add('is-loading'); msg.textContent = '';
      try { const l = await Geo.get(); form.lat.value = l.lat.toFixed(6); form.lng.value = l.lng.toFixed(6); msg.textContent = `Akurasi ±${l.accuracy} m — periksa lalu Simpan.`; if (!form.name.value) form.name.value = 'Lokasi Kerja Utama'; }
      catch (e) { msg.textContent = e.message; UI.toast(e.message, 'error'); } finally { geo.classList.remove('is-loading'); }
    });
    const pdm = form.querySelector('[name=payment_day_mode]');
    if (pdm) pdm.addEventListener('change', () => { form.payment_day.disabled = pdm.value === 'join_date'; });
    const addComp = $('[data-add-comp]', form);
    if (addComp) { addComp.addEventListener('click', () => $('[data-comps]', form).insertAdjacentHTML('beforeend', compRow(undefined, $$('[data-comp]', form).length))); form.addEventListener('click', (e) => { const r = e.target.closest('[data-rm-comp]'); if (r) r.closest('[data-comp]').remove(); }); }
    const reset = $('[data-reset]', form); if (reset) reset.addEventListener('click', async () => { if (await UI.confirm({ title: 'Reset data demo?', message: 'Semua perubahan demo di browser ini akan hilang.', confirmText: 'Reset', tone: 'danger' })) { DemoStore.reset(); location.reload(); } });
    const lo = $('[data-logout2]', form); if (lo) lo.addEventListener('click', () => Auth.logout());
    const cpw = $('[data-cpw]', form); if (cpw) cpw.addEventListener('click', () => Layout.changePasswordDialog());

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const d = UI.formData(form); let payload = d, key = section;
      if (section === 'work') payload = { start: d.start, end: d.end, break_start: d.break_start, break_end: d.break_end, late_tolerance_min: d.late_tolerance_min, early_leave_tolerance_min: d.early_leave_tolerance_min, working_days: $$('[name=working_days]:checked', form).map((c) => Number(c.value)) };
      if (section === 'payroll') {
        const comps = $$('[data-comp]', form).map((r) => ({ name: r.querySelector('[data-cn]').value.trim(), amount: r.querySelector('[data-ca]').value })).filter((c) => c.name || c.amount);
        if (comps.some((c) => !c.name || c.amount === '')) { $('[data-comp-err]', form).textContent = 'Lengkapi nama & nominal setiap komponen.'; return; }
        payload = { period: d.period, payment_day_mode: d.payment_day_mode, payment_day: d.payment_day, default_components: comps, rules: { unpaid_leave: d.unpaid_leave, absent: d.absent, late_per_incident: d.late_per_incident, overtime_enabled: d.overtime_enabled } };
      }
      if (section === 'leave') payload = { annual_quota_days: d.annual_quota_days, types: $$('[data-lt]', form).map((r) => ({ id: r.dataset.lt, is_paid: r.querySelector('[data-k=is_paid]').checked, requires_attachment: r.querySelector('[data-k=requires_attachment]').checked, active: r.querySelector('[data-k=active]').checked })) };
      const btn = form.querySelector('[type=submit]');
      const r = await UI.submit(btn, form, async () => {
        if (section === 'notifications') { await API.settings.update('profile_fields', { fields: $$('[name=profile_fields]:checked', form).map((c) => c.value) }); key = 'notifications'; payload = { leave_requests: d.leave_requests, attendance_reminder: d.attendance_reminder, task_deadline: d.task_deadline, payroll: d.payroll }; }
        return API.settings.update(key, payload);
      });
      if (r) { S = r; UI.toast('Pengaturan disimpan.', 'success'); render(); }
    });
  }

  $$('[data-sec]', el).forEach((b) => b.addEventListener('click', () => { section = b.dataset.sec; history.replaceState(null, '', '#' + section); $$('[data-sec]', el).forEach((x) => x.classList.toggle('is-active', x === b)); render(); }));
  window.addEventListener('hashchange', () => { const k = location.hash.slice(1); if (SECTIONS.some(([x]) => x === k) && k !== section) { section = k; $$('[data-sec]', el).forEach((x) => x.classList.toggle('is-active', x.dataset.sec === k)); render(); } });
  load();
})();
