/* AbsenInn — Owner: Payroll Management */
(async function () {
  await Layout.init({ role: 'owner', page: 'payroll', title: 'Payroll' });
  const { icon, esc, $, $$ } = UI;
  const el = $('#content');
  const st = { tab: location.hash === '#config' ? 'config' : 'overview', periodId: null };
  let periods = [], period = null;
  const FLOW = ['draft', 'pending_approval', 'approved', 'scheduled', 'paid'];

  el.innerHTML = `
    ${Layout.pageHeader({ title: 'Payroll', subtitle: 'Hitung, tinjau, setujui, dan catat pembayaran gaji. Pembayaran dilakukan manual oleh owner.', actions: `<select class="select" data-period style="width:auto;min-width:200px" aria-label="Periode payroll"></select><button class="btn btn-primary" data-gen>${icon('calculator')}Hitung Payroll</button>` })}
    <div class="card"><div class="tabs" style="padding:0 16px" role="tablist">
      <button class="tab ${st.tab === 'overview' ? 'is-active' : ''}" data-tab="overview">${icon('receipt')}Payroll Periode</button>
      <button class="tab ${st.tab === 'config' ? 'is-active' : ''}" data-tab="config">${icon('settings')}Konfigurasi Gaji</button>
      <button class="tab" data-tab="history">${icon('history')}Riwayat & Pembayaran</button></div>
      <div data-panel>${UI.loading(6)}</div></div>`;

  async function loadPeriods(keepId) {
    periods = await API.payroll.periods();
    st.periodId = keepId || st.periodId || (periods.find((p) => p.period_key === Fmt.today().slice(0, 7)) || periods[0] || {}).id;
    $('[data-period]').innerHTML = periods.map((p) => `<option value="${p.id}" ${p.id === st.periodId ? 'selected' : ''}>${Fmt.monthLabel(p.period_key)} — ${UI.statusLabel(p.status_display)}</option>`).join('');
  }
  async function render() {
    const p = $('[data-panel]'); p.onclick = null;
    try { await ({ overview, config, history })[st.tab](p); } catch (e) { UI.errorState(p, e, render); }
  }

  /* ---------- Period overview ---------- */
  async function overview(p) {
    p.innerHTML = UI.loading(6);
    if (!st.periodId) { p.innerHTML = `${UI.empty('Belum ada periode payroll', 'Isi konfigurasi gaji karyawan, lalu tekan "Hitung Payroll" untuk membuat periode pertama.', 'wallet')}<div class="text-center" style="padding-bottom:24px"><button class="btn btn-primary" data-gen2>${icon('calculator')}Hitung Payroll</button></div>`; p.querySelector('[data-gen2]').addEventListener('click', () => generateDialog()); return; }
    period = await API.payroll.period(st.periodId);
    const sd = period.status_display, idx = FLOW.indexOf(period.status);
    const editable = ['draft', 'pending_approval'].includes(period.status);
    const paidCount = period.items.filter((i) => i.status === 'paid').length;
    const actions = {
      draft: `<button class="btn btn-outline" data-recalc>${icon('rotate-ccw')}Hitung Ulang</button><button class="btn btn-primary" data-act="submit">${icon('send')}Ajukan untuk Approval</button>`,
      pending_approval: `<button class="btn btn-outline" data-act="reopen">${icon('rotate-ccw')}Kembalikan ke Draft</button><button class="btn btn-success" data-act="approve">${icon('shield-check')}Setujui & Finalisasi</button>`,
      approved: `<button class="btn btn-outline" data-act="schedule">${icon('calendar')}Jadwalkan Pembayaran</button><button class="btn btn-primary" data-pay>${icon('banknote')}Konfirmasi Pembayaran</button>`,
      scheduled: `<button class="btn btn-primary" data-pay>${icon('banknote')}Konfirmasi Pembayaran</button>`,
      paid: `<span class="badge badge-success">${icon('check-circle', 14)} Semua pembayaran terkonfirmasi</span>`,
    }[period.status];

    p.innerHTML = `<div class="card-body">
      <div class="grid grid-4 stats-grid">
        ${[['wallet', 'primary', Fmt.rupiah(period.total_net), 'Total gaji bersih'], ['users', 'info', period.items.length, 'Karyawan dalam periode'], ['calendar', sd === 'overdue' ? 'danger' : 'mint', Fmt.date(period.payment_date), 'Jadwal pembayaran'], ['banknote', 'success', `${paidCount}/${period.items.length}`, 'Sudah dibayar']]
          .map(([ic, tone, v, l]) => `<div class="card stat"><span class="stat-icon tone-${tone}">${icon(ic)}</span><div><div class="stat-value" style="font-size:1.3rem">${v}</div><div class="stat-label">${l}</div></div></div>`).join('')}
      </div>
      <div class="card mt-4" style="box-shadow:none"><div class="card-body flex items-center justify-between wrap gap-4">
        <div class="flex items-center gap-2 wrap" aria-label="Alur payroll">${FLOW.map((f, i) => `<span class="badge ${i < idx ? 'badge-success' : i === idx ? `badge-${UI.STATUS[sd === 'overdue' && f === period.status ? 'overdue' : f][1]}` : 'badge-muted'} ${i === idx ? '' : 'no-dot'}">${i < idx ? icon('check', 12) : ''}${UI.statusLabel(f)}</span>${i < FLOW.length - 1 ? icon('chevron-right', 14, 'text-3') : ''}`).join('')}${sd === 'overdue' ? `<span class="badge badge-danger">${icon('alert-triangle', 12)} Overdue — lewat jadwal bayar</span>` : ''}</div>
        <div class="flex gap-2 wrap">${actions}</div></div></div>
      ${editable ? `<div class="alert alert-info mt-4">${icon('info')}<div>Status <b>${UI.statusLabel(period.status)}</b>: ${API.isDemo() ? 'mode demo memakai angka contoh dari konfigurasi gaji.' : 'gaji dihitung otomatis dari absensi, izin, dan lembur sesuai aturan di <a href="' + Auth.root() + 'owner/settings.html#payroll">Settings → Payroll</a>. Setelah ada koreksi absensi/izin, tekan <b>Hitung Ulang</b>.'} Anda dapat menambah adjustment (bonus/potongan) atau mengubah jam lembur per karyawan sebelum menyetujui.</div></div>` : ''}
      ${(() => { const w = [...(period.warnings || []), ...period.items.flatMap((i) => (i.warnings || []).map((x) => `${i.employee.full_name}: ${x}`))]; return w.length && editable ? `<div class="alert alert-warning mt-4">${icon('alert-triangle')}<div><strong>Perlu diperhatikan sebelum approval:</strong><ul style="margin:6px 0 0 18px">${w.map((x) => `<li class="text-sm">${esc(x)}</li>`).join('')}</ul></div></div>` : ''; })()}
      ${['approved', 'scheduled'].includes(period.status) ? `<div class="alert alert-warning mt-4">${icon('alert-circle')}<div>Status <b>Paid</b> hanya diberikan setelah Anda mentransfer gaji secara manual lalu menekan <b>Konfirmasi Pembayaran</b>.</div></div>` : ''}
    </div><div data-t></div>`;

    UI.table($('[data-t]', p), { rows: period.items, pageSize: 20, emptyTitle: 'Tidak ada karyawan dalam periode', columns: [
      { label: 'Karyawan', render: (i) => UI.person(i.employee) },
      { label: 'Tgl bayar', render: (i) => `<span class="text-sm">${Fmt.date(i.payment_date || period.payment_date)}</span>${i.cycle_start ? `<div class="text-xs text-3">${Fmt.date(i.cycle_start, 'short')} – ${Fmt.date(i.cycle_end, 'short')}</div>` : ''}` },
      { label: 'Gaji pokok', render: (i) => Fmt.rupiah(i.basic_salary) },
      { label: 'Tunjangan', render: (i) => Fmt.rupiah(i.allowances.reduce((s, a) => s + a.amount, 0)) },
      { label: 'Bonus + Lembur', render: (i) => Fmt.rupiah(i.bonus + i.incentives + i.overtime_amount) },
      { label: 'Potongan', render: (i) => { const d = i.deductions.reduce((s, x) => s + x.amount, 0) + i.adjustments.filter((a) => a.type === 'deduction').reduce((s, a) => s + a.amount, 0); return d ? `<span class="text-danger">−${Fmt.rupiah(d)}</span>` : '<span class="text-3">—</span>'; } },
      { label: 'Gaji bersih', render: (i) => `<b>${Fmt.rupiah(i.net_salary)}</b>${i.adjustments.length ? `<div class="text-xs text-primary">${i.adjustments.length} adjustment</div>` : ''}` },
      { label: 'Status', render: (i) => UI.badge(i.status === 'paid' ? 'paid' : sd) },
      { label: '', cls: 'col-actions', render: (i) => `<div class="flex gap-1"><button class="btn btn-outline btn-sm" data-preview="${i.id}">${icon(editable ? 'pencil' : 'eye', 15)}${editable ? 'Preview & Adjust' : 'Rincian'}</button><button class="btn btn-ghost btn-icon btn-sm" data-slip="${i.id}" title="Slip gaji" aria-label="Slip gaji">${icon('receipt', 16)}</button></div>` }] });

    p.onclick = async (e) => {
      const a = e.target.closest('[data-act]'); if (a) return transition(a.dataset.act, a);
      if (e.target.closest('[data-pay]')) return confirmPayment();
      const rc = e.target.closest('[data-recalc]'); if (rc) { const r = await UI.submit(rc, null, () => API.payroll.recalculate(period.id)); if (r) { UI.toast('Payroll dihitung ulang dari data absensi terbaru.', 'success'); await loadPeriods(period.id); render(); } return; }
      const pv = e.target.closest('[data-preview]'); if (pv) return preview(pv.dataset.preview, editable);
      const sl = e.target.closest('[data-slip]'); if (sl) Payslip.open(sl.dataset.slip);
    };
  }

  async function transition(action, btn) {
    const label = { submit: 'Ajukan payroll untuk approval?', approve: 'Setujui & finalisasi payroll?', reopen: 'Kembalikan ke draft?' }[action];
    if (action === 'schedule') {
      const m = UI.modal({ title: 'Jadwalkan Pembayaran', size: 'sm', body: `<form novalidate data-f>${UI.field({ name: 'payment_date', label: 'Tanggal pembayaran', type: 'date', value: period.payment_date, required: true })}<p class="text-xs text-3 mt-2">Karyawan akan menerima notifikasi "Upcoming Salary".</p></form>`, footer: `<button class="btn btn-outline" data-close>Batal</button><button class="btn btn-primary" data-ok>Jadwalkan</button>` });
      const form = m.el.querySelector('[data-f]');
      m.el.querySelector('[data-ok]').addEventListener('click', async (ev) => { const btn = ev.currentTarget; const d = UI.validate(form, { payment_date: [UI.rules.required()] }); if (!d) return; const r = await UI.submit(btn, form, () => API.payroll.transition(period.id, 'schedule', d)); if (r) { UI.toast('Pembayaran dijadwalkan.', 'success'); m.close(); await loadPeriods(period.id); render(); } });
      return;
    }
    const msg = { submit: 'Payroll akan dikunci dari edit konfigurasi dan menunggu approval.', approve: 'Setelah disetujui, adjustment terkunci dan karyawan dapat melihat slip gajinya. Status belum <b>Paid</b> sampai pembayaran dikonfirmasi.', reopen: 'Payroll kembali ke Draft agar bisa diperbaiki.' }[action];
    if (!(await UI.confirm({ title: label, message: msg, confirmText: 'Lanjutkan', tone: action === 'approve' ? 'success' : 'primary' }))) return;
    const r = await UI.submit(btn, null, () => API.payroll.transition(period.id, action));
    if (r) { UI.toast({ submit: 'Payroll diajukan untuk approval.', approve: 'Payroll disetujui. Slip gaji tersedia untuk karyawan.', reopen: 'Payroll dikembalikan ke draft.' }[action], 'success'); await loadPeriods(period.id); render(); }
  }

  async function preview(itemId, editable) {
    const m = UI.modal({ title: 'Payroll Preview', size: 'lg', body: UI.loading(6) });
    async function draw() {
      const it = await API.payroll.item(itemId);
      const row = (l, v, cls = '') => `<tr><td>${esc(l)}</td><td class="${cls}">${v}</td></tr>`;
      m.body.innerHTML = `<div class="flex items-center justify-between wrap gap-3">${UI.person(it.employee)}<span class="text-sm text-3">${Fmt.monthLabel(it.period.period_key)}</span></div>
        <table class="payslip-table mt-4">
          ${row('Gaji pokok', Fmt.rupiah(it.basic_salary))}${it.allowances.map((a) => row(a.name, Fmt.rupiah(a.amount))).join('')}
          ${row('Bonus', Fmt.rupiah(it.bonus))}${row('Insentif', Fmt.rupiah(it.incentives))}${row(`Lembur (${it.overtime_hours} jam)`, Fmt.rupiah(it.overtime_amount))}
          ${it.deductions.map((d) => row(d.name, '−' + Fmt.rupiah(d.amount), 'text-danger')).join('')}
          ${it.adjustments.map((a) => `<tr><td>Adjustment: ${esc(a.name)} <span class="text-xs text-3">· ${esc(a.by)}</span>${editable ? ` <button class="btn btn-ghost btn-sm text-danger" data-rm="${a.id}" aria-label="Hapus adjustment">${icon('trash', 14)}</button>` : ''}</td><td class="${a.type === 'deduction' ? 'text-danger' : 'text-success'}">${a.type === 'deduction' ? '−' : '+'}${Fmt.rupiah(a.amount)}</td></tr>`).join('')}
        </table>
        <div class="payslip-total"><span class="fw-600">Gaji bersih</span><strong>${Fmt.rupiah(it.net_salary)}</strong></div>
        ${it.calc_note ? `<p class="text-xs text-3 mt-3">${esc(it.calc_note)}</p>` : ''}
        ${(it.warnings || []).length ? `<div class="alert alert-warning mt-3">${icon('alert-triangle')}<div>${it.warnings.map((w) => `<div class="text-sm">${esc(w)}</div>`).join('')}</div></div>` : ''}
        ${editable ? `<form class="flex gap-2 items-end wrap mt-4" novalidate data-ot><div class="field" style="max-width:200px"><label class="label" for="ot-h">Jam lembur</label><input id="ot-h" class="input input-sm" name="overtime_hours" type="number" min="0" max="400" step="0.5" value="${it.overtime_hours}"></div><button type="submit" class="btn btn-outline btn-sm">${icon('check', 15)}Simpan jam lembur</button>${it.overtime_override != null ? `<button type="button" class="btn btn-ghost btn-sm" data-ot-reset>Kembalikan ke otomatis (${it.overtime_hours_auto} jam)</button>` : ''}</form>` : ''}
        ${editable ? `<form class="form-grid mt-6" novalidate data-f style="grid-template-columns:140px 1fr 160px auto;align-items:end">
          ${UI.field({ name: 'type', label: 'Jenis', type: 'select', options: [['addition', 'Tambahan'], ['deduction', 'Potongan']] })}
          ${UI.field({ name: 'name', label: 'Keterangan', placeholder: 'Mis. Bonus target penjualan' })}
          ${UI.field({ name: 'amount', label: 'Nominal (Rp)', type: 'number', attrs: 'min="0" step="10000"' })}
          <button type="submit" class="btn btn-secondary" style="margin-bottom:${'0'}">${icon('plus')}Tambah</button></form>` : `<div class="alert alert-primary mt-4">${icon('lock')}<div>Payroll sudah disetujui — adjustment terkunci.</div></div>`}`;
      const ot = m.body.querySelector('[data-ot]');
      if (ot) {
        ot.addEventListener('submit', async (e) => { e.preventDefault(); const v = ot.overtime_hours.value; if (v === '' || Number(v) < 0) return UI.showErrors(ot, { overtime_hours: 'Isi jam lembur (≥ 0)' });
          const r = await UI.submit(ot.querySelector('[type=submit]'), ot, () => API.payroll.updateItem(itemId, { overtime_hours: Number(v) })); if (r) { UI.toast('Jam lembur diperbarui.', 'success'); await draw(); render(); } });
        const rs = ot.querySelector('[data-ot-reset]'); if (rs) rs.addEventListener('click', async () => { const r = await UI.submit(rs, null, () => API.payroll.updateItem(itemId, { overtime_hours: null })); if (r) { await draw(); render(); } });
      }
      const form = m.body.querySelector('[data-f]');
      if (form) form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const d = UI.validate(form, { name: [UI.rules.required(), UI.rules.min(3)], amount: [UI.rules.required(), UI.rules.positive()] }); if (!d) return;
        const r = await UI.submit(form.querySelector('[type=submit]'), form, () => API.payroll.adjust(itemId, d));
        if (r) { UI.toast('Adjustment ditambahkan & tercatat di audit log.', 'success'); await draw(); render(); }
      });
      $$('[data-rm]', m.body).forEach((b) => b.addEventListener('click', async () => { if (!(await UI.confirm({ title: 'Hapus adjustment?', confirmText: 'Hapus', tone: 'danger' }))) return; try { await API.payroll.removeAdjust(itemId, b.dataset.rm); await draw(); render(); } catch (e) { UI.apiError(e); } }));
    }
    try { await draw(); } catch (e) { UI.errorState(m.body, e); }
  }

  function confirmPayment() {
    const unpaid = period.items.filter((i) => i.status !== 'paid');
    const m = UI.modal({ title: 'Konfirmasi Pembayaran Gaji', subtitle: `${Fmt.monthLabel(period.period_key)} · transfer dilakukan manual di luar sistem`, size: 'lg',
      body: `<form novalidate data-f><div class="field" data-field="items"><span class="label">Karyawan yang sudah ditransfer</span><div class="list">
        <label class="list-item" style="cursor:pointer"><input type="checkbox" class="check" data-all checked><b>Pilih semua (${unpaid.length})</b><span class="grow"></span><b data-sum>${Fmt.rupiah(unpaid.reduce((s, i) => s + i.net_salary, 0))}</b></label>
        ${unpaid.map((i) => `<label class="list-item" style="cursor:pointer"><input type="checkbox" class="check" data-item="${i.id}" data-amt="${i.net_salary}" checked>${UI.person(i.employee)}<span class="grow"></span><span class="mono">${Fmt.rupiah(i.net_salary)}</span></label>`).join('')}</div><span class="field-error"></span></div>
        <div class="form-grid mt-4">${UI.field({ name: 'paid_at', label: 'Tanggal transfer', type: 'date', value: Fmt.today(), required: true, attrs: `max="${Fmt.today()}"` })}${UI.field({ name: 'method', label: 'Metode', type: 'select', options: ['Transfer bank (manual)', 'Tunai', 'E-wallet'], required: true })}
        ${UI.field({ name: 'reference', label: 'No. referensi (opsional)', placeholder: 'Mis. kode transfer bank' })}${UI.field({ name: 'note', label: 'Catatan (opsional)' })}</div></form>`,
      footer: `<button class="btn btn-outline" data-close>Batal</button><button class="btn btn-success" data-ok>${icon('check-circle')}Konfirmasi Lunas</button>` });
    const form = m.el.querySelector('[data-f]');
    const sync = () => { const sel = $$('[data-item]:checked', form); form.querySelector('[data-sum]').textContent = Fmt.rupiah(sel.reduce((s, c) => s + Number(c.dataset.amt), 0)); form.querySelector('[data-all]').checked = sel.length === unpaid.length; };
    form.querySelector('[data-all]').addEventListener('change', (e) => { $$('[data-item]', form).forEach((c) => { c.checked = e.target.checked; }); sync(); });
    $$('[data-item]', form).forEach((c) => c.addEventListener('change', sync));
    m.el.querySelector('[data-ok]').addEventListener('click', async (ev) => { const btn = ev.currentTarget;
      const ids = $$('[data-item]:checked', form).map((c) => c.dataset.item);
      const d = UI.validate(form, { paid_at: [UI.rules.required()], method: [UI.rules.required()] }); if (!d) return;
      if (!ids.length) return UI.showErrors(form, { items: 'Pilih minimal satu karyawan' });
      if (!(await UI.confirm({ title: 'Tandai sebagai Paid?', message: `Pastikan Anda <b>sudah mentransfer</b> gaji ${ids.length} karyawan. Karyawan akan menerima notifikasi "Gaji telah dibayar".`, confirmText: 'Ya, sudah ditransfer', tone: 'success' }))) return;
      const r = await UI.submit(btn, form, () => API.payroll.confirmPayment(period.id, ids, d));
      if (r) { UI.toast(`Pembayaran ${ids.length} karyawan dikonfirmasi.`, 'success'); m.close(); await loadPeriods(period.id); render(); }
    });
  }

  /* ---------- Salary configuration ---------- */
  async function config(p) {
    p.innerHTML = UI.loading(5);
    const cfgs = await API.payroll.salaryConfigs();
    p.innerHTML = `<div class="card-body" style="padding-bottom:0"><div class="alert alert-info">${icon('info')}<div>Setiap karyawan dapat memiliki konfigurasi gaji berbeda. Aturan potongan (izin tidak dibayar, absen, keterlambatan) diatur di <a href="${Auth.root()}owner/settings.html#payroll">Settings → Payroll</a> — tidak ada potongan universal otomatis.</div></div></div><div data-t></div>`;
    UI.table($('[data-t]', p), { rows: cfgs, pageSize: 20, columns: [
      { label: 'Karyawan', render: (c) => UI.person(c.employee) }, { label: 'Gaji pokok', render: (c) => (c.configured === false ? '<span class="badge badge-pending">Belum diisi</span>' : `<b>${Fmt.rupiah(c.basic_salary)}</b>`) },
      { label: 'Tunjangan', render: (c) => (c.allowances.length ? c.allowances.map((a) => `<div class="text-sm">${esc(a.name)}: ${Fmt.rupiah(a.amount)}</div>`).join('') : '<span class="text-3">—</span>') },
      { label: 'Lembur / jam', render: (c) => Fmt.rupiah(c.overtime_rate_per_hour) },
      { label: 'Tgl gajian', render: (c) => (c.pay_day ? `Tgl ${c.pay_day}` : '<span class="text-3">Tgl masuk</span>') },
      { label: 'Estimasi kotor', render: (c) => Fmt.rupiah(c.basic_salary + c.allowances.reduce((s, a) => s + a.amount, 0)) },
      { label: '', cls: 'col-actions', render: (c) => `<button class="btn btn-outline btn-sm" data-cfg="${c.employee_id}">${icon('pencil', 15)}Ubah</button>` }] });
    p.onclick = (e) => { const b = e.target.closest('[data-cfg]'); if (b) editConfig(cfgs.find((c) => c.employee_id === b.dataset.cfg)); };
  }

  function editConfig(c) {
    const allowRow = (a = { name: '', amount: '' }, i) => `<div class="flex gap-2 items-center" data-allow><input class="input input-sm" data-an placeholder="Nama tunjangan" value="${esc(a.name)}" aria-label="Nama tunjangan ${i + 1}"><input class="input input-sm" data-aa type="number" min="0" step="10000" placeholder="Nominal" value="${a.amount}" style="max-width:160px" aria-label="Nominal tunjangan ${i + 1}"><button type="button" class="btn btn-ghost btn-icon btn-sm text-danger" data-rm aria-label="Hapus">${icon('trash', 15)}</button></div>`;
    const m = UI.modal({ title: 'Konfigurasi Gaji', subtitle: esc(c.employee.full_name), size: 'lg',
      body: `<form class="form-grid" novalidate data-f>${UI.field({ name: 'basic_salary', label: 'Gaji pokok (Rp/bulan)', type: 'number', value: c.basic_salary, required: true, attrs: 'min="0" step="50000"' })}${UI.field({ name: 'overtime_rate_per_hour', label: 'Tarif lembur (Rp/jam)', type: 'number', value: c.overtime_rate_per_hour, attrs: 'min="0" step="1000"' })}
        ${UI.field({ name: 'pay_day', label: 'Tanggal gajian (1–31)', type: 'number', value: c.pay_day || '', attrs: 'min="1" max="31" step="1"', placeholder: 'Ikuti tanggal masuk', hint: 'Kosongkan = mengikuti tanggal masuk kerja. Jika bulan lebih pendek, dibayar di hari terakhir bulan itu. Dipakai bila Settings → Payroll memakai aturan "tanggal masuk".' })}
        <div class="span-2"><div class="label mb-4">Tunjangan tetap</div><div class="flex" style="flex-direction:column;gap:8px" data-allows>${c.allowances.map(allowRow).join('')}</div><button type="button" class="btn btn-ghost btn-sm mt-2" data-add>${icon('plus')}Tambah tunjangan</button><div class="field-error" data-allow-err></div></div>
        <div class="span-2 alert alert-warning">${icon('info')}<div>Perubahan berlaku untuk perhitungan payroll berikutnya. Payroll yang sudah disetujui tidak berubah.</div></div></form>`,
      footer: `<button class="btn btn-outline" data-close>Batal</button><button class="btn btn-primary" data-save>${icon('check')}Simpan</button>` });
    const form = m.el.querySelector('[data-f]'), list = form.querySelector('[data-allows]');
    form.querySelector('[data-add]').addEventListener('click', () => list.insertAdjacentHTML('beforeend', allowRow(undefined, list.children.length)));
    list.addEventListener('click', (e) => { const r = e.target.closest('[data-rm]'); if (r) r.closest('[data-allow]').remove(); });
    m.el.querySelector('[data-save]').addEventListener('click', async (ev) => { const btn = ev.currentTarget;
      const d = UI.validate(form, { basic_salary: [UI.rules.required(), UI.rules.positive()], pay_day: [(v) => (v !== '' && v != null && !(Number(v) >= 1 && Number(v) <= 31 && Number.isInteger(Number(v))) ? 'Isi 1–31 atau kosongkan' : null)] }); if (!d) return;
      const allowances = $$('[data-allow]', list).map((r) => ({ name: r.querySelector('[data-an]').value.trim(), amount: r.querySelector('[data-aa]').value })).filter((a) => a.name || a.amount);
      if (allowances.some((a) => !a.name || a.amount === '' || Number(a.amount) < 0)) { form.querySelector('[data-allow-err]').textContent = 'Lengkapi nama dan nominal setiap tunjangan.'; return; }
      const r = await UI.submit(btn, form, () => API.payroll.updateSalaryConfig(c.employee_id, { ...d, allowances }));
      if (r) { UI.toast('Konfigurasi gaji disimpan.', 'success'); m.close(); render(); }
    });
  }

  /* ---------- History ---------- */
  async function history(p) {
    await loadPeriods(st.periodId);
    const asc = [...periods].reverse();
    p.innerHTML = `<div class="card-body"><div class="chart-box sm" data-c></div></div><div data-t></div>`;
    Charts.bar($('[data-c]', p), { labels: asc.map((x) => Fmt.monthLabel(x.period_key, true)), datasets: [{ label: 'Total gaji bersih', data: asc.map((x) => x.total_net) }], yFormat: (v) => Fmt.rupiah(v, { compact: true }) });
    UI.table($('[data-t]', p), { rows: periods, onRow: (x) => { st.periodId = x.id; $('[data-period]').value = x.id; switchTab('overview'); }, columns: [
      { label: 'Periode', render: (x) => `<b>${Fmt.monthLabel(x.period_key)}</b><div class="text-xs text-3">${Fmt.date(x.start_date)} – ${Fmt.date(x.end_date)}</div>` },
      { label: 'Total', render: (x) => Fmt.rupiah(x.total_net) }, { label: 'Karyawan', render: (x) => x.employees },
      { label: 'Dibayar', render: (x) => `${x.paid_count}/${x.employees}` }, { label: 'Jadwal bayar', render: (x) => Fmt.date(x.payment_date) },
      { label: 'Status', render: (x) => UI.badge(x.status_display) }, { label: '', cls: 'col-actions', render: () => icon('chevron-right', 16, 'text-3') }] });
  }

  function generateDialog() {
    const next = Fmt.toISODate(new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1)).slice(0, 7);
    const m = UI.modal({ title: 'Hitung Payroll', size: 'sm', body: `<form novalidate data-f>${UI.field({ name: 'period_key', label: 'Bulan pembayaran', type: 'month', value: Fmt.today().slice(0, 7), required: true, attrs: `max="${next}"` })}
      <p class="text-xs text-3 mt-2">Dengan aturan "tanggal masuk kerja", tiap karyawan dibayar pada tanggal masuknya di bulan ini, untuk siklus kerja sejak tanggal yang sama bulan lalu. Periode draft dapat dihitung ulang kapan saja.</p></form>`,
      footer: `<button class="btn btn-outline" data-close>Batal</button><button class="btn btn-primary" data-ok>${icon('calculator')}Hitung</button>` });
    const form = m.el.querySelector('[data-f]');
    m.el.querySelector('[data-ok]').addEventListener('click', async (ev) => { const d = UI.validate(form, { period_key: [UI.rules.required()] }); if (!d) return;
      const r = await UI.submit(ev.currentTarget, form, () => API.payroll.generate(d.period_key));
      if (r) { UI.toast(`Payroll ${Fmt.monthLabel(r.period_key)} dihitung (${r.items.length} karyawan).`, 'success'); m.close(); await loadPeriods(r.id); switchTab('overview'); } });
  }

  function switchTab(t) { st.tab = t; $$('[data-tab]', el).forEach((b) => b.classList.toggle('is-active', b.dataset.tab === t)); render(); }
  UI.tabs(el.querySelector('.card'), (t) => { st.tab = t; render(); });
  $('[data-gen]').addEventListener('click', () => generateDialog());
  $('[data-period]').addEventListener('change', (e) => { st.periodId = e.target.value; if (st.tab !== 'overview') switchTab('overview'); else render(); });
  try { await loadPeriods(); render(); } catch (e) { UI.errorState($('[data-panel]'), e, () => location.reload()); }
})();
