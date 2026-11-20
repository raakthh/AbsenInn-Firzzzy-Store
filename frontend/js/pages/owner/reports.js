/* AbsenInn — Owner: Reports (preview, CSV export, print-to-PDF) */
(async function () {
  await Layout.init({ role: 'owner', page: 'reports', title: 'Reports' });
  const { icon, esc, $ } = UI;
  const el = $('#content');
  const today = Fmt.today();
  const TYPES = {
    employee: ['Employee Report', 'users', 'Data karyawan & status kepegawaian'],
    attendance: ['Attendance Report', 'calendar-check', 'Rekap check-in/out harian'],
    leave: ['Leave Report', 'file-text', 'Pengajuan izin & keputusan'],
    payroll: ['Payroll Report', 'wallet', 'Gaji bersih per periode'],
    task: ['Task Report', 'clipboard-list', 'Tugas, deadline & status'],
    performance: ['Performance Report', 'trending-up', 'Skor kinerja per karyawan'],
  };
  const st = { type: UI.qs('type') || 'attendance', from: today.slice(0, 7) + '-01', to: today, employee: '', search: '' };
  let employees = [], current = { columns: [], rows: [] };

  el.innerHTML = `${Layout.pageHeader({ title: 'Reports', subtitle: 'Buat laporan dengan filter periode & karyawan, lalu ekspor ke CSV atau PDF.' })}
    <div class="grid grid-6" data-types>${Object.entries(TYPES).map(([k, [l, ic, d]]) => `<button class="card stat" data-type="${k}" style="text-align:left;cursor:pointer;border-width:2px" aria-pressed="false"><span class="stat-icon tone-primary">${icon(ic)}</span><div><div class="fw-700">${l}</div><div class="text-xs text-3">${d}</div></div></button>`).join('')}</div>
    <div class="card mt-6"><div class="table-toolbar">
      <label class="text-sm text-3" for="r-from">Dari</label><input id="r-from" type="date" class="input input-sm" data-from value="${st.from}" style="width:auto">
      <label class="text-sm text-3" for="r-to">s/d</label><input id="r-to" type="date" class="input input-sm" data-to value="${st.to}" style="width:auto">
      <select class="select select-sm" data-emp style="width:auto" aria-label="Karyawan"><option value="">Semua karyawan</option></select>
      <div class="input-group">${icon('search')}<input class="input input-sm" data-search placeholder="Cari dalam laporan…"></div>
      <div class="flex gap-2" style="margin-left:auto"><button class="btn btn-outline btn-sm" data-csv>${icon('download', 15)}Export CSV</button><button class="btn btn-primary btn-sm" data-pdf>${icon('printer', 15)}Export PDF</button></div>
    </div><div class="card-body" style="padding-bottom:0"><div class="flex items-center justify-between wrap gap-2"><div><div class="card-title" data-title></div><div class="card-subtitle" data-sub></div></div><div class="flex gap-2 wrap" data-totals></div></div></div><div data-t>${UI.loading(6)}</div></div>`;

  const inRange = (d) => d >= st.from && d <= st.to;
  const byEmp = (id) => !st.employee || id === st.employee;

  async function build() {
    const t = st.type;
    if (t === 'employee') {
      const rows = employees.filter((e) => byEmp(e.id));
      return { rows, totals: [`${rows.length} karyawan`, `${rows.filter((e) => e.employment_status === 'active').length} aktif`], columns: [
        { label: 'ID', key: 'employee_code' }, { label: 'Nama', key: 'full_name' }, { label: 'Email', key: 'email' }, { label: 'Telepon', key: 'phone' }, { label: 'Jabatan', key: 'position' },
        { label: 'Tipe', key: 'employment_type' }, { label: 'Bergabung', key: 'join_date', render: (r) => Fmt.date(r.join_date) }, { label: 'Status', key: 'employment_status', render: (r) => UI.badge(r.employment_status), csv: (r) => UI.statusLabel(r.employment_status) }] };
    }
    if (t === 'attendance') {
      const rows = (await API.attendance.list({ from: st.from, to: st.to })).filter((r) => byEmp(r.employee_id));
      const s = Metrics.summarize(rows);
      return { rows, totals: [`${rows.length} catatan`, `Kehadiran ${Fmt.percent(s.attendanceRate, 1)}`, `${s.counts.late} terlambat`, `${s.counts.absent} absen`], columns: [
        { label: 'Tanggal', key: 'date', render: (r) => Fmt.date(r.date) }, { label: 'Karyawan', csv: (r) => r.employee.full_name, render: (r) => esc(r.employee.full_name) },
        { label: 'Check-in', csv: (r) => Fmt.time(r.check_in_at), render: (r) => Fmt.time(r.check_in_at) }, { label: 'Check-out', csv: (r) => Fmt.time(r.check_out_at), render: (r) => Fmt.time(r.check_out_at) },
        { label: 'Durasi (menit)', csv: (r) => r.work_minutes || '', render: (r) => Fmt.minutesToHM(r.work_minutes) }, { label: 'Status lokasi', csv: (r) => UI.statusLabel(r.location_status || ''), render: (r) => (r.location_status ? UI.badge(r.location_status) : '—') },
        { label: 'Jarak (m)', csv: (r) => r.distance_in_m ?? '', render: (r) => Fmt.distance(r.distance_in_m) }, { label: 'Status', csv: (r) => UI.statusLabel(r.status), render: (r) => UI.badge(r.status) }, { label: 'Catatan', key: 'notes' }] };
    }
    if (t === 'leave') {
      const rows = (await API.leave.list({})).filter((l) => byEmp(l.employee_id) && !(l.end_date < st.from || l.start_date > st.to));
      return { rows, totals: [`${rows.length} pengajuan`, `${rows.filter((l) => l.status === 'approved').reduce((s, l) => s + l.days, 0)} hari disetujui`], columns: [
        { label: 'Karyawan', csv: (r) => r.employee.full_name, render: (r) => esc(r.employee.full_name) }, { label: 'Jenis', csv: (r) => r.leave_type.name, render: (r) => esc(r.leave_type.name) },
        { label: 'Mulai', key: 'start_date', render: (r) => Fmt.date(r.start_date) }, { label: 'Selesai', key: 'end_date', render: (r) => Fmt.date(r.end_date) }, { label: 'Hari', key: 'days' },
        { label: 'Dibayar', csv: (r) => (r.leave_type.is_paid ? 'Ya' : 'Tidak'), render: (r) => (r.leave_type.is_paid ? 'Ya' : 'Tidak') }, { label: 'Alasan', key: 'reason' },
        { label: 'Status', csv: (r) => UI.statusLabel(r.status), render: (r) => UI.badge(r.status) }, { label: 'Catatan owner', key: 'owner_notes' }] };
    }
    if (t === 'payroll') {
      const periods = (await API.payroll.periods()).filter((p) => !(p.end_date < st.from || p.start_date > st.to));
      const details = await Promise.all(periods.map((p) => API.payroll.period(p.id)));
      const rows = details.flatMap((p) => p.items.map((i) => ({ ...i, period_key: p.period_key, period_status: p.status_display }))).filter((i) => byEmp(i.employee_id));
      return { rows, totals: [`${rows.length} slip`, `Total ${Fmt.rupiah(rows.reduce((s, i) => s + i.net_salary, 0))}`], columns: [
        { label: 'Periode', csv: (r) => r.period_key, render: (r) => Fmt.monthLabel(r.period_key) }, { label: 'Karyawan', csv: (r) => r.employee.full_name, render: (r) => esc(r.employee.full_name) },
        { label: 'Gaji pokok', key: 'basic_salary', render: (r) => Fmt.rupiah(r.basic_salary) }, { label: 'Tunjangan', csv: (r) => r.allowances.reduce((s, a) => s + a.amount, 0), render: (r) => Fmt.rupiah(r.allowances.reduce((s, a) => s + a.amount, 0)) },
        { label: 'Bonus', key: 'bonus', render: (r) => Fmt.rupiah(r.bonus) }, { label: 'Lembur', key: 'overtime_amount', render: (r) => Fmt.rupiah(r.overtime_amount) },
        { label: 'Potongan', csv: (r) => r.deductions.reduce((s, d) => s + d.amount, 0) + r.adjustments.filter((a) => a.type === 'deduction').reduce((s, a) => s + a.amount, 0), render: (r) => Fmt.rupiah(r.deductions.reduce((s, d) => s + d.amount, 0) + r.adjustments.filter((a) => a.type === 'deduction').reduce((s, a) => s + a.amount, 0)) },
        { label: 'Gaji bersih', key: 'net_salary', render: (r) => `<b>${Fmt.rupiah(r.net_salary)}</b>` }, { label: 'Status', csv: (r) => UI.statusLabel(r.status === 'paid' ? 'paid' : r.period_status), render: (r) => UI.badge(r.status === 'paid' ? 'paid' : r.period_status) },
        { label: 'Tgl bayar', csv: (r) => (r.payment ? r.payment.paid_at.slice(0, 10) : ''), render: (r) => (r.payment ? Fmt.date(r.payment.paid_at) : '—') }] };
    }
    if (t === 'task') {
      const rows = (await API.tasks.list({})).filter((x) => byEmp(x.assignee_id) && inRange(x.deadline));
      const s = Metrics.taskSummary(rows);
      return { rows, totals: [`${rows.length} tugas`, `Completion ${Fmt.percent(s.completionRate)}`, `${s.counts.overdue} overdue`], columns: [
        { label: 'Tugas', key: 'title' }, { label: 'Karyawan', csv: (r) => (r.assignee ? r.assignee.full_name : ''), render: (r) => esc(r.assignee ? r.assignee.full_name : '—') },
        { label: 'Prioritas', key: 'priority', render: (r) => UI.priority(r.priority) }, { label: 'Deadline', key: 'deadline', render: (r) => Fmt.date(r.deadline) }, { label: 'Progress (%)', key: 'progress' },
        { label: 'Status', csv: (r) => UI.statusLabel(r.status_display), render: (r) => UI.badge(r.status_display) }, { label: 'Selesai', csv: (r) => (r.completed_at || '').slice(0, 10), render: (r) => (r.completed_at ? Fmt.date(r.completed_at) : '—') }] };
    }
    const [recs, tasks] = await Promise.all([API.attendance.list({ from: st.from, to: st.to }), API.tasks.list({})]);
    const rows = Metrics.perEmployee(employees.filter((e) => byEmp(e.id) && e.employment_status === 'active'), recs, tasks.filter((x) => inRange(x.deadline))).sort((a, b) => b.score - a.score);
    return { rows, totals: [`${rows.length} karyawan`, `Rata-rata skor ${rows.length ? Math.round(rows.reduce((s, r) => s + r.score, 0) / rows.length) : 0}`], columns: [
      { label: 'Karyawan', csv: (r) => r.employee.full_name, render: (r) => esc(r.employee.full_name) }, { label: 'Hadir', csv: (r) => r.att.attended, render: (r) => r.att.attended },
      { label: 'Terlambat', csv: (r) => r.att.counts.late, render: (r) => r.att.counts.late }, { label: 'Absen', csv: (r) => r.att.counts.absent, render: (r) => r.att.counts.absent },
      { label: 'Kehadiran (%)', csv: (r) => r.att.attendanceRate.toFixed(1), render: (r) => Fmt.percent(r.att.attendanceRate, 1) }, { label: 'Tepat waktu (%)', csv: (r) => r.att.punctualityRate.toFixed(1), render: (r) => Fmt.percent(r.att.punctualityRate, 1) },
      { label: 'Tugas selesai (%)', csv: (r) => r.task.completionRate.toFixed(1), render: (r) => Fmt.percent(r.task.completionRate, 1) }, { label: 'Skor', csv: (r) => r.score, render: (r) => `<b>${r.score}</b>` }] };
  }

  async function render() {
    el.querySelectorAll('[data-type]').forEach((b) => { const on = b.dataset.type === st.type; b.style.borderColor = on ? 'var(--primary-400)' : ''; b.setAttribute('aria-pressed', on); });
    $('[data-title]').textContent = TYPES[st.type][0];
    $('[data-sub]').textContent = `${st.type === 'employee' ? 'Data terkini' : `Periode ${Fmt.date(st.from)} – ${Fmt.date(st.to)}`}${st.employee ? ' · ' + (employees.find((e) => e.id === st.employee) || {}).full_name : ''}`;
    const tEl = $('[data-t]'); tEl.innerHTML = UI.loading(6);
    try {
      current = await build();
      const q = st.search.toLowerCase();
      if (q) current.rows = current.rows.filter((r) => current.columns.some((c) => String(c.csv ? c.csv(r) : r[c.key] ?? '').toLowerCase().includes(q)));
      $('[data-totals]').innerHTML = current.totals.map((x) => `<span class="badge badge-primary no-dot">${esc(x)}</span>`).join('');
      UI.table(tEl, { rows: current.rows, pageSize: 15, emptyTitle: 'Tidak ada data untuk filter ini', emptyIcon: 'file-bar-chart', columns: current.columns.map((c) => ({ label: c.label, render: c.render || ((r) => esc(r[c.key] ?? '')) })) });
    } catch (e) { UI.errorState(tEl, e, render); }
  }

  function exportPDF() {
    if (!current.rows.length) return UI.toast('Tidak ada data untuk diekspor', 'warning');
    const w = window.open('', '_blank');
    if (!w) return UI.toast('Pop-up diblokir browser. Izinkan pop-up untuk mengekspor PDF.', 'warning');
    const head = current.columns.map((c) => `<th>${esc(c.label)}</th>`).join('');
    const body = current.rows.map((r) => `<tr>${current.columns.map((c) => `<td>${esc(c.csv ? c.csv(r) : r[c.key] ?? '')}</td>`).join('')}</tr>`).join('');
    w.document.write(`<!DOCTYPE html><html lang="id"><head><meta charset="utf-8"><title>${esc(TYPES[st.type][0])}</title><style>body{font-family:Segoe UI,Arial,sans-serif;color:#17153B;margin:24px}h1{font-size:20px;margin:0}p{color:#5B6182;font-size:12px;margin:4px 0 16px}table{width:100%;border-collapse:collapse;font-size:11px}th{background:#F3F1FF;text-align:left;padding:6px;border-bottom:2px solid #6C55F2}td{padding:6px;border-bottom:1px solid #E4E6F1}.brand{color:#6C55F2;font-weight:800}</style></head><body>
      <div class="brand">AbsenInn</div><h1>${esc(TYPES[st.type][0])}</h1><p>${esc($('[data-sub]').textContent)} · ${esc(current.totals.join(' · '))} · Dibuat ${new Date().toLocaleString('id-ID')}</p><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>
      <script>window.onload=function(){window.print()}<\/script></body></html>`);
    w.document.close();
  }

  try { employees = await API.employees.list({}); } catch (e) { UI.apiError(e); }
  $('[data-emp]').innerHTML += employees.map((e) => `<option value="${e.id}">${esc(e.full_name)}</option>`).join('');
  el.querySelectorAll('[data-type]').forEach((b) => b.addEventListener('click', () => { st.type = b.dataset.type; render(); }));
  $('[data-from]').addEventListener('change', (e) => { st.from = e.target.value; if (st.to < st.from) { st.to = st.from; $('[data-to]').value = st.to; } render(); });
  $('[data-to]').addEventListener('change', (e) => { st.to = e.target.value; render(); });
  $('[data-emp]').addEventListener('change', (e) => { st.employee = e.target.value; render(); });
  let deb; $('[data-search]').addEventListener('input', (e) => { clearTimeout(deb); deb = setTimeout(() => { st.search = e.target.value.trim(); render(); }, 250); });
  $('[data-csv]').addEventListener('click', () => { if (!current.rows.length) return UI.toast('Tidak ada data untuk diekspor', 'warning'); UI.downloadCSV(`absenninn-${st.type}-${st.from}_${st.to}.csv`, current.columns, current.rows); UI.toast(`${current.rows.length} baris diekspor ke CSV.`, 'success'); });
  $('[data-pdf]').addEventListener('click', exportPDF);
  render();
})();
