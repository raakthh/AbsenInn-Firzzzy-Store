/* AbsenInn — Owner: Employee Detail */
(async function () {
  await Layout.init({ role: 'owner', page: 'employees', title: 'Employee Detail' });
  const { icon, esc, $ } = UI;
  const el = $('#content');
  const id = UI.qs('id');
  if (!id) { el.innerHTML = UI.empty('Karyawan tidak dipilih', 'Buka halaman ini dari daftar karyawan.', 'users', `<a class="btn btn-primary mt-3" href="${Auth.root()}owner/employees.html">Ke daftar karyawan</a>`); return; }

  let emp, att, leaves, tasks, payroll, balance;
  async function load() {
    el.innerHTML = UI.loading(10);
    try {
      [emp, att, leaves, tasks, payroll, balance] = await Promise.all([API.employees.get(id), API.attendance.list({ employee_id: id }), API.leave.list({ employee_id: id }), API.tasks.list({ assignee_id: id }), API.payroll.employeeItems(id), API.leave.balance(id)]);
      render();
    } catch (e) { UI.errorState(el, e, load); }
  }

  function render() {
    const monthStart = Fmt.today().slice(0, 7) + '-01';
    const a30 = Metrics.summarize(att.filter((r) => r.date >= Fmt.addDays(Fmt.today(), -30)));
    const t = Metrics.taskSummary(tasks);
    const score = Metrics.productivity(a30.attendanceRate, a30.punctualityRate, t.completionRate);
    const cfg = emp.salary_config || { allowances: [] };
    el.innerHTML = `
      ${Layout.pageHeader({ title: emp.full_name, crumbs: [['Employees', 'owner/employees.html'], [emp.full_name]],
        actions: `<button class="btn btn-outline" data-toggle>${icon(emp.employment_status === 'active' ? 'user-x' : 'user-check')}${emp.employment_status === 'active' ? 'Nonaktifkan' : 'Aktifkan'}</button><button class="btn btn-primary" data-edit>${icon('pencil')}Edit</button>` })}
      <div class="card"><div class="profile-cover"></div><div class="profile-head-wrap"><div class="profile-head">${UI.avatar(emp, 'xl')}
        <div class="grow" style="padding-top:36px"><div class="flex items-center gap-2 wrap"><h2>${esc(emp.full_name)}</h2>${UI.badge(emp.employment_status)}</div>
        <div class="text-2 mt-1">${esc(emp.position)} · <span class="mono">${esc(emp.employee_code)}</span> · Bergabung ${Fmt.date(emp.join_date)}</div></div>
        <div class="flex gap-4 wrap" style="padding-top:36px">${[['Kehadiran 30h', Fmt.percent(a30.attendanceRate)], ['Tepat waktu', Fmt.percent(a30.punctualityRate)], ['Tugas selesai', Fmt.percent(t.completionRate)], ['Skor', score]].map(([l, v]) => `<div><div class="text-xs text-3">${l}</div><div class="fw-700 text-lg">${v}</div></div>`).join('')}</div>
      </div></div>
      <div class="tabs" style="padding:0 20px" role="tablist">${[['overview', 'Ringkasan'], ['attendance', 'Absensi'], ['leave', 'Izin'], ['tasks', 'Tugas'], ['payroll', 'Payroll']].map(([k, l], i) => `<button class="tab ${i ? '' : 'is-active'}" data-tab="${k}" role="tab">${l}</button>`).join('')}</div></div>
      <div class="mt-6" data-panel></div>`;
    $('[data-edit]').addEventListener('click', () => EmployeeForm.open(emp, load));
    $('[data-toggle]').addEventListener('click', () => EmployeeForm.toggleStatus(emp, load));
    UI.tabs(el, (k) => { $('[data-panel]').onclick = null; panels[k](); });

    function panelEl() { return $('[data-panel]'); }
    var panels = {
      overview() {
        panelEl().innerHTML = `<div class="grid grid-2">
          <div class="card"><div class="card-header"><div class="card-title">Informasi Personal</div></div><div class="card-body"><dl class="kv">
            <dt>Email</dt><dd>${esc(emp.email)}</dd><dt>Telepon</dt><dd>${esc(emp.phone || '—')}</dd><dt>Alamat</dt><dd>${esc(emp.address || '—')}</dd><dt>Akun login</dt><dd>${emp.user_id ? UI.badge('active', 'Terhubung') : '<span class="text-3">Belum dibuat</span>'}</dd></dl></div></div>
          <div class="card"><div class="card-header"><div class="card-title">Informasi Pekerjaan</div></div><div class="card-body"><dl class="kv">
            <dt>Jabatan</dt><dd>${esc(emp.position)}</dd><dt>Tipe</dt><dd>${esc(emp.employment_type || '—')}</dd><dt>Tanggal bergabung</dt><dd>${Fmt.date(emp.join_date)}</dd><dt>${balance.enabled === false ? 'Izin tahun ini' : 'Saldo cuti tahunan'}</dt><dd>${balance.enabled === false ? `${balance.taken_days || 0} hari` : `${balance.remaining} / ${balance.quota} hari`}</dd></dl></div></div>
          <div class="card"><div class="card-header"><div><div class="card-title">Ringkasan Performa</div><div class="card-subtitle">30 hari terakhir · skor = 40% kehadiran + 30% ketepatan waktu + 30% penyelesaian tugas</div></div></div><div class="card-body"><div class="chart-box sm" data-perf-chart></div></div></div>
          <div class="card"><div class="card-header"><div class="card-title">Riwayat Kepegawaian</div></div><div class="card-body"><div class="timeline">${[...emp.history].reverse().map((h) => `<div class="tl-item"><span class="tl-dot"></span><div><div class="tl-title">${esc(h.event)}</div><div class="tl-sub">${Fmt.date(h.date)}</div></div></div>`).join('')}</div></div></div>
        </div>`;
        const months = Metrics.lastMonths(4); const mon = Metrics.monthly(att, months);
        Charts.bar($('[data-perf-chart]'), { labels: months.map((k) => Fmt.monthLabel(k, true)), yMax: 100, yFormat: (v) => v + '%',
          datasets: [{ label: 'Kehadiran', data: mon.map((x) => Math.round(x.attendanceRate)) }, { label: 'Tepat waktu', data: mon.map((x) => Math.round(x.punctualityRate)), color: Charts.BRAND.mint }] });
      },
      attendance() {
        panelEl().innerHTML = '<div class="card" data-t></div>';
        UI.table($('[data-t]'), { rows: att, pageSize: 10, emptyTitle: 'Belum ada data absensi', columns: [
          { label: 'Tanggal', render: (r) => `${Fmt.date(r.date)}<div class="text-xs text-3">${Fmt.dayName(r.date)}</div>` },
          { label: 'Check-in', render: (r) => `<span class="mono">${Fmt.time(r.check_in_at)}</span>` }, { label: 'Check-out', render: (r) => `<span class="mono">${Fmt.time(r.check_out_at)}</span>` },
          { label: 'Durasi', render: (r) => Fmt.minutesToHM(r.work_minutes) }, { label: 'Lokasi', render: (r) => (r.location_status ? UI.badge(r.location_status) : '—') },
          { label: 'Status', render: (r) => UI.badge(r.status) }, { label: 'Catatan', render: (r) => `<span class="text-sm text-2">${esc(r.notes || '')}</span>` }] });
      },
      leave() {
        panelEl().innerHTML = '<div class="card" data-t></div>';
        UI.table($('[data-t]'), { rows: leaves, emptyTitle: 'Belum ada pengajuan izin', emptyIcon: 'file-text', columns: [
          { label: 'Jenis', render: (l) => esc(l.leave_type.name) }, { label: 'Tanggal', render: (l) => `${Fmt.date(l.start_date)}${l.end_date !== l.start_date ? ' – ' + Fmt.date(l.end_date) : ''}` },
          { label: 'Durasi', render: (l) => `${String(l.days).replace('.', ',')} hari` }, { label: 'Alasan', render: (l) => `<span class="text-2">${esc(l.reason)}</span>` },
          { label: 'Status', render: (l) => UI.badge(l.status) }, { label: 'Catatan owner', render: (l) => `<span class="text-sm text-2">${esc(l.owner_notes || '—')}</span>` }] });
      },
      tasks() {
        panelEl().innerHTML = '<div class="card" data-t></div>';
        UI.table($('[data-t]'), { rows: tasks, emptyTitle: 'Belum ada tugas', emptyIcon: 'clipboard-list', columns: [
          { label: 'Tugas', render: (x) => `<div class="fw-600">${esc(x.title)}</div><div class="text-xs text-3 truncate" style="max-width:320px">${esc(x.description)}</div>` },
          { label: 'Prioritas', render: (x) => UI.priority(x.priority) }, { label: 'Deadline', render: (x) => Fmt.date(x.deadline) },
          { label: 'Progress', render: (x) => `<div class="progress" style="width:90px"><div class="progress-bar ${x.progress === 100 ? 'is-success' : ''}" style="width:${x.progress}%"></div></div><div class="text-xs text-3 mt-1">${x.progress}%</div>` },
          { label: 'Status', render: (x) => UI.badge(x.status_display) }] });
      },
      payroll() {
        panelEl().innerHTML = `<div class="grid grid-side-main">
          <div class="card"><div class="card-header"><div class="card-title">Konfigurasi Gaji</div><a class="card-link" href="${Auth.root()}owner/payroll.html#config">Ubah ${icon('arrow-right')}</a></div><div class="card-body"><dl class="kv">
            <dt>Gaji pokok</dt><dd>${Fmt.rupiah(cfg.basic_salary)}</dd>${cfg.allowances.map((a) => `<dt>${esc(a.name)}</dt><dd>${Fmt.rupiah(a.amount)}</dd>`).join('')}<dt>Tarif lembur</dt><dd>${Fmt.rupiah(cfg.overtime_rate_per_hour)}/jam</dd></dl>
            <div class="alert alert-primary mt-4">${icon('lock')}<div>Informasi gaji hanya terlihat oleh owner dan karyawan yang bersangkutan.</div></div></div></div>
          <div class="card" data-t></div></div>`;
        UI.table($('[data-t]'), { rows: payroll, emptyTitle: 'Belum ada payroll', emptyIcon: 'wallet', columns: [
          { label: 'Periode', render: (i) => Fmt.monthLabel(i.period.period_key) }, { label: 'Gaji bersih', render: (i) => `<b>${Fmt.rupiah(i.net_salary)}</b>` },
          { label: 'Status', render: (i) => UI.badge(i.status === 'paid' ? 'paid' : i.period.status_display) }, { label: 'Dibayar', render: (i) => (i.payment ? Fmt.date(i.payment.paid_at) : '—') },
          { label: '', cls: 'col-actions', render: (i) => `<button class="btn btn-outline btn-sm" data-slip="${i.id}">${icon('receipt', 15)}Slip</button>` }] });
        panelEl().onclick = ((e) => { const b = e.target.closest('[data-slip]'); if (b) Payslip.open(b.dataset.slip); });
      },
    };
    panels.overview();
  }
  load();
})();
