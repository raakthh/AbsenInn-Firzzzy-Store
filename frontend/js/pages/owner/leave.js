/* AbsenInn — Owner: Leave Management */
(async function () {
  await Layout.init({ role: 'owner', page: 'leave', title: 'Leave Management' });
  const { icon, esc, $ } = UI;
  const el = $('#content');
  const st = { tab: 'pending', type: '', month: Fmt.today().slice(0, 7) };
  let all = [], types = [];

  el.innerHTML = `
    ${Layout.pageHeader({ title: 'Leave Management', subtitle: 'Tinjau, setujui, atau tolak pengajuan izin & cuti karyawan.' })}
    <div class="grid grid-4 stats-grid mb-4" data-summary></div>
    <div class="card"><div class="tabs" style="padding:0 16px" role="tablist">
      <button class="tab is-active" data-tab="pending">Pending <span class="count" data-c="pending">0</span></button><button class="tab" data-tab="approved">Disetujui <span class="count" data-c="approved">0</span></button>
      <button class="tab" data-tab="rejected">Ditolak <span class="count" data-c="rejected">0</span></button><button class="tab" data-tab="all">Semua</button><button class="tab" data-tab="calendar">${icon('calendar-days')}Kalender</button></div>
      <div data-panel>${UI.loading(5)}</div></div>`;

  async function reload() {
    try {
      [all, types] = await Promise.all([API.leave.list({}), API.leave.types()]);
      ['pending', 'approved', 'rejected'].forEach((k) => { $(`[data-c="${k}"]`).textContent = all.filter((l) => l.status === k).length; });
      const year = Fmt.today().slice(0, 4);
      const approvedYear = all.filter((l) => l.status === 'approved' && l.start_date.startsWith(year));
      const upcoming = all.filter((l) => l.status === 'approved' && l.start_date > Fmt.today()).length;
      const onLeaveToday = all.filter((l) => l.status === 'approved' && l.start_date <= Fmt.today() && l.end_date >= Fmt.today()).length;
      const stat = (ic, tone, v, l) => `<div class="card stat"><span class="stat-icon tone-${tone}">${icon(ic)}</span><div><div class="stat-value">${v}</div><div class="stat-label">${l}</div></div></div>`;
      $('[data-summary]').innerHTML = stat('hourglass', 'pending', all.filter((l) => l.status === 'pending').length, 'Menunggu keputusan') + stat('plane', 'primary', onLeaveToday, 'Sedang izin hari ini') + stat('calendar', 'info', upcoming, 'Izin disetujui mendatang') + stat('check-circle', 'success', approvedYear.reduce((s, l) => s + l.days, 0).toString().replace('.', ','), `Hari izin disetujui ${year}`);
      render();
      Layout.refreshBadges();
    } catch (e) { UI.errorState($('[data-panel]'), e, reload); }
  }

  function render() { const p = $('[data-panel]'); p.onclick = null; st.tab === 'calendar' ? calendar(p) : list(p); }

  function list(p) {
    p.innerHTML = `<div class="table-toolbar"><select class="select select-sm" data-type style="width:auto" aria-label="Jenis izin"><option value="">Semua jenis</option>${types.map((t) => `<option value="${t.id}" ${st.type === t.id ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select></div><div data-t></div>`;
    $('[data-type]', p).addEventListener('change', (e) => { st.type = e.target.value; render(); });
    const rows = all.filter((l) => (st.tab === 'all' || l.status === st.tab) && (!st.type || l.leave_type_id === st.type));
    UI.table($('[data-t]', p), { rows, pageSize: 10, emptyTitle: st.tab === 'pending' ? 'Tidak ada pengajuan pending' : 'Tidak ada pengajuan', emptyText: st.tab === 'pending' ? 'Semua pengajuan sudah diproses. 🎉' : '', emptyIcon: 'file-text', onRow: (l) => openDetail(l.id),
      columns: [
        { label: 'Karyawan', render: (l) => UI.person(l.employee) },
        { label: 'Jenis', render: (l) => `${esc(l.leave_type.name)}<div class="text-xs ${l.leave_type.is_paid ? 'text-success' : 'text-3'}">${l.leave_type.is_paid ? 'Dibayar' : 'Tidak dibayar'}</div>` },
        { label: 'Tanggal', render: (l) => `${Fmt.date(l.start_date)}${l.end_date !== l.start_date ? '<br><span class="text-xs text-3">s/d ' + Fmt.date(l.end_date) + '</span>' : ''}` },
        { label: 'Durasi', render: (l) => `${String(l.days).replace('.', ',')} hari` },
        { label: 'Alasan', render: (l) => `<span class="text-sm text-2 truncate" style="display:block;max-width:240px">${esc(l.reason)}</span>${l.attachment_name ? `<span class="text-xs text-primary">${icon('paperclip', 12)} ${esc(l.attachment_name)}</span>` : ''}` },
        { label: 'Diajukan', render: (l) => `<span class="text-sm">${Fmt.relative(l.requested_at)}</span>` },
        { label: 'Status', render: (l) => UI.badge(l.status) },
        { label: '', cls: 'col-actions', render: (l) => (l.status === 'pending' ? `<div class="flex gap-1"><button class="btn btn-success btn-sm" data-quick="approve" data-id="${l.id}">${icon('check', 15)}Setujui</button><button class="btn btn-danger-soft btn-sm" data-quick="reject" data-id="${l.id}">${icon('x', 15)}</button></div>` : `<button class="btn btn-ghost btn-sm" data-id="${l.id}" data-quick="view">Detail</button>`) },
      ] });
    p.onclick = (e) => { const b = e.target.closest('[data-quick]'); if (b) openDetail(b.dataset.id, b.dataset.quick); };
  }

  function calendar(p) {
    const [y, m] = st.month.split('-').map(Number);
    const first = new Date(y, m - 1, 1), days = new Date(y, m, 0).getDate();
    const lead = (first.getDay() + 6) % 7;
    const items = all.filter((l) => l.status !== 'rejected');
    const tone = { approved: 'background:var(--primary-50);color:var(--primary-700)', pending: 'background:var(--pending-50);color:#9a5300' };
    let cells = '';
    for (let i = 0; i < lead; i += 1) cells += '<div class="cal-day is-out"></div>';
    for (let d = 1; d <= days; d += 1) {
      const date = `${st.month}-${Fmt.pad(d)}`;
      const on = items.filter((l) => date >= l.start_date && date <= l.end_date);
      cells += `<div class="cal-day ${date === Fmt.today() ? 'is-today' : ''}"><span class="cal-num">${d}</span>${on.slice(0, 3).map((l) => `<span class="cal-chip" style="${tone[l.status]}" title="${esc(l.employee.full_name)} — ${esc(l.leave_type.name)} (${UI.statusLabel(l.status)})">${esc(l.employee.full_name.split(' ')[0])}</span>`).join('')}${on.length > 3 ? `<span class="text-xs text-3">+${on.length - 3}</span>` : ''}</div>`;
    }
    p.innerHTML = `<div class="table-toolbar"><button class="btn btn-outline btn-sm btn-icon" data-prev aria-label="Bulan sebelumnya">${icon('chevron-left')}</button><b style="min-width:140px;text-align:center">${Fmt.monthLabel(st.month)}</b><button class="btn btn-outline btn-sm btn-icon" data-next aria-label="Bulan berikutnya">${icon('chevron-right')}</button>
      <div class="legend" style="margin-left:auto"><span><i style="background:var(--primary-200)"></i>Disetujui</span><span><i style="background:#FFD9A8"></i>Pending</span></div></div>
      <div class="card-body"><div class="cal">${['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min'].map((d) => `<div class="cal-head">${d}</div>`).join('')}${cells}</div></div>`;
    const shift = (n) => { const d = new Date(y, m - 1 + n, 1); st.month = Fmt.toISODate(d).slice(0, 7); render(); };
    $('[data-prev]', p).addEventListener('click', () => shift(-1));
    $('[data-next]', p).addEventListener('click', () => shift(1));
  }

  async function openDetail(id, intent) {
    const m = UI.modal({ title: 'Detail Pengajuan', size: 'lg', body: UI.loading(6) });
    try {
      const l = await API.leave.get(id);
      const others = all.filter((x) => x.id !== l.id && x.status === 'approved' && !(x.end_date < l.start_date || x.start_date > l.end_date));
      const bal = l.leave_type.uses_quota ? await API.leave.balance(l.employee_id) : null;
      m.body.innerHTML = `<div class="flex items-center justify-between wrap gap-3">${UI.person(l.employee)}${UI.badge(l.status)}</div>
        <dl class="kv mt-4"><dt>Jenis izin</dt><dd>${esc(l.leave_type.name)} <span class="text-xs text-3">(${esc(l.leave_type.name_en)})</span></dd>
          <dt>Tanggal</dt><dd>${Fmt.date(l.start_date, 'long')}${l.end_date !== l.start_date ? ' – ' + Fmt.date(l.end_date, 'long') : ''}</dd>
          <dt>Durasi (hari kerja)</dt><dd>${String(l.days).replace('.', ',')} hari</dd><dt>Alasan</dt><dd>${esc(l.reason)}</dd>
          <dt>Lampiran</dt><dd>${l.attachment_name ? `${icon('paperclip', 14)} ${esc(l.attachment_name)} ${API.isDemo() ? '<span class="text-xs text-3">(demo: hanya nama file)</span>' : `<button type="button" class="btn btn-ghost btn-sm" data-att="${l.id}">${icon('eye', 14)}Lihat</button>`}` : '<span class="text-3">—</span>'}</dd>
          <dt>Diajukan</dt><dd>${Fmt.dateTime(l.requested_at)}</dd>${l.decided_at ? `<dt>Diputuskan</dt><dd>${Fmt.dateTime(l.decided_at)}</dd>` : ''}${l.owner_notes ? `<dt>Catatan owner</dt><dd>${esc(l.owner_notes)}</dd>` : ''}</dl>
        <div class="alert ${l.leave_type.is_paid ? 'alert-success' : 'alert-warning'} mt-4">${icon('wallet')}<div><strong>Dampak payroll (sesuai kebijakan di Settings):</strong> ${esc(l.leave_type.name)} dikonfigurasi sebagai <b>${l.leave_type.is_paid ? 'dibayar' : 'tidak dibayar'}</b>. Jika disetujui, tanggal terkait otomatis tercatat di absensi sebagai <b>${UI.statusLabel(l.leave_type.attendance_status)}</b>${l.leave_type.half_day ? ' (setengah hari, karyawan tetap check-in)' : ''}.</div></div>
        ${bal ? `<div class="alert alert-info mt-3">${icon('calendar')}<div>Saldo cuti tahunan ${esc(l.employee.full_name.split(' ')[0])}: <b>${bal.remaining}</b> dari ${bal.quota} hari (terpakai ${bal.used}).</div></div>` : ''}
        ${others.length ? `<div class="alert alert-warning mt-3">${icon('users')}<div>Karyawan lain yang juga izin pada periode ini: ${others.map((o) => esc(o.employee.full_name)).join(', ')}.</div></div>` : ''}
        ${l.status === 'pending' ? `<form class="mt-4" novalidate data-f>${UI.field({ name: 'notes', label: 'Catatan untuk karyawan', type: 'textarea', placeholder: 'Wajib diisi jika menolak', rows: 2 })}</form>` : ''}`;
      const attBtn = m.body.querySelector('[data-att]');
      if (attBtn) attBtn.addEventListener('click', async () => {
        attBtn.classList.add('is-loading');
        try {
          const a = await API.leave.attachment(l.id);
          const href = a.url.startsWith('data:') ? URL.createObjectURL(await (await fetch(a.url)).blob()) : a.url;
          attBtn.outerHTML = `<a class="btn btn-ghost btn-sm" href="${href}" target="_blank" rel="noopener">${icon('eye', 14)}Buka lampiran</a> <span class="text-xs text-3">link berlaku ${Math.round(a.expires_in / 60)} menit</span>`;
        } catch (e) { attBtn.classList.remove('is-loading'); UI.apiError(e); }
      });
      if (l.status === 'pending') {
        m.el.querySelector('.modal').insertAdjacentHTML('beforeend', `<div class="modal-footer"><button class="btn btn-outline" data-close2>Tutup</button><button class="btn btn-danger" data-reject>${icon('x')}Tolak</button><button class="btn btn-success" data-approve>${icon('check')}Setujui</button></div>`);
        m.el.querySelector('[data-close2]').addEventListener('click', () => m.close());
        const form = m.el.querySelector('[data-f]');
        const decide = async (kind, btn) => {
          const notes = form.notes.value.trim();
          if (kind === 'reject' && notes.length < 3) return UI.showErrors(form, { notes: 'Catatan wajib diisi saat menolak (min. 3 karakter)' });
          const ok = await UI.confirm({ title: kind === 'approve' ? 'Setujui pengajuan?' : 'Tolak pengajuan?', message: kind === 'approve' ? `Absensi ${esc(l.employee.full_name)} pada tanggal terkait akan diperbarui otomatis.` : 'Karyawan akan menerima notifikasi beserta catatan Anda.', confirmText: kind === 'approve' ? 'Setujui' : 'Tolak', tone: kind === 'approve' ? 'success' : 'danger' });
          if (!ok) return;
          const r = await UI.submit(btn, form, () => (kind === 'approve' ? API.leave.approve(l.id, notes) : API.leave.reject(l.id, notes)));
          if (r) { UI.toast(kind === 'approve' ? 'Pengajuan disetujui & absensi diperbarui.' : 'Pengajuan ditolak.', 'success'); m.close(); reload(); }
        };
        m.el.querySelector('[data-approve]').addEventListener('click', (e) => decide('approve', e.currentTarget));
        m.el.querySelector('[data-reject]').addEventListener('click', (e) => decide('reject', e.currentTarget));
        if (intent === 'reject') form.notes.focus();
      }
    } catch (e) { UI.errorState(m.body, e); }
  }

  UI.tabs(el.querySelector('.card'), (t) => { st.tab = t; render(); });
  reload();
})();
