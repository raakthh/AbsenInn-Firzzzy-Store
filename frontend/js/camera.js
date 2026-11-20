/* =========================================================
   AbsenInn — Camera (selfie capture) via getUserMedia.
   Requires HTTPS or localhost. Front camera preferred.
   ========================================================= */
(function () {
  const ERR = {
    insecure: 'Kamera hanya dapat diakses melalui HTTPS atau localhost.',
    unsupported: 'Browser ini tidak mendukung akses kamera.',
    denied: 'Izin kamera ditolak. Aktifkan izin kamera untuk situs ini melalui ikon gembok di address bar, lalu coba lagi.',
    notfound: 'Kamera tidak ditemukan pada perangkat ini.',
    busy: 'Kamera sedang dipakai aplikasi lain. Tutup aplikasi tersebut lalu coba lagi.',
    unknown: 'Kamera tidak dapat dibuka.',
  };

  class Camera {
    constructor(video) { this.video = video; this.stream = null; }

    async start() {
      if (!window.isSecureContext) throw Object.assign(new Error(ERR.insecure), { code: 'insecure' });
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw Object.assign(new Error(ERR.unsupported), { code: 'unsupported' });
      try {
        this.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 720 }, height: { ideal: 960 } }, audio: false });
      } catch (e) {
        const code = e.name === 'NotAllowedError' || e.name === 'SecurityError' ? 'denied' : e.name === 'NotFoundError' || e.name === 'OverconstrainedError' ? 'notfound' : e.name === 'NotReadableError' ? 'busy' : 'unknown';
        throw Object.assign(new Error(ERR[code]), { code });
      }
      this.video.srcObject = this.stream;
      this.video.setAttribute('playsinline', ''); this.video.muted = true;
      await this.video.play().catch(() => {});
      return this;
    }

    /* Returns a compressed JPEG data URL (max 480px wide), mirrored like the preview. */
    capture(maxW = 480, quality = 0.82) {
      const v = this.video; if (!v.videoWidth) throw new Error('Kamera belum siap.');
      const scale = Math.min(1, maxW / v.videoWidth);
      const c = document.createElement('canvas'); c.width = Math.round(v.videoWidth * scale); c.height = Math.round(v.videoHeight * scale);
      const ctx = c.getContext('2d'); ctx.translate(c.width, 0); ctx.scale(-1, 1); ctx.drawImage(v, 0, 0, c.width, c.height);
      return c.toDataURL('image/jpeg', quality);
    }

    stop() { if (this.stream) this.stream.getTracks().forEach((t) => t.stop()); this.stream = null; if (this.video) this.video.srcObject = null; }
  }
  Camera.ERR = ERR;
  window.Camera = Camera;
})();
