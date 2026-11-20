/* =========================================================
   AbsenInn — Check-in / Check-out flow (selfie + GPS)
   1) camera + location permission → 2) selfie → 3) GPS + distance
   → 4) preview & confirm → 5) submit to API → server validates.
   Handles: camera denied, GPS unavailable (retry), outside radius
   (request owner review), upload failure (retry, no record created).
   ========================================================= */
(function () {
  const { icon, esc, $ } = UI;

  function open(kind, onDone) {
    const isIn = kind === 'in';
    const state = { selfie: null, loc: null, locErr: null, preview: null, camErr: null, submitting: false };
    const m = UI.modal({
      title: isIn ? 'Check-in Kehadiran' : 'Check-out Kehadiran',
      subtitle: `${Fmt.date(Fmt.today(), 'long')} · <span data-clock>${Fmt.time(new Date().toISOString())}</span>`,
      size: 'sm', dismissible: true, onClose: () => { cam.stop(); clearInterval(clock); },
      body: `<div class="steps" aria-hidden="true"><span class="is-done"></span><span data-step="2"></span><span data-step="3"></span></div>
        <div class="cam-wrap" data-cam><video class="mirror" data-video autoplay playsinline muted></video><div class="cam-guide"></div><div class="cam-msg" data-cam-msg>${icon('camera', 28)}<div class="mt-2">Meminta izin kamera…</div></div></div>
        <div class="mt-4 loc-box" data-loc>${UI.loading(2)}</div>
        <div class="mt-3" data-alert></div>
        ${API.isDemo() ? `<label class="check text-xs text-3 mt-3"><input type="checkbox" data-sim-fail> Simulasikan upload selfie gagal (uji demo)</label>` : ''}`,
      footer: `<button class="btn btn-outline" data-close>Batal</button><button class="btn btn-primary" data-action disabled>${icon('camera')}Ambil Selfie</button>`,
    });
    const el = m.el, video = $('[data-video]', el), cam = new Camera(video);
    const clock = setInterval(() => { const c = $('[data-clock]', el); if (c) c.textContent = Fmt.time(new Date().toISOString()); }, 15000);
    const action = $('[data-action]', el);
    const setStep = (n) => { el.querySelectorAll('[data-step]').forEach((s) => s.classList.toggle('is-done', Number(s.dataset.step) <= n)); };
    const alertBox = (html) => { $('[data-alert]', el).innerHTML = html; };

    async function startCamera() {
      state.camErr = null; const msg = $('[data-cam-msg]', el);
      msg.classList.remove('hidden'); msg.innerHTML = `${icon('camera', 28)}<div class="mt-2">Meminta izin kamera…</div>`;
      try { await cam.start(); msg.classList.add('hidden'); renderAction(); }
      catch (e) {
        state.camErr = e;
        msg.innerHTML = `<div>${icon('camera-off', 30)}<div class="mt-2 fw-600">${esc(e.message)}</div>
          ${e.code === 'denied' ? '<ol class="text-xs" style="text-align:left;margin:10px 0 0;padding-left:18px;opacity:.9"><li>Klik ikon gembok/kamera di address bar.</li><li>Ubah izin Kamera menjadi "Izinkan".</li><li>Tekan "Coba lagi".</li></ol>' : ''}
          <button class="btn btn-glass btn-sm mt-3" data-retry-cam>${icon('refresh-cw')}Coba lagi</button></div>`;
        $('[data-retry-cam]', el).addEventListener('click', startCamera);
        renderAction();
      }
    }

    async function getLocation() {
      state.loc = null; state.locErr = null; state.preview = null;
      $('[data-loc]', el).innerHTML = `<div class="flex items-center gap-2 text-sm text-2">${icon('crosshair')}Mengambil lokasi GPS…</div>`;
      try {
        state.loc = await Geo.get();
        state.preview = await API.attendance.locationPreview(state.loc.lat, state.loc.lng, state.loc.accuracy);
      } catch (e) { state.locErr = e; }
      renderLoc(); renderAction();
    }

    function renderLoc() {
      const box = $('[data-loc]', el);
      if (state.locErr) {
        box.innerHTML = `<div class="flex items-center justify-between gap-3"><div class="flex gap-2 text-sm"><span class="text-danger">${icon('alert-circle')}</span><div><b>GPS tidak tersedia</b><div class="text-xs text-3">${esc(state.locErr.message)}</div></div></div><button class="btn btn-outline btn-sm" data-retry-loc>${icon('refresh-cw')}Coba lagi</button></div>`;
        $('[data-retry-loc]', box).addEventListener('click', getLocation); return;
      }
      const p = state.preview, l = state.loc;
      box.innerHTML = `
        <div class="loc-row"><span>Status lokasi</span><span>${UI.badge(p.status)}</span></div>
        <div class="loc-row"><span>Lokasi saat ini</span><span class="mono">${Geo.fmtCoord(l.lat, l.lng)}</span></div>
        <div class="loc-row"><span>Lokasi kerja</span><span>${p.work_location && p.work_location.name ? esc(p.work_location.name) : '<span class="text-3">Belum diatur</span>'}</span></div>
        <div class="loc-row"><span>Jarak</span><span>${p.distance_m != null ? Fmt.distance(p.distance_m) + ` <span class="text-3">/ radius ${p.radius_m} m</span>` : '—'}</span></div>
        <div class="loc-row"><span>Akurasi GPS</span><span>±${l.accuracy} m</span></div>`;
      if (p.status === 'outside') alertBox(`<div class="alert alert-danger">${icon('alert-triangle')}<div><strong>Anda berada di luar radius lokasi kerja.</strong> Absensi tidak akan ditandai valid. Anda dapat mengirimnya untuk <b>direview owner</b>.</div></div>${noteField()}`);
      else if (p.status === 'not_configured') alertBox(`<div class="alert alert-warning">${icon('info')}<div><strong>Lokasi kerja belum diatur owner.</strong> Lokasi tidak bisa diverifikasi — absensi akan dikirim sebagai <b>Perlu Review</b>.</div></div>${noteField()}`);
      else if (p.status === 'needs_review') alertBox(`<div class="alert alert-warning">${icon('info')}<div>Akurasi GPS rendah (±${l.accuracy} m). Absensi akan ditandai <b>Perlu Review</b>.</div></div>`);
      else alertBox('');
    }

    const noteField = () => `<div class="field mt-3"><label class="label" for="rv-note">Catatan untuk owner (opsional)</label><textarea class="textarea" id="rv-note" data-review-note rows="2" placeholder="Mis. sedang tugas di luar kantor"></textarea></div>`;

    function renderAction() {
      const needsReview = state.preview && ['outside', 'not_configured'].includes(state.preview.status);
      if (!state.selfie) {
        action.disabled = !!state.camErr || !cam.stream;
        action.className = 'btn btn-primary'; action.innerHTML = `${icon('camera')}Ambil Selfie`;
        return;
      }
      setStep(state.loc ? 3 : 2);
      action.disabled = !state.loc || !state.preview;
      action.className = `btn ${needsReview ? 'btn-secondary' : 'btn-primary'}`;
      action.innerHTML = needsReview ? `${icon('send')}Kirim untuk Review` : `${icon('check')}Konfirmasi ${isIn ? 'Check-in' : 'Check-out'}`;
    }

    function showPreview() {
      const wrap = $('[data-cam]', el);
      wrap.innerHTML = `<img src="${state.selfie}" alt="Preview selfie"><button class="btn btn-glass btn-sm" data-retake style="position:absolute;left:12px;bottom:12px">${icon('rotate-ccw')}Ulangi</button>`;
      $('[data-retake]', wrap).addEventListener('click', () => {
        state.selfie = null; setStep(1);
        wrap.innerHTML = `<video class="mirror" data-video autoplay playsinline muted></video><div class="cam-guide"></div><div class="cam-msg hidden" data-cam-msg></div>`;
        cam.video = $('[data-video]', wrap); cam.video.srcObject = cam.stream; cam.video.play().catch(() => {}); renderAction();
      });
    }

    action.addEventListener('click', async () => {
      if (!state.selfie) {
        try { state.selfie = cam.capture(); showPreview(); setStep(2); renderAction(); } catch (e) { UI.toast(e.message, 'error'); }
        return;
      }
      if (state.submitting) return;
      const needsReview = ['outside', 'not_configured'].includes(state.preview.status);
      const noteEl = $('[data-review-note]', el);
      const note = needsReview && noteEl ? noteEl.value.trim() : '';
      state.submitting = true; action.classList.add('is-loading');
      const simFail = $('[data-sim-fail]', el);
      try {
        const payload = { selfie: state.selfie, lat: state.loc.lat, lng: state.loc.lng, accuracy: state.loc.accuracy, captured_at: new Date().toISOString(), request_review: needsReview, note, simulate_upload_failure: !!(simFail && simFail.checked) };
        const rec = await (isIn ? API.attendance.checkIn(payload) : API.attendance.checkOut(payload));
        UI.toast(rec.status === 'needs_review' ? 'Absensi terkirim dan menunggu review owner.' : `${isIn ? 'Check-in' : 'Check-out'} tercatat pukul ${Fmt.time(isIn ? rec.check_in_at : rec.check_out_at)}.`, rec.status === 'needs_review' ? 'warning' : 'success');
        m.close(); if (onDone) onDone(rec);
      } catch (e) {
        if (e.code === 'UPLOAD_FAILED') alertBox(`<div class="alert alert-danger">${icon('alert-triangle')}<div><strong>Upload selfie gagal.</strong> Absensi <b>belum</b> tercatat. Periksa koneksi lalu tekan tombol konfirmasi lagi untuk mencoba ulang.</div></div>`);
        else UI.apiError(e);
      } finally { state.submitting = false; action.classList.remove('is-loading'); }
    });

    startCamera();
    getLocation();
    return m;
  }

  /* Today's attendance card with check-in / check-out actions. */
  async function renderToday(container, onChange) {
    container.innerHTML = `<div class="attend-card">${UI.loading(3)}</div>`;
    let t;
    try { t = await API.attendance.today(); } catch (e) { return UI.errorState(container, e, () => renderToday(container, onChange)); }
    const r = t.record, w = t.schedule;
    const onLeave = r && ['sick', 'paid_leave', 'unpaid_leave'].includes(r.status) && !r.check_in_at;
    let ic = 'clock', title = 'Belum check-in', sub = t.is_work_day ? `Jadwal kerja ${w.start} – ${w.end}` : 'Hari ini bukan hari kerja sesuai jadwal';
    if (onLeave) { ic = 'plane'; title = UI.statusLabel(r.status); sub = r.notes || 'Izin disetujui owner'; }
    else if (r && r.check_out_at) { ic = 'check-check'; title = 'Sudah check-out'; sub = `Total kerja ${Fmt.minutesToHM(r.work_minutes)} · ${UI.statusLabel(r.status)}`; }
    else if (r && r.check_in_at) { ic = 'check-circle'; title = `Check-in ${Fmt.time(r.check_in_at)}`; sub = r.status === 'needs_review' ? 'Menunggu review owner (lokasi)' : r.status === 'late' ? 'Tercatat terlambat' : 'Anda tercatat hadir hari ini'; }
    const canIn = !onLeave && !(r && r.check_in_at);
    const canOut = r && r.check_in_at && !r.check_out_at;
    container.innerHTML = `<div class="attend-card">
      <div class="flex items-center justify-between gap-3 wrap"><div class="attend-status"><span class="attend-status-ico">${icon(ic)}</span><div><div class="text-sm" style="opacity:.8">Today's Attendance · ${Fmt.date(t.date, 'short')}</div><h3 style="font-size:1.3rem">${esc(title)}</h3><div class="text-sm" style="opacity:.85">${esc(sub)}</div></div></div>
        ${r && r.location_status ? `<span class="badge" style="background:rgba(255,255,255,.18);color:#fff">${icon('map-pin', 12)} ${UI.statusLabel(r.location_status)}${r.distance_in_m != null ? ' · ' + Fmt.distance(r.distance_in_m) : ''}</span>` : ''}</div>
      <div class="attend-times"><div class="attend-time"><small>Check-in</small><b>${Fmt.time(r && r.check_in_at)}</b></div><div class="attend-time"><small>Check-out</small><b>${Fmt.time(r && r.check_out_at)}</b></div><div class="attend-time"><small>Durasi</small><b>${r && r.check_in_at ? Fmt.minutesToHM(r.work_minutes != null ? r.work_minutes : Math.round((Date.now() - new Date(r.check_in_at)) / 60000)) : '—'}</b></div></div>
      <div class="attend-actions">${canIn ? `<button class="btn btn-light btn-lg" data-in>${icon('scan-face')}Check-in Sekarang</button>` : ''}${canOut ? `<button class="btn btn-light btn-lg" data-out>${icon('log-out')}Check-out</button>` : ''}
        ${!canIn && !canOut ? `<span class="text-sm" style="opacity:.85">${onLeave ? 'Tidak perlu absen hari ini.' : 'Absensi hari ini selesai. Terima kasih! 🎉'}</span>` : ''}</div>
      ${!t.location_configured && (canIn || canOut) ? `<p class="text-xs mt-3" style="opacity:.8">${icon('info', 12)} Lokasi kerja belum diatur owner — absensi akan berstatus Perlu Review.</p>` : ''}</div>`;
    const done = () => { renderToday(container, onChange); if (onChange) onChange(); };
    const bi = container.querySelector('[data-in]'), bo = container.querySelector('[data-out]');
    if (bi) bi.addEventListener('click', () => open('in', done));
    if (bo) bo.addEventListener('click', () => open('out', done));
    return t;
  }

  window.AttendanceFlow = { open, renderToday };
})();
