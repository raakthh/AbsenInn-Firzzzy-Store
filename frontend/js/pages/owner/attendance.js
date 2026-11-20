/* AbsenInn — Owner: Attendance Management */
(async function () {
  await Layout.init({ role: 'owner', page: 'attendance', title: 'Attendance' });
  const { icon, esc, $, $$ } = UI;
  const root = Auth.root();
  const el = $('#content');
  const today = Fmt.today();
  const st = { tab: 'daily', date: UI.qs('date') || today, search: '', status: '', loc: '', weekStart: startOfWeek(today), month: today.slice(0, 7) };
  let settings, employees;

  function startOfWeek(d) { const x = Fmt.parseDate(d); const dow = (x.getDay() + 6) % 7; return Fmt.addDays(d, -dow); }
  const STATUS_OPTS = [['present', 'Hadir'], ['late', 'Terlambat'], ['early_leave', 'Pulang Awal'], ['sick', 'Sakit'], ['paid_leave', 'Cuti/Izin Dibayar'], ['unpaid_leave', 'Cuti Tdk Dibayar'], ['absent', 'Absen'], ['needs_review', 'Perlu Review']];

  el.innerHTML = `
    ${Layout.pageHeader({ title: 'Attendance', subtitle: 'Pantau check-in/out, bukti selfie & lokasi, dan lakukan koreksi.', actions: `<button class="btn btn-outline" data-reconcile>${icon('check-check')}Rekonsiliasi</button><button class="btn btn-primary" data-manual>${icon('plus')}Input / Koreksi Manual</button>` })}
    <div data-loc-alert></div>
    <div class="card"><div class="tabs" style="padding:0 16px" role="tablist">
      <button class="tab is-active" data-tab="daily">${icon('calendar')}Harian</button><button class="tab" data-tab="weekly">${icon('calendar-days')}Mingguan</button>
      <button class="tab" data-tab="monthly">${icon('bar-chart')}Bulanan</button><button class="tab" data-tab="requests">${icon('history')}Permintaan Koreksi <span class="count" data-req-count>0</span></button></div>
      <div data-panel>${UI.loading(6)}</div></div>`;

  async function init() {
    [settings, employees] = await Promise.all([API.settings.get(), API.employees.list({})]);
    if (settings.attendance.location.lat == null) $('[data-loc-alert]').innerHTML = `<div class="alert alert-warning mb-4">${icon('map-pin')}<div><strong>Lokasi kerja belum diatur.</strong> Check-in baru tidak bisa diverifikasi radiusnya dan akan masuk sebagai "Perlu Review". <a href="${root}owner/settings.html#attendance">Atur lokasi kerja →</a></div></div>`;
    refreshReqCount();
    UI.tabs(el.querySelector('.card'), (t) => { st.tab = t; render(); });
    render();
  }
  async function refreshReqCount() { const r = await API.attendance.correctionRequests(); $('[data-req-count]').textContent = r.filter((x) => x.status === 'pending').length; }
  function render() { const p = $('[data-panel]'); ({ daily, weekly, monthly, requests })[st.tab](p); }

  /* ---------- Daily ---------- */
  async function daily(p) {
    p.innerHTML = `<div class="table-toolbar">
        <input type="date" class="input input-sm" data-date value="${st.date}" max="${today}" style="width:auto" aria-label="Tanggal">
        <div class="input-group">${icon('search')}<input class="input input-sm" data-search placeholder="Cari nama karyawan…" value="${esc(st.search)}"></div>
        <select class="select select-sm" data-status style="width:auto" aria-label="Status kehadiran"><option value="">Semua status</option>${STATUS_OPTS.map(([v, l]) => `<option value="${v}" ${st.status === v ? 'selected' : ''}>${l}</option>`).join('')}<option value="not_checked_in" ${st.status === 'not_checked_in' ? 'selected' : ''}>Belum check-in</option></select>
        <select class="select select-sm" data-loc style="width:auto" aria-label="Status lokasi"><option value="">Semua lokasi</option>${['verified', 'needs_review', 'outside', 'not_configured', 'reviewed'].map((v) => `<option value="${v}" ${st.loc === v ? 'selected' : ''}>${UI.statusLabel(v)}</option>`).join('')}</select>
      </div><div class="flex gap-2 wrap" style="padding:12px 20px 0" data-chips></div><div data-t>${UI.loading(5)}</div>`;
    $('[data-date]', p).addEventListener('change', (e) => { st.date = e.target.value || today; render(); });
    let deb; $('[data-search]', p).addEventListener('input', (e) => { clearTimeout(deb); deb = setTimeout(() => { st.search = e.target.value.trim().toLowerCase(); draw(); }, 160); });
    $('[data-status]', p).addEventListener('change', (e) => { st.status = e.target.value; draw(); });
    $('[data-loc]', p).addEventListener('change', (e) => { st.loc = e.target.value; draw(); });

    let mon;
    try { mon = await API.attendance.monitoring(st.date); } catch (e) { return UI.errorState($('[data-t]', p), e, render); }
    const counts = {}; mon.rows.forEach((r) => { counts[r.state] = (counts[r.state] || 0) + 1; });
    $('[data-chips]', p).innerHTML = (mon.is_work_day ? '' : `<span class="badge badge-muted no-dot">${icon('info', 13)} Bukan hari kerja</span>`) + Object.entries(counts).map(([k, v]) => `${UI.badge(k, `${UI.statusLabel(k)}: ${v}`)}`).join('');
    const tbl = UI.table($('[data-t]', p), { rows: [], pageSize: 12, emptyTitle: 'Tidak ada data', emptyText: 'Ubah tanggal atau filter.', emptyIcon: 'calendar-check',
      rowClass: (r) => (r.state === 'needs_review' ? 'row-review' : ''),
      columns: [
        { label: 'Karyawan', render: (r) => UI.person(r.employee) },
        { label: 'Check-in', render: (r) => `<span class="mono fw-600">${Fmt.time(r.record && r.record.check_in_at)}</span>` },
        { label: 'Check-out', render: (r) => `<span class="mono">${Fmt.time(r.record && r.record.check_out_at)}</span>` },
        { label: 'Selfie', render: (r) => (r.record && (r.record.selfie_in_path || r.record.selfie_out_path) ? `<div class="flex gap-1">${['in', 'out'].map((k) => (r.record[`selfie_${k}_path`] ? `<button class="thumb-btn" data-evidence="${r.record.id}" title="Selfie ${k === 'in' ? 'check-in' : 'check-out'}"><span class="thumb">${icon('scan-face')}</span></button>` : '')).join('')}</div>` : '<span class="text-3">—</span>') },
        { label: 'Lokasi', render: (r) => (r.record && r.record.location_status ? UI.badge(r.record.location_status) : '<span class="text-3">—</span>') },
        { label: 'Jarak', render: (r) => (r.record ? Fmt.distance(r.record.distance_in_m) : '—') },
        { label: 'Akurasi', render: (r) => (r.record && r.record.accuracy_in_m != null ? `±${r.record.accuracy_in_m} m` : '—') },
        { label: 'Durasi', render: (r) => Fmt.minutesToHM(r.record && r.record.work_minutes) },
        { label: 'Status', render: (r) => UI.badge(r.state) + (r.pending_leave ? `<div class="text-xs text-pending mt-1">Ada izin pending</div>` : '') },
        { label: 'Catatan', render: (r) => `<span class="text-xs text-2">${esc((r.record && r.record.notes) || '')}</span>` },
        { label: '', cls: 'col-actions', render: (r) => `<div class="flex gap-1">${r.record && r.record.check_in_at ? `<button class="btn btn-ghost btn-icon btn-sm" data-evidence="${r.record.id}" title="Bukti absensi" aria-label="Bukti absensi">${icon('eye', 16)}</button>` : ''}<button class="btn btn-ghost btn-icon btn-sm" data-correct="${r.employee.id}" title="Koreksi" aria-label="Koreksi absensi">${icon('pencil', 16)}</button></div>` },
      ] });
    function draw() {
      tbl.update(mon.rows.filter((r) => (!st.search || r.employee.full_name.toLowerCase().includes(st.search)) && (!st.status || r.state === st.status) && (!st.loc || (r.record && r.record.location_status) === st.loc)));
    }
    draw();
    p.onclick = (e) => {
      const ev = e.target.closest('[data-evidence]'); if (ev) return openEvidence(ev.dataset.evidence);
      const c = e.target.closest('[data-correct]'); if (c) { const row = mon.rows.find((r) => r.employee.id === c.dataset.correct); openCorrection(row.record, row.employee, st.date); }
    };
  }

  /* ---------- Weekly ---------- */
  async function weekly(p) {
    const days = Array.from({ length: 7 }, (_, i) => Fmt.addDays(st.weekStart, i));
    p.innerHTML = `<div class="table-toolbar"><button class="btn btn-outline btn-sm btn-icon" data-prev aria-label="Minggu sebelumnya">${icon('chevron-left')}</button><b>${Fmt.date(days[0])} – ${Fmt.date(days[6])}</b><button class="btn btn-outline btn-sm btn-icon" data-next ${days[6] >= today ? 'disabled' : ''} aria-label="Minggu berikutnya">${icon('chevron-right')}</button>
      <div class="legend" style="margin-left:auto">${['present', 'late', 'paid_leave', 'sick', 'absent', 'needs_review'].map((k) => `<span><i class="badge-${UI.STATUS[k][1]}" style="background:currentColor"></i>${UI.statusLabel(k)}</span>`).join('')}</div></div><div data-t>${UI.loading(5)}</div>`;
    $('[data-prev]', p).addEventListener('click', () => { st.weekStart = Fmt.addDays(st.weekStart, -7); render(); });
    $('[data-next]', p).addEventListener('click', () => { st.weekStart = Fmt.addDays(st.weekStart, 7); render(); });
    const recs = await API.attendance.list({ from: days[0], to: days[6] });
    const emps = employees.filter((e) => e.employment_status === 'active');
    const wd = settings.work.working_days;
    $('[data-t]', p).innerHTML = `<div class="table-wrap"><table class="table"><thead><tr><th>Karyawan</th>${days.map((d) => `<th class="text-center">${Fmt.dayName(d, true)}<br><span style="font-weight:500">${Fmt.date(d, 'short')}</span></th>`).join('')}<th class="text-center">Hadir</th></tr></thead><tbody>
      ${emps.map((e) => { const mine = recs.filter((r) => r.employee_id === e.id); return `<tr><td>${UI.person(e)}</td>${days.map((d) => { const r = mine.find((x) => x.date === d);
        if (r) return `<td class="text-center"><span class="badge badge-${UI.STATUS[r.status][1]} no-dot" title="${UI.statusLabel(r.status)}${r.check_in_at ? ' · ' + Fmt.time(r.check_in_at) : ''}">${r.check_in_at ? Fmt.time(r.check_in_at) : UI.statusLabel(r.status).split(' ')[0]}</span></td>`;
        return `<td class="text-center text-3">${!wd.includes(Fmt.parseDate(d).getDay()) ? '<span class="text-xs">Libur</span>' : d > today ? '' : d === today ? '<span class="text-xs">Belum</span>' : '<span class="text-xs">—</span>'}</td>`; }).join('')}
        <td class="text-center fw-700">${mine.filter((r) => Metrics.ATTENDED.includes(r.status)).length}</td></tr>`; }).join('')}</tbody></table></div>`;
  }

  /* ---------- Monthly ---------- */
  async function monthly(p) {
    p.innerHTML = `<div class="table-toolbar"><input type="month" class="input input-sm" data-month value="${st.month}" max="${today.slice(0, 7)}" style="width:auto" aria-label="Bulan"><span class="text-sm text-3">Rekap per karyawan · izin/cuti tidak dihitung sebagai ketidakhadiran</span></div><div data-t>${UI.loading(5)}</div>`;
    $('[data-month]', p).addEventListener('change', (e) => { st.month = e.target.value || today.slice(0, 7); render(); });
    const [y, m] = st.month.split('-').map(Number);
    const recs = await API.attendance.list({ from: `${st.month}-01`, to: Fmt.toISODate(new Date(y, m, 0)) });
    const rows = employees.map((e) => ({ e, s: Metrics.summarize(recs.filter((r) => r.employee_id === e.id)) })).filter((x) => x.s.attended + x.s.leave + x.s.counts.absent > 0 || x.e.employment_status === 'active');
    UI.table($('[data-t]', p), { rows, pageSize: 20, emptyTitle: 'Tidak ada data bulan ini', columns: [
      { label: 'Karyawan', render: (x) => UI.person(x.e) },
      { label: 'Hadir', render: (x) => `<b>${x.s.attended}</b>` }, { label: 'Terlambat', render: (x) => `<span class="${x.s.counts.late ? 'text-pending fw-600' : ''}">${x.s.counts.late}</span>` },
      { label: 'Pulang awal', render: (x) => x.s.counts.early_leave }, { label: 'Sakit', render: (x) => x.s.counts.sick }, { label: 'Cuti/Izin', render: (x) => x.s.counts.paid_leave + x.s.counts.unpaid_leave },
      { label: 'Absen', render: (x) => `<span class="${x.s.counts.absent ? 'text-danger fw-600' : ''}">${x.s.counts.absent}</span>` },
      { label: 'Total jam', render: (x) => Fmt.minutesToHM(x.s.totalMinutes) },
      { label: 'Kehadiran', render: (x) => `<div class="flex items-center gap-2"><div class="progress" style="width:70px"><div class="progress-bar" style="width:${x.s.attendanceRate}%"></div></div><span class="text-sm fw-600">${Fmt.percent(x.s.attendanceRate)}</span></div>` },
      { label: 'Tepat waktu', render: (x) => Fmt.percent(x.s.punctualityRate) }] });
  }

  /* ---------- Correction requests ---------- */
  async function requests(p) {
    p.innerHTML = `<div data-t>${UI.loading(4)}</div>`;
    const rows = await API.attendance.correctionRequests();
    UI.table($('[data-t]', p), { rows, emptyTitle: 'Belum ada permintaan koreksi', emptyText: 'Permintaan dari karyawan akan muncul di sini.', emptyIcon: 'history', columns: [
      { label: 'Karyawan', render: (c) => UI.person(c.employee) }, { label: 'Tanggal', render: (c) => Fmt.date(c.date) },
      { label: 'Jam diajukan', render: (c) => `<span class="mono">${c.requested_check_in || '—'} – ${c.requested_check_out || '—'}</span>` },
      { label: 'Alasan', render: (c) => `<span class="text-sm text-2">${esc(c.reason)}</span>` }, { label: 'Diajukan', render: (c) => Fmt.relative(c.created_at) }, { label: 'Status', render: (c) => UI.badge(c.status) },
      { label: '', cls: 'col-actions', render: (c) => (c.status === 'pending' ? `<div class="flex gap-1"><button class="btn btn-success btn-sm" data-approve="${c.id}">Setujui</button><button class="btn btn-danger-soft btn-sm" data-reject="${c.id}">Tolak</button></div>` : '') }] });
    p.onclick = async (e) => {
      const a = e.target.closest('[data-approve]'), r = e.target.closest('[data-reject]');
      if (a) { const c = rows.find((x) => x.id === a.dataset.approve); openCorrection(null, c.employee, c.date, c); }
      if (r) {
        const ok = await UI.confirm({ title: 'Tolak permintaan koreksi?', message: 'Karyawan akan menerima notifikasi penolakan.', confirmText: 'Tolak', tone: 'danger' });
        if (!ok) return; try { await API.attendance.resolveCorrection(r.dataset.reject, 'reject', { notes: '' }); UI.toast('Permintaan ditolak', 'success'); refreshReqCount(); render(); } catch (err) { UI.apiError(err); }
      }
    };
  }

  /* ---------- Evidence modal ---------- */
  async function openEvidence(id) {
    const m = UI.modal({ title: 'Bukti Absensi', size: 'lg', body: UI.loading(6), footer: '<button class="btn btn-outline" data-close>Tutup</button>' });
    try {
      const [rec, ev] = await Promise.all([API.attendance.get(id), API.attendance.evidence(id)]);
      const side = (k, label) => { const x = ev[k]; return `<div><div class="fw-700 mb-4">${label}</div>${x.selfie_url ? `<img class="selfie-img" src="${x.selfie_url}" alt="Selfie ${label}">` : x.placeholder ? UI.selfiePlaceholder() : `<div class="selfie-ph">${icon('camera-off')}<small>Tidak ada selfie</small></div>`}
        <div class="loc-box mt-3"><div class="loc-row"><span>Waktu</span><span class="mono">${Fmt.time(x.at)}</span></div><div class="loc-row"><span>Koordinat</span><span class="mono">${x.lat != null ? `<a href="https://www.google.com/maps?q=${x.lat},${x.lng}" target="_blank" rel="noopener">${Number(x.lat).toFixed(5)}, ${Number(x.lng).toFixed(5)}</a>` : '<span class="text-3">tidak disimpan (data contoh)</span>'}</span></div>
        <div class="loc-row"><span>Jarak dari lokasi kerja</span><span>${Fmt.distance(x.distance_m)}</span></div><div class="loc-row"><span>Akurasi GPS</span><span>${x.accuracy_m != null ? '±' + x.accuracy_m + ' m' : '—'}</span></div></div></div>`; };
      m.body.innerHTML = `<div class="flex items-center justify-between wrap gap-3 mb-4">${UI.person(rec.employee, Fmt.date(rec.date, 'long'))}<div class="flex gap-2">${UI.badge(rec.status)}${rec.location_status ? UI.badge(rec.location_status) : ''}</div></div>
        ${ev.flags.length ? `<div class="alert alert-warning mb-4">${icon('flag')}<div><strong>Ditandai untuk diperiksa:</strong> ${ev.flags.map((f) => ({ outside_radius: 'di luar radius', low_gps_accuracy: 'akurasi GPS rendah', location_not_configured: 'lokasi kerja belum diatur', checkout_location: 'lokasi check-out bermasalah', early_leave: 'pulang lebih awal', stale_capture: 'waktu foto berbeda jauh dari waktu kirim', non_work_day: 'absen di hari libur', gps_unavailable: 'GPS tidak tersedia' }[f] || f)).join(', ')}.</div></div>` : ''}
        <div class="grid grid-2">${side('check_in', 'Check-in')}${side('check_out', 'Check-out')}</div>
        <div class="alert alert-info mt-4">${icon('shield')}<div>Selfie disimpan di <b>private bucket</b> dan ditampilkan via signed URL berlaku ${ev.expires_in / 60} menit (produksi). GPS browser dapat dimanipulasi — gunakan sebagai bukti pendukung, bukan jaminan anti-kecurangan.${API.isDemo() ? ' Data contoh memakai placeholder, bukan foto asli.' : ''}</div></div>
        ${rec.corrections.length ? `<div class="mt-4"><div class="fw-700 mb-4">Riwayat koreksi</div><div class="timeline">${rec.corrections.map((c) => `<div class="tl-item"><span class="tl-dot"></span><div><div class="tl-title">${UI.statusLabel(c.before.status)} → ${UI.statusLabel(c.after.status)}</div><div class="tl-sub">${esc(c.reason)} · ${esc(c.corrected_by_name || '')} · ${Fmt.relative(c.created_at)}</div></div></div>`).join('')}</div></div>` : ''}`;
      m.footer.innerHTML = `<button class="btn btn-outline" data-close>Tutup</button><button class="btn btn-primary" data-fix>${icon('pencil')}Koreksi</button>`;
      m.footer.querySelector('[data-close]').addEventListener('click', () => m.close());
      m.footer.querySelector('[data-fix]').addEventListener('click', () => { m.close(); openCorrection(rec, rec.employee, rec.date); });
    } catch (e) { UI.errorState(m.body, e); }
  }

  /* ---------- Correction form ---------- */
  function openCorrection(rec, emp, date, request) {
    const hm = (iso) => (iso ? Fmt.time(iso) : '');
    const m = UI.modal({ title: request ? 'Setujui Permintaan Koreksi' : rec ? 'Koreksi Absensi' : 'Input Absensi Manual', subtitle: emp ? `${esc(emp.full_name)} · ${Fmt.date(date, 'long')}` : 'Pilih karyawan & tanggal',
      body: `<form class="form-grid" novalidate data-f>
        ${emp ? '' : UI.field({ name: 'employee_id', label: 'Karyawan', type: 'select', required: true, options: [['', 'Pilih karyawan']].concat(employees.filter((e) => e.employment_status === 'active').map((e) => [e.id, e.full_name])) }) + UI.field({ name: 'date', label: 'Tanggal', type: 'date', value: today, required: true, attrs: `max="${today}"` })}
        ${rec ? `<div class="span-2 alert alert-primary">${icon('info')}<div>Saat ini: <b>${UI.statusLabel(rec.status)}</b> · ${hm(rec.check_in_at) || '—'} – ${hm(rec.check_out_at) || '—'}</div></div>` : ''}
        ${request ? `<div class="span-2 alert alert-info">${icon('history')}<div>Alasan karyawan: "${esc(request.reason)}"</div></div>` : ''}
        ${UI.field({ name: 'status', label: 'Status kehadiran', type: 'select', required: true, value: rec ? rec.status : 'present', options: STATUS_OPTS, span: true })}
        ${UI.field({ name: 'check_in', label: 'Jam check-in', type: 'time', value: request ? request.requested_check_in || '' : hm(rec && rec.check_in_at) })}
        ${UI.field({ name: 'check_out', label: 'Jam check-out', type: 'time', value: request ? request.requested_check_out || '' : hm(rec && rec.check_out_at) })}
        ${UI.field({ name: 'reason', label: 'Alasan koreksi', type: 'textarea', required: true, span: true, placeholder: 'Wajib diisi — tercatat di audit log', value: request ? 'Disetujui berdasarkan permintaan karyawan' : '' })}
      </form>`,
      footer: `<button class="btn btn-outline" data-close>Batal</button><button class="btn btn-primary" data-save>${icon('check')}Simpan Koreksi</button>` });
    const form = m.el.querySelector('[data-f]');
    m.el.querySelector('[data-save]').addEventListener('click', async (ev) => { const btn = ev.currentTarget;
      const r = UI.rules;
      const data = UI.validate(form, { ...(emp ? {} : { employee_id: [r.required('Pilih karyawan')], date: [r.required()] }), status: [r.required()], reason: [r.required('Alasan koreksi wajib diisi'), r.min(5)],
        check_out: [(v, d) => (v && d.check_in && v <= d.check_in ? 'Harus setelah jam check-in' : null)] });
      if (!data) return;
      const ok = await UI.submit(btn, form, async () => {
        if (request) return API.attendance.resolveCorrection(request.id, 'approve', { status: data.status, check_in: data.check_in || null, check_out: data.check_out || null, notes: data.reason });
        const payload = { status: data.status, check_in: data.check_in || null, check_out: data.check_out || null, reason: data.reason, employee_id: emp ? emp.id : data.employee_id, date: emp ? date : data.date };
        let targetId = rec ? rec.id : null;
        if (!targetId) { const existing = await API.attendance.list({ employee_id: payload.employee_id, date: payload.date }); targetId = existing[0] ? existing[0].id : null; }
        return API.attendance.correct(targetId, payload);
      });
      if (ok) { UI.toast('Koreksi tersimpan dan tercatat di audit log.', 'success'); m.close(); refreshReqCount(); render(); }
    });
  }

  /* ---------- Reconciliation ---------- */
  $('[data-reconcile]').addEventListener('click', () => {
    const def = Fmt.addDays(today, -1);
    const m = UI.modal({ title: 'Rekonsiliasi Absensi', subtitle: 'Tandai karyawan tanpa check-in dan tanpa izin sebagai Absen', size: 'lg',
      body: `<div class="alert alert-info mb-4">${icon('info')}<div>Karyawan <b>tidak otomatis</b> dianggap absen hanya karena belum check-in. Pilih tanggal yang sudah lewat, periksa daftarnya, lalu konfirmasi. Karyawan dengan izin pending sebaiknya diputuskan dulu.</div></div>
        <div class="field" style="max-width:240px"><label class="label" for="rc-date">Tanggal</label><input id="rc-date" type="date" class="input" value="${def}" max="${Fmt.addDays(today, -1)}"></div><div class="mt-4" data-list></div>`,
      footer: `<button class="btn btn-outline" data-close>Batal</button><button class="btn btn-danger" data-go disabled>${icon('user-x')}Tandai Absen</button>` });
    const list = $('[data-list]', m.el), go = $('[data-go]', m.el);
    async function preview() {
      list.innerHTML = UI.loading(3); go.disabled = true;
      try {
        const r = await API.attendance.reconcilePreview($('#rc-date', m.el).value);
        if (!r.is_work_day) { list.innerHTML = UI.empty('Bukan hari kerja', 'Tanggal ini bukan hari kerja sesuai pengaturan.', 'calendar'); return; }
        if (!r.candidates.length) { list.innerHTML = UI.empty('Semua sudah tercatat', 'Tidak ada karyawan yang perlu direkonsiliasi pada tanggal ini.', 'check-circle'); return; }
        list.innerHTML = `<div class="list">${r.candidates.map((c) => `<label class="list-item" style="cursor:pointer"><input type="checkbox" class="check" data-emp="${c.employee.id}" ${c.pending_leave ? '' : 'checked'}>${UI.person(c.employee)}${c.pending_leave ? '<span class="badge badge-pending">Izin pending</span>' : ''}</label>`).join('')}</div>`;
        go.disabled = false;
      } catch (e) { UI.errorState(list, e, preview); }
    }
    $('#rc-date', m.el).addEventListener('change', preview);
    go.addEventListener('click', async () => {
      const ids = $$('[data-emp]:checked', m.el).map((c) => c.dataset.emp);
      if (!ids.length) return UI.toast('Pilih minimal satu karyawan', 'warning');
      const ok = await UI.submit(go, null, () => API.attendance.reconcile($('#rc-date', m.el).value, ids));
      if (ok) { UI.toast(`${ok.count} karyawan ditandai Absen.`, 'success'); m.close(); render(); }
    });
    preview();
  });
  $('[data-manual]').addEventListener('click', () => openCorrection(null, null, today));

  try { await init(); } catch (e) { UI.errorState($('[data-panel]'), e, () => location.reload()); }
})();
