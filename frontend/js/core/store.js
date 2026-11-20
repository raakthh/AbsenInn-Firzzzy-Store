/* =========================================================
   AbsenInn — Demo data store (DEMO MODE ONLY)
   - All names, emails, salaries are FICTITIOUS.
   - Persisted in localStorage purely so the demo survives reloads.
     localStorage is NOT secure storage: production uses Supabase
     PostgreSQL + Django API (Phase 2–3). No passwords and no real
     selfie photos are stored here.
   - Shapes mirror the planned PostgreSQL tables (company_id on
     every business row) so Phase 2 can swap this layer out.
   ========================================================= */
(function () {
  const KEY = APP_CONFIG.DEMO_STORAGE_KEY;
  const SCHEMA_VERSION = 3;
  const CID = 'c-001';

  /* Deterministic PRNG so the demo looks the same on every reset. */
  function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

  function isoAt(dateStr, hm, jitterMin = 0) {
    const d = Fmt.parseDate(dateStr);
    const [h, m] = hm.split(':').map(Number);
    d.setHours(h, m + jitterMin, Math.floor(Math.random() * 50), 0);
    return d.toISOString();
  }

  function seed() {
    const R = rng(20250428);
    const today = Fmt.today();
    const now = new Date();
    const nowMin = now.getHours() * 60 + now.getMinutes();

    const company = { id: CID, name: 'Toko Sinar Contoh (Demo)', address: 'Alamat contoh — ubah melalui Settings', phone: '0812-0000-0000', email: 'halo@tokocontoh.demo', logo_url: null, created_at: Fmt.addDays(today, -400) };

    const settings = {
      company_id: CID,
      work: { start: '08:00', end: '16:00', break_start: '12:00', break_end: '13:00', working_days: [1, 2, 3, 4, 5, 6], late_tolerance_min: 10, early_leave_tolerance_min: 0 },
      attendance: {
        /* No real coordinates are seeded on purpose — the owner sets the work location in Settings. */
        location: { name: '', address: '', lat: null, lng: null },
        radius_m: 100, selfie_required: true, gps_required: true, max_gps_accuracy_m: 100,
      },
      payroll: {
        period: 'monthly', payment_day: 28, payment_day_mode: 'fixed',
        rules: { unpaid_leave: 'prorate', absent: 'none', late_per_incident: 0, overtime_enabled: true },
        default_components: [{ name: 'Tunjangan Transport', amount: 300000 }, { name: 'Tunjangan Makan', amount: 250000 }],
      },
      leave: { annual_quota_days: 12, approval: 'owner', min_notice_days: 0 },
      notifications: { leave_requests: true, attendance_reminder: true, task_deadline: true, payroll: true },
      profile_editable_fields: ['phone', 'address'],
    };

    const leave_types = [
      { id: 'lt-annual', company_id: CID, code: 'annual', name: 'Cuti Tahunan', name_en: 'Annual Leave', is_paid: true, uses_quota: true, requires_attachment: false, half_day: false, attendance_status: 'paid_leave', active: true },
      { id: 'lt-sick', company_id: CID, code: 'sick', name: 'Sakit', name_en: 'Sick Leave', is_paid: true, uses_quota: false, requires_attachment: true, half_day: false, attendance_status: 'sick', active: true },
      { id: 'lt-personal', company_id: CID, code: 'personal', name: 'Izin Pribadi', name_en: 'Personal Permission', is_paid: true, uses_quota: false, requires_attachment: false, half_day: false, attendance_status: 'paid_leave', active: true },
      { id: 'lt-unpaid', company_id: CID, code: 'unpaid', name: 'Cuti Tidak Dibayar', name_en: 'Unpaid Leave', is_paid: false, uses_quota: false, requires_attachment: false, half_day: false, attendance_status: 'unpaid_leave', active: true },
      { id: 'lt-half', company_id: CID, code: 'half_day', name: 'Izin Setengah Hari', name_en: 'Half-day Leave', is_paid: true, uses_quota: true, requires_attachment: false, half_day: true, attendance_status: 'paid_leave', active: true },
    ];

    const people = [
      ['Aisyah Putri', 'Store Staff', '2025-01-15', 'Jl. Melati No. 12 (contoh)', 3200000, '#6C55F2'],
      ['Bima Pratama', 'Warehouse Staff', '2025-01-20', 'Jl. Kenanga No. 5 (contoh)', 3000000, '#4F8DF7'],
      ['Citra Dewi', 'CS Officer', '2025-02-01', 'Jl. Anggrek No. 21 (contoh)', 3100000, '#E0559B'],
      ['Dimas Anggara', 'Admin Staff', '2025-02-10', 'Jl. Flamboyan No. 8 (contoh)', 3400000, '#13A985'],
      ['Eka Rahma', 'Picker Staff', '2025-02-15', 'Jl. Dahlia No. 3 (contoh)', 2900000, '#F08A10'],
    ];
    const employees = people.map((p, i) => ({
      id: `e-00${i + 1}`, company_id: CID, employee_code: `EMP-00${i + 1}`, full_name: p[0],
      email: p[0].toLowerCase().split(' ')[0] + '@absenninn.demo', phone: `0813-0000-00${10 + i}`,
      address: p[3], position: p[1], join_date: p[2], employment_status: 'active', employment_type: i === 4 ? 'Kontrak' : 'Tetap',
      avatar_color: p[5], photo_url: null, user_id: `u-emp-00${i + 1}`,
      history: [{ date: p[2], event: `Bergabung sebagai ${p[1]}` }],
      created_at: p[2] + 'T09:00:00.000Z',
    }));

    const salary_configs = employees.map((e, i) => ({
      employee_id: e.id, company_id: CID, basic_salary: people[i][4],
      allowances: settings.payroll.default_components.map((c) => ({ ...c })),
      overtime_rate_per_hour: 20000, effective_from: e.join_date,
    }));

    const profiles = [
      { id: 'u-owner', company_id: CID, email: 'owner@absenninn.demo', role: 'owner', full_name: 'Rina Wijaya', employee_id: null, avatar_color: '#3B2898' },
      ...employees.map((e) => ({ id: e.user_id, company_id: CID, email: e.email, role: 'employee', full_name: e.full_name, employee_id: e.id, avatar_color: e.avatar_color })),
    ];

    /* ---- Leave requests (created first so attendance can reflect approved leave) ---- */
    const ws = settings.work.working_days;
    const isWorkDay = (d) => ws.includes(Fmt.parseDate(d).getDay());
    const L = (id, emp, type, s, e, status, reason, reqOffset, note) => ({
      id, company_id: CID, employee_id: emp, leave_type_id: type, start_date: s, end_date: e, reason,
      attachment_name: type === 'lt-sick' ? 'surat-dokter-contoh.pdf' : null, status, owner_notes: note || '',
      requested_at: isoAt(Fmt.addDays(s, -reqOffset), '09:15'), decided_at: status === 'pending' ? null : isoAt(Fmt.addDays(s, -Math.max(0, reqOffset - 1)), '13:40'),
    });
    const leave_requests = [
      L('lv-001', 'e-005', 'lt-sick', today, today, 'approved', 'Demam, istirahat sesuai saran dokter.', 0, 'Semoga lekas sembuh.'),
      L('lv-002', 'e-003', 'lt-personal', Fmt.addDays(today, 3), Fmt.addDays(today, 3), 'pending', 'Mengurus dokumen keluarga.', 2),
      L('lv-003', 'e-004', 'lt-annual', Fmt.addDays(today, 9), Fmt.addDays(today, 11), 'pending', 'Acara keluarga di luar kota.', 3),
      L('lv-004', 'e-002', 'lt-unpaid', Fmt.addDays(today, -18), Fmt.addDays(today, -17), 'approved', 'Keperluan pribadi mendesak.', 4, 'Disetujui sebagai cuti tidak dibayar.'),
      L('lv-005', 'e-001', 'lt-annual', Fmt.addDays(today, -25), Fmt.addDays(today, -25), 'approved', 'Liburan singkat.', 7, ''),
      L('lv-006', 'e-005', 'lt-annual', Fmt.addDays(today, -6), Fmt.addDays(today, -5), 'rejected', 'Ingin berlibur.', 2, 'Bertepatan dengan stock opname, mohon ajukan tanggal lain.'),
      L('lv-007', 'e-003', 'lt-half', Fmt.addDays(today, -11), Fmt.addDays(today, -11), 'approved', 'Kontrol ke klinik siang hari.', 2, ''),
    ];
    const leaveOn = (emp, d) => leave_requests.find((l) => l.employee_id === emp && l.status === 'approved' && d >= l.start_date && d <= l.end_date);

    /* ---- Attendance (last ~70 days + today where the time has already passed) ---- */
    const attendance = [];
    const startDay = Fmt.addDays(today, -70);
    let n = 1;
    const workStart = Fmt.hmToMinutes(settings.work.start);
    const workEnd = Fmt.hmToMinutes(settings.work.end);
    for (let d = startDay; d <= today; d = Fmt.addDays(d, 1)) {
      if (!isWorkDay(d)) continue;
      employees.forEach((e, idx) => {
        if (Fmt.parseDate(d) < Fmt.parseDate(e.join_date)) return;
        const isToday = d === today;
        const base = { id: `at-${String(n++).padStart(5, '0')}`, company_id: CID, employee_id: e.id, date: d, source: 'seed', notes: '', check_in_at: null, check_out_at: null, work_minutes: null,
          location_status: null, distance_in_m: null, distance_out_m: null, accuracy_in_m: null, accuracy_out_m: null, lat_in: null, lng_in: null, lat_out: null, lng_out: null,
          selfie_in_path: null, selfie_out_path: null, flags: [] };
        const lv = leaveOn(e.id, d);
        const lt = lv && leave_types.find((t) => t.id === lv.leave_type_id);
        if (lv && !lt.half_day) { attendance.push({ ...base, status: lt.attendance_status, leave_request_id: lv.id, notes: lt.name }); return; }
        if (isToday && idx === 0) return; // Demo employee account (Aisyah) checks in herself.
        const roll = R();
        if (!isToday && roll < 0.035) { attendance.push({ ...base, status: 'absent', notes: 'Tidak ada check-in & tidak ada izin (hasil rekonsiliasi)' }); return; }
        let inOffset = Math.floor(R() * 14) - 9;                // mostly on time
        if (roll > 0.86) inOffset = 11 + Math.floor(R() * 28);  // late
        if (idx === 2 && R() > 0.7) inOffset = 12 + Math.floor(R() * 15); // Citra is late more often
        const inMin = workStart + inOffset;
        if (isToday && nowMin < inMin) return;                 // hasn't happened yet today
        let outMin = workEnd + Math.floor(R() * 25);
        if (R() < 0.05) outMin = workEnd - 30 - Math.floor(R() * 60); // early leave
        if (lv && lt.half_day) outMin = workStart + 240;
        const checkIn = isoAt(d, '00:00', inMin);
        const hasOut = !isToday || nowMin >= outMin;
        const checkOut = hasOut ? isoAt(d, '00:00', outMin) : null;
        const late = inOffset > settings.work.late_tolerance_min;
        const early = hasOut && outMin < workEnd && !(lv && lt.half_day);
        const dist = Math.round(8 + R() * 60), acc = Math.round(6 + R() * 22);
        const rec = { ...base, check_in_at: checkIn, check_out_at: checkOut,
          status: late ? 'late' : early ? 'early_leave' : 'present',
          work_minutes: hasOut ? outMin - inMin - 60 : null,
          location_status: 'verified', distance_in_m: dist, accuracy_in_m: acc,
          distance_out_m: hasOut ? Math.round(8 + R() * 60) : null, accuracy_out_m: hasOut ? Math.round(6 + R() * 22) : null,
          selfie_in_path: 'demo-placeholder', selfie_out_path: hasOut ? 'demo-placeholder' : null,
          leave_request_id: lv ? lv.id : null, notes: lv ? 'Izin setengah hari' : '' };
        if (R() < 0.03 && !isToday) { rec.location_status = 'needs_review'; rec.distance_in_m = 140 + Math.round(R() * 90); rec.flags = ['outside_radius']; rec.notes = 'Di luar radius — perlu review owner'; rec.status = 'needs_review'; }
        attendance.push(rec);
      });
    }

    /* ---- Tasks ---- */
    const T = (id, title, desc, emp, prio, dl, status, progress, createdOff) => ({
      id, company_id: CID, title, description: desc, assignee_id: emp, priority: prio, deadline: Fmt.addDays(today, dl), status, progress,
      created_by: 'u-owner', created_at: isoAt(Fmt.addDays(today, -createdOff), '08:30'), completed_at: status === 'completed' ? isoAt(Fmt.addDays(today, Math.min(dl, 0) - 1), '15:10') : null,
      history: [{ at: isoAt(Fmt.addDays(today, -createdOff), '08:30'), by: 'Rina Wijaya', action: 'Tugas dibuat', from: null, to: 'todo' }]
        .concat(status !== 'todo' ? [{ at: isoAt(Fmt.addDays(today, -createdOff + 1), '10:00'), by: people[Number(emp.slice(-1)) - 1][0], action: 'Status diubah', from: 'todo', to: 'in_progress' }] : [])
        .concat(status === 'completed' ? [{ at: isoAt(Fmt.addDays(today, Math.min(dl, 0) - 1), '15:10'), by: people[Number(emp.slice(-1)) - 1][0], action: 'Status diubah', from: 'in_progress', to: 'completed' }] : []),
    });
    const tasks = [
      T('tk-001', 'Packing order Shopee', 'Kemas semua pesanan Shopee batch pagi dan cetak label pengiriman.', 'e-001', 'high', 0, 'in_progress', 60, 1),
      T('tk-002', 'Update stok produk', 'Sinkronkan stok fisik dengan data stok di marketplace.', 'e-002', 'medium', 1, 'todo', 0, 2),
      T('tk-003', 'Upload konten TikTok', 'Unggah 3 video produk baru beserta deskripsi.', 'e-003', 'medium', 2, 'todo', 0, 1),
      T('tk-004', 'Stock checking gudang B', 'Cek fisik stok rak B1–B6 dan catat selisih.', 'e-005', 'high', -1, 'in_progress', 40, 4),
      T('tk-005', 'Balas chat pelanggan', 'Pastikan semua chat pelanggan dibalas < 1 jam.', 'e-003', 'low', 5, 'in_progress', 30, 2),
      T('tk-006', 'Rekap pesanan mingguan', 'Buat rekap pesanan minggu ini untuk owner.', 'e-004', 'medium', -2, 'completed', 100, 6),
      T('tk-007', 'Administrasi invoice supplier', 'Input invoice supplier bulan ini ke spreadsheet.', 'e-004', 'high', 4, 'todo', 0, 1),
      T('tk-008', 'Order processing marketplace', 'Proses pesanan masuk Tokopedia dan Lazada.', 'e-001', 'medium', -4, 'completed', 100, 8),
      T('tk-009', 'Packing order Tokopedia', 'Kemas pesanan Tokopedia batch siang.', 'e-005', 'medium', -3, 'completed', 100, 5),
      T('tk-010', 'Upload produk baru', 'Upload 10 SKU baru lengkap dengan foto dan harga.', 'e-002', 'low', -6, 'completed', 100, 10),
      T('tk-011', 'Customer service retur', 'Tangani 4 pengajuan retur pelanggan.', 'e-003', 'high', -8, 'completed', 100, 12),
    ];

    /* ---- Payroll: 3 closed months (paid) + current month (draft) ---- */
    const monthKeyOf = (offset) => { const d = new Date(now.getFullYear(), now.getMonth() + offset, 1); return Fmt.toISODate(d).slice(0, 7); };
    const payroll_periods = [], payroll_items = [], payments = [];
    [-3, -2, -1, 0].forEach((off, pi) => {
      const key = monthKeyOf(off);
      const [y, m] = key.split('-').map(Number);
      const start = `${key}-01`, end = Fmt.toISODate(new Date(y, m, 0));
      const payDate = `${key}-${Fmt.pad(Math.min(settings.payroll.payment_day, Number(end.slice(-2))))}`;
      const isCurrent = off === 0;
      const pid = `pp-${key}`;
      payroll_periods.push({ id: pid, company_id: CID, period_key: key, start_date: start, end_date: end, payment_date: payDate,
        status: isCurrent ? 'draft' : 'paid', approved_at: isCurrent ? null : isoAt(Fmt.addDays(payDate, -2), '10:00'), created_at: isoAt(start, '09:00') });
      employees.forEach((e, i) => {
        const cfg = salary_configs[i];
        const allowance = cfg.allowances.reduce((s, a) => s + a.amount, 0);
        const bonus = !isCurrent && R() > 0.6 ? 100000 * (1 + Math.floor(R() * 3)) : 0;
        const otHours = isCurrent ? 0 : Math.floor(R() * 6);
        const unpaidDays = e.id === 'e-002' && attendance.some((a) => a.employee_id === e.id && a.status === 'unpaid_leave' && a.date.startsWith(key))
          ? attendance.filter((a) => a.employee_id === e.id && a.status === 'unpaid_leave' && a.date.startsWith(key)).length : 0;
        const daily = Math.round(cfg.basic_salary / 26);
        const deductions = unpaidDays ? [{ name: `Cuti tidak dibayar (${unpaidDays} hari)`, amount: unpaidDays * daily }] : [];
        const ded = deductions.reduce((s, x) => s + x.amount, 0);
        const overtime = otHours * cfg.overtime_rate_per_hour;
        const net = cfg.basic_salary + allowance + bonus + overtime - ded;
        const itemId = `pi-${key}-${e.id}`;
        payroll_items.push({ id: itemId, company_id: CID, period_id: pid, employee_id: e.id, basic_salary: cfg.basic_salary, allowances: cfg.allowances.map((a) => ({ ...a })),
          bonus, incentives: 0, overtime_hours: otHours, overtime_amount: overtime, deductions, adjustments: [], net_salary: net,
          status: isCurrent ? 'draft' : 'paid', calc_note: isCurrent ? 'Data contoh (mode demo). Di mode produksi gaji dihitung otomatis dari absensi, izin & lembur.' : '' });
        if (!isCurrent) payments.push({ id: `pay-${key}-${e.id}`, company_id: CID, payroll_item_id: itemId, employee_id: e.id, amount: net, paid_at: isoAt(payDate, '14:00'), method: 'Transfer bank (manual)', reference: `TRF-${key.replace('-', '')}-${pi}${i}`, confirmed_by: 'u-owner', note: '' });
      });
    });

    /* ---- Announcements, notifications, audit ---- */
    const announcements = [
      { id: 'an-001', company_id: CID, title: 'Stock opname akhir bulan', body: 'Stock opname dilakukan pada hari kerja terakhir bulan ini. Mohon semua staf hadir tepat waktu.', created_at: isoAt(Fmt.addDays(today, -2), '09:00'), created_by: 'u-owner', pinned: true },
      { id: 'an-002', company_id: CID, title: 'Absensi wajib selfie + GPS', body: 'Mulai bulan ini absensi menggunakan selfie dan lokasi. Pastikan izin kamera dan lokasi di browser sudah diaktifkan.', created_at: isoAt(Fmt.addDays(today, -9), '08:00'), created_by: 'u-owner', pinned: false },
    ];
    const N = (id, to, type, title, msg, offH, read, link) => ({ id, company_id: CID, recipient_id: to, type, title, message: msg, link: link || null, read, created_at: new Date(Date.now() - offH * 3600000).toISOString() });
    const lastPaid = payroll_periods[2];
    const notifications = [
      N('nt-001', 'u-owner', 'leave_request', 'Pengajuan izin baru', 'Citra Dewi mengajukan Izin Pribadi.', 2, false, 'owner/leave.html'),
      N('nt-002', 'u-owner', 'leave_request', 'Pengajuan izin baru', 'Dimas Anggara mengajukan Cuti Tahunan (3 hari).', 5, false, 'owner/leave.html'),
      N('nt-003', 'u-owner', 'task_deadline', 'Tugas melewati deadline', '"Stock checking gudang B" melewati deadline.', 9, false, 'owner/tasks.html'),
      N('nt-004', 'u-owner', 'attendance_review', 'Absensi perlu review', 'Ada check-in di luar radius yang perlu diperiksa.', 30, true, 'owner/attendance.html'),
      N('nt-005', 'u-owner', 'salary_paid', 'Pembayaran gaji dikonfirmasi', `Gaji periode ${Fmt.monthLabel(lastPaid.period_key)} telah dikonfirmasi lunas.`, 24 * 20, true, 'owner/payroll.html'),
      N('nt-101', 'u-emp-001', 'task_assigned', 'Tugas baru', 'Anda mendapat tugas: Packing order Shopee.', 20, false, 'employee/tasks.html'),
      N('nt-102', 'u-emp-001', 'salary_paid', 'Gaji telah dibayar', `Gaji periode ${Fmt.monthLabel(lastPaid.period_key)} sudah ditransfer.`, 24 * 20, true, 'employee/payslip.html'),
      N('nt-103', 'u-emp-001', 'payslip', 'Slip gaji tersedia', `Slip gaji ${Fmt.monthLabel(lastPaid.period_key)} dapat diunduh.`, 24 * 20, true, 'employee/payslip.html'),
      N('nt-104', 'u-emp-001', 'announcement', 'Pengumuman baru', 'Stock opname akhir bulan.', 48, false, 'employee/announcements.html'),
      N('nt-105', 'u-emp-001', 'leave_approved', 'Izin disetujui', 'Cuti Tahunan Anda telah disetujui.', 24 * 30, true, 'employee/leave.html'),
    ];
    const audit_logs = [
      { id: 'al-001', company_id: CID, actor_id: 'u-owner', actor_name: 'Rina Wijaya', action: 'leave.approve', entity: 'leave_request', entity_id: 'lv-001', summary: 'Menyetujui izin Sakit — Eka Rahma', created_at: new Date(Date.now() - 3600000 * 3).toISOString() },
      { id: 'al-002', company_id: CID, actor_id: 'u-owner', actor_name: 'Rina Wijaya', action: 'task.create', entity: 'task', entity_id: 'tk-001', summary: 'Membuat tugas "Packing order Shopee" untuk Aisyah Putri', created_at: new Date(Date.now() - 3600000 * 20).toISOString() },
      { id: 'al-003', company_id: CID, actor_id: 'u-owner', actor_name: 'Rina Wijaya', action: 'payroll.confirm_payment', entity: 'payroll_period', entity_id: lastPaid.id, summary: `Mengonfirmasi pembayaran gaji ${Fmt.monthLabel(lastPaid.period_key)}`, created_at: new Date(Date.now() - 3600000 * 24 * 20).toISOString() },
    ];

    return { schema_version: SCHEMA_VERSION, seeded_on: today, company, settings, profiles, employees, salary_configs, leave_types, leave_requests,
      attendance, attendance_corrections: [], tasks, payroll_periods, payroll_items, payments, announcements, notifications, audit_logs, seq: 1000 };
  }

  let db = null;
  const DemoStore = {
    load() {
      if (db) return db;
      try {
        const raw = localStorage.getItem(KEY);
        if (raw) { const parsed = JSON.parse(raw); if (parsed.schema_version === SCHEMA_VERSION) { db = parsed; return db; } }
      } catch (e) { console.warn('[demo] storage unreadable, reseeding', e); }
      db = seed(); DemoStore.save(); return db;
    },
    save() { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (e) { console.warn('[demo] could not persist', e); } },
    reset() { db = seed(); DemoStore.save(); return db; },
    id(prefix) { DemoStore.load(); db.seq += 1; return `${prefix}-${db.seq}`; },
    get db() { return DemoStore.load(); },
  };
  window.DemoStore = DemoStore;
})();
