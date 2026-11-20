/* AbsenInn — Owner Dashboard */
(async function () {
  const s = await Layout.init({ role: 'owner', page: 'dashboard', title: 'Dashboard' });
  const { icon, esc, $ } = UI;
  const root = Auth.root();
  const el = $('#content');
  const today = Fmt.today();

  el.innerHTML = `
    <section class="hero">
      <div class="flex justify-between items-center wrap gap-4">
        <div><span class="hero-date">${icon('calendar')}${Fmt.date(today, 'long')}</span>
          <h1 class="mt-3">${Fmt.greeting()}, ${esc(s.full_name.split(' ')[0])} 👋</h1>
          <p class="mt-1" data-hero-sub>Memuat ringkasan hari ini…</p></div>
        <div class="flex gap-2 wrap"><a class="btn btn-light" href="${root}owner/attendance.html">${icon('calendar-check')}Pantau Absensi</a><a class="btn btn-glass" href="${root}owner/tasks.html?new=1">${icon('plus')}Buat Tugas</a></div>
      </div>
    </section>
    <div class="grid grid-4 stats-grid mt-6" data-stats>${Array.from({ length: 4 }, () => `<div class="card">${UI.loading(3)}</div>`).join('')}</div>
    <div class="grid grid-main-side mt-6">
      <div class="card"><div class="card-header"><div><div class="card-title">Attendance Trend</div><div class="card-subtitle" data-trend-sub>7 hari kerja terakhir</div></div><a class="card-link" href="${root}owner/analytics.html">Analytics ${icon('arrow-right')}</a></div><div class="card-body"><div class="chart-box" data-trend-chart></div></div></div>
      <div class="card"><div class="card-header"><div><div class="card-title">Kehadiran Hari Ini</div><div class="card-subtitle">Employee attendance overview</div></div><a class="card-link" href="${root}owner/attendance.html">Detail ${icon('arrow-right')}</a></div><div class="card-body" data-today></div></div>
    </div>
    <div class="grid grid-3 mt-6">
      <div class="card"><div class="card-header"><div class="card-title">Pengajuan Izin Terbaru</div><a class="card-link" href="${root}owner/leave.html">Lihat semua ${icon('arrow-right')}</a></div><div class="card-body" data-leave></div></div>
      <div class="card"><div class="card-header"><div class="card-title">Payroll Summary</div><a class="card-link" href="${root}owner/payroll.html">Detail ${icon('arrow-right')}</a></div><div class="card-body" data-payroll></div></div>
      <div class="card"><div class="card-header"><div class="card-title">Tugas Mendatang</div><a class="card-link" href="${root}owner/tasks.html">Lihat semua ${icon('arrow-right')}</a></div><div class="card-body" data-tasks></div></div>
    </div>
    <div class="grid grid-2 mt-6">
      <div class="card"><div class="card-header"><div class="card-title">Aktivitas Terbaru</div><span class="text-xs text-3">Audit log</span></div><div class="card-body" data-activity></div></div>
      <div class="card"><div class="card-header"><div class="card-title">Notifikasi</div><a class="card-link" href="${root}owner/notifications.html">Lihat semua ${icon('arrow-right')}</a></div><div class="card-body" data-notifs></div></div>
    </div>`;

  async function loadAll() {
    const monthStart = today.slice(0, 7) + '-01';
    const [emps, mon, recent, pendingLeaves, leaves, tasks, periods, audit, notifs, settings] = await Promise.all([
      API.employees.list({ status: 'active' }), API.attendance.monitoring(today), API.attendance.list({ from: Fmt.addDays(today, -40) }),
      API.leave.list({ status: 'pending' }), API.leave.list({}), API.tasks.list({}), API.payroll.periods(), API.audit.list(8), API.notifications.list(), API.settings.get(),
    ]);
    const wd = settings.work.working_days;
    const rows = mon.rows;
    const count = (st) => rows.filter((r) => r.state === st).length;
    const attendedToday = rows.filter((r) => Metrics.ATTENDED.includes(r.state)).length;
    const late = count('late'), absent = count('absent'), notYet = count('not_checked_in'), onLeave = rows.filter((r) => Metrics.LEAVE.includes(r.state)).length;
    const monthSum = Metrics.summarize(recent.filter((r) => r.date >= monthStart && r.date <= today));
    const curPeriod = periods.find((p) => p.period_key === today.slice(0, 7));

    $('[data-hero-sub]').textContent = mon.is_work_day
      ? `${attendedToday} dari ${rows.length} karyawan sudah hadir · ${pendingLeaves.length} pengajuan izin menunggu keputusan Anda.`
      : `Hari ini bukan hari kerja sesuai pengaturan · ${pendingLeaves.length} pengajuan izin menunggu keputusan Anda.`;

    const stat = (ic, tone, value, label, meta, href) => `<a class="card stat" href="${root}${href}" style="color:inherit"><div class="stat-top"><span class="stat-icon tone-${tone}">${icon(ic)}</span>${icon('arrow-up-right', 16, 'text-3')}</div><div><div class="stat-value">${value}</div><div class="stat-label">${label}</div></div><div class="stat-meta">${meta}</div></a>`;
    $('[data-stats]').innerHTML = [
      stat('users', 'primary', emps.length, 'Total Karyawan Aktif', `${Fmt.number(emps.length)} terdaftar di perusahaan`, 'owner/employees.html'),
      stat('user-check', 'success', `${attendedToday}<span class="text-3" style="font-size:1rem">/${rows.length}</span>`, 'Hadir Hari Ini', `${late} terlambat · ${onLeave} izin/cuti`, 'owner/attendance.html'),
      stat('user-x', absent ? 'danger' : 'muted', absent, 'Absen Hari Ini', `${notYet} belum check-in (belum dianggap absen)`, 'owner/attendance.html'),
      stat('file-text', 'pending', pendingLeaves.length, 'Pengajuan Izin Pending', 'Menunggu persetujuan owner', 'owner/leave.html'),
    ].join('');

    // Trend chart
    const trend = Metrics.dailyTrend(recent, Fmt.addDays(today, -13), today, wd).slice(-7);
    $('[data-trend-sub]').innerHTML = `7 hari kerja terakhir · Attendance rate bulan ini <b class="text-primary">${Fmt.percent(monthSum.attendanceRate, 1)}</b>`;
    Charts.line($('[data-trend-chart]'), { labels: trend.map((t) => `${Fmt.dayName(t.date, true)} ${Fmt.parseDate(t.date).getDate()}`),
      datasets: [{ label: 'Hadir tepat waktu', data: trend.map((t) => t.present) }, { label: 'Terlambat', data: trend.map((t) => t.late), color: Charts.BRAND.pending, fill: false }, { label: 'Absen', data: trend.map((t) => t.absent), color: Charts.BRAND.danger, fill: false, borderDash: [4, 4] }] });

    // Today overview
    const rate = rows.length ? Math.round((attendedToday / rows.length) * 100) : 0;
    $('[data-today]').innerHTML = `
      <div class="flex items-center gap-4"><div style="width:96px;height:96px;border-radius:50%;background:conic-gradient(var(--primary-500) ${rate * 3.6}deg, var(--slate-100) 0);display:grid;place-items:center;flex-shrink:0">
        <div style="width:74px;height:74px;border-radius:50%;background:#fff;display:grid;place-items:center;text-align:center"><div><div class="fw-700" style="font-size:1.25rem">${rate}%</div><div class="text-xs text-3">hadir</div></div></div></div>
        <div class="legend" style="flex-direction:column;gap:6px"><span><i style="background:var(--success-500)"></i>Hadir: ${attendedToday - late}</span><span><i style="background:var(--pending-500)"></i>Terlambat: ${late}</span><span><i style="background:var(--primary-300)"></i>Izin/Cuti: ${onLeave}</span><span><i style="background:var(--slate-300)"></i>Belum check-in: ${notYet}</span></div></div>
      <div class="list mt-4">${rows.map((r) => `<div class="list-item">${UI.person(r.employee)}<div class="text-right">${UI.badge(r.state)}<div class="text-xs text-3 mt-1 mono">${r.record && r.record.check_in_at ? Fmt.time(r.record.check_in_at) : '—'}</div></div></div>`).join('') || UI.empty('Belum ada karyawan', '', 'users')}</div>`;

    // Leave
    $('[data-leave]').innerHTML = leaves.slice(0, 4).map((l) => `<div class="list-item">${UI.avatar(l.employee, 'sm')}<div class="list-item-main"><div class="list-item-title truncate">${esc(l.employee.full_name)}</div><div class="list-item-sub">${esc(l.leave_type.name)} · ${Fmt.date(l.start_date, 'short')}${l.days > 1 ? ` (${l.days} hari)` : ''}</div></div>${UI.badge(l.status)}</div>`).join('')
      || UI.empty('Belum ada pengajuan', '', 'file-text');

    // Payroll
    const chartPeriods = [...periods].reverse().slice(-6);
    $('[data-payroll]').innerHTML = curPeriod ? `
      <div class="text-sm text-3">Total payroll ${Fmt.monthLabel(curPeriod.period_key)}</div>
      <div class="flex items-center justify-between mt-1"><div class="stat-value">${Fmt.rupiah(curPeriod.total_net)}</div>${UI.badge(curPeriod.status_display)}</div>
      <div class="text-xs text-3 mt-1">${curPeriod.employees} karyawan · jadwal bayar ${Fmt.date(curPeriod.payment_date)}</div>
      <div class="chart-box sm mt-4" data-pay-chart></div>` : UI.empty('Belum ada periode payroll', '', 'wallet');
    if (curPeriod) Charts.bar($('[data-pay-chart]'), { labels: chartPeriods.map((p) => Fmt.monthLabel(p.period_key, true)), datasets: [{ label: 'Total gaji bersih', data: chartPeriods.map((p) => p.total_net), color: chartPeriods.map((p) => (p.id === curPeriod.id ? Charts.BRAND.primary : Charts.BRAND.blue)) }], yFormat: (v) => Fmt.rupiah(v, { compact: true }) });

    // Tasks
    const upcoming = tasks.filter((t) => t.status !== 'completed').sort((a, b) => a.deadline.localeCompare(b.deadline)).slice(0, 4);
    $('[data-tasks]').innerHTML = upcoming.map((t) => `<div class="list-item"><span class="stat-icon tone-${t.status_display === 'overdue' ? 'danger' : 'pending'}" style="width:34px;height:34px">${icon('clipboard-list', 16)}</span><div class="list-item-main"><div class="list-item-title truncate">${esc(t.title)}</div><div class="list-item-sub">${esc(t.assignee ? t.assignee.full_name : '—')} · ${Fmt.date(t.deadline, 'short')} · ${UI.priority(t.priority)}</div></div>${UI.badge(t.status_display)}</div>`).join('')
      || UI.empty('Tidak ada tugas aktif', '', 'clipboard-list');

    // Activity
    $('[data-activity]').innerHTML = audit.length ? `<div class="timeline">${audit.map((a) => `<div class="tl-item"><span class="tl-dot"></span><div><div class="tl-title">${esc(a.summary)}</div><div class="tl-sub">${esc(a.actor_name)} · ${Fmt.relative(a.created_at)}</div></div></div>`).join('')}</div>` : UI.empty('Belum ada aktivitas', '', 'history');

    // Notifications
    const nEl = $('[data-notifs]');
    nEl.innerHTML = notifs.length ? `<div style="margin:0 -20px">${notifs.slice(0, 5).map(Layout.notifRow).join('')}</div>` : UI.empty('Tidak ada notifikasi', '', 'bell');
    Layout.bindNotifRows(nEl);
  }

  try { await loadAll(); } catch (e) { console.error(e); UI.errorState($('[data-stats]'), e, () => location.reload()); }
})();
