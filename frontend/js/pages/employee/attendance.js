/* AbsenInn — Employee: My Attendance */
(async function () {
  await Layout.init({ role: 'employee', page: 'attendance', title: 'My Attendance' });
  const { icon, esc, $ } = UI;
  const el = $('#content');
  const today = Fmt.today();
  let month = today.slice(0, 7), view = 'calendar';

  el.innerHTML = `${Layout.pageHeader({ title: 'My Attendance', subtitle: 'Check-in/out dengan selfie & GPS, lihat riwayat dan ajukan koreksi.', actions: `<button class="btn btn-outline" data-req>${icon('history')}Ajukan Koreksi</button>` })}
    <div class="grid grid-main-side"><div data-today></div><div class="card"><div class="card-header"><div class="card-title">Ringkasan Bulan Ini</div></div><div class="card-body" data-sum>${UI.loading(4)}</div></div></div>
    <div class="card mt-6"><div class="table-toolbar"><button class="btn btn-outline btn-sm btn-icon" data-prev aria-label="Bulan sebelumnya">${icon('chevron-left')}</button><b data-month style="min-width:130px;text-align:center"></b><button class="btn btn-outline btn-sm btn-icon" data-next aria-label="Bulan berikutnya">${icon('chevron-right')}</button>
      <div class="segmented" style="margin-left:auto" role="group"><button data-view="calendar" class="is-active">${icon('calendar-days', 15)} Kalender</button><button data-view="list">${icon('list', 15)} Riwayat</button></div></div><div data-body>${UI.loading(6)}</div></div>
    <div class="card mt-6"><div class="card-header"><div class="card-title">Permintaan Koreksi Saya</div></div><div data-reqs></div></div>`;

  async function loadMonth() {
    $('[data-month]').textContent = Fmt.monthLabel(month);
    $('[data-next]').disabled = month >= today.slice(0, 7);
    const [y, m] = month.split('-').map(Number);
    const from = `${month}-01`, to = Fmt.toISODate(new Date(y, m, 0));
    const [recs, settings] = await Promise.all([API.attendance.list({ from, to }), API.settings.get()]);
    const s = Metrics.summarize(recs);
    if (month === today.slice(0, 7)) $('[data-sum]').innerHTML = `<div class="grid grid-2" style="gap:12px">${[['Hadir', s.attended, 'success'], ['Terlambat', s.counts.late, 'pending'], ['Izin/Cuti', s.leave, 'primary'], ['Absen', s.counts.absent, 'danger']].map(([l, v, t]) => `<div class="card stat" style="padding:14px;box-shadow:none"><span class="badge badge-${t} no-dot" style="align-self:flex-start">${l}</span><div class="stat-value">${v}</div></div>`).join('')}</div>
      <div class="list mt-4"><div class="list-item"><span class="grow text-sm text-3">Tingkat kehadiran</span><b>${Fmt.percent(s.attendanceRate, 1)}</b></div><div class="list-item"><span class="grow text-sm text-3">Tepat waktu</span><b>${Fmt.percent(s.punctualityRate, 1)}</b></div><div class="list-item"><span class="grow text-sm text-3">Total jam kerja</span><b>${Fmt.minutesToHM(s.totalMinutes)}</b></div></div>`;
    const body = $('[data-body]');
    if (view === 'calendar') {
      const lead = (new Date(y, m - 1, 1).getDay() + 6) % 7, days = new Date(y, m, 0).getDate();
      const color = { present: 'var(--success-500)', late: 'var(--pending-500)', early_leave: 'var(--pending-500)', sick: 'var(--info-500)', paid_leave: 'var(--primary-400)', unpaid_leave: 'var(--slate-400)', absent: 'var(--danger-500)', needs_review: 'var(--pending-500)' };
      let cells = ''; for (let i = 0; i < lead; i += 1) cells += '<div class="cal-day is-out"></div>';
      for (let d = 1; d <= days; d += 1) {
        const date = `${month}-${Fmt.pad(d)}`; const r = recs.find((x) => x.date === date);
        const off = !settings.work.working_days.includes(Fmt.parseDate(date).getDay());
        cells += `<div class="cal-day ${date === today ? 'is-today' : ''}" title="${r ? UI.statusLabel(r.status) : off ? 'Libur' : ''}" ${r ? `data-rec="${r.id}" style="cursor:pointer"` : ''}><span class="cal-num" style="${off ? 'color:var(--slate-400)' : ''}">${d}</span>${r ? `<span class="cal-dot" style="background:${color[r.status]}"></span><span class="text-xs mono">${r.check_in_at ? Fmt.time(r.check_in_at) : UI.statusLabel(r.status).split(' ')[0]}</span>` : ''}</div>`;
      }
      body.innerHTML = `<div class="card-body"><div class="cal">${['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min'].map((x) => `<div class="cal-head">${x}</div>`).join('')}${cells}</div>
        <div class="legend mt-4">${[['present', 'Hadir'], ['late', 'Terlambat'], ['sick', 'Sakit'], ['paid_leave', 'Cuti/Izin'], ['absent', 'Absen']].map(([k, l]) => `<span><i style="background:${color[k]}"></i>${l}</span>`).join('')}</div></div>`;
      body.onclick = (e) => { const c = e.target.closest('[data-rec]'); if (c) detail(recs.find((r) => r.id === c.dataset.rec)); };
    } else {
      body.onclick = null;
      UI.table(body, { rows: recs, pageSize: 10, emptyTitle: 'Belum ada absensi bulan ini', emptyIcon: 'calendar-check', onRow: detail, columns: [
        { label: 'Tanggal', render: (r) => `${Fmt.date(r.date)}<div class="text-xs text-3">${Fmt.dayName(r.date)}</div>` },
        { label: 'Check-in', render: (r) => `<span class="mono">${Fmt.time(r.check_in_at)}</span>` }, { label: 'Check-out', render: (r) => `<span class="mono">${Fmt.time(r.check_out_at)}</span>` },
        { label: 'Jam kerja', render: (r) => Fmt.minutesToHM(r.work_minutes) }, { label: 'Lokasi', render: (r) => (r.location_status ? `${UI.badge(r.location_status)}<div class="text-xs text-3 mt-1">${Fmt.distance(r.distance_in_m)}</div>` : '—') },
        { label: 'Status', render: (r) => UI.badge(r.status) }] });
    }
  }

  function detail(r) {
    const mem = window.__demoSelfies || {};
    const phId = (k) => `sf-${r.id}-${k}`;
    const selfie = (k) => (mem[`${r.id}:${k}`] ? `<img class="selfie-img" src="${mem[`${r.id}:${k}`]}" alt="Selfie">`
      : r[`selfie_${k}_path`] ? `<div id="${phId(k)}">${UI.selfiePlaceholder(API.isDemo() ? 'Foto tersimpan aman (placeholder demo)' : 'Memuat foto…')}</div>` : `<div class="selfie-ph">${icon('camera-off')}<small>Tidak ada</small></div>`);
    const m = UI.modal({ title: 'Detail Absensi', subtitle: Fmt.date(r.date, 'long'), body: `<div class="flex gap-2 mb-4">${UI.badge(r.status)}${r.location_status ? UI.badge(r.location_status) : ''}</div>
      ${r.check_in_at ? `<div class="grid grid-2" style="gap:12px"><div><div class="text-sm fw-600 mb-4">Check-in · ${Fmt.time(r.check_in_at)}</div>${selfie('in')}</div><div><div class="text-sm fw-600 mb-4">Check-out · ${Fmt.time(r.check_out_at)}</div>${selfie('out')}</div></div>` : ''}
      <dl class="kv mt-4"><dt>Jam kerja</dt><dd>${Fmt.minutesToHM(r.work_minutes)}</dd><dt>Jarak dari lokasi kerja</dt><dd>${Fmt.distance(r.distance_in_m)}</dd><dt>Akurasi GPS</dt><dd>${r.accuracy_in_m != null ? '±' + r.accuracy_in_m + ' m' : '—'}</dd><dt>Catatan</dt><dd>${esc(r.notes || '—')}</dd></dl>`, footer: '<button class="btn btn-outline" data-close>Tutup</button>' });
    /* Production: selfies live in a private bucket → short-lived signed URL from Django. */
    if (!API.isDemo() && (r.selfie_in_path || r.selfie_out_path)) {
      API.attendance.evidence(r.id).then((ev) => {
        [['in', 'check_in'], ['out', 'check_out']].forEach(([k, side]) => {
          const box = m.el.querySelector('#' + CSS.escape(phId(k)));
          if (box) box.innerHTML = ev[side].selfie_url ? `<img class="selfie-img" src="${ev[side].selfie_url}" alt="Selfie ${k === 'in' ? 'check-in' : 'check-out'}">` : `<div class="selfie-ph">${icon('camera-off')}<small>Foto tidak tersedia</small></div>`;
        });
      }).catch(() => {});
    }
  }

  async function loadReqs() {
    const rows = await API.attendance.correctionRequests();
    UI.table($('[data-reqs]'), { rows, emptyTitle: 'Belum ada permintaan koreksi', emptyText: 'Lupa check-in/out? Ajukan koreksi ke owner.', emptyIcon: 'history', columns: [
      { label: 'Tanggal', render: (c) => Fmt.date(c.date) }, { label: 'Jam diajukan', render: (c) => `<span class="mono">${c.requested_check_in || '—'} – ${c.requested_check_out || '—'}</span>` },
      { label: 'Alasan', render: (c) => `<span class="text-sm text-2">${esc(c.reason)}</span>` }, { label: 'Status', render: (c) => UI.badge(c.status) }] });
  }

  $('[data-req]').addEventListener('click', () => {
    const m = UI.modal({ title: 'Ajukan Koreksi Absensi', subtitle: 'Owner akan meninjau dan memutuskan permintaan Anda.',
      body: `<form class="form-grid" novalidate data-f>${UI.field({ name: 'date', label: 'Tanggal', type: 'date', required: true, value: today, attrs: `max="${today}"`, span: true })}${UI.field({ name: 'check_in', label: 'Jam check-in sebenarnya', type: 'time' })}${UI.field({ name: 'check_out', label: 'Jam check-out sebenarnya', type: 'time' })}${UI.field({ name: 'reason', label: 'Alasan', type: 'textarea', required: true, span: true, placeholder: 'Mis. lupa check-out karena baterai habis' })}</form>`,
      footer: `<button class="btn btn-outline" data-close>Batal</button><button class="btn btn-primary" data-ok>${icon('send')}Kirim</button>` });
    const form = m.el.querySelector('[data-f]');
    m.el.querySelector('[data-ok]').addEventListener('click', async (e) => { const btn = e.currentTarget;
      const d = UI.validate(form, { date: [UI.rules.required()], reason: [UI.rules.required(), UI.rules.min(10, 'Jelaskan alasan (min. 10 karakter)')], check_out: [(v, x) => (v && x.check_in && v <= x.check_in ? 'Harus setelah jam check-in' : null)] }); if (!d) return;
      const r = await UI.submit(btn, form, () => API.attendance.requestCorrection(d));
      if (r) { UI.toast('Permintaan koreksi terkirim ke owner.', 'success'); m.close(); loadReqs(); }
    });
  });
  $('[data-prev]').addEventListener('click', () => { const [y, m] = month.split('-').map(Number); month = Fmt.toISODate(new Date(y, m - 2, 1)).slice(0, 7); loadMonth(); });
  $('[data-next]').addEventListener('click', () => { const [y, m] = month.split('-').map(Number); month = Fmt.toISODate(new Date(y, m, 1)).slice(0, 7); loadMonth(); });
  el.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', () => { view = b.dataset.view; el.querySelectorAll('[data-view]').forEach((x) => x.classList.toggle('is-active', x === b)); loadMonth(); }));

  AttendanceFlow.renderToday($('[data-today]'), () => loadMonth());
  try { await Promise.all([loadMonth(), loadReqs()]); } catch (e) { UI.errorState($('[data-body]'), e, () => location.reload()); }
})();
