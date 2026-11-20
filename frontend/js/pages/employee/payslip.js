/* AbsenInn — Employee: My Payslip (own data only — enforced server-side) */
(async function () {
  await Layout.init({ role: 'employee', page: 'payslip', title: 'My Payslip' });
  const { icon, $ } = UI;
  const el = $('#content');
  el.innerHTML = `${Layout.pageHeader({ title: 'My Payslip', subtitle: 'Slip gaji dan riwayat pembayaran Anda.' })}<div data-body>${UI.loading(6)}</div>`;

  async function load() {
    const body = $('[data-body]');
    try {
      const slips = await API.payroll.myPayslips();
      if (!slips.length) { body.innerHTML = `<div class="card">${UI.empty('Belum ada slip gaji', 'Slip gaji muncul setelah owner menyetujui payroll periode berjalan.', 'receipt')}</div>`; return; }
      const latest = slips[0];
      const st = latest.status === 'paid' ? 'paid' : latest.period.status_display;
      body.innerHTML = `<div class="grid grid-main-side">
        <div class="attend-card"><div class="text-sm" style="opacity:.8">Slip terbaru · ${Fmt.monthLabel(latest.period.period_key)}</div><div style="font-size:2rem;font-weight:800;letter-spacing:-.02em;margin-top:6px">${Fmt.rupiah(latest.net_salary)}</div><div class="text-sm" style="opacity:.85">Gaji bersih (net salary)</div>
          <div class="attend-times"><div class="attend-time"><small>Status</small><b>${UI.statusLabel(st)}</b></div><div class="attend-time"><small>${latest.payment ? 'Dibayar' : 'Jadwal bayar'}</small><b>${Fmt.date(latest.payment ? latest.payment.paid_at : latest.period.payment_date, 'short')}</b></div><div class="attend-time"><small>Periode</small><b>${Fmt.monthLabel(latest.period.period_key, true)}</b></div></div>
          <div class="attend-actions"><button class="btn btn-light btn-lg" data-slip="${latest.id}">${icon('download')}Lihat & Unduh PDF</button></div></div>
        <div class="card"><div class="card-header"><div class="card-title">Status Pembayaran</div></div><div class="card-body">
          ${st === 'paid' ? `<div class="alert alert-success">${icon('check-circle')}<div>Gaji ${Fmt.monthLabel(latest.period.period_key)} sudah ditransfer pada ${Fmt.date(latest.payment.paid_at)}.</div></div>` : st === 'overdue' ? `<div class="alert alert-danger">${icon('alert-triangle')}<div>Pembayaran melewati jadwal (${Fmt.date(latest.payment_date || latest.period.payment_date)}) dan belum dikonfirmasi owner.</div></div>` : `<div class="alert alert-info">${icon('calendar')}<div>Gaji dijadwalkan dibayar ${Fmt.date(latest.payment_date || latest.period.payment_date)}. Status berubah menjadi "Dibayar" setelah owner mengonfirmasi transfer.</div></div>`}
          <div class="alert alert-primary mt-3">${icon('lock')}<div>Data gaji bersifat privat — hanya Anda dan owner yang dapat melihatnya.</div></div></div></div></div>
        <div class="card mt-6"><div class="card-header"><div class="card-title">Riwayat Gaji</div></div><div data-t></div></div>`;
      UI.table($('[data-t]'), { rows: slips, columns: [
        { label: 'Periode', render: (i) => `<b>${Fmt.monthLabel(i.period.period_key)}</b>` }, { label: 'Gaji bersih', render: (i) => Fmt.rupiah(i.net_salary) },
        { label: 'Status', render: (i) => UI.badge(i.status === 'paid' ? 'paid' : i.period.status_display) }, { label: 'Tanggal bayar', render: (i) => (i.payment ? Fmt.date(i.payment.paid_at) : `<span class="text-3">${Fmt.date(i.payment_date || i.period.payment_date)} (jadwal)</span>`) },
        { label: '', cls: 'col-actions', render: (i) => `<button class="btn btn-outline btn-sm" data-slip="${i.id}">${icon('receipt', 15)}Slip</button>` }] });
      body.onclick = (e) => { const b = e.target.closest('[data-slip]'); if (b) Payslip.open(b.dataset.slip); };
    } catch (e) { UI.errorState(body, e, load); }
  }
  load();
})();
