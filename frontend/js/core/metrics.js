/* =========================================================
   AbsenInn — Metrics (attendance, punctuality, tasks, productivity)
   Pure functions over records returned by the API.
   Used in demo mode and for small client-side widgets. In production the
   analytics page uses Django (/api/analytics/performance/), which ports
   these exact formulas (backend/analytics/services.py).
   ========================================================= */
(function () {
  const ATTENDED = ['present', 'late', 'early_leave', 'needs_review'];
  const ON_TIME = ['present', 'early_leave']; // arrived within tolerance
  const LEAVE = ['sick', 'paid_leave', 'unpaid_leave'];

  function summarize(records) {
    const c = { present: 0, late: 0, early_leave: 0, needs_review: 0, absent: 0, sick: 0, paid_leave: 0, unpaid_leave: 0 };
    records.forEach((r) => { if (c[r.status] !== undefined) c[r.status] += 1; });
    const attended = ATTENDED.reduce((s, k) => s + c[k], 0);
    const onTime = ON_TIME.reduce((s, k) => s + c[k], 0);
    const leave = LEAVE.reduce((s, k) => s + c[k], 0);
    const expected = attended + c.absent; // leave days are excused, not counted against attendance
    const totalMinutes = records.reduce((s, r) => s + (r.work_minutes || 0), 0);
    const withMinutes = records.filter((r) => r.work_minutes).length;
    return { counts: c, attended, onTime, leave, expected,
      attendanceRate: expected ? (attended / expected) * 100 : 0,
      punctualityRate: onTime + c.late ? (onTime / (onTime + c.late)) * 100 : 0,
      avgWorkMinutes: withMinutes ? totalMinutes / withMinutes : 0, totalMinutes };
  }

  function taskSummary(tasks) {
    const c = { todo: 0, in_progress: 0, completed: 0, overdue: 0 };
    tasks.forEach((t) => { c[t.status_display || t.status] += 1; });
    const total = tasks.length;
    const onTime = tasks.filter((t) => t.status === 'completed' && t.completed_at && t.completed_at.slice(0, 10) <= t.deadline).length;
    return { counts: c, total, completionRate: total ? (c.completed / total) * 100 : 0, onTimeCompletion: c.completed ? (onTime / c.completed) * 100 : 0 };
  }

  /* Productivity score (0–100): 40% attendance + 30% punctuality + 30% task completion.
     Shown with its formula in the UI so owners know how it is derived. */
  const productivity = (a, p, t) => Math.round(a * 0.4 + p * 0.3 + t * 0.3);

  function perEmployee(employees, records, tasks) {
    return employees.map((e) => {
      const a = summarize(records.filter((r) => r.employee_id === e.id));
      const t = taskSummary(tasks.filter((x) => x.assignee_id === e.id));
      return { employee: e, att: a, task: t, score: productivity(a.attendanceRate, a.punctualityRate, t.completionRate) };
    });
  }

  function dailyTrend(records, from, to, workingDays) {
    const out = [];
    for (let d = from; d <= to; d = Fmt.addDays(d, 1)) {
      if (workingDays && !workingDays.includes(Fmt.parseDate(d).getDay())) continue;
      const day = records.filter((r) => r.date === d);
      const s = summarize(day);
      out.push({ date: d, present: s.counts.present + s.counts.early_leave + s.counts.needs_review, late: s.counts.late, absent: s.counts.absent, leave: s.leave, rate: s.attendanceRate });
    }
    return out;
  }

  function monthly(records, months) {
    return months.map((key) => ({ key, ...summarize(records.filter((r) => r.date.startsWith(key))) }));
  }
  function lastMonths(n, ref = Fmt.today()) {
    const d = Fmt.parseDate(ref); const out = [];
    for (let i = n - 1; i >= 0; i -= 1) { const x = new Date(d.getFullYear(), d.getMonth() - i, 1); out.push(Fmt.toISODate(x).slice(0, 7)); }
    return out;
  }

  /* Short plain-language insights computed from actual data. */
  function insights(rows, cur, prev) {
    const out = [];
    if (cur && prev && prev.expected) {
      const diff = cur.attendanceRate - prev.attendanceRate;
      out.push({ icon: diff >= 0 ? 'trending-up' : 'trending-down', text: `Tingkat kehadiran ${diff >= 0 ? 'naik' : 'turun'} ${Math.abs(diff).toFixed(1).replace('.', ',')} poin dibanding bulan lalu (${Fmt.percent(prev.attendanceRate, 1)} → ${Fmt.percent(cur.attendanceRate, 1)}).` });
    }
    const withData = rows.filter((r) => r.att.onTime + r.att.counts.late > 0);
    if (withData.length) {
      const best = [...withData].sort((a, b) => b.att.punctualityRate - a.att.punctualityRate)[0];
      const worst = [...withData].sort((a, b) => b.att.counts.late - a.att.counts.late)[0];
      out.push({ icon: 'award', text: `${best.employee.full_name} paling tepat waktu (${Fmt.percent(best.att.punctualityRate)} kedatangan tepat waktu).` });
      if (worst.att.counts.late > 0) out.push({ icon: 'clock', text: `${worst.employee.full_name} tercatat terlambat ${worst.att.counts.late}× pada periode ini — pertimbangkan untuk dibicarakan.` });
    }
    const overdue = rows.reduce((s, r) => s + r.task.counts.overdue, 0);
    if (overdue) out.push({ icon: 'alert-triangle', text: `${overdue} tugas melewati deadline dan belum selesai.` });
    const review = rows.reduce((s, r) => s + r.att.counts.needs_review, 0);
    if (review) out.push({ icon: 'map-pin', text: `${review} absensi berstatus "Perlu Review" (mis. di luar radius) menunggu pemeriksaan owner.` });
    if (!out.length) out.push({ icon: 'info', text: 'Belum cukup data untuk menghasilkan insight pada periode ini.' });
    return out;
  }

  window.Metrics = { ATTENDED, ON_TIME, LEAVE, summarize, taskSummary, productivity, perEmployee, dailyTrend, monthly, lastMonths, insights };
})();
