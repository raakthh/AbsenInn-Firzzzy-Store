/* AbsenInn — Employee: My Dashboard */
(async function () {
  const s = await Layout.init({ role: 'employee', page: 'dashboard', title: 'My Dashboard' });
  const { icon, esc, $ } = UI;
  const root = Auth.root();
  const el = $('#content');

  el.innerHTML = `
    <div class="flex items-center justify-between gap-3 wrap mb-4"><div class="flex items-center gap-3">${UI.avatar(s, 'lg')}<div><h1 style="font-size:1.4rem">Hi, ${esc(s.full_name.split(' ')[0])}! 👋</h1><p class="text-2">${Fmt.greeting()} · ${Fmt.date(Fmt.today(), 'long')}</p></div></div></div>
    <div class="grid grid-main-side">
      <div data-today></div>
      <div class="card"><div class="card-header"><div class="card-title">Today's Schedule</div></div><div class="card-body" data-schedule>${UI.loading(3)}</div></div>
    </div>
    <div class="quick-grid mt-6" data-quick>${Array.from({ length: 4 }, () => `<div class="quick">${UI.loading(2)}</div>`).join('')}</div>
    <div class="grid grid-2 mt-6">
      <div class="card"><div class="card-header"><div class="card-title">My Tasks</div><a class="card-link" href="${root}employee/tasks.html">Lihat semua ${icon('arrow-right')}</a></div><div class="card-body" data-tasks></div></div>
      <div class="card"><div class="card-header"><div class="card-title">Latest Payslip</div><a class="card-link" href="${root}employee/payslip.html">Riwayat ${icon('arrow-right')}</a></div><div class="card-body" data-payslip></div></div>
      <div class="card"><div class="card-header"><div class="card-title">Pengajuan Izin</div><a class="card-link" href="${root}employee/leave.html">Ajukan ${icon('arrow-right')}</a></div><div class="card-body" data-leave></div></div>
      <div class="card"><div class="card-header"><div class="card-title">Pengumuman</div><a class="card-link" href="${root}employee/announcements.html">Semua ${icon('arrow-right')}</a></div><div class="card-body" data-ann></div></div>
    </div>
    <div class="card mt-6"><div class="card-header"><div class="card-title">Notifikasi Terbaru</div><a class="card-link" href="${root}employee/notifications.html">Semua ${icon('arrow-right')}</a></div><div class="card-body" data-notifs></div></div>`;

  async function loadRest() {
    const [settings, tasks, leaves, bal, slips, notifs, anns] = await Promise.all([API.settings.get(), API.tasks.list({}), API.leave.list({}), API.leave.balance(), API.payroll.myPayslips(), API.notifications.list(), API.announcements.list()]);
    const w = settings.work;
    const days = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];
    $('[data-schedule]').innerHTML = `<div class="flex items-center gap-3"><span class="stat-icon tone-primary">${icon('clock')}</span><div><div class="stat-value" style="font-size:1.35rem">${w.start} – ${w.end}</div><div class="text-xs text-3">Jam kerja · toleransi ${w.late_tolerance_min} menit</div></div></div>
      <div class="list mt-4"><div class="list-item"><span class="text-3 text-sm grow">Istirahat</span><b class="text-sm">${w.break_start} – ${w.break_end}</b></div><div class="list-item"><span class="text-3 text-sm grow">Hari kerja</span><b class="text-sm">${w.working_days.slice().sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)).map((d) => days[d]).join(', ')}</b></div>
      <div class="list-item"><span class="text-3 text-sm grow">Lokasi kerja</span><b class="text-sm">${esc(settings.attendance.location.name || 'Belum diatur')}</b></div></div>`;
    const active = tasks.filter((t) => t.status !== 'completed');
    const latest = slips[0];
    const unread = notifs.filter((n) => !n.read).length;
    const q = (href, ic, tone, v, l) => `<a class="quick" href="${root}${href}"><span class="stat-icon tone-${tone}">${icon(ic)}</span><b>${v}</b><small>${l}</small></a>`;
    $('[data-quick]').innerHTML = q('employee/tasks.html', 'clipboard-list', 'primary', active.length, 'Tugas aktif') + (bal.enabled === false ? q('employee/leave.html', 'plane', 'mint', `${String(bal.taken_days || 0).replace('.', ',')} hari`, 'Izin tahun ini') : q('employee/leave.html', 'plane', 'mint', `${String(bal.remaining).replace('.', ',')} hari`, 'Saldo cuti')) + q('employee/payslip.html', 'receipt', 'info', latest ? Fmt.monthLabel(latest.period.period_key, true) : '—', 'Slip terbaru') + q('employee/notifications.html', 'bell', 'pending', unread, 'Belum dibaca');

    $('[data-tasks]').innerHTML = active.slice(0, 3).map((t) => `<div class="list-item"><span class="stat-icon tone-${t.status_display === 'overdue' ? 'danger' : 'pending'}" style="width:34px;height:34px">${icon('clipboard-list', 16)}</span><div class="list-item-main"><div class="list-item-title truncate">${esc(t.title)}</div><div class="list-item-sub">Deadline ${Fmt.date(t.deadline, 'short')} · ${UI.priority(t.priority)}</div></div>${UI.badge(t.status_display)}</div>`).join('') || UI.empty('Tidak ada tugas aktif', 'Kerja bagus! 🎉', 'check-circle');
    $('[data-payslip]').innerHTML = latest ? `<div class="flex items-center justify-between"><div><div class="text-sm text-3">${Fmt.monthLabel(latest.period.period_key)}</div><div class="stat-value mt-1">${Fmt.rupiah(latest.net_salary)}</div></div>${UI.badge(latest.status === 'paid' ? 'paid' : latest.period.status_display)}</div>
      <div class="text-xs text-3 mt-2">${latest.payment ? `Dibayar ${Fmt.date(latest.payment.paid_at)}` : `Jadwal bayar ${Fmt.date(latest.period.payment_date)}`}</div><button class="btn btn-secondary btn-block mt-4" data-slip="${latest.id}">${icon('receipt')}Lihat & Unduh Slip</button>` : UI.empty('Belum ada slip gaji', 'Slip muncul setelah payroll disetujui owner.', 'receipt');
    const pend = leaves.filter((l) => l.status === 'pending');
    $('[data-leave]').innerHTML = `<div class="flex items-center justify-between mb-4"><div>${bal.enabled === false ? `<div class="text-sm text-3">Izin disetujui tahun ini</div><div class="fw-700 text-lg">${String(bal.taken_days || 0).replace('.', ',')} hari</div><div class="text-xs text-3">Izin tidak dibayar memotong gaji per hari</div>` : `<div class="text-sm text-3">Saldo cuti tahunan</div><div class="fw-700 text-lg">${String(bal.remaining).replace('.', ',')} / ${bal.quota} hari</div>`}</div><a class="btn btn-primary btn-sm" href="${root}employee/leave.html?new=1">${icon('plus')}Ajukan Izin</a></div>
      ${leaves.slice(0, 3).map((l) => `<div class="list-item"><div class="list-item-main"><div class="list-item-title">${esc(l.leave_type.name)}</div><div class="list-item-sub">${Fmt.date(l.start_date, 'short')}${l.end_date !== l.start_date ? ' – ' + Fmt.date(l.end_date, 'short') : ''}</div></div>${UI.badge(l.status)}</div>`).join('') || '<p class="text-sm text-3">Belum ada pengajuan.</p>'}
      ${pend.length ? `<p class="text-xs text-pending mt-2">${pend.length} pengajuan menunggu persetujuan.</p>` : ''}`;
    $('[data-ann]').innerHTML = anns.slice(0, 2).map((a) => `<div class="list-item" style="align-items:flex-start"><span class="stat-icon tone-mint" style="width:34px;height:34px">${icon('megaphone', 16)}</span><div class="list-item-main"><div class="list-item-title">${esc(a.title)}</div><div class="text-sm text-2 mt-1">${esc(a.body.length > 110 ? a.body.slice(0, 110) + '…' : a.body)}</div><div class="list-item-sub mt-1">${Fmt.relative(a.created_at)}</div></div></div>`).join('') || UI.empty('Belum ada pengumuman', '', 'megaphone');
    const nEl = $('[data-notifs]');
    nEl.innerHTML = notifs.length ? `<div style="margin:0 -20px">${notifs.slice(0, 4).map(Layout.notifRow).join('')}</div>` : UI.empty('Tidak ada notifikasi', '', 'bell');
    Layout.bindNotifRows(nEl);
    const sb = el.querySelector('[data-slip]'); if (sb) sb.addEventListener('click', () => Payslip.open(sb.dataset.slip));
  }

  AttendanceFlow.renderToday($('[data-today]'), () => Layout.refreshBadges());
  try { await loadRest(); } catch (e) { UI.errorState($('[data-tasks]'), e, () => location.reload()); }
})();
