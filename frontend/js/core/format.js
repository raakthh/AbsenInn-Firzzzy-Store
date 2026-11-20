/* =========================================================
   AbsenInn — Formatting helpers (Indonesian locale)
   ========================================================= */
(function () {
  const L = (window.APP_CONFIG && APP_CONFIG.LOCALE) || 'id-ID';
  const pad = (n) => String(n).padStart(2, '0');

  const Fmt = {
    pad,
    rupiah(n, opts = {}) {
      const v = Number(n || 0);
      if (opts.compact) {
        if (Math.abs(v) >= 1e9) return 'Rp' + (v / 1e9).toFixed(1).replace('.', ',') + ' M';
        if (Math.abs(v) >= 1e6) return 'Rp' + (v / 1e6).toFixed(1).replace('.', ',') + ' jt';
      }
      return 'Rp' + v.toLocaleString(L, { maximumFractionDigits: 0 });
    },
    number(n, d = 0) { return Number(n || 0).toLocaleString(L, { maximumFractionDigits: d, minimumFractionDigits: d }); },
    percent(n, d = 0) { return (Number.isFinite(n) ? n : 0).toFixed(d).replace('.', ',') + '%'; },

    /* Dates are stored as 'YYYY-MM-DD' (local) and timestamps as ISO strings. */
    toISODate(d) { const x = d instanceof Date ? d : new Date(d); return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`; },
    today() { return Fmt.toISODate(new Date()); },
    parseDate(s) { if (!s) return null; if (s instanceof Date) return s; const [y, m, d] = String(s).slice(0, 10).split('-').map(Number); return new Date(y, m - 1, d); },
    addDays(s, n) { const d = Fmt.parseDate(s); d.setDate(d.getDate() + n); return Fmt.toISODate(d); },
    diffDays(a, b) { return Math.round((Fmt.parseDate(b) - Fmt.parseDate(a)) / 86400000); },
    date(s, style = 'medium') {
      const d = Fmt.parseDate(s); if (!d) return '—';
      const o = style === 'long' ? { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }
        : style === 'short' ? { day: 'numeric', month: 'short' }
        : style === 'month' ? { month: 'long', year: 'numeric' }
        : { day: 'numeric', month: 'short', year: 'numeric' };
      return d.toLocaleDateString(L, o);
    },
    dayName(s, short) { return Fmt.parseDate(s).toLocaleDateString(L, { weekday: short ? 'short' : 'long' }); },
    time(iso) { if (!iso) return '—'; const d = new Date(iso); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; },
    dateTime(iso) { if (!iso) return '—'; return `${Fmt.date(iso)} · ${Fmt.time(iso)}`; },
    minutesToHM(min) { if (min == null) return '—'; const m = Math.max(0, Math.round(min)); return `${Math.floor(m / 60)}j ${pad(m % 60)}m`; },
    hmToMinutes(hm) { if (!hm) return 0; const [h, m] = hm.split(':').map(Number); return h * 60 + (m || 0); },
    minutesOfDay(iso) { const d = new Date(iso); return d.getHours() * 60 + d.getMinutes(); },
    relative(iso) {
      const diff = (Date.now() - new Date(iso).getTime()) / 1000;
      if (diff < 60) return 'baru saja';
      if (diff < 3600) return `${Math.floor(diff / 60)} mnt lalu`;
      if (diff < 86400) return `${Math.floor(diff / 3600)} jam lalu`;
      if (diff < 86400 * 7) return `${Math.floor(diff / 86400)} hari lalu`;
      return Fmt.date(iso);
    },
    greeting(d = new Date()) {
      const h = d.getHours();
      if (h < 11) return 'Selamat pagi';
      if (h < 15) return 'Selamat siang';
      if (h < 18) return 'Selamat sore';
      return 'Selamat malam';
    },
    monthKey(s) { return String(s).slice(0, 7); },
    monthLabel(key, short) { const [y, m] = key.split('-').map(Number); return new Date(y, m - 1, 1).toLocaleDateString(L, short ? { month: 'short' } : { month: 'long', year: 'numeric' }); },
    distance(m) { if (m == null) return '—'; return m >= 1000 ? (m / 1000).toFixed(2).replace('.', ',') + ' km' : Math.round(m) + ' m'; },
    initials(name) { return String(name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join(''); },
  };
  window.Fmt = Fmt;
})();
