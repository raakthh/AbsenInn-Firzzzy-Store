/* AbsenInn — Employee: My Leave */
(async function () {
  await Layout.init({ role: 'employee', page: 'leave', title: 'My Leave' });
  const { icon, esc, $ } = UI;
  const el = $('#content');
  let types = [];

  el.innerHTML = `${Layout.pageHeader({ title: 'My Leave', subtitle: 'Ajukan izin/cuti dan pantau statusnya.', actions: `<button class="btn btn-primary" data-new>${icon('plus')}Ajukan Izin</button>` })}
    <div class="grid grid-3 mb-4" data-sum></div><div class="card"><div class="card-header"><div class="card-title">Riwayat Pengajuan</div></div><div data-t>${UI.loading(5)}</div></div>`;

  async function load() {
    try {
      const [list, bal, t] = await Promise.all([API.leave.list({}), API.leave.balance(), API.leave.types()]); types = t.filter((x) => x.active);
      const stat = (ic, tone, v, l) => `<div class="card stat"><span class="stat-icon tone-${tone}">${icon(ic)}</span><div><div class="stat-value">${v}</div><div class="stat-label">${l}</div></div></div>`;
      $('[data-sum]').innerHTML = (bal.enabled === false ? stat('plane', 'mint', String(bal.taken_days || 0).replace('.', ','), 'Hari izin disetujui (tahun ini)') : stat('plane', 'mint', `${String(bal.remaining).replace('.', ',')}<span class="text-3" style="font-size:1rem"> / ${bal.quota}</span>`, 'Saldo cuti tahunan (hari)')) + stat('hourglass', 'pending', list.filter((l) => l.status === 'pending').length, 'Menunggu persetujuan') + stat('check-circle', 'success', list.filter((l) => l.status === 'approved').length, 'Disetujui');
      UI.table($('[data-t]'), { rows: list, pageSize: 10, emptyTitle: 'Belum ada pengajuan', emptyText: 'Klik "Ajukan Izin" untuk membuat pengajuan pertama.', emptyIcon: 'plane', onRow: detail, columns: [
        { label: 'Jenis', render: (l) => `<b>${esc(l.leave_type.name)}</b>` }, { label: 'Tanggal', render: (l) => `${Fmt.date(l.start_date)}${l.end_date !== l.start_date ? ' – ' + Fmt.date(l.end_date) : ''}` },
        { label: 'Durasi', render: (l) => `${String(l.days).replace('.', ',')} hari` }, { label: 'Diajukan', render: (l) => Fmt.date(l.requested_at) }, { label: 'Status', render: (l) => UI.badge(l.status) },
        { label: 'Catatan owner', render: (l) => `<span class="text-sm text-2">${esc(l.owner_notes || '—')}</span>` }] });
    } catch (e) { UI.errorState($('[data-t]'), e, load); }
  }

  function detail(l) {
    const m = UI.modal({ title: l.leave_type.name, subtitle: `Diajukan ${Fmt.dateTime(l.requested_at)}`, footer: `${l.status === 'pending' ? `<button class="btn btn-danger-soft" data-cancel style="margin-right:auto">${icon('x')}Batalkan pengajuan</button>` : ''}<button class="btn btn-outline" data-close>Tutup</button>`,
      body: `<div class="mb-4">${UI.badge(l.status)}</div><dl class="kv"><dt>Tanggal</dt><dd>${Fmt.date(l.start_date, 'long')}${l.end_date !== l.start_date ? ' – ' + Fmt.date(l.end_date, 'long') : ''}</dd><dt>Durasi</dt><dd>${String(l.days).replace('.', ',')} hari kerja</dd><dt>Alasan</dt><dd>${esc(l.reason)}</dd>
        <dt>Lampiran</dt><dd>${l.attachment_name ? esc(l.attachment_name) : '—'}</dd><dt>Catatan owner</dt><dd>${esc(l.owner_notes || (l.status === 'pending' ? 'Menunggu keputusan owner' : '—'))}</dd>${l.decided_at ? `<dt>Diputuskan</dt><dd>${Fmt.dateTime(l.decided_at)}</dd>` : ''}</dl>` });
    const cb = m.el.querySelector('[data-cancel]');
    if (cb) cb.addEventListener('click', async () => {
      if (!(await UI.confirm({ title: 'Batalkan pengajuan?', message: 'Pengajuan yang belum diputuskan owner akan dibatalkan.', confirmText: 'Batalkan', tone: 'danger' }))) return;
      const r = await UI.submit(cb, null, () => API.leave.cancel(l.id));
      if (r) { UI.toast('Pengajuan dibatalkan.', 'success'); m.close(); load(); }
    });
  }

  function apply() {
    const m = UI.modal({ title: 'Ajukan Izin / Cuti', size: 'lg',
      body: `<form class="form-grid" novalidate data-f>
        ${UI.field({ name: 'leave_type_id', label: 'Jenis izin', type: 'select', required: true, span: true, options: [['', 'Pilih jenis izin']].concat(types.map((t) => [t.id, `${t.name}${t.is_paid ? '' : ' (tidak dibayar)'}${t.requires_attachment ? ' — wajib lampiran' : ''}`])) })}
        ${UI.field({ name: 'start_date', label: 'Tanggal mulai', type: 'date', required: true, value: Fmt.addDays(Fmt.today(), 1) })}${UI.field({ name: 'end_date', label: 'Tanggal selesai', type: 'date', required: true, value: Fmt.addDays(Fmt.today(), 1) })}
        <div class="span-2 text-sm text-3" data-days></div>
        ${UI.field({ name: 'reason', label: 'Alasan', type: 'textarea', required: true, span: true, placeholder: 'Jelaskan alasan pengajuan' })}
        <div class="field span-2" data-field="attachment"><label class="label" for="att">Lampiran <span class="text-3" data-att-hint>(opsional)</span></label><input id="att" type="file" class="input" accept=".pdf,.jpg,.jpeg,.png" style="padding:8px"><span class="field-hint">PDF/JPG/PNG maks. 5 MB. ${API.isDemo() ? 'Mode demo hanya menyimpan nama file; di produksi file diunggah ke Supabase Storage (private).' : ''}</span><span class="field-error"></span></div>
      </form>`,
      footer: `<button class="btn btn-outline" data-close>Batal</button><button class="btn btn-primary" data-ok>${icon('send')}Kirim Pengajuan</button>` });
    const form = m.el.querySelector('[data-f]');
    const sync = () => {
      const t = types.find((x) => x.id === form.leave_type_id.value);
      m.el.querySelector('[data-att-hint]').textContent = t && t.requires_attachment ? '(wajib)' : '(opsional)';
      if (t && t.half_day) form.end_date.value = form.start_date.value;
      form.end_date.disabled = !!(t && t.half_day);
      const s = form.start_date.value, e = form.end_date.value;
      m.el.querySelector('[data-days]').textContent = s && e && e >= s ? `Durasi: ${t && t.half_day ? '½ hari' : `${Fmt.diffDays(s, e) + 1} hari kalender`} · hari libur tidak dihitung.` : '';
    };
    ['change', 'input'].forEach((ev) => form.addEventListener(ev, sync)); sync();
    m.el.querySelector('[data-ok]').addEventListener('click', async (ev) => { const btn = ev.currentTarget;
      const t = types.find((x) => x.id === form.leave_type_id.value);
      const file = form.querySelector('#att').files[0];
      const d = UI.validate(form, { leave_type_id: [UI.rules.required('Pilih jenis izin')], start_date: [UI.rules.required()], end_date: [(v, x) => (!form.end_date.disabled && !v ? 'Wajib diisi' : !form.end_date.disabled && v < x.start_date ? 'Harus setelah tanggal mulai' : null)], reason: [UI.rules.required(), UI.rules.min(5)] });
      if (!d) return;
      if (file && file.size > 5 * 1024 * 1024) return UI.showErrors(form, { attachment: 'Ukuran file maksimal 5 MB' });
      if (t.requires_attachment && !file) return UI.showErrors(form, { attachment: `Lampiran wajib untuk ${t.name}` });
      const payload = { leave_type_id: d.leave_type_id, start_date: d.start_date, end_date: form.end_date.disabled ? d.start_date : d.end_date, reason: d.reason, attachment_name: file ? file.name : null, attachment: file || null };
      const r = await UI.submit(btn, form, () => API.leave.request(payload));
      if (r) { UI.toast('Pengajuan terkirim. Owner akan mendapat notifikasi.', 'success'); m.close(); load(); }
    });
  }

  $('[data-new]').addEventListener('click', apply);
  await load();
  if (UI.qs('new')) apply();
})();
