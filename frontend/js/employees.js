/* =========================================================
   AbsenInn — Shared employee form (add / edit), used by the
   Employees list and Employee Detail pages.
   ========================================================= */
(function () {
  const { icon, esc } = UI;
  const POSITIONS = ['Store Staff', 'Warehouse Staff', 'CS Officer', 'Admin Staff', 'Picker Staff', 'Kasir', 'Kurir'];

  function open(emp, onSaved) {
    const isNew = !emp;
    const e = emp || { join_date: Fmt.today(), employment_type: 'Tetap' };
    const m = UI.modal({
      title: isNew ? 'Tambah Karyawan' : 'Edit Karyawan', subtitle: isNew ? 'Data karyawan & akun login' : esc(e.employee_code), size: 'lg',
      body: `<form class="form-grid" novalidate data-emp-form>
        ${UI.field({ name: 'full_name', label: 'Nama lengkap', value: e.full_name || '', required: true, placeholder: 'Mis. Sari Lestari' })}
        ${UI.field({ name: 'email', label: 'Email', type: 'email', value: e.email || '', required: true, placeholder: 'nama@perusahaan.com', hint: isNew ? 'Dipakai sebagai email login karyawan.' : '' })}
        ${UI.field({ name: 'phone', label: 'No. telepon', value: e.phone || '', placeholder: '08xx-xxxx-xxxx' })}
        <div class="field" data-field="position"><label class="label">Jabatan<span class="req">*</span></label><input class="input" name="position" list="pos-list" value="${esc(e.position || '')}" placeholder="Pilih atau ketik jabatan"><datalist id="pos-list">${POSITIONS.map((p) => `<option value="${p}">`).join('')}</datalist><span class="field-error"></span></div>
        ${UI.field({ name: 'join_date', label: 'Tanggal bergabung', type: 'date', value: e.join_date || '', required: true })}
        ${UI.field({ name: 'employment_type', label: 'Tipe kepegawaian', type: 'select', value: e.employment_type, options: ['Tetap', 'Kontrak', 'Paruh Waktu', 'Magang'] })}
        ${UI.field({ name: 'address', label: 'Alamat', type: 'textarea', value: e.address || '', span: true, rows: 2 })}
        ${isNew ? `<div class="span-2" style="border-top:1px solid var(--border);padding-top:16px"><div class="fw-700">Konfigurasi gaji awal</div><div class="text-xs text-3">Tunjangan default diambil dari Settings → Payroll dan dapat diubah di halaman Payroll.</div></div>
          ${UI.field({ name: 'basic_salary', label: 'Gaji pokok (Rp / bulan)', type: 'number', required: true, attrs: 'min="0" step="50000"', placeholder: '3000000' })}
          ${UI.field({ name: 'overtime_rate_per_hour', label: 'Tarif lembur (Rp / jam)', type: 'number', attrs: 'min="0" step="1000"', placeholder: '0' })}
          <label class="check span-2"><input type="checkbox" name="create_account" checked> Buat akun login karyawan dengan email di atas</label>
          <div class="alert alert-info span-2">${icon('info')}<div>Di produksi, akun dibuat melalui Supabase Auth oleh backend (undangan email). Mode demo hanya menautkan akun fiktif.</div></div>` : ''}
      </form>`,
      footer: `<button class="btn btn-outline" data-close>Batal</button><button class="btn btn-primary" data-save>${icon('check')}${isNew ? 'Simpan Karyawan' : 'Simpan Perubahan'}</button>`,
    });
    const form = m.el.querySelector('[data-emp-form]');
    m.el.querySelector('[data-save]').addEventListener('click', async (ev) => { const btn = ev.currentTarget;
      const r = UI.rules;
      const data = UI.validate(form, { full_name: [r.required(), r.min(3)], email: [r.required(), r.email()], phone: [r.phone()], position: [r.required('Jabatan wajib diisi')], join_date: [r.required()], ...(isNew ? { basic_salary: [r.required(), r.positive()] } : {}) });
      if (!data) return;
      const saved = await UI.submit(btn, form, () => (isNew ? API.employees.create(data) : API.employees.update(e.id, data)));
      if (saved) { UI.toast(isNew ? `${saved.full_name} ditambahkan (${saved.employee_code}).` : 'Data karyawan diperbarui.', 'success'); m.close(); if (onSaved) onSaved(saved); }
    });
  }

  async function toggleStatus(emp, onDone) {
    const deactivate = emp.employment_status === 'active';
    const ok = await UI.confirm({ title: deactivate ? 'Nonaktifkan karyawan?' : 'Aktifkan kembali?', tone: deactivate ? 'danger' : 'success', confirmText: deactivate ? 'Nonaktifkan' : 'Aktifkan',
      message: deactivate ? `<b>${esc(emp.full_name)}</b> tidak akan bisa login dan tidak muncul di absensi harian. Data historis (absensi, payroll) tetap tersimpan.` : `<b>${esc(emp.full_name)}</b> akan dapat login kembali.` });
    if (!ok) return;
    try { const r = await (deactivate ? API.employees.deactivate(emp.id) : API.employees.activate(emp.id)); UI.toast(deactivate ? 'Karyawan dinonaktifkan.' : 'Karyawan diaktifkan kembali.', 'success'); if (onDone) onDone(r); }
    catch (e) { UI.apiError(e); }
  }

  window.EmployeeForm = { open, toggleStatus, POSITIONS };
})();
