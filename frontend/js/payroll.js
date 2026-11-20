/* =========================================================
   AbsenInn — Shared payslip view (owner + employee).
   Demo: printable HTML payslip via the browser print dialog.
   Production: also a server-generated PDF (GET /api/payroll/items/{id}/pdf/).
   ========================================================= */
(function () {
  const { icon, esc } = UI;

  function html(it) {
    const allow = (it.allowances || []);
    const ded = (it.deductions || []);
    const adds = (it.adjustments || []).filter((a) => a.type === 'addition');
    const subs = (it.adjustments || []).filter((a) => a.type === 'deduction');
    const row = (l, v, neg) => `<tr><td>${esc(l)}</td><td class="${neg ? 'text-danger' : ''}">${neg ? '−' : ''}${Fmt.rupiah(v)}</td></tr>`;
    const company = it.company || {};
    const status = it.period.status_display || it.period.status;
    return `<div class="payslip">
      <div class="payslip-head">
        <div class="brand"><img class="brand-mark" src="${Auth.root()}assets/images/logo-mark.svg" alt=""><div><div class="fw-700">${esc(company.name || 'Perusahaan')}</div><div class="text-xs text-3">${esc(company.address || '')}</div></div></div>
        <div class="text-right"><div class="fw-700" style="font-size:1.1rem;letter-spacing:.04em">SLIP GAJI</div><div class="text-sm text-3">${Fmt.monthLabel(it.period.period_key)}</div></div>
      </div>
      <dl class="kv mt-4">
        <dt>Nama karyawan</dt><dd>${esc(it.employee.full_name)}</dd>
        <dt>Employee ID</dt><dd class="mono">${esc(it.employee.employee_code)}</dd>
        <dt>Jabatan</dt><dd>${esc(it.employee.position)}</dd>
        <dt>Periode kerja</dt><dd>${Fmt.date(it.cycle_start || it.period.start_date)} – ${Fmt.date(it.cycle_end || it.period.end_date)}</dd>
        <dt>Tanggal pembayaran</dt><dd>${it.payment ? Fmt.date(it.payment.paid_at) : `${Fmt.date(it.payment_date || it.period.payment_date)} <span class="text-3 text-xs">(jadwal)</span>`}</dd>
        <dt>Status pembayaran</dt><dd>${UI.badge(it.status === 'paid' ? 'paid' : status)}</dd>
      </dl>
      <div class="grid grid-2 mt-4" style="gap:24px">
        <div><div class="fw-700 text-sm">Pendapatan</div><table class="payslip-table">
          ${row('Gaji pokok', it.basic_salary)}${allow.map((a) => row(a.name, a.amount)).join('')}
          ${it.bonus ? row('Bonus', it.bonus) : ''}${it.incentives ? row('Insentif', it.incentives) : ''}
          ${it.overtime_amount ? row(`Lembur (${it.overtime_hours} jam)`, it.overtime_amount) : ''}${adds.map((a) => row(`Penyesuaian: ${a.name}`, a.amount)).join('')}
        </table></div>
        <div><div class="fw-700 text-sm">Potongan</div><table class="payslip-table">
          ${ded.length || subs.length ? ded.map((d) => row(d.name, d.amount, true)).join('') + subs.map((a) => row(`Penyesuaian: ${a.name}`, a.amount, true)).join('') : '<tr><td class="text-3">Tidak ada potongan</td><td>Rp0</td></tr>'}
        </table></div>
      </div>
      <div class="payslip-total"><span class="fw-600">Gaji bersih (Net Salary)</span><strong>${Fmt.rupiah(it.net_salary)}</strong></div>
      ${it.payment ? `<p class="text-xs text-3 mt-3">Dibayar via ${esc(it.payment.method)}${it.payment.reference ? ' · Ref. ' + esc(it.payment.reference) : ''}.</p>` : ''}
      <p class="text-xs text-3 mt-3">Dokumen ini bersifat rahasia dan hanya untuk karyawan yang bersangkutan.${API.isDemo() ? ' Data fiktif (mode demo).' : ''}</p>
    </div>`;
  }

  async function open(itemId) {
    const m = UI.modal({ title: 'Slip Gaji', size: 'lg', body: UI.loading(8), footer: `<button class="btn btn-outline" data-close>Tutup</button>${API.isDemo() ? '' : `<button class="btn btn-secondary" data-pdf>${icon('download')}Unduh PDF</button>`}<button class="btn btn-primary" data-print disabled>${icon('printer')}Cetak</button>` });
    const pdf = m.el.querySelector('[data-pdf]');
    if (pdf) pdf.addEventListener('click', async () => { pdf.classList.add('is-loading'); try { await API.payroll.pdf(itemId); } catch (e) { UI.apiError(e); } finally { pdf.classList.remove('is-loading'); } });
    try {
      const it = await API.payroll.item(itemId);
      m.body.innerHTML = html(it);
      const p = m.el.querySelector('[data-print]'); p.disabled = false; p.addEventListener('click', () => UI.printModal(m));
    } catch (e) { UI.errorState(m.body, e); }
  }

  window.Payslip = { html, open };
})();
