/* =========================================================
   AbsenInn — Chart.js wrapper with brand styling.
   Chart.js is loaded from CDN; if it is unavailable (offline)
   each chart shows a clear fallback message instead of failing.
   ========================================================= */
(function () {
  const BRAND = { primary: '#6C55F2', violet: '#8B5CF6', blue: '#7DB3FF', mint: '#22C9A0', pending: '#F08A10', danger: '#E5484D', muted: '#CDD0E2', success: '#16A34A', info: '#4F8DF7' };
  const registry = new Map();

  function ready() { return typeof window.Chart !== 'undefined'; }
  function mount(container) {
    const el = typeof container === 'string' ? document.querySelector(container) : container;
    if (registry.has(el)) { registry.get(el).destroy(); registry.delete(el); }
    el.innerHTML = '';
    if (!ready()) { el.innerHTML = `<div class="chart-fallback">${Icons.svg('bar-chart', 28)}<div>Grafik tidak dapat dimuat.<br><small>Chart.js dimuat dari CDN — periksa koneksi internet.</small></div></div>`; return null; }
    const canvas = document.createElement('canvas'); el.appendChild(canvas); return { el, canvas };
  }

  function baseOptions(extra = {}) {
    return {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { position: 'top', align: 'end', labels: { usePointStyle: true, pointStyle: 'circle', boxWidth: 8, boxHeight: 8, padding: 14, font: { family: 'Plus Jakarta Sans', size: 12, weight: '600' }, color: '#5B6182' } },
        tooltip: { backgroundColor: '#17153B', padding: 10, cornerRadius: 8, titleFont: { family: 'Plus Jakarta Sans', weight: '700' }, bodyFont: { family: 'Plus Jakarta Sans' }, usePointStyle: true },
      },
      scales: {
        x: { grid: { display: false }, border: { display: false }, ticks: { color: '#7A809E', font: { family: 'Plus Jakarta Sans', size: 11 } } },
        y: { grid: { color: '#F0F1F8' }, border: { display: false }, beginAtZero: true, ticks: { color: '#7A809E', font: { family: 'Plus Jakarta Sans', size: 11 }, precision: 0 } },
      },
      ...extra,
    };
  }
  function create(container, config) {
    const m = mount(container); if (!m) return null;
    const chart = new Chart(m.canvas, config); registry.set(m.el, chart); return chart;
  }
  function gradient(ctx, color) {
    const g = ctx.createLinearGradient(0, 0, 0, 260); g.addColorStop(0, color + '33'); g.addColorStop(1, color + '00'); return g;
  }

  const Charts = {
    BRAND, ready,
    line(container, { labels, datasets, yFormat, yMax }) {
      return create(container, { type: 'line', data: { labels, datasets: datasets.map((d, i) => ({ tension: 0.38, borderWidth: 2.5, pointRadius: 3, pointHoverRadius: 6, pointBackgroundColor: '#fff', pointBorderWidth: 2,
        borderColor: d.color || [BRAND.primary, BRAND.blue, BRAND.mint][i], fill: d.fill !== false && i === 0,
        backgroundColor: (c) => (c.chart.ctx ? gradient(c.chart.ctx, d.color || BRAND.primary) : 'transparent'), ...d })) },
        options: baseOptions({ scales: { ...baseOptions().scales, y: { ...baseOptions().scales.y, max: yMax, ticks: { ...baseOptions().scales.y.ticks, callback: yFormat || ((v) => v) } } } }) });
    },
    bar(container, { labels, datasets, yFormat, stacked, horizontal, yMax }) {
      const o = baseOptions(); o.indexAxis = horizontal ? 'y' : 'x';
      const valAxis = horizontal ? 'x' : 'y', catAxis = horizontal ? 'y' : 'x';
      o.scales = { [catAxis]: { ...o.scales.x, stacked: !!stacked }, [valAxis]: { ...o.scales.y, stacked: !!stacked, max: yMax, grid: { color: '#F0F1F8' }, ticks: { ...o.scales.y.ticks, callback: yFormat || ((v) => v) } } };
      if (yFormat) o.plugins.tooltip.callbacks = { label: (c) => `${c.dataset.label}: ${yFormat(c.parsed[valAxis])}` };
      return create(container, { type: 'bar', data: { labels, datasets: datasets.map((d, i) => ({ borderRadius: 6, borderSkipped: false, maxBarThickness: 34, backgroundColor: d.color || [BRAND.primary, BRAND.blue, BRAND.mint, BRAND.pending][i], ...d })) }, options: o });
    },
    doughnut(container, { labels, data, colors, centerLabel, type = 'doughnut' }) {
      const total = data.reduce((a, b) => a + b, 0);
      const o = { responsive: true, maintainAspectRatio: false, cutout: type === 'doughnut' ? '68%' : 0,
        plugins: { legend: { position: 'bottom', labels: { usePointStyle: true, pointStyle: 'circle', boxWidth: 8, padding: 12, font: { family: 'Plus Jakarta Sans', size: 12, weight: '600' }, color: '#5B6182',
          generateLabels: (chart) => chart.data.labels.map((l, i) => ({ text: `${l} · ${total ? Math.round((data[i] / total) * 100) : 0}%`, fillStyle: chart.data.datasets[0].backgroundColor[i], strokeStyle: '#fff', pointStyle: 'circle', index: i, hidden: !chart.getDataVisibility(i) })) },
          onClick: (e, item, legend) => { legend.chart.toggleDataVisibility(item.index); legend.chart.update(); } },
          tooltip: { backgroundColor: '#17153B', padding: 10, cornerRadius: 8, callbacks: { label: (c) => `${c.label}: ${c.parsed} (${total ? ((c.parsed / total) * 100).toFixed(1) : 0}%)` } } } };
      const plugins = centerLabel ? [{ id: 'center', afterDraw(chart) { const { ctx, chartArea: a } = chart; const x = (a.left + a.right) / 2, y = (a.top + a.bottom) / 2; ctx.save(); ctx.textAlign = 'center'; ctx.fillStyle = '#17153B'; ctx.font = '800 22px Plus Jakarta Sans'; ctx.fillText(centerLabel.value, x, y + 2); ctx.fillStyle = '#7A809E'; ctx.font = '600 11px Plus Jakarta Sans'; ctx.fillText(centerLabel.label, x, y + 20); ctx.restore(); } }] : [];
      return create(container, { type, data: { labels, datasets: [{ data, backgroundColor: colors || [BRAND.primary, BRAND.mint, BRAND.pending, BRAND.danger, BRAND.blue, BRAND.muted], borderWidth: 2, borderColor: '#fff', hoverOffset: 6 }] }, options: o, plugins });
    },
    pie(container, opts) { return Charts.doughnut(container, { ...opts, type: 'pie' }); },
  };
  window.Charts = Charts;
})();
