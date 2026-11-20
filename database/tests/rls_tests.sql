-- =====================================================================
-- AbsenInn · RLS security tests
-- Runs inside a transaction and ROLLS BACK at the end → leaves no data.
-- Safe to run in Supabase SQL Editor after schema.sql.
-- Any failure aborts with "FAIL: ..."; success ends with
-- "SEMUA TES RLS LULUS".
-- =====================================================================
begin;
set local client_min_messages = notice;

-- ---------- fixtures (as postgres, bypassing RLS) ----------
insert into auth.users (id, email) values
  ('11111111-0000-4000-8000-00000000a0a0', 'owner.a@test.local'),
  ('11111111-0000-4000-8000-00000000a001', 'emp.a1@test.local'),
  ('11111111-0000-4000-8000-00000000a002', 'emp.a2@test.local'),
  ('11111111-0000-4000-8000-00000000b0b0', 'owner.b@test.local');
insert into public.companies (id, name) values
  ('22222222-0000-4000-8000-00000000000a', 'Test Company A'),
  ('22222222-0000-4000-8000-00000000000b', 'Test Company B');
select app.bootstrap_company('22222222-0000-4000-8000-00000000000a');
select app.bootstrap_company('22222222-0000-4000-8000-00000000000b');
insert into public.employees (id, company_id, full_name, email, position, join_date) values
  ('33333333-0000-4000-8000-0000000000a1', '22222222-0000-4000-8000-00000000000a', 'Emp A One', 'emp.a1@test.local', 'Packing', '2025-01-01'),
  ('33333333-0000-4000-8000-0000000000a2', '22222222-0000-4000-8000-00000000000a', 'Emp A Two', 'emp.a2@test.local', 'Admin',   '2025-01-01'),
  ('33333333-0000-4000-8000-0000000000b1', '22222222-0000-4000-8000-00000000000b', 'Emp B One', 'emp.b1@test.local', 'Kasir',   '2025-01-01');
select app.link_account('owner.a@test.local', '22222222-0000-4000-8000-00000000000a', 'owner', 'Owner A');
select app.link_account('emp.a1@test.local',  '22222222-0000-4000-8000-00000000000a', 'employee', 'Emp A One', '33333333-0000-4000-8000-0000000000a1');
select app.link_account('emp.a2@test.local',  '22222222-0000-4000-8000-00000000000a', 'employee', 'Emp A Two', '33333333-0000-4000-8000-0000000000a2');
select app.link_account('owner.b@test.local', '22222222-0000-4000-8000-00000000000b', 'owner', 'Owner B');

insert into public.employee_salary_configurations (company_id, employee_id, basic_salary) values
  ('22222222-0000-4000-8000-00000000000a', '33333333-0000-4000-8000-0000000000a1', 3000000),
  ('22222222-0000-4000-8000-00000000000a', '33333333-0000-4000-8000-0000000000a2', 4000000);
insert into public.payroll_periods (id, company_id, period_key, start_date, end_date, payment_date, status) values
  ('44444444-0000-4000-8000-000000000001', '22222222-0000-4000-8000-00000000000a', '2026-09', '2026-09-01', '2026-09-30', '2026-09-28', 'paid'),
  ('44444444-0000-4000-8000-000000000002', '22222222-0000-4000-8000-00000000000a', '2026-10', '2026-10-01', '2026-10-31', '2026-10-28', 'draft');
insert into public.payroll_items (id, company_id, period_id, employee_id, cycle_start, cycle_end, payment_date, basic_salary, net_salary, status) values
  ('55555555-0000-4000-8000-0000000000a1', '22222222-0000-4000-8000-00000000000a', '44444444-0000-4000-8000-000000000001', '33333333-0000-4000-8000-0000000000a1', '2026-09-01', '2026-09-30', '2026-09-28', 3000000, 3000000, 'paid'),
  ('55555555-0000-4000-8000-0000000000a2', '22222222-0000-4000-8000-00000000000a', '44444444-0000-4000-8000-000000000001', '33333333-0000-4000-8000-0000000000a2', '2026-09-01', '2026-09-30', '2026-09-28', 4000000, 4000000, 'paid'),
  ('55555555-0000-4000-8000-0000000000d1', '22222222-0000-4000-8000-00000000000a', '44444444-0000-4000-8000-000000000002', '33333333-0000-4000-8000-0000000000a1', '2026-10-01', '2026-10-31', '2026-10-28', 3000000, 3100000, 'draft');
insert into public.attendance_records (id, company_id, employee_id, attendance_date, status) values
  ('66666666-0000-4000-8000-0000000000a1', '22222222-0000-4000-8000-00000000000a', '33333333-0000-4000-8000-0000000000a1', '2026-11-02', 'present'),
  ('66666666-0000-4000-8000-0000000000a2', '22222222-0000-4000-8000-00000000000a', '33333333-0000-4000-8000-0000000000a2', '2026-11-02', 'present'),
  ('66666666-0000-4000-8000-0000000000b1', '22222222-0000-4000-8000-00000000000b', '33333333-0000-4000-8000-0000000000b1', '2026-11-02', 'present');
insert into public.attendance_evidence (company_id, attendance_id, employee_id, attendance_date, check_in_selfie_path) values
  ('22222222-0000-4000-8000-00000000000a', '66666666-0000-4000-8000-0000000000a1', '33333333-0000-4000-8000-0000000000a1', '2026-11-02', 'a/a1/in.jpg'),
  ('22222222-0000-4000-8000-00000000000a', '66666666-0000-4000-8000-0000000000a2', '33333333-0000-4000-8000-0000000000a2', '2026-11-02', 'a/a2/in.jpg');
insert into public.leave_requests (id, company_id, employee_id, leave_type_id, start_date, end_date, reason)
select '77777777-0000-4000-8000-0000000000a2', '22222222-0000-4000-8000-00000000000a', '33333333-0000-4000-8000-0000000000a2', id, '2026-12-01', '2026-12-01', 'Keperluan keluarga'
from public.leave_types where company_id = '22222222-0000-4000-8000-00000000000a' and code = 'personal';
insert into public.tasks (id, company_id, title, deadline) values
  ('88888888-0000-4000-8000-0000000000a1', '22222222-0000-4000-8000-00000000000a', 'Packing order', '2026-12-01'),
  ('88888888-0000-4000-8000-0000000000a2', '22222222-0000-4000-8000-00000000000a', 'Rekap admin',   '2026-12-01');
insert into public.task_assignments (company_id, task_id, employee_id) values
  ('22222222-0000-4000-8000-00000000000a', '88888888-0000-4000-8000-0000000000a1', '33333333-0000-4000-8000-0000000000a1'),
  ('22222222-0000-4000-8000-00000000000a', '88888888-0000-4000-8000-0000000000a2', '33333333-0000-4000-8000-0000000000a2');
insert into public.notifications (id, company_id, recipient_id, type, title, message) values
  ('99999999-0000-4000-8000-0000000000a1', '22222222-0000-4000-8000-00000000000a', '11111111-0000-4000-8000-00000000a001', 'salary_paid', 'Gaji dibayar', 'Gaji Rp3.000.000 telah ditransfer'),
  ('99999999-0000-4000-8000-0000000000a2', '22222222-0000-4000-8000-00000000000a', '11111111-0000-4000-8000-00000000a002', 'salary_paid', 'Gaji dibayar', 'Gaji Rp4.000.000 telah ditransfer');
insert into public.audit_logs (company_id, action, entity, summary) values ('22222222-0000-4000-8000-00000000000a', 'test', 'test', 'fixture');
insert into storage.buckets (id, name, public) values ('attendance-selfies', 'attendance-selfies', false) on conflict (id) do nothing;
insert into storage.objects (bucket_id, name) values
  ('attendance-selfies', '22222222-0000-4000-8000-00000000000a/33333333-0000-4000-8000-0000000000a1/2026-11-02-in.jpg'),
  ('attendance-selfies', '22222222-0000-4000-8000-00000000000a/33333333-0000-4000-8000-0000000000a2/2026-11-02-in.jpg');

-- =====================================================================
-- OWNER A
-- =====================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-0000-4000-8000-00000000a0a0","role":"authenticated"}', true);
do $$ begin
  assert (select count(*) from public.companies) = 1, 'FAIL: owner A should see only company A';
  assert (select count(*) from public.employees) = 2, 'FAIL: owner A should see 2 employees of company A';
  assert (select count(*) from public.employees where company_id = '22222222-0000-4000-8000-00000000000b') = 0, 'FAIL: owner A sees company B employees';
  assert (select count(*) from public.payroll_items) = 3, 'FAIL: owner A should see all 3 payroll items of A';
  assert (select count(*) from public.employee_salary_configurations) = 2, 'FAIL: owner A should see salary configs';
  assert (select count(*) from public.attendance_records) = 2, 'FAIL: owner A should see only A attendance';
  assert (select count(*) from public.audit_logs) = 1, 'FAIL: owner A should read audit log';
  assert (select count(*) from public.notifications) = 0, 'FAIL: notifications are private to recipients';
  assert (select count(*) from storage.objects where bucket_id = 'attendance-selfies') = 2, 'FAIL: owner A should read company selfies';
  begin
    insert into public.employees (company_id, full_name, email, position, join_date)
    values ('22222222-0000-4000-8000-00000000000b', 'Intruder', 'x@test.local', 'X', '2025-01-01');
    raise exception 'FAIL: owner A inserted an employee into company B';
  exception when insufficient_privilege then null; end;
  begin
    update public.audit_logs set summary = 'tampered';
    if found then raise exception 'FAIL: audit log is editable'; end if;
  end;
  raise notice 'OK  owner A: akses penuh hanya untuk perusahaan sendiri';
end $$;
reset role;

-- =====================================================================
-- OWNER B (other tenant)
-- =====================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-0000-4000-8000-00000000b0b0","role":"authenticated"}', true);
do $$ begin
  assert (select count(*) from public.employees where company_id = '22222222-0000-4000-8000-00000000000a') = 0, 'FAIL: owner B sees A employees';
  assert (select count(*) from public.payroll_items) = 0, 'FAIL: owner B sees A payroll';
  assert (select count(*) from public.attendance_records) = 1, 'FAIL: owner B should see only own attendance';
  assert (select count(*) from storage.objects where bucket_id = 'attendance-selfies') = 0, 'FAIL: owner B sees A selfies';
  raise notice 'OK  owner B: tidak bisa melihat data perusahaan A';
end $$;
reset role;

-- =====================================================================
-- EMPLOYEE A1
-- =====================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-0000-4000-8000-00000000a001","role":"authenticated"}', true);
do $$ begin
  assert (select count(*) from public.employees) = 1, 'FAIL: employee should see only own employee row';
  assert (select count(*) from public.payroll_items) = 1, 'FAIL: employee should see only own APPROVED payroll item';
  assert (select count(*) from public.payroll_items where id = '55555555-0000-4000-8000-0000000000a2') = 0, 'FAIL: employee A1 can read A2 payslip';
  assert (select count(*) from public.payroll_items where id = '55555555-0000-4000-8000-0000000000d1') = 0, 'FAIL: employee sees draft payroll';
  assert (select count(*) from public.payroll_periods) = 1, 'FAIL: employee should see only released periods';
  assert (select count(*) from public.employee_salary_configurations) = 0, 'FAIL: employee can read salary configurations';
  assert (select count(*) from public.attendance_records) = 1, 'FAIL: employee sees others attendance';
  assert (select count(*) from public.attendance_evidence) = 1, 'FAIL: employee sees others selfie evidence';
  assert (select count(*) from storage.objects where bucket_id = 'attendance-selfies') = 1, 'FAIL: employee can access other selfie files';
  assert (select count(*) from public.notifications) = 1, 'FAIL: employee sees others notifications';
  assert (select count(*) from public.leave_requests) = 0, 'FAIL: employee sees others leave requests';
  assert (select count(*) from public.tasks) = 1, 'FAIL: employee sees unassigned tasks';
  assert (select count(*) from public.audit_logs) = 0, 'FAIL: employee reads audit log';
  assert (select count(*) from public.company_settings) = 1, 'FAIL: employee should read company settings';
  raise notice 'OK  employee A1: hanya membaca data milik sendiri (gaji, absensi, selfie, notifikasi)';

  -- cannot write attendance directly
  begin
    insert into public.attendance_records (company_id, employee_id, attendance_date, status)
    values ('22222222-0000-4000-8000-00000000000a', '33333333-0000-4000-8000-0000000000a1', '2026-11-03', 'present');
    raise exception 'FAIL: employee inserted attendance directly';
  exception when insufficient_privilege then null; end;
  update public.attendance_records set status = 'present' where employee_id = '33333333-0000-4000-8000-0000000000a1';
  if found then raise exception 'FAIL: employee updated attendance'; end if;

  -- cannot approve leave (own or others)
  update public.leave_requests set status = 'approved' where id = '77777777-0000-4000-8000-0000000000a2';
  if found then raise exception 'FAIL: employee approved a leave request'; end if;

  -- can submit own pending leave, but not approved / not for others
  insert into public.leave_requests (company_id, employee_id, leave_type_id, start_date, end_date, reason)
  select '22222222-0000-4000-8000-00000000000a', '33333333-0000-4000-8000-0000000000a1', id, '2026-12-05', '2026-12-05', 'Kontrol kesehatan'
  from public.leave_types where company_id = '22222222-0000-4000-8000-00000000000a' and code = 'sick';
  begin
    insert into public.leave_requests (company_id, employee_id, leave_type_id, start_date, end_date, reason, status)
    select '22222222-0000-4000-8000-00000000000a', '33333333-0000-4000-8000-0000000000a1', id, '2026-12-06', '2026-12-06', 'Self-approve', 'approved'
    from public.leave_types where company_id = '22222222-0000-4000-8000-00000000000a' and code = 'sick';
    raise exception 'FAIL: employee self-approved leave';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.leave_requests (company_id, employee_id, leave_type_id, start_date, end_date, reason)
    select '22222222-0000-4000-8000-00000000000a', '33333333-0000-4000-8000-0000000000a2', id, '2026-12-07', '2026-12-07', 'Impersonate'
    from public.leave_types where company_id = '22222222-0000-4000-8000-00000000000a' and code = 'sick';
    raise exception 'FAIL: employee filed leave for someone else';
  exception when insufficient_privilege then null; end;

  -- cannot touch payroll configuration
  update public.employee_salary_configurations set basic_salary = 99999999;
  if found then raise exception 'FAIL: employee changed salary configuration'; end if;
  begin
    insert into public.payroll_adjustments (company_id, payroll_item_id, type, name, amount)
    values ('22222222-0000-4000-8000-00000000000a', '55555555-0000-4000-8000-0000000000a1', 'addition', 'Bonus sendiri', 1000000);
    raise exception 'FAIL: employee added payroll adjustment';
  exception when insufficient_privilege then null; end;
  raise notice 'OK  employee A1: tidak bisa menulis absensi, menyetujui izin, atau mengubah payroll';

  -- profile: allowed fields only
  update public.employees set phone = '0812-9999-0000' where id = '33333333-0000-4000-8000-0000000000a1';
  if not found then raise exception 'FAIL: employee could not update own phone'; end if;
  begin
    update public.employees set position = 'Manager' where id = '33333333-0000-4000-8000-0000000000a1';
    raise exception 'FAIL: employee changed own position';
  exception when insufficient_privilege then null; end;
  update public.employees set phone = '000' where id = '33333333-0000-4000-8000-0000000000a2';
  if found then raise exception 'FAIL: employee edited another employee'; end if;

  -- tasks: status/progress of assigned task only
  update public.tasks set status = 'in_progress', progress = 40 where id = '88888888-0000-4000-8000-0000000000a1';
  if not found then raise exception 'FAIL: employee could not update assigned task'; end if;
  assert (select count(*) from public.task_history where task_id = '88888888-0000-4000-8000-0000000000a1' and to_status = 'in_progress') = 1, 'FAIL: task history not recorded';
  begin
    update public.tasks set title = 'Renamed' where id = '88888888-0000-4000-8000-0000000000a1';
    raise exception 'FAIL: employee renamed a task';
  exception when insufficient_privilege then null; end;
  update public.tasks set status = 'completed' where id = '88888888-0000-4000-8000-0000000000a2';
  if found then raise exception 'FAIL: employee updated someone else''s task'; end if;

  -- notifications: may only mark read
  update public.notifications set read_at = now() where id = '99999999-0000-4000-8000-0000000000a1';
  if not found then raise exception 'FAIL: employee could not mark notification read'; end if;
  begin
    update public.notifications set message = 'edited' where id = '99999999-0000-4000-8000-0000000000a1';
    raise exception 'FAIL: employee edited a notification';
  exception when insufficient_privilege then null; end;
  raise notice 'OK  employee A1: profil, tugas & notifikasi hanya sebatas yang diizinkan';
end $$;
reset role;

-- =====================================================================
-- Deactivated employee & anonymous visitor
-- =====================================================================
select set_config('request.jwt.claims', '', true);   -- back to admin context (no user identity)
update public.employees set employment_status = 'inactive' where id = '33333333-0000-4000-8000-0000000000a2';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-0000-4000-8000-00000000a002","role":"authenticated"}', true);
do $$ begin
  assert (select count(*) from public.employees) = 0, 'FAIL: inactive employee still sees own record';
  assert (select count(*) from public.payroll_items) = 0, 'FAIL: inactive employee still sees payroll';
  raise notice 'OK  karyawan nonaktif: akses data tertutup';
end $$;
reset role;

set local role anon;
select set_config('request.jwt.claims', '', true);
do $$ begin
  begin
    perform 1 from public.employees limit 1;
    raise exception 'FAIL: anonymous visitor can query employees';
  exception when insufficient_privilege then null; end;
  raise notice 'OK  pengunjung anonim: tidak punya akses';
end $$;
reset role;

do $$ begin raise notice '==== SEMUA TES RLS LULUS ===='; end $$;
rollback;
