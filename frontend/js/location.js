/* =========================================================
   AbsenInn — Geolocation + Haversine distance.
   NOTE: browser GPS can be spoofed. Location is evidence that
   the server validates and flags — not perfect anti-fraud.
   ========================================================= */
(function () {
  const ERR = {
    insecure: 'Lokasi hanya dapat diakses melalui HTTPS atau localhost.',
    unsupported: 'Browser ini tidak mendukung GPS/geolocation.',
    denied: 'Izin lokasi ditolak. Aktifkan izin lokasi untuk situs ini, lalu coba lagi.',
    unavailable: 'Lokasi tidak dapat ditentukan. Pastikan GPS aktif dan coba di area terbuka.',
    timeout: 'Pengambilan lokasi terlalu lama. Coba lagi.',
  };

  const Geo = {
    ERR,
    get({ timeout = 15000, highAccuracy = true } = {}) {
      return new Promise((resolve, reject) => {
        if (!window.isSecureContext) return reject(Object.assign(new Error(ERR.insecure), { code: 'insecure' }));
        if (!navigator.geolocation) return reject(Object.assign(new Error(ERR.unsupported), { code: 'unsupported' }));
        navigator.geolocation.getCurrentPosition(
          (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: Math.round(p.coords.accuracy), timestamp: new Date(p.timestamp).toISOString() }),
          (e) => { const code = e.code === 1 ? 'denied' : e.code === 3 ? 'timeout' : 'unavailable'; reject(Object.assign(new Error(ERR[code]), { code })); },
          { enableHighAccuracy: highAccuracy, timeout, maximumAge: 0 },
        );
      });
    },
    /* Great-circle distance in meters. */
    haversine(lat1, lon1, lat2, lon2) {
      const R = 6371000, r = (d) => (d * Math.PI) / 180;
      const a = Math.sin(r(lat2 - lat1) / 2) ** 2 + Math.cos(r(lat1)) * Math.cos(r(lat2)) * Math.sin(r(lon2 - lon1) / 2) ** 2;
      return 2 * R * Math.asin(Math.sqrt(a));
    },
    mapsLink(lat, lng) { return `https://www.google.com/maps?q=${lat},${lng}`; },
    fmtCoord(lat, lng) { return lat == null ? '—' : `${Number(lat).toFixed(6)}, ${Number(lng).toFixed(6)}`; },
  };
  window.Geo = Geo;
})();
