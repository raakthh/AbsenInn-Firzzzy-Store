/* AbsenInn — Owner: Performance Analytics */
(async function () {
  await Layout.init({ role: 'owner', page: 'analytics', title: 'Performance Analytics' });
  const { icon, esc, $ } = UI;
  const el = $('#content');
  const today = Fmt.today();
  const RANGES = { this_month: 'Bulan ini', last_month: 'Bulan lalu', last_90: '90 hari terakhir' };
  let range = 'this_month';

  el.innerHTML = `${Layout.pageHeader({ title: 'Performance Analytics', subtitle: 'Kehadiran, ketepatan waktu, dan penyelesaian tugas — dihitung dari data aktual.',
    actions: `<div class="segmented" role="group" aria-label="Periode">${Object.entries(RANGES).map(([k, l]) => `<button data-range="${k}" class="${k === range ? 'is-active' : ''}">${l}</button>`).join('')}</div>` })}<div data-body>${UI.loading(8)}</div>`;

  async function render() {
    const body = $('[data-body]'); body.innerHTML = UI.loading(8);
    try {
      /* Production: computed by Django (/api/analytics/performance/). Demo: same formulas in the browser (core/metrics.js). */
      const D = await API.analytics.performance(range);
      const { from, to, prev_from: pFrom, prev_to: pTo } = D;
      const S = D.current, P = D.previous, T = D.tasks, rows = D.rows, avgScore = D.avg_score;
      const delta = (a, b) => { if (!b) return '<span class="text-3">tidak ada data pembanding</span>'; const d = a - b; return `<span class="${d >= 0 ? 'text-success' : 'text-danger'}">${icon(d >= 0 ? 'trending-up' : 'trending-down', 13)} ${d >= 0 ? '+' : ''}${d.toFixed(1).replace('.', ',')} poin</span> vs periode lalu`; };
      const kpi = (ic, tone, v, l, meta) => `<div class="card stat"><div class="stat-top"><span class="stat-icon tone-${tone}">${icon(ic)}</span></div><div><div class="stat-value">${v}</div><div class="stat-label">${l}</div></div><div class="stat-meta">${meta}</div></div>`;

      body.innerHTML = `
        <div class="grid grid-4 stats-grid">
          ${kpi('calendar-check', 'primary', Fmt.percent(S.attendanceRate, 1), 'Attendance Rate', delta(S.attendanceRate, P.expected ? P.attendanceRate : 0))}
          ${kpi('clock', 'mint', Fmt.percent(S.punctualityRate, 1), 'Punctuality Rate', delta(S.punctualityRate, P.onTime + P.counts.late ? P.punctualityRate : 0))}
          ${kpi('check-circle', 'success', Fmt.percent(T.completionRate, 1), 'Task Completion Rate', `${T.counts.completed} dari ${T.total} tugas selesai`)}
          ${kpi('award', 'pending', avgScore, 'Rata-rata Produktivitas', 'Skor 0–100 (lihat rumus di bawah)')}
        </div>
        <div class="card mt-6"><div class="card-header"><div class="card-title">Insight</div><span class="text-xs text-3">${RANGES[range]} · ${Fmt.date(from)} – ${Fmt.date(to)}</span></div><div class="card-body grid grid-2" style="gap:12px">${D.insights.map((i) => `<div class="insight">${icon(i.icon)}<div class="text-sm">${esc(i.text)}</div></div>`).join('')}</div></div>
        <div class="grid grid-main-side mt-6">
          <div class="card"><div class="card-header"><div><div class="card-title">Performance Trend</div><div class="card-subtitle">Kehadiran & ketepatan waktu per bulan (6 bulan)</div></div></div><div class="card-body"><div class="chart-box" data-trend></div></div></div>
          <div class="card"><div class="card-header"><div class="card-title">Distribusi Status Kehadiran</div></div><div class="card-body"><div class="chart-box" data-dist></div></div></div>
        </div>
        <div class="grid grid-main-side mt-6">
          <div class="card"><div class="card-header"><div><div class="card-title">Produktivitas per Karyawan</div><div class="card-subtitle">Skor = 40% kehadiran + 30% ketepatan waktu + 30% penyelesaian tugas</div></div></div><div class="card-body"><div class="chart-box" data-emp></div></div></div>
          <div class="card"><div class="card-header"><div class="card-title">Status Tugas</div></div><div class="card-body"><div class="chart-box" data-task></div></div></div>
        </div>
        <div class="card mt-6"><div class="card-header"><div class="card-title">Monthly Comparison</div><span class="text-xs text-3">${Fmt.date(from)}–${Fmt.date(to)} vs ${Fmt.date(pFrom)}–${Fmt.date(pTo)}</span></div><div class="card-body" style="padding-top:12px"><div class="table-wrap"><table class="table"><thead><tr><th>Metrik</th><th>Periode ini</th><th>Periode lalu</th><th>Perubahan</th></tr></thead><tbody>
          ${[['Attendance rate', S.attendanceRate, P.attendanceRate, true], ['Punctuality rate', S.punctualityRate, P.punctualityRate, true], ['Hari hadir', S.attended, P.attended], ['Keterlambatan', S.counts.late, P.counts.late, false, true], ['Absen', S.counts.absent, P.counts.absent, false, true], ['Hari izin/cuti', S.leave, P.leave], ['Rata-rata jam kerja/hari', S.avgWorkMinutes / 60, P.avgWorkMinutes / 60, false, false, 'h']]
            .map(([l, a, b, pct, lowerBetter, unit]) => { const d = a - b; const good = lowerBetter ? d <= 0 : d >= 0; const f = (v) => (pct ? Fmt.percent(v, 1) : unit === 'h' ? v.toFixed(1).replace('.', ',') + ' jam' : Fmt.number(v)); return `<tr><td class="fw-600">${l}</td><td>${f(a)}</td><td class="text-2">${f(b)}</td><td class="${d === 0 ? 'text-3' : good ? 'text-success' : 'text-danger'}">${d > 0 ? '+' : ''}${pct ? d.toFixed(1).replace('.', ',') + ' poin' : unit === 'h' ? d.toFixed(1).replace('.', ',') : Fmt.number(d)}</td></tr>`; }).join('')}
        </tbody></table></div></div></div>
        <div class="card mt-6"><div class="card-header"><div class="card-title">Individual Employee Performance</div></div><div data-t></div></div>`;

      const mon = D.months; const months = mon.map((m) => m.key);
      Charts.line($('[data-trend]'), { labels: months.map((k) => Fmt.monthLabel(k, true)), yMax: 100, yFormat: (v) => v + '%', datasets: [{ label: 'Attendance', data: mon.map((m) => (m.expected ? +m.attendanceRate.toFixed(1) : null)) }, { label: 'Punctuality', data: mon.map((m) => (m.onTime + m.counts.late ? +m.punctualityRate.toFixed(1) : null)), color: Charts.BRAND.mint, fill: false }] });
      const c = S.counts;
      Charts.doughnut($('[data-dist]'), { labels: ['Hadir', 'Terlambat', 'Pulang awal', 'Izin/Cuti/Sakit', 'Absen', 'Perlu review'], data: [c.present, c.late, c.early_leave, S.leave, c.absent, c.needs_review],
        colors: [Charts.BRAND.primary, Charts.BRAND.pending, Charts.BRAND.blue, Charts.BRAND.mint, Charts.BRAND.danger, Charts.BRAND.muted], centerLabel: { value: Fmt.percent(S.attendanceRate), label: 'kehadiran' } });
      Charts.bar($('[data-emp]'), { labels: rows.map((r) => r.employee.full_name.split(' ')[0]), horizontal: true, yMax: 100, datasets: [{ label: 'Skor produktivitas', data: rows.map((r) => r.score), color: rows.map((r) => (r.score >= 85 ? Charts.BRAND.primary : r.score >= 70 ? Charts.BRAND.blue : Charts.BRAND.pending)) }] });
      Charts.pie($('[data-task]'), { labels: ['To Do', 'In Progress', 'Completed', 'Overdue'], data: [T.counts.todo, T.counts.in_progress, T.counts.completed, T.counts.overdue], colors: [Charts.BRAND.muted, Charts.BRAND.blue, Charts.BRAND.success, Charts.BRAND.danger] });
      UI.table($('[data-t]'), { rows, pageSize: 20, onRow: (r) => { location.href = `${Auth.root()}owner/employee-detail.html?id=${r.employee.id}`; }, columns: [
        { label: '#', render: (r) => `<b>${rows.indexOf(r) + 1}</b>` }, { label: 'Karyawan', render: (r) => UI.person(r.employee) },
        { label: 'Kehadiran', render: (r) => Fmt.percent(r.att.attendanceRate) }, { label: 'Tepat waktu', render: (r) => Fmt.percent(r.att.punctualityRate) },
        { label: 'Terlambat', render: (r) => r.att.counts.late }, { label: 'Tugas selesai', render: (r) => `${r.task.counts.completed}/${r.task.total}` },
        { label: 'Rata-rata jam/hari', render: (r) => Fmt.minutesToHM(r.att.avgWorkMinutes) },
        { label: 'Skor', render: (r) => `<div class="flex items-center gap-2"><div class="progress" style="width:80px"><div class="progress-bar" style="width:${r.score}%"></div></div><b>${r.score}</b></div>` }] });
    } catch (e) { UI.errorState(body, e, render); }
  }

  el.querySelectorAll('[data-range]').forEach((b) => b.addEventListener('click', () => { range = b.dataset.range; el.querySelectorAll('[data-range]').forEach((x) => x.classList.toggle('is-active', x === b)); render(); }));
  render();
})();
