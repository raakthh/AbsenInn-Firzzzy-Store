/* =========================================================
   AbsenInn — API client
   One interface, two backends:
   - production: fetch() → Django REST API (backend/, verifies the Supabase JWT)
   - demo: an in-browser simulation of the same endpoints over DemoStore,
     including role checks, so pages behave the same in both modes.
   IMPORTANT: demo-mode checks run in the browser and are NOT security.
   Real authorization is enforced by Django + Supabase RLS.
   ========================================================= */
(function () {
  const C = window.APP_CONFIG;
  const isDemo = () => C.MODE === 'demo';

  class ApiError extends Error {
    constructor(message, code, status, details) { super(message); this.code = code || 'ERROR'; this.status = status || 400; this.details = details || {}; }
  }

  /* ---------------- Production transport ---------------- */
  async function http(method, path, body, query) {
    const token = await Auth.accessToken();
    const url = new URL(C.API_BASE_URL.replace(/\/$/, '') + path, location.href);   // relative '/api' or absolute URL
    if (query) Object.entries(query).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v); });
    const isForm = body instanceof FormData;
    let res;
    try {
      res = await fetch(url, {
        method,
        headers: { ...(isForm ? {} : { 'Content-Type': 'application/json' }), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: body ? (isForm ? body : JSON.stringify(body)) : undefined,
      });
    } catch (e) {
      throw new ApiError('Server API (Django) tidak dapat dihubungi. Periksa koneksi internet atau pastikan backend berjalan (lihat API_BASE_URL di js/config.js).', 'API_UNAVAILABLE', 0);
    }
    if (res.status === 401) { Auth.clear(); location.href = Auth.loginUrl(); throw new ApiError('Sesi berakhir', 'UNAUTHORIZED', 401); }
    const data = res.status === 204 ? null : await res.json().catch(() => null);
    if (!res.ok) throw new ApiError((data && (data.detail || data.message)) || `Request gagal (${res.status})`, data && data.code, res.status, data);
    return data;
  }

  /* Authenticated file download (e.g. payslip PDF) → triggers a browser download. */
  async function download(path) {
    const token = await Auth.accessToken();
    let res;
    try { res = await fetch(new URL(C.API_BASE_URL.replace(/\/$/, '') + path, location.href), { headers: token ? { Authorization: `Bearer ${token}` } : {} }); }
    catch (e) { throw new ApiError('Server API tidak dapat dihubungi.', 'API_UNAVAILABLE', 0); }
    if (!res.ok) { const d = await res.json().catch(() => null); throw new ApiError((d && d.detail) || `Unduhan gagal (${res.status})`, d && d.code, res.status, d); }
    const name = ((res.headers.get('Content-Disposition') || '').match(/filename="?([^";]+)"?/) || [])[1] || 'dokumen.pdf';
    const url = URL.createObjectURL(await res.blob());
    const a = Object.assign(document.createElement('a'), { href: url, download: name });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    return true;
  }

  /* ---------------- Demo simulation ---------------- */
  const delay = (v) => new Promise((r) => setTimeout(() => r(v), C.DEMO_LATENCY));
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const db = () => DemoStore.db;
  const commit = () => DemoStore.save();
  function sess() { const s = Auth.session(); if (!s) throw new ApiError('Silakan login terlebih dahulu', 'UNAUTHORIZED', 401); return s; }
  function owner() { const s = sess(); if (s.role !== 'owner') throw new ApiError('Akses ditolak: khusus Owner', 'FORBIDDEN', 403); return s; }
  function employee() { const s = sess(); if (s.role !== 'employee') throw new ApiError('Akses ditolak: khusus Employee', 'FORBIDDEN', 403); return s; }
  const companyRows = (rows, s) => rows.filter((r) => r.company_id === s.company_id);
  const empById = (id) => db().employees.find((e) => e.id === id);
  const typeById = (id) => db().leave_types.find((t) => t.id === id);
  const nowISO = () => new Date().toISOString();

  function audit(s, action, entity, entityId, summary, extra) {
    db().audit_logs.unshift({ id: DemoStore.id('al'), company_id: s.company_id, actor_id: s.user_id, actor_name: s.full_name, action, entity, entity_id: entityId, summary, extra: extra || null, created_at: nowISO() });
  }
  function notify(recipientId, type, title, message, link) {
    db().notifications.unshift({ id: DemoStore.id('nt'), company_id: db().company.id, recipient_id: recipientId, type, title, message, link: link || null, read: false, created_at: nowISO() });
  }
  const userOfEmployee = (empId) => { const e = empById(empId); return e && e.user_id; };
  const ownerIds = () => db().profiles.filter((p) => p.role === 'owner').map((p) => p.id);

  /* ---- Domain rules (mirrors what Django will do) ---- */
  const Rules = {
    isWorkDay(date) { return db().settings.work.working_days.includes(Fmt.parseDate(date).getDay()); },
    checkInStatus(iso) {
      const w = db().settings.work;
      return Fmt.minutesOfDay(iso) > Fmt.hmToMinutes(w.start) + Number(w.late_tolerance_min || 0) ? 'late' : 'present';
    },
    workMinutes(inISO, outISO) {
      if (!inISO || !outISO) return null;
      const w = db().settings.work;
      let mins = (new Date(outISO) - new Date(inISO)) / 60000;
      const bs = Fmt.hmToMinutes(w.break_start), be = Fmt.hmToMinutes(w.break_end);
      const a = Fmt.minutesOfDay(inISO), b = Fmt.minutesOfDay(outISO);
      const overlap = Math.max(0, Math.min(b, be) - Math.max(a, bs));
      return Math.max(0, Math.round(mins - overlap));
    },
    attended: (st) => ['present', 'late', 'early_leave', 'needs_review'].includes(st),
    leaveDays(l) {
      const t = typeById(l.leave_type_id); let n = 0;
      for (let d = l.start_date; d <= l.end_date; d = Fmt.addDays(d, 1)) if (Rules.isWorkDay(d)) n += t && t.half_day ? 0.5 : 1;
      return n;
    },
    leaveCancel(id) {
      const s = employee(); const l = db().leave_requests.find((x) => x.id === id && x.employee_id === s.employee_id);
      if (!l) throw new ApiError('Pengajuan tidak ditemukan', 'NOT_FOUND', 404);
      if (l.status !== 'pending') throw new ApiError('Hanya pengajuan pending yang bisa dibatalkan', 'ALREADY_DECIDED', 409);
      l.status = 'cancelled'; commit(); return leaveOut(l);
    },
    leaveBalance(empId) {
      const year = Fmt.today().slice(0, 4);
      const used = db().leave_requests.filter((l) => l.employee_id === empId && l.status === 'approved' && l.start_date.startsWith(year) && typeById(l.leave_type_id).uses_quota)
        .reduce((s, l) => s + Rules.leaveDays(l), 0);
      const quota = Number(db().settings.leave.annual_quota_days || 0);
      return { quota, used, remaining: Math.max(0, quota - used) };
    },
    payrollNet(it) {
      const allow = (it.allowances || []).reduce((s, a) => s + Number(a.amount || 0), 0);
      const ded = (it.deductions || []).reduce((s, a) => s + Number(a.amount || 0), 0);
      const adj = (it.adjustments || []).reduce((s, a) => s + (a.type === 'deduction' ? -1 : 1) * Number(a.amount || 0), 0);
      return Number(it.basic_salary || 0) + allow + Number(it.bonus || 0) + Number(it.incentives || 0) + Number(it.overtime_amount || 0) - ded + adj;
    },
    periodStatus(p) {
      if (['approved', 'scheduled'].includes(p.status) && p.payment_date < Fmt.today()) return 'overdue';
      return p.status;
    },
    taskStatus(t) { return t.status !== 'completed' && t.deadline < Fmt.today() ? 'overdue' : t.status; },
  };

  function haversine(lat1, lon1, lat2, lon2) {
    const R = 6371000, toR = (d) => (d * Math.PI) / 180;
    const dLat = toR(lat2 - lat1), dLon = toR(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(toR(lat1)) * Math.cos(toR(lat2)) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
  }

  /* Enrichers */
  const withEmp = (r) => ({ ...r, employee: pickEmp(empById(r.employee_id)) });
  const pickEmp = (e) => e && { id: e.id, full_name: e.full_name, position: e.position, employee_code: e.employee_code, avatar_color: e.avatar_color, photo_url: e.photo_url, employment_status: e.employment_status };
  const leaveOut = (l) => ({ ...withEmp(l), leave_type: typeById(l.leave_type_id), days: Rules.leaveDays(l) });
  const taskOut = (t) => ({ ...t, status_display: Rules.taskStatus(t), assignee: pickEmp(empById(t.assignee_id)) });

  function validateEmployee(d, isNew, selfId) {
    const errors = {};
    if (!d.full_name || d.full_name.trim().length < 3) errors.full_name = 'Nama minimal 3 karakter';
    if (!d.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email)) errors.email = 'Format email tidak valid';
    else if (db().employees.some((e) => e.email.toLowerCase() === d.email.toLowerCase() && e.id !== selfId)) errors.email = 'Email sudah digunakan';
    if (d.phone && !/^[0-9+\-\s()]{8,20}$/.test(d.phone)) errors.phone = 'Nomor telepon tidak valid';
    if (!d.position || !d.position.trim()) errors.position = 'Jabatan wajib diisi';
    if (!d.join_date) errors.join_date = 'Tanggal bergabung wajib diisi';
    if (isNew && !(Number(d.basic_salary) > 0)) errors.basic_salary = 'Gaji pokok harus lebih dari 0';
    if (Object.keys(errors).length) throw new ApiError('Periksa kembali data yang diisi', 'VALIDATION', 422, errors);
  }

  /* ---------------- Endpoint handlers (demo) ---------------- */
  const demo = {
    me() { const s = sess(); const p = db().profiles.find((x) => x.id === s.user_id); return { ...p, company: db().company, employee: p.employee_id ? empById(p.employee_id) : null }; },

    /* Employees */
    employeesList(q = {}) {
      const s = owner();
      let rows = companyRows(db().employees, s);
      if (q.status) rows = rows.filter((e) => e.employment_status === q.status);
      if (q.position) rows = rows.filter((e) => e.position === q.position);
      if (q.search) { const t = q.search.toLowerCase(); rows = rows.filter((e) => [e.full_name, e.email, e.employee_code, e.position].some((v) => v.toLowerCase().includes(t))); }
      return rows;
    },
    employeeGet(id) {
      const s = sess();
      if (s.role === 'employee' && s.employee_id !== id) throw new ApiError('Akses ditolak', 'FORBIDDEN', 403);
      const e = empById(id); if (!e || e.company_id !== s.company_id) throw new ApiError('Karyawan tidak ditemukan', 'NOT_FOUND', 404);
      const out = { ...e };
      if (s.role === 'owner') out.salary_config = db().salary_configs.find((c) => c.employee_id === id);
      return out;
    },
    employeeCreate(d) {
      const s = owner(); validateEmployee(d, true);
      const n = db().employees.length + 1;
      const id = DemoStore.id('e');
      const code = `EMP-${String(n).padStart(3, '0')}`;
      const colors = ['#6C55F2', '#4F8DF7', '#E0559B', '#13A985', '#F08A10', '#8B5CF6', '#0EA5E9'];
      const e = { id, company_id: s.company_id, employee_code: code, full_name: d.full_name.trim(), email: d.email.trim().toLowerCase(), phone: d.phone || '', address: d.address || '',
        position: d.position.trim(), join_date: d.join_date, employment_status: 'active', employment_type: d.employment_type || 'Tetap', avatar_color: colors[n % colors.length], photo_url: null,
        user_id: d.create_account ? DemoStore.id('u') : null, history: [{ date: d.join_date, event: `Bergabung sebagai ${d.position.trim()}` }], created_at: nowISO() };
      db().employees.push(e);
      db().salary_configs.push({ employee_id: id, company_id: s.company_id, basic_salary: Number(d.basic_salary), allowances: clone(db().settings.payroll.default_components), overtime_rate_per_hour: Number(d.overtime_rate_per_hour || 0), effective_from: d.join_date });
      if (e.user_id) db().profiles.push({ id: e.user_id, company_id: s.company_id, email: e.email, role: 'employee', full_name: e.full_name, employee_id: id, avatar_color: e.avatar_color });
      audit(s, 'employee.create', 'employee', id, `Menambahkan karyawan ${e.full_name} (${code})`);
      commit(); return e;
    },
    employeeUpdate(id, d) {
      const s = sess();
      const e = empById(id); if (!e || e.company_id !== s.company_id) throw new ApiError('Karyawan tidak ditemukan', 'NOT_FOUND', 404);
      if (s.role === 'employee') {
        if (s.employee_id !== id) throw new ApiError('Akses ditolak', 'FORBIDDEN', 403);
        const allowed = db().settings.profile_editable_fields;
        const errors = {};
        if (d.phone && !/^[0-9+\-\s()]{8,20}$/.test(d.phone)) errors.phone = 'Nomor telepon tidak valid';
        if (Object.keys(errors).length) throw new ApiError('Periksa kembali data', 'VALIDATION', 422, errors);
        Object.keys(d).forEach((k) => { if (allowed.includes(k)) e[k] = d[k]; });
        commit(); return e;
      }
      validateEmployee({ ...e, ...d }, false, id);
      const before = { position: e.position, employment_status: e.employment_status };
      ['full_name', 'email', 'phone', 'address', 'position', 'join_date', 'employment_type'].forEach((k) => { if (d[k] !== undefined) e[k] = typeof d[k] === 'string' ? d[k].trim() : d[k]; });
      if (before.position !== e.position) e.history.push({ date: Fmt.today(), event: `Jabatan berubah: ${before.position} → ${e.position}` });
      const p = db().profiles.find((x) => x.employee_id === id); if (p) { p.full_name = e.full_name; p.email = e.email; }
      audit(s, 'employee.update', 'employee', id, `Memperbarui data ${e.full_name}`);
      commit(); return e;
    },
    employeeSetStatus(id, status) {
      const s = owner(); const e = empById(id); if (!e) throw new ApiError('Karyawan tidak ditemukan', 'NOT_FOUND', 404);
      e.employment_status = status;
      e.history.push({ date: Fmt.today(), event: status === 'inactive' ? 'Akun dinonaktifkan' : 'Akun diaktifkan kembali' });
      audit(s, status === 'inactive' ? 'employee.deactivate' : 'employee.activate', 'employee', id, `${status === 'inactive' ? 'Menonaktifkan' : 'Mengaktifkan'} ${e.full_name}`);
      commit(); return e;
    },

    /* Attendance */
    attendanceList(q = {}) {
      const s = sess();
      let rows = companyRows(db().attendance, s);
      if (s.role === 'employee') rows = rows.filter((r) => r.employee_id === s.employee_id);
      else if (q.employee_id) rows = rows.filter((r) => r.employee_id === q.employee_id);
      if (q.date) rows = rows.filter((r) => r.date === q.date);
      if (q.from) rows = rows.filter((r) => r.date >= q.from);
      if (q.to) rows = rows.filter((r) => r.date <= q.to);
      if (q.status) rows = rows.filter((r) => r.status === q.status);
      if (q.location_status) rows = rows.filter((r) => (r.location_status || 'none') === q.location_status);
      return rows.sort((a, b) => (b.date + (b.check_in_at || '')).localeCompare(a.date + (a.check_in_at || ''))).map(withEmp);
    },
    attendanceMonitoring(date) {
      const s = owner(); const d = date || Fmt.today();
      const emps = companyRows(db().employees, s).filter((e) => e.employment_status === 'active' && e.join_date <= d);
      const recs = db().attendance.filter((r) => r.date === d);
      const pendingLeave = db().leave_requests.filter((l) => l.status === 'pending' && d >= l.start_date && d <= l.end_date);
      return { date: d, is_work_day: Rules.isWorkDay(d), rows: emps.map((e) => {
        const r = recs.find((x) => x.employee_id === e.id);
        return { employee: pickEmp(e), record: r || null, state: r ? r.status : (d < Fmt.today() ? 'unreconciled' : 'not_checked_in'), pending_leave: !!pendingLeave.find((l) => l.employee_id === e.id) };
      }) };
    },
    attendanceGet(id) {
      const s = sess(); const r = db().attendance.find((x) => x.id === id);
      if (!r || r.company_id !== s.company_id || (s.role === 'employee' && r.employee_id !== s.employee_id)) throw new ApiError('Data absensi tidak ditemukan', 'NOT_FOUND', 404);
      return { ...withEmp(r), corrections: db().attendance_corrections.filter((c) => c.attendance_id === id) };
    },
    /* Evidence: production returns short-lived signed URLs from a private bucket. Demo returns placeholders. */
    attendanceEvidence(id) {
      const r = demo.attendanceGet(id);
      const mem = (window.__demoSelfies || {});
      return { attendance_id: id, check_in: { selfie_url: mem[id + ':in'] || null, placeholder: !!r.selfie_in_path, lat: r.lat_in, lng: r.lng_in, distance_m: r.distance_in_m, accuracy_m: r.accuracy_in_m, at: r.check_in_at },
        check_out: { selfie_url: mem[id + ':out'] || null, placeholder: !!r.selfie_out_path, lat: r.lat_out, lng: r.lng_out, distance_m: r.distance_out_m, accuracy_m: r.accuracy_out_m, at: r.check_out_at },
        location_status: r.location_status, flags: r.flags || [], expires_in: 300 };
    },
    attendanceToday() {
      const s = employee(); const d = Fmt.today();
      const rec = db().attendance.find((r) => r.employee_id === s.employee_id && r.date === d);
      return { date: d, is_work_day: Rules.isWorkDay(d), schedule: db().settings.work, record: rec ? withEmp(rec) : null, location_configured: db().settings.attendance.location.lat != null, settings: db().settings.attendance };
    },
    locationCheck(lat, lng, accuracy) {
      const a = db().settings.attendance;
      if (lat == null || lng == null) return { status: 'gps_unavailable', distance_m: null };
      if (a.location.lat == null) return { status: 'not_configured', distance_m: null };
      const dist = haversine(lat, lng, a.location.lat, a.location.lng);
      let status = dist <= a.radius_m ? 'verified' : 'outside';
      if (status === 'verified' && accuracy != null && accuracy > a.max_gps_accuracy_m) status = 'needs_review';
      return { status, distance_m: Math.round(dist), radius_m: a.radius_m, work_location: a.location };
    },
    attendanceCheck(kind, p) {
      const s = employee(); const a = db().settings.attendance; const d = Fmt.today();
      if (a.selfie_required && !p.selfie) throw new ApiError('Selfie wajib untuk absensi', 'SELFIE_REQUIRED', 422);
      if (a.gps_required && (p.lat == null || p.lng == null)) throw new ApiError('Lokasi GPS tidak tersedia', 'GPS_UNAVAILABLE', 422);
      if (p.simulate_upload_failure) throw new ApiError('Upload foto gagal. Coba lagi.', 'UPLOAD_FAILED', 502);
      const loc = demo.locationCheck(p.lat, p.lng, p.accuracy);
      if (!p.request_review && (loc.status === 'outside' || loc.status === 'not_configured'))
        throw new ApiError(loc.status === 'outside' ? `Anda berada ${Fmt.distance(loc.distance_m)} dari lokasi kerja (radius ${a.radius_m} m).` : 'Lokasi kerja belum diatur oleh owner.', loc.status === 'outside' ? 'OUTSIDE_RADIUS' : 'LOCATION_NOT_CONFIGURED', 422, loc);
      let rec = db().attendance.find((r) => r.employee_id === s.employee_id && r.date === d);
      const at = nowISO();
      const reviewNeeded = p.request_review || loc.status === 'needs_review';
      if (kind === 'in') {
        if (rec && rec.check_in_at) throw new ApiError('Anda sudah check-in hari ini', 'ALREADY_CHECKED_IN', 409);
        if (rec && ['sick', 'paid_leave', 'unpaid_leave'].includes(rec.status)) throw new ApiError('Anda tercatat sedang izin/cuti hari ini', 'ON_LEAVE', 409);
        rec = rec || { id: DemoStore.id('at'), company_id: s.company_id, employee_id: s.employee_id, date: d, source: 'app', notes: '', flags: [], check_out_at: null, work_minutes: null, distance_out_m: null, accuracy_out_m: null, lat_out: null, lng_out: null, selfie_out_path: null };
        Object.assign(rec, { check_in_at: at, lat_in: p.lat, lng_in: p.lng, accuracy_in_m: p.accuracy, distance_in_m: loc.distance_m, selfie_in_path: `selfies/${s.company_id}/${s.employee_id}/${d}-in.jpg`,
          location_status: reviewNeeded ? (loc.status === 'verified' ? 'needs_review' : loc.status) : loc.status, status: reviewNeeded ? 'needs_review' : Rules.checkInStatus(at) });
        if (reviewNeeded) { rec.flags = [...new Set([...(rec.flags || []), loc.status === 'outside' ? 'outside_radius' : loc.status === 'not_configured' ? 'location_not_configured' : 'low_gps_accuracy'])]; rec.notes = p.note || 'Perlu review owner'; ownerIds().forEach((o) => notify(o, 'attendance_review', 'Absensi perlu review', `${s.full_name} check-in dengan status lokasi: ${loc.status}.`, 'owner/attendance.html')); }
        if (!db().attendance.includes(rec)) db().attendance.push(rec);
      } else {
        if (!rec || !rec.check_in_at) throw new ApiError('Belum ada check-in yang valid hari ini. Ajukan koreksi absensi ke owner.', 'NO_CHECK_IN', 409);
        if (rec.check_out_at) throw new ApiError('Anda sudah check-out hari ini', 'ALREADY_CHECKED_OUT', 409);
        Object.assign(rec, { check_out_at: at, lat_out: p.lat, lng_out: p.lng, accuracy_out_m: p.accuracy, distance_out_m: loc.distance_m, selfie_out_path: `selfies/${s.company_id}/${s.employee_id}/${d}-out.jpg` });
        rec.work_minutes = Rules.workMinutes(rec.check_in_at, rec.check_out_at);
        if (reviewNeeded) { rec.status = 'needs_review'; rec.flags = [...new Set([...(rec.flags || []), 'checkout_location'])]; }
        else if (rec.status !== 'needs_review' && Fmt.minutesOfDay(at) < Fmt.hmToMinutes(db().settings.work.end) - Number(db().settings.work.early_leave_tolerance_min || 0)) rec.status = 'early_leave';
      }
      if (p.selfie) { window.__demoSelfies = window.__demoSelfies || {}; window.__demoSelfies[`${rec.id}:${kind}`] = p.selfie; }
      commit(); return withEmp(rec);
    },
    attendanceCorrect(id, d) {
      const s = owner();
      if (!d.reason || d.reason.trim().length < 5) throw new ApiError('Alasan koreksi wajib diisi (min. 5 karakter)', 'VALIDATION', 422, { reason: 'Alasan koreksi wajib diisi (min. 5 karakter)' });
      let r = id ? db().attendance.find((x) => x.id === id) : null;
      if (!r) {
        if (!d.employee_id || !d.date) throw new ApiError('Data tidak lengkap', 'VALIDATION', 422);
        r = { id: DemoStore.id('at'), company_id: s.company_id, employee_id: d.employee_id, date: d.date, source: 'correction', notes: '', flags: [], check_in_at: null, check_out_at: null, work_minutes: null, location_status: null };
        db().attendance.push(r);
      }
      const before = { status: r.status, check_in_at: r.check_in_at, check_out_at: r.check_out_at };
      const toISO = (hm) => (hm ? new Date(`${r.date}T${hm}:00`).toISOString() : null);
      if (d.check_in !== undefined) r.check_in_at = toISO(d.check_in);
      if (d.check_out !== undefined) r.check_out_at = toISO(d.check_out);
      if (r.check_in_at && r.check_out_at && r.check_out_at <= r.check_in_at) throw new ApiError('Jam check-out harus setelah check-in', 'VALIDATION', 422, { check_out: 'Harus setelah check-in' });
      r.status = d.status; r.work_minutes = Rules.workMinutes(r.check_in_at, r.check_out_at);
      r.notes = `Dikoreksi owner: ${d.reason.trim()}`; if (r.location_status === 'needs_review' && d.status !== 'needs_review') r.location_status = 'reviewed';
      const corr = { id: DemoStore.id('ac'), company_id: s.company_id, attendance_id: r.id, employee_id: r.employee_id, before, after: { status: r.status, check_in_at: r.check_in_at, check_out_at: r.check_out_at }, reason: d.reason.trim(), corrected_by: s.user_id, corrected_by_name: s.full_name, created_at: nowISO(), source: 'owner' };
      db().attendance_corrections.push(corr);
      audit(s, 'attendance.correct', 'attendance', r.id, `Koreksi absensi ${empById(r.employee_id).full_name} (${Fmt.date(r.date)}): ${before.status || '—'} → ${r.status}`, corr);
      notify(userOfEmployee(r.employee_id), 'attendance_corrected', 'Absensi dikoreksi', `Absensi ${Fmt.date(r.date)} dikoreksi owner.`, 'employee/attendance.html');
      commit(); return withEmp(r);
    },
    attendanceRequestCorrection(d) {
      const s = employee();
      if (!d.date) throw new ApiError('Tanggal wajib diisi', 'VALIDATION', 422, { date: 'Tanggal wajib diisi' });
      if (d.date > Fmt.today()) throw new ApiError('Tidak bisa mengajukan koreksi untuk tanggal mendatang', 'VALIDATION', 422, { date: 'Tanggal tidak valid' });
      if (!d.reason || d.reason.trim().length < 10) throw new ApiError('Jelaskan alasan (min. 10 karakter)', 'VALIDATION', 422, { reason: 'Jelaskan alasan (min. 10 karakter)' });
      const c = { id: DemoStore.id('ac'), company_id: s.company_id, attendance_id: null, employee_id: s.employee_id, date: d.date, requested_check_in: d.check_in || null, requested_check_out: d.check_out || null, reason: d.reason.trim(), status: 'pending', created_at: nowISO(), source: 'employee' };
      db().attendance_corrections.push(c);
      ownerIds().forEach((o) => notify(o, 'correction_request', 'Permintaan koreksi absensi', `${s.full_name} mengajukan koreksi untuk ${Fmt.date(d.date)}.`, 'owner/attendance.html'));
      commit(); return c;
    },
    correctionRequests() {
      const s = sess();
      let rows = db().attendance_corrections.filter((c) => c.source === 'employee' && c.company_id === s.company_id);
      if (s.role === 'employee') rows = rows.filter((c) => c.employee_id === s.employee_id);
      return rows.sort((a, b) => b.created_at.localeCompare(a.created_at)).map(withEmp);
    },
    correctionResolve(id, decision, payload) {
      const s = owner(); const c = db().attendance_corrections.find((x) => x.id === id);
      if (!c || c.status !== 'pending') throw new ApiError('Permintaan tidak ditemukan / sudah diproses', 'NOT_FOUND', 404);
      if (decision === 'approve') {
        const existing = db().attendance.find((r) => r.employee_id === c.employee_id && r.date === c.date);
        demo.attendanceCorrect(existing ? existing.id : null, { employee_id: c.employee_id, date: c.date, check_in: payload.check_in, check_out: payload.check_out, status: payload.status, reason: `Permintaan karyawan disetujui: ${c.reason}` });
      }
      c.status = decision === 'approve' ? 'approved' : 'rejected'; c.resolved_at = nowISO(); c.owner_notes = (payload && payload.notes) || '';
      notify(userOfEmployee(c.employee_id), 'correction_' + c.status, `Koreksi absensi ${c.status === 'approved' ? 'disetujui' : 'ditolak'}`, `Permintaan koreksi ${Fmt.date(c.date)} ${c.status === 'approved' ? 'disetujui' : 'ditolak'}.`, 'employee/attendance.html');
      commit(); return c;
    },
    /* Reconciliation: past working day, no record and no approved leave → Absent (owner confirms). */
    attendanceReconcilePreview(date) {
      owner();
      if (date >= Fmt.today()) throw new ApiError('Rekonsiliasi hanya untuk tanggal yang sudah lewat', 'VALIDATION', 422);
      if (!Rules.isWorkDay(date)) return { date, candidates: [], is_work_day: false };
      const m = demo.attendanceMonitoring(date);
      return { date, is_work_day: true, candidates: m.rows.filter((r) => !r.record).map((r) => ({ employee: r.employee, pending_leave: r.pending_leave })) };
    },
    attendanceReconcile(date, employeeIds) {
      const s = owner();
      employeeIds.forEach((eid) => {
        if (db().attendance.some((r) => r.employee_id === eid && r.date === date)) return;
        db().attendance.push({ id: DemoStore.id('at'), company_id: s.company_id, employee_id: eid, date, status: 'absent', source: 'reconciliation', notes: 'Tidak ada check-in & tidak ada izin (rekonsiliasi owner)', flags: [], check_in_at: null, check_out_at: null, work_minutes: null, location_status: null });
      });
      audit(s, 'attendance.reconcile', 'attendance', null, `Rekonsiliasi ${Fmt.date(date)}: ${employeeIds.length} karyawan ditandai Absent`);
      commit(); return { count: employeeIds.length };
    },

    /* Leave */
    leaveTypes() { const s = sess(); return companyRows(db().leave_types, s); },
    leaveList(q = {}) {
      const s = sess(); let rows = companyRows(db().leave_requests, s);
      if (s.role === 'employee') rows = rows.filter((l) => l.employee_id === s.employee_id);
      else if (q.employee_id) rows = rows.filter((l) => l.employee_id === q.employee_id);
      if (q.status) rows = rows.filter((l) => l.status === q.status);
      return rows.sort((a, b) => b.requested_at.localeCompare(a.requested_at)).map(leaveOut);
    },
    leaveGet(id) {
      const s = sess(); const l = db().leave_requests.find((x) => x.id === id);
      if (!l || l.company_id !== s.company_id || (s.role === 'employee' && l.employee_id !== s.employee_id)) throw new ApiError('Pengajuan tidak ditemukan', 'NOT_FOUND', 404);
      return leaveOut(l);
    },
    leaveRequest(d) {
      const s = employee(); const errors = {};
      const t = typeById(d.leave_type_id);
      if (!t || !t.active) errors.leave_type_id = 'Pilih jenis izin';
      if (!d.start_date) errors.start_date = 'Tanggal mulai wajib diisi';
      if (!d.end_date) errors.end_date = 'Tanggal selesai wajib diisi';
      if (d.start_date && d.end_date && d.end_date < d.start_date) errors.end_date = 'Tanggal selesai harus setelah tanggal mulai';
      if (t && t.half_day && d.start_date !== d.end_date) errors.end_date = 'Izin setengah hari hanya untuk 1 tanggal';
      if (!d.reason || d.reason.trim().length < 5) errors.reason = 'Alasan minimal 5 karakter';
      if (t && t.requires_attachment && !d.attachment_name) errors.attachment = `Lampiran wajib untuk ${t.name}`;
      if (!errors.start_date && !errors.end_date && d.start_date && d.end_date) {
        const overlap = db().leave_requests.find((l) => l.employee_id === s.employee_id && ['pending', 'approved'].includes(l.status) && !(d.end_date < l.start_date || d.start_date > l.end_date));
        if (overlap) errors.start_date = 'Bertabrakan dengan pengajuan lain yang masih aktif';
      }
      if (t && t.uses_quota && !errors.start_date && !errors.end_date) {
        const days = Rules.leaveDays({ ...d }); const bal = Rules.leaveBalance(s.employee_id);
        if (days > bal.remaining) errors.end_date = `Saldo cuti tidak cukup (sisa ${bal.remaining} hari)`;
      }
      if (Object.keys(errors).length) throw new ApiError('Periksa kembali pengajuan', 'VALIDATION', 422, errors);
      const l = { id: DemoStore.id('lv'), company_id: s.company_id, employee_id: s.employee_id, leave_type_id: t.id, start_date: d.start_date, end_date: d.end_date, reason: d.reason.trim(), attachment_name: d.attachment_name || null, status: 'pending', owner_notes: '', requested_at: nowISO(), decided_at: null };
      db().leave_requests.push(l);
      ownerIds().forEach((o) => notify(o, 'leave_request', 'Pengajuan izin baru', `${s.full_name} mengajukan ${t.name} (${Fmt.date(l.start_date)}${l.end_date !== l.start_date ? ' – ' + Fmt.date(l.end_date) : ''}).`, 'owner/leave.html'));
      commit(); return leaveOut(l);
    },
    leaveDecide(id, decision, notes) {
      const s = owner(); const l = db().leave_requests.find((x) => x.id === id);
      if (!l || l.company_id !== s.company_id) throw new ApiError('Pengajuan tidak ditemukan', 'NOT_FOUND', 404);
      if (l.status !== 'pending') throw new ApiError('Pengajuan sudah diproses', 'ALREADY_DECIDED', 409);
      if (decision === 'rejected' && (!notes || notes.trim().length < 3)) throw new ApiError('Berikan catatan alasan penolakan', 'VALIDATION', 422, { notes: 'Catatan wajib saat menolak' });
      l.status = decision; l.owner_notes = (notes || '').trim(); l.decided_at = nowISO(); l.decided_by = s.user_id;
      const t = typeById(l.leave_type_id);
      if (decision === 'approved' && !t.half_day) {
        /* Integrate with attendance: each working day in range gets the leave's attendance status. */
        for (let d = l.start_date; d <= l.end_date; d = Fmt.addDays(d, 1)) {
          if (!Rules.isWorkDay(d)) continue;
          const ex = db().attendance.find((r) => r.employee_id === l.employee_id && r.date === d);
          if (ex && ex.check_in_at) continue; // never overwrite a real check-in
          if (ex) Object.assign(ex, { status: t.attendance_status, leave_request_id: l.id, notes: t.name });
          else db().attendance.push({ id: DemoStore.id('at'), company_id: s.company_id, employee_id: l.employee_id, date: d, status: t.attendance_status, leave_request_id: l.id, source: 'leave', notes: t.name, flags: [], check_in_at: null, check_out_at: null, work_minutes: null, location_status: null });
        }
      }
      const emp = empById(l.employee_id);
      notify(userOfEmployee(l.employee_id), decision === 'approved' ? 'leave_approved' : 'leave_rejected', decision === 'approved' ? 'Izin disetujui' : 'Izin ditolak', `${t.name} (${Fmt.date(l.start_date)}) ${decision === 'approved' ? 'disetujui' : 'ditolak'}.${l.owner_notes ? ' Catatan: ' + l.owner_notes : ''}`, 'employee/leave.html');
      audit(s, `leave.${decision === 'approved' ? 'approve' : 'reject'}`, 'leave_request', id, `${decision === 'approved' ? 'Menyetujui' : 'Menolak'} ${t.name} — ${emp.full_name}`);
      commit(); return leaveOut(l);
    },
    leaveCancel(id) {
      const s = employee(); const l = db().leave_requests.find((x) => x.id === id && x.employee_id === s.employee_id);
      if (!l) throw new ApiError('Pengajuan tidak ditemukan', 'NOT_FOUND', 404);
      if (l.status !== 'pending') throw new ApiError('Hanya pengajuan pending yang bisa dibatalkan', 'ALREADY_DECIDED', 409);
      l.status = 'cancelled'; commit(); return leaveOut(l);
    },
    leaveBalance(empId) { const s = sess(); const id = s.role === 'employee' ? s.employee_id : empId; return Rules.leaveBalance(id); },

    /* Tasks */
    tasksList(q = {}) {
      const s = sess(); let rows = companyRows(db().tasks, s);
      if (s.role === 'employee') rows = rows.filter((t) => t.assignee_id === s.employee_id);
      else if (q.assignee_id) rows = rows.filter((t) => t.assignee_id === q.assignee_id);
      rows = rows.map(taskOut);
      if (q.status) rows = rows.filter((t) => t.status_display === q.status);
      return rows.sort((a, b) => a.deadline.localeCompare(b.deadline));
    },
    taskGet(id) {
      const s = sess(); const t = db().tasks.find((x) => x.id === id);
      if (!t || t.company_id !== s.company_id || (s.role === 'employee' && t.assignee_id !== s.employee_id)) throw new ApiError('Tugas tidak ditemukan', 'NOT_FOUND', 404);
      return taskOut(t);
    },
    taskSave(id, d) {
      const s = owner(); const errors = {};
      if (!d.title || d.title.trim().length < 3) errors.title = 'Judul minimal 3 karakter';
      if (!d.assignee_id || !empById(d.assignee_id)) errors.assignee_id = 'Pilih karyawan';
      else if (empById(d.assignee_id).employment_status !== 'active') errors.assignee_id = 'Karyawan tidak aktif';
      if (!['low', 'medium', 'high'].includes(d.priority)) errors.priority = 'Pilih prioritas';
      if (!d.deadline) errors.deadline = 'Deadline wajib diisi';
      else if (!id && d.deadline < Fmt.today()) errors.deadline = 'Deadline tidak boleh di masa lalu';
      if (Object.keys(errors).length) throw new ApiError('Periksa kembali data tugas', 'VALIDATION', 422, errors);
      let t;
      if (id) {
        t = db().tasks.find((x) => x.id === id); if (!t) throw new ApiError('Tugas tidak ditemukan', 'NOT_FOUND', 404);
        const reassigned = t.assignee_id !== d.assignee_id;
        Object.assign(t, { title: d.title.trim(), description: (d.description || '').trim(), assignee_id: d.assignee_id, priority: d.priority, deadline: d.deadline });
        t.history.push({ at: nowISO(), by: s.full_name, action: reassigned ? `Dialihkan ke ${empById(d.assignee_id).full_name}` : 'Detail tugas diperbarui', from: null, to: null });
        if (reassigned) notify(userOfEmployee(d.assignee_id), 'task_assigned', 'Tugas baru', `Anda mendapat tugas: ${t.title}.`, 'employee/tasks.html');
        audit(s, 'task.update', 'task', id, `Memperbarui tugas "${t.title}"`);
      } else {
        t = { id: DemoStore.id('tk'), company_id: s.company_id, title: d.title.trim(), description: (d.description || '').trim(), assignee_id: d.assignee_id, priority: d.priority, deadline: d.deadline, status: 'todo', progress: 0, created_by: s.user_id, created_at: nowISO(), completed_at: null,
          history: [{ at: nowISO(), by: s.full_name, action: 'Tugas dibuat', from: null, to: 'todo' }] };
        db().tasks.push(t);
        notify(userOfEmployee(d.assignee_id), 'task_assigned', 'Tugas baru', `Anda mendapat tugas: ${t.title} (deadline ${Fmt.date(t.deadline)}).`, 'employee/tasks.html');
        audit(s, 'task.create', 'task', t.id, `Membuat tugas "${t.title}" untuk ${empById(d.assignee_id).full_name}`);
      }
      commit(); return taskOut(t);
    },
    taskDelete(id) {
      const s = owner(); const i = db().tasks.findIndex((x) => x.id === id); if (i < 0) throw new ApiError('Tugas tidak ditemukan', 'NOT_FOUND', 404);
      const [t] = db().tasks.splice(i, 1); audit(s, 'task.delete', 'task', id, `Menghapus tugas "${t.title}"`); commit(); return true;
    },
    taskStatus(id, status, progress) {
      const s = sess(); const t = db().tasks.find((x) => x.id === id);
      if (!t || (s.role === 'employee' && t.assignee_id !== s.employee_id)) throw new ApiError('Tugas tidak ditemukan', 'NOT_FOUND', 404);
      if (!['todo', 'in_progress', 'completed'].includes(status)) throw new ApiError('Status tidak valid', 'VALIDATION', 422);
      const from = t.status;
      t.status = status;
      t.progress = status === 'completed' ? 100 : status === 'todo' ? 0 : Math.min(99, Math.max(1, Number(progress != null ? progress : t.progress || 10)));
      t.completed_at = status === 'completed' ? nowISO() : null;
      t.history.push({ at: nowISO(), by: s.full_name, action: from === status ? `Progress diperbarui (${t.progress}%)` : 'Status diubah', from, to: status });
      if (s.role === 'employee' && status === 'completed') ownerIds().forEach((o) => notify(o, 'task_completed', 'Tugas selesai', `${s.full_name} menyelesaikan "${t.title}".`, 'owner/tasks.html'));
      commit(); return taskOut(t);
    },

    /* Payroll */
    payrollPeriods() {
      const s = owner();
      return companyRows(db().payroll_periods, s).sort((a, b) => b.period_key.localeCompare(a.period_key)).map((p) => {
        const items = db().payroll_items.filter((i) => i.period_id === p.id);
        return { ...p, status_display: Rules.periodStatus(p), total_net: items.reduce((sum, i) => sum + i.net_salary, 0), employees: items.length, paid_count: items.filter((i) => i.status === 'paid').length };
      });
    },
    payrollPeriod(id) {
      const s = owner(); const p = db().payroll_periods.find((x) => x.id === id && x.company_id === s.company_id);
      if (!p) throw new ApiError('Periode tidak ditemukan', 'NOT_FOUND', 404);
      const items = db().payroll_items.filter((i) => i.period_id === id).map((i) => ({ ...withEmp(i), payment: db().payments.find((x) => x.payroll_item_id === i.id) || null }));
      return { ...p, status_display: Rules.periodStatus(p), items, total_net: items.reduce((sum, i) => sum + i.net_salary, 0) };
    },
    payrollItem(id) {
      const s = sess(); const it = db().payroll_items.find((x) => x.id === id);
      /* Salary privacy: an employee can only read their own items, and only once approved. */
      if (!it || it.company_id !== s.company_id || (s.role === 'employee' && it.employee_id !== s.employee_id)) throw new ApiError('Data payroll tidak ditemukan', 'NOT_FOUND', 404);
      const p = db().payroll_periods.find((x) => x.id === it.period_id);
      if (s.role === 'employee' && !['approved', 'scheduled', 'paid'].includes(p.status)) throw new ApiError('Slip gaji belum tersedia', 'NOT_FOUND', 404);
      return { ...withEmp(it), period: { ...p, status_display: Rules.periodStatus(p) }, payment: db().payments.find((x) => x.payroll_item_id === id) || null, company: db().company };
    },
    payrollAdjust(itemId, d) {
      const s = owner(); const it = db().payroll_items.find((x) => x.id === itemId); if (!it) throw new ApiError('Item tidak ditemukan', 'NOT_FOUND', 404);
      const p = db().payroll_periods.find((x) => x.id === it.period_id);
      if (!['draft', 'pending_approval'].includes(p.status)) throw new ApiError('Payroll sudah disetujui — adjustment terkunci', 'LOCKED', 409);
      const errors = {};
      if (!d.name || d.name.trim().length < 3) errors.name = 'Keterangan minimal 3 karakter';
      if (!(Number(d.amount) > 0)) errors.amount = 'Nominal harus lebih dari 0';
      if (!['addition', 'deduction'].includes(d.type)) errors.type = 'Pilih jenis';
      if (Object.keys(errors).length) throw new ApiError('Periksa kembali adjustment', 'VALIDATION', 422, errors);
      it.adjustments.push({ id: DemoStore.id('adj'), type: d.type, name: d.name.trim(), amount: Number(d.amount), by: s.full_name, at: nowISO() });
      it.net_salary = Rules.payrollNet(it);
      audit(s, 'payroll.adjust', 'payroll_item', itemId, `Adjustment ${d.type === 'deduction' ? '−' : '+'}${Fmt.rupiah(d.amount)} untuk ${empById(it.employee_id).full_name}: ${d.name}`);
      commit(); return it;
    },
    payrollRemoveAdjust(itemId, adjId) {
      const s = owner(); const it = db().payroll_items.find((x) => x.id === itemId);
      const p = db().payroll_periods.find((x) => x.id === it.period_id);
      if (!['draft', 'pending_approval'].includes(p.status)) throw new ApiError('Payroll sudah disetujui — adjustment terkunci', 'LOCKED', 409);
      it.adjustments = it.adjustments.filter((a) => a.id !== adjId); it.net_salary = Rules.payrollNet(it);
      audit(s, 'payroll.adjust_remove', 'payroll_item', itemId, `Menghapus adjustment untuk ${empById(it.employee_id).full_name}`);
      commit(); return it;
    },
    payrollTransition(periodId, action, d = {}) {
      const s = owner(); const p = db().payroll_periods.find((x) => x.id === periodId); if (!p) throw new ApiError('Periode tidak ditemukan', 'NOT_FOUND', 404);
      const items = db().payroll_items.filter((i) => i.period_id === periodId);
      const flow = { submit: ['draft', 'pending_approval'], approve: ['pending_approval', 'approved'], schedule: ['approved', 'scheduled'], reopen: ['pending_approval', 'draft'] };
      if (!flow[action] || p.status !== flow[action][0]) throw new ApiError(`Aksi tidak valid untuk status ${p.status}`, 'INVALID_TRANSITION', 409);
      if (action === 'schedule') { if (!d.payment_date) throw new ApiError('Tanggal pembayaran wajib', 'VALIDATION', 422, { payment_date: 'Wajib diisi' }); p.payment_date = d.payment_date; }
      p.status = flow[action][1];
      items.forEach((i) => { if (i.status !== 'paid') i.status = p.status; });
      if (action === 'approve') {
        p.approved_at = nowISO(); p.approved_by = s.user_id;
        items.forEach((i) => notify(userOfEmployee(i.employee_id), 'payslip', 'Slip gaji tersedia', `Slip gaji ${Fmt.monthLabel(p.period_key)} sudah dapat dilihat. Pembayaran dijadwalkan ${Fmt.date(p.payment_date)}.`, 'employee/payslip.html'));
        ownerIds().forEach((o) => notify(o, 'payroll_approved', 'Payroll disetujui', `Payroll ${Fmt.monthLabel(p.period_key)} disetujui.`, 'owner/payroll.html'));
      }
      if (action === 'schedule') items.forEach((i) => notify(userOfEmployee(i.employee_id), 'salary_upcoming', 'Gaji akan dibayarkan', `Gaji ${Fmt.monthLabel(p.period_key)} dijadwalkan ${Fmt.date(p.payment_date)}.`, 'employee/payslip.html'));
      const label = { submit: 'Mengajukan payroll untuk approval', approve: 'Menyetujui payroll', schedule: 'Menjadwalkan pembayaran', reopen: 'Membuka kembali payroll ke draft' }[action];
      audit(s, `payroll.${action}`, 'payroll_period', periodId, `${label} ${Fmt.monthLabel(p.period_key)}`);
      commit(); return p;
    },
    /* Paid is ONLY set here, after the owner records a manual transfer. */
    payrollConfirmPayment(periodId, itemIds, d) {
      const s = owner(); const p = db().payroll_periods.find((x) => x.id === periodId);
      if (!p || !['approved', 'scheduled'].includes(p.status)) throw new ApiError('Payroll harus disetujui sebelum konfirmasi pembayaran', 'INVALID_TRANSITION', 409);
      const errors = {};
      if (!d.paid_at) errors.paid_at = 'Tanggal transfer wajib diisi';
      else if (d.paid_at > Fmt.today()) errors.paid_at = 'Tanggal transfer tidak boleh di masa depan';
      if (!d.method) errors.method = 'Metode wajib diisi';
      if (!itemIds.length) errors.items = 'Pilih minimal satu karyawan';
      if (Object.keys(errors).length) throw new ApiError('Periksa data pembayaran', 'VALIDATION', 422, errors);
      itemIds.forEach((iid) => {
        const it = db().payroll_items.find((x) => x.id === iid && x.period_id === periodId); if (!it || it.status === 'paid') return;
        it.status = 'paid';
        db().payments.push({ id: DemoStore.id('pay'), company_id: s.company_id, payroll_item_id: iid, employee_id: it.employee_id, amount: it.net_salary, paid_at: new Date(`${d.paid_at}T12:00:00`).toISOString(), method: d.method, reference: d.reference || '', note: d.note || '', confirmed_by: s.user_id });
        notify(userOfEmployee(it.employee_id), 'salary_paid', 'Gaji telah dibayar', `Gaji ${Fmt.monthLabel(p.period_key)} sebesar ${Fmt.rupiah(it.net_salary)} telah ditransfer.`, 'employee/payslip.html');
      });
      const all = db().payroll_items.filter((i) => i.period_id === periodId);
      if (all.every((i) => i.status === 'paid')) p.status = 'paid';
      audit(s, 'payroll.confirm_payment', 'payroll_period', periodId, `Mengonfirmasi pembayaran ${itemIds.length} karyawan — ${Fmt.monthLabel(p.period_key)}`);
      commit(); return p;
    },
    /* Demo only: a simple period from salary configs. Production computes from attendance/leave (Django payroll engine). */
    payrollGenerate(key) {
      const s = owner();
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(key || '')) throw new ApiError('Periode tidak valid', 'VALIDATION', 422, { period_key: 'Format YYYY-MM' });
      let p = db().payroll_periods.find((x) => x.period_key === key);
      if (p && p.status !== 'draft') throw new ApiError('Payroll periode ini sudah diajukan/disetujui — kembalikan ke draft untuk menghitung ulang', 'LOCKED', 409);
      const [y, m] = key.split('-').map(Number); const end = Fmt.toISODate(new Date(y, m, 0));
      if (!p) { p = { id: `pp-${key}`, company_id: s.company_id, period_key: key, start_date: `${key}-01`, end_date: end, payment_date: `${key}-${Fmt.pad(Math.min(db().settings.payroll.payment_day || 28, Number(end.slice(-2))))}`, status: 'draft', approved_at: null, created_at: nowISO() }; db().payroll_periods.push(p); }
      db().employees.filter((e) => e.employment_status === 'active' && e.join_date <= end).forEach((e) => {
        const cfg = db().salary_configs.find((c) => c.employee_id === e.id); if (!cfg) return;
        let it = db().payroll_items.find((i) => i.period_id === p.id && i.employee_id === e.id);
        if (!it) { it = { id: `pi-${key}-${e.id}`, company_id: s.company_id, period_id: p.id, employee_id: e.id, bonus: 0, incentives: 0, overtime_hours: 0, overtime_amount: 0, deductions: [], adjustments: [], status: 'draft' }; db().payroll_items.push(it); }
        Object.assign(it, { basic_salary: cfg.basic_salary, allowances: clone(cfg.allowances), calc_note: 'Mode demo: angka dari konfigurasi gaji. Di produksi dihitung dari absensi, izin & lembur.' });
        it.net_salary = Rules.payrollNet(it);
      });
      audit(s, 'payroll.generate', 'payroll_period', p.id, `Menghitung payroll ${Fmt.monthLabel(key)}`);
      commit(); return demo.payrollPeriod(p.id);
    },
    payrollUpdateItem(itemId, d) {
      const s = owner(); const it = db().payroll_items.find((x) => x.id === itemId); if (!it) throw new ApiError('Item tidak ditemukan', 'NOT_FOUND', 404);
      const p = db().payroll_periods.find((x) => x.id === it.period_id);
      if (!['draft', 'pending_approval'].includes(p.status)) throw new ApiError('Payroll sudah disetujui — adjustment terkunci', 'LOCKED', 409);
      const cfg = db().salary_configs.find((c) => c.employee_id === it.employee_id) || { overtime_rate_per_hour: 0 };
      if (d.overtime_hours !== undefined) { it.overtime_hours = d.overtime_hours == null ? 0 : Number(d.overtime_hours); it.overtime_amount = it.overtime_hours * Number(cfg.overtime_rate_per_hour || 0); }
      ['bonus', 'incentives'].forEach((k) => { if (d[k] !== undefined) it[k] = Number(d[k] || 0); });
      it.net_salary = Rules.payrollNet(it);
      audit(s, 'payroll.item_update', 'payroll_item', itemId, `Mengubah komponen payroll ${empById(it.employee_id).full_name}`);
      commit(); return { ...withEmp(it), overtime_hours_auto: 0, overtime_override: d.overtime_hours };
    },
    analyticsPerformance(range) {
      const s = owner(); const today = Fmt.today(); const d = Fmt.parseDate(today);
      let b;
      if (range === 'last_month') b = [Fmt.toISODate(new Date(d.getFullYear(), d.getMonth() - 1, 1)), Fmt.toISODate(new Date(d.getFullYear(), d.getMonth(), 0)), Fmt.toISODate(new Date(d.getFullYear(), d.getMonth() - 2, 1)), Fmt.toISODate(new Date(d.getFullYear(), d.getMonth() - 1, 0))];
      else if (range === 'last_90') b = [Fmt.addDays(today, -89), today, Fmt.addDays(today, -179), Fmt.addDays(today, -90)];
      else { const st = today.slice(0, 7) + '-01'; const ps = Fmt.toISODate(new Date(d.getFullYear(), d.getMonth() - 1, 1)); b = [st, today, ps, Fmt.addDays(ps, Fmt.diffDays(st, today))]; }
      const [from, to, pFrom, pTo] = b;
      const emps = companyRows(db().employees, s).filter((e) => e.employment_status === 'active');
      const recs = companyRows(db().attendance, s).filter((r) => r.date >= Fmt.addDays(today, -200));
      const tasks = demo.tasksList({});
      const cur = recs.filter((r) => r.date >= from && r.date <= to), prev = recs.filter((r) => r.date >= pFrom && r.date <= pTo);
      const curTasks = tasks.filter((t) => (t.deadline >= from && t.deadline <= to) || (t.status !== 'completed' && t.deadline < from && range === 'this_month'));
      const scope = curTasks.length ? curTasks : tasks;
      const S = Metrics.summarize(cur), P = Metrics.summarize(prev);
      const rows = Metrics.perEmployee(emps, cur, scope).sort((a, x) => x.score - a.score);
      const months = Metrics.lastMonths(6);
      return { range, from, to, prev_from: pFrom, prev_to: pTo, current: S, previous: P, tasks: Metrics.taskSummary(scope), rows,
        avg_score: rows.length ? Math.round(rows.reduce((t, r) => t + r.score, 0) / rows.length) : 0, months: Metrics.monthly(recs, months), insights: Metrics.insights(rows, S, P) };
    },
    salaryConfigs() { const s = owner(); return companyRows(db().salary_configs, s).map((c) => ({ ...c, employee: pickEmp(empById(c.employee_id)) })); },
    salaryConfigUpdate(empId, d) {
      const s = owner(); const c = db().salary_configs.find((x) => x.employee_id === empId); if (!c) throw new ApiError('Konfigurasi tidak ditemukan', 'NOT_FOUND', 404);
      const errors = {};
      if (!(Number(d.basic_salary) > 0)) errors.basic_salary = 'Gaji pokok harus lebih dari 0';
      if (Number(d.overtime_rate_per_hour) < 0) errors.overtime_rate_per_hour = 'Tidak boleh negatif';
      (d.allowances || []).forEach((a, i) => { if (!a.name || !(Number(a.amount) >= 0)) errors[`allowance_${i}`] = 'Nama & nominal tunjangan wajib valid'; });
      if (Object.keys(errors).length) throw new ApiError('Periksa konfigurasi gaji', 'VALIDATION', 422, errors);
      Object.assign(c, { basic_salary: Number(d.basic_salary), overtime_rate_per_hour: Number(d.overtime_rate_per_hour || 0), allowances: (d.allowances || []).map((a) => ({ name: a.name.trim(), amount: Number(a.amount) })) });
      audit(s, 'payroll.salary_config', 'employee_salary_configuration', empId, `Memperbarui konfigurasi gaji ${empById(empId).full_name}`);
      commit(); return c;
    },
    employeePayroll(empId) {
      const s = owner();
      return db().payroll_items.filter((i) => i.employee_id === empId && i.company_id === s.company_id)
        .map((i) => { const p = db().payroll_periods.find((x) => x.id === i.period_id); return { ...i, period: { ...p, status_display: Rules.periodStatus(p) }, payment: db().payments.find((x) => x.payroll_item_id === i.id) || null }; })
        .sort((a, b) => b.period.period_key.localeCompare(a.period.period_key));
    },
    myPayslips() {
      const s = employee();
      return db().payroll_items.filter((i) => i.employee_id === s.employee_id).map((i) => ({ ...i, period: db().payroll_periods.find((p) => p.id === i.period_id), payment: db().payments.find((x) => x.payroll_item_id === i.id) || null }))
        .filter((i) => ['approved', 'scheduled', 'paid'].includes(i.period.status))
        .map((i) => ({ ...i, period: { ...i.period, status_display: Rules.periodStatus(i.period) } }))
        .sort((a, b) => b.period.period_key.localeCompare(a.period.period_key));
    },

    /* Notifications & announcements */
    notifications() { const s = sess(); return db().notifications.filter((n) => n.recipient_id === s.user_id).sort((a, b) => b.created_at.localeCompare(a.created_at)); },
    notificationRead(id) { const s = sess(); const n = db().notifications.find((x) => x.id === id && x.recipient_id === s.user_id); if (n) n.read = true; commit(); return n; },
    notificationsReadAll() { const s = sess(); db().notifications.forEach((n) => { if (n.recipient_id === s.user_id) n.read = true; }); commit(); return true; },
    announcements() { const s = sess(); return companyRows(db().announcements, s).sort((a, b) => (b.pinned - a.pinned) || b.created_at.localeCompare(a.created_at)); },
    announcementCreate(d) {
      const s = owner(); const errors = {};
      if (!d.title || d.title.trim().length < 3) errors.title = 'Judul minimal 3 karakter';
      if (!d.body || d.body.trim().length < 10) errors.body = 'Isi minimal 10 karakter';
      if (Object.keys(errors).length) throw new ApiError('Periksa pengumuman', 'VALIDATION', 422, errors);
      const a = { id: DemoStore.id('an'), company_id: s.company_id, title: d.title.trim(), body: d.body.trim(), pinned: !!d.pinned, created_at: nowISO(), created_by: s.user_id };
      db().announcements.push(a);
      db().employees.filter((e) => e.employment_status === 'active' && e.user_id).forEach((e) => notify(e.user_id, 'announcement', 'Pengumuman baru', a.title, 'employee/announcements.html'));
      audit(s, 'announcement.create', 'announcement', a.id, `Membuat pengumuman "${a.title}"`);
      commit(); return a;
    },
    announcementDelete(id) { const s = owner(); db().announcements = db().announcements.filter((a) => a.id !== id); audit(s, 'announcement.delete', 'announcement', id, 'Menghapus pengumuman'); commit(); return true; },
    auditLogs(limit = 20) { const s = owner(); return companyRows(db().audit_logs, s).slice(0, limit); },

    /* Settings */
    settings() {
      const s = sess();
      if (s.role === 'employee') { const st = db().settings; return { work: st.work, attendance: { radius_m: st.attendance.radius_m, selfie_required: st.attendance.selfie_required, gps_required: st.attendance.gps_required, location: { name: st.attendance.location.name } }, profile_editable_fields: st.profile_editable_fields, company: { name: db().company.name } }; }
      return { ...clone(db().settings), company: clone(db().company), leave_types: clone(db().leave_types), users: db().profiles.map((p) => ({ ...p, status: p.employee_id ? empById(p.employee_id).employment_status : 'active' })) };
    },
    settingsUpdate(section, d) {
      const s = owner(); const st = db().settings; const errors = {};
      if (section === 'company') {
        if (!d.name || d.name.trim().length < 2) errors.name = 'Nama perusahaan wajib diisi';
        if (d.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email)) errors.email = 'Email tidak valid';
        if (!Object.keys(errors).length) Object.assign(db().company, { name: d.name.trim(), address: d.address || '', phone: d.phone || '', email: d.email || '' });
      } else if (section === 'work') {
        if (!d.start || !d.end) errors.start = 'Jam kerja wajib diisi';
        else if (Fmt.hmToMinutes(d.end) <= Fmt.hmToMinutes(d.start)) errors.end = 'Jam selesai harus setelah jam mulai';
        if (d.break_start && d.break_end && Fmt.hmToMinutes(d.break_end) <= Fmt.hmToMinutes(d.break_start)) errors.break_end = 'Jam istirahat selesai harus setelah mulai';
        if (!d.working_days || !d.working_days.length) errors.working_days = 'Pilih minimal satu hari kerja';
        if (!(Number(d.late_tolerance_min) >= 0 && Number(d.late_tolerance_min) <= 120)) errors.late_tolerance_min = 'Toleransi 0–120 menit';
        if (!Object.keys(errors).length) Object.assign(st.work, { ...d, late_tolerance_min: Number(d.late_tolerance_min), early_leave_tolerance_min: Number(d.early_leave_tolerance_min || 0) });
      } else if (section === 'attendance') {
        const hasLat = d.lat !== '' && d.lat != null, hasLng = d.lng !== '' && d.lng != null;
        if (hasLat !== hasLng) errors.lat = 'Isi latitude dan longitude bersamaan';
        if (hasLat && !(Number(d.lat) >= -90 && Number(d.lat) <= 90)) errors.lat = 'Latitude harus −90 s/d 90';
        if (hasLng && !(Number(d.lng) >= -180 && Number(d.lng) <= 180)) errors.lng = 'Longitude harus −180 s/d 180';
        if (!(Number(d.radius_m) >= 10 && Number(d.radius_m) <= 5000)) errors.radius_m = 'Radius 10–5000 meter';
        if (!(Number(d.max_gps_accuracy_m) >= 5 && Number(d.max_gps_accuracy_m) <= 1000)) errors.max_gps_accuracy_m = 'Akurasi 5–1000 meter';
        if (hasLat && !d.name) errors.name = 'Nama lokasi wajib diisi';
        if (!Object.keys(errors).length) Object.assign(st.attendance, { location: { name: d.name || '', address: d.address || '', lat: hasLat ? Number(d.lat) : null, lng: hasLng ? Number(d.lng) : null }, radius_m: Number(d.radius_m), max_gps_accuracy_m: Number(d.max_gps_accuracy_m), selfie_required: !!d.selfie_required, gps_required: !!d.gps_required });
      } else if (section === 'payroll') {
        const mode = d.payment_day_mode === 'join_date' ? 'join_date' : 'fixed';
        if (mode === 'fixed' && !(Number(d.payment_day) >= 1 && Number(d.payment_day) <= 31)) errors.payment_day = 'Tanggal 1–31';
        (d.default_components || []).forEach((c, i) => { if (!c.name || !(Number(c.amount) >= 0)) errors[`component_${i}`] = 'Komponen tidak valid'; });
        if (!Object.keys(errors).length) Object.assign(st.payroll, { payment_day_mode: mode, payment_day: mode === 'fixed' ? Number(d.payment_day) : st.payroll.payment_day, period: d.period, rules: { ...st.payroll.rules, ...d.rules, late_per_incident: Number(d.rules.late_per_incident || 0) }, default_components: (d.default_components || []).map((c) => ({ name: c.name.trim(), amount: Number(c.amount) })) });
      } else if (section === 'leave') {
        if (!(Number(d.annual_quota_days) >= 0 && Number(d.annual_quota_days) <= 60)) errors.annual_quota_days = '0–60 hari';
        if (!Object.keys(errors).length) {
          st.leave.annual_quota_days = Number(d.annual_quota_days);
          (d.types || []).forEach((u) => { const t = db().leave_types.find((x) => x.id === u.id); if (t) Object.assign(t, { is_paid: !!u.is_paid, requires_attachment: !!u.requires_attachment, active: !!u.active }); });
        }
      } else if (section === 'notifications') { st.notifications = { ...st.notifications, ...d }; }
      else if (section === 'profile_fields') { st.profile_editable_fields = d.fields || []; }
      else throw new ApiError('Bagian pengaturan tidak dikenal', 'VALIDATION', 422);
      if (Object.keys(errors).length) throw new ApiError('Periksa kembali pengaturan', 'VALIDATION', 422, errors);
      audit(s, `settings.${section}`, 'company_settings', s.company_id, `Memperbarui pengaturan: ${section}`);
      commit(); return demo.settings();
    },
  };

  /* ---------------- Public API ---------------- */
  function call(method, path, opts, demoFn) {
    if (!isDemo()) return http(method, path, opts && opts.body, opts && opts.query);
    return delay().then(() => clone(demoFn()));
  }

  const API = {
    ApiError, Rules, haversine, isDemo,
    auth: {
      /* Production: Django verifies the Supabase JWT and returns profile + company + employee. */
      me: () => call('GET', '/auth/me/', null, demo.me),
    },
    employees: {
      list: (q) => call('GET', '/employees/', { query: q }, () => demo.employeesList(q)),
      get: (id) => call('GET', `/employees/${id}/`, null, () => demo.employeeGet(id)),
      create: (d) => call('POST', '/employees/', { body: d }, () => demo.employeeCreate(d)),
      update: (id, d) => call('PUT', `/employees/${id}/`, { body: d }, () => demo.employeeUpdate(id, d)),
      deactivate: (id) => call('DELETE', `/employees/${id}/`, null, () => demo.employeeSetStatus(id, 'inactive')),
      activate: (id) => call('POST', `/employees/${id}/activate/`, null, () => demo.employeeSetStatus(id, 'active')),
    },
    attendance: {
      list: (q) => call('GET', '/attendance/history/', { query: q }, () => demo.attendanceList(q)),
      monitoring: (date) => call('GET', '/attendance/monitoring/', { query: { date } }, () => demo.attendanceMonitoring(date)),
      get: (id) => call('GET', `/attendance/${id}/`, null, () => demo.attendanceGet(id)),
      evidence: (id) => call('GET', `/attendance/${id}/evidence/`, null, () => demo.attendanceEvidence(id)),
      today: () => call('GET', '/attendance/today/', null, demo.attendanceToday),
      checkIn: (p) => call('POST', '/attendance/check-in/', { body: p }, () => demo.attendanceCheck('in', p)),
      checkOut: (p) => call('POST', '/attendance/check-out/', { body: p }, () => demo.attendanceCheck('out', p)),
      locationPreview: (lat, lng, acc) => call('POST', '/attendance/location-preview/', { body: { lat, lng, accuracy: acc } }, () => demo.locationCheck(lat, lng, acc)),
      correct: (id, d) => call('POST', `/attendance/${id || 'new'}/correction/`, { body: d }, () => demo.attendanceCorrect(id, d)),
      requestCorrection: (d) => call('POST', '/attendance/correction-requests/', { body: d }, () => demo.attendanceRequestCorrection(d)),
      correctionRequests: () => call('GET', '/attendance/correction-requests/', null, demo.correctionRequests),
      resolveCorrection: (id, decision, payload) => call('POST', `/attendance/correction-requests/${id}/${decision}/`, { body: payload }, () => demo.correctionResolve(id, decision, payload)),
      reconcilePreview: (date) => call('GET', '/attendance/reconcile/', { query: { date } }, () => demo.attendanceReconcilePreview(date)),
      reconcile: (date, ids) => call('POST', '/attendance/reconcile/', { body: { date, employee_ids: ids } }, () => demo.attendanceReconcile(date, ids)),
    },
    leave: {
      types: () => call('GET', '/leave/types/', null, demo.leaveTypes),
      list: (q) => call('GET', '/leave/', { query: q }, () => demo.leaveList(q)),
      get: (id) => call('GET', `/leave/${id}/`, null, () => demo.leaveGet(id)),
      /* Production sends the real file (multipart) → Django validates it and stores it in a private bucket. */
      request: (d) => {
        const { attachment, ...rest } = d;
        let body = rest;
        if (!isDemo() && attachment) { body = new FormData(); Object.entries(rest).forEach(([k, v]) => { if (v != null) body.append(k, v); }); body.append('attachment', attachment); }
        return call('POST', '/leave/request/', { body }, () => demo.leaveRequest(rest));
      },
      attachment: (id) => call('GET', `/leave/${id}/attachment/`, null, () => { throw new ApiError('Lampiran asli hanya tersedia di mode produksi', 'DEMO_MODE', 400); }),
      cancel: (id) => call('POST', `/leave/${id}/cancel/`, null, () => demo.leaveCancel(id)),
      approve: (id, notes) => call('POST', `/leave/${id}/approve/`, { body: { notes } }, () => demo.leaveDecide(id, 'approved', notes)),
      reject: (id, notes) => call('POST', `/leave/${id}/reject/`, { body: { notes } }, () => demo.leaveDecide(id, 'rejected', notes)),
      balance: (empId) => call('GET', '/leave/balance/', { query: { employee_id: empId } }, () => demo.leaveBalance(empId)),
    },
    tasks: {
      list: (q) => call('GET', '/tasks/', { query: q }, () => demo.tasksList(q)),
      get: (id) => call('GET', `/tasks/${id}/`, null, () => demo.taskGet(id)),
      create: (d) => call('POST', '/tasks/', { body: d }, () => demo.taskSave(null, d)),
      update: (id, d) => call('PUT', `/tasks/${id}/`, { body: d }, () => demo.taskSave(id, d)),
      remove: (id) => call('DELETE', `/tasks/${id}/`, null, () => demo.taskDelete(id)),
      setStatus: (id, status, progress) => call('PATCH', `/tasks/${id}/status/`, { body: { status, progress } }, () => demo.taskStatus(id, status, progress)),
    },
    payroll: {
      periods: () => call('GET', '/payroll/', null, demo.payrollPeriods),
      period: (id) => call('GET', `/payroll/${id}/`, null, () => demo.payrollPeriod(id)),
      item: (id) => call('GET', `/payroll/items/${id}/`, null, () => demo.payrollItem(id)),
      adjust: (itemId, d) => call('POST', `/payroll/items/${itemId}/adjustments/`, { body: d }, () => demo.payrollAdjust(itemId, d)),
      removeAdjust: (itemId, adjId) => call('DELETE', `/payroll/items/${itemId}/adjustments/${adjId}/`, null, () => demo.payrollRemoveAdjust(itemId, adjId)),
      transition: (id, action, d) => call('POST', `/payroll/${id}/${action}/`, { body: d }, () => demo.payrollTransition(id, action, d)),
      confirmPayment: (id, itemIds, d) => call('POST', `/payroll/${id}/confirm-payment/`, { body: { ...d, item_ids: itemIds } }, () => demo.payrollConfirmPayment(id, itemIds, d)),
      generate: (key) => call('POST', '/payroll/generate/', { body: { period_key: key } }, () => demo.payrollGenerate(key)),
      recalculate: (id) => call('POST', `/payroll/${id}/recalculate/`, null, () => demo.payrollGenerate((DemoStore.db.payroll_periods.find((p) => p.id === id) || {}).period_key)),
      updateItem: (id, d) => call('PATCH', `/payroll/items/${id}/`, { body: d }, () => demo.payrollUpdateItem(id, d)),
      pdf: (id) => (isDemo() ? Promise.reject(new ApiError('PDF server tersedia di mode produksi — gunakan tombol Cetak.', 'DEMO_MODE', 400)) : download(`/payroll/items/${id}/pdf/`)),
      salaryConfigs: () => call('GET', '/payroll/salary-configurations/', null, demo.salaryConfigs),
      updateSalaryConfig: (empId, d) => call('PUT', `/payroll/salary-configurations/${empId}/`, { body: d }, () => demo.salaryConfigUpdate(empId, d)),
      myPayslips: () => call('GET', '/payroll/my-payslips/', null, demo.myPayslips),
      employeeItems: (empId) => call('GET', `/payroll/employees/${empId}/items/`, null, () => demo.employeePayroll(empId)),
    },
    notifications: {
      list: () => call('GET', '/notifications/', null, demo.notifications),
      read: (id) => call('POST', `/notifications/${id}/read/`, null, () => demo.notificationRead(id)),
      readAll: () => call('POST', '/notifications/read-all/', null, demo.notificationsReadAll),
      unreadCount: () => call('GET', '/notifications/unread-count/', null, () => ({ unread: demo.notifications().filter((n) => !n.read).length })),
    },
    announcements: {
      list: () => call('GET', '/announcements/', null, demo.announcements),
      create: (d) => call('POST', '/announcements/', { body: d }, () => demo.announcementCreate(d)),
      remove: (id) => call('DELETE', `/announcements/${id}/`, null, () => demo.announcementDelete(id)),
    },
    analytics: { performance: (range) => call('GET', '/analytics/performance/', { query: { range } }, () => demo.analyticsPerformance(range)) },
    audit: { list: (limit) => call('GET', '/audit-logs/', { query: { limit } }, () => demo.auditLogs(limit)) },
    settings: {
      get: () => call('GET', '/settings/', null, demo.settings),
      update: (section, d) => call('PUT', `/settings/${section}/`, { body: d }, () => demo.settingsUpdate(section, d)),
    },
  };
  window.API = API;
})();
