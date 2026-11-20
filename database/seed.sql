-- =====================================================================
-- AbsenInn · seed.sql — DATA DEMO FIKTIF (aman untuk repositori publik)
-- Untuk project Supabase demo/portfolio, BUKAN untuk database toko asli.
-- Buat akun di Authentication → Users lebih dulu (password bebas):
--   owner@absenninn.demo, aisyah@absenninn.demo, bima@absenninn.demo,
--   citra@absenninn.demo, dimas@absenninn.demo, eka@absenninn.demo
-- Tanpa akun, data tetap dibuat; profil di-link saat file dijalankan ulang.
-- =====================================================================
begin;

insert into public.companies (id, name, address, email, email_domain) values
  ('d0000000-0000-4000-8000-000000000001', 'Toko Sinar Contoh (Demo)', 'Alamat contoh — ubah melalui Settings', 'halo@absenninn.demo', 'absenninn.demo')
on conflict (id) do nothing;
select app.bootstrap_company('d0000000-0000-4000-8000-000000000001');
update public.work_schedules set working_days = '{1,2,3,4,5,6}' where company_id = 'd0000000-0000-4000-8000-000000000001';
update public.company_settings set default_components = '[{"name":"Tunjangan Transport","amount":300000},{"name":"Tunjangan Makan","amount":250000}]'
  where company_id = 'd0000000-0000-4000-8000-000000000001';
-- Work location row WITHOUT coordinates: the owner sets them in Settings.
insert into public.work_locations (company_id, name, radius_m)
select 'd0000000-0000-4000-8000-000000000001', 'Lokasi Utama (atur koordinat)', 100
where not exists (select 1 from public.work_locations where company_id = 'd0000000-0000-4000-8000-000000000001');

insert into public.employees (id, company_id, employee_code, full_name, nickname, email, phone, address, position, employment_type, join_date, avatar_color) values
  ('d0000000-0000-4000-8000-000000000011', 'd0000000-0000-4000-8000-000000000001', 'EMP-001', 'Aisyah Putri',  'aisyah', 'aisyah@absenninn.demo', '0813-0000-0010', 'Jl. Melati No. 12 (contoh)',   'Store Staff',     'Tetap',   '2025-01-15', '#6C55F2'),
  ('d0000000-0000-4000-8000-000000000012', 'd0000000-0000-4000-8000-000000000001', 'EMP-002', 'Bima Pratama',  'bima',   'bima@absenninn.demo',   '0813-0000-0011', 'Jl. Kenanga No. 5 (contoh)',   'Warehouse Staff', 'Tetap',   '2025-01-20', '#4F8DF7'),
  ('d0000000-0000-4000-8000-000000000013', 'd0000000-0000-4000-8000-000000000001', 'EMP-003', 'Citra Dewi',    'citra',  'citra@absenninn.demo',  '0813-0000-0012', 'Jl. Anggrek No. 21 (contoh)',  'CS Officer',      'Tetap',   '2025-02-01', '#E0559B'),
  ('d0000000-0000-4000-8000-000000000014', 'd0000000-0000-4000-8000-000000000001', 'EMP-004', 'Dimas Anggara', 'dimas',  'dimas@absenninn.demo',  '0813-0000-0013', 'Jl. Flamboyan No. 8 (contoh)', 'Admin Staff',     'Tetap',   '2025-02-10', '#13A985'),
  ('d0000000-0000-4000-8000-000000000015', 'd0000000-0000-4000-8000-000000000001', 'EMP-005', 'Eka Rahma',     'eka',    'eka@absenninn.demo',    '0813-0000-0014', 'Jl. Dahlia No. 3 (contoh)',    'Picker Staff',    'Kontrak', '2025-02-15', '#F08A10')
on conflict (id) do nothing;

insert into public.employee_salary_configurations (company_id, employee_id, basic_salary, allowances, overtime_rate_per_hour, effective_from)
select e.company_id, e.id, v.basic, '[{"name":"Tunjangan Transport","amount":300000},{"name":"Tunjangan Makan","amount":250000}]', 20000, e.join_date
from public.employees e
join (values ('EMP-001', 3200000), ('EMP-002', 3000000), ('EMP-003', 3100000), ('EMP-004', 3400000), ('EMP-005', 2900000)) v(code, basic) on v.code = e.employee_code
where e.company_id = 'd0000000-0000-4000-8000-000000000001'
on conflict (employee_id, effective_from) do nothing;

-- Attendance for the last 20 days on working days (deterministic sample, no coordinates)
insert into public.attendance_records (company_id, employee_id, attendance_date, check_in_at, check_out_at, work_minutes, status, location_status, source)
select e.company_id, e.id, d::date,
       (d::date + time '08:00' + make_interval(mins => m.in_off)) at time zone 'Asia/Jakarta',
       (d::date + time '16:00' + make_interval(mins => m.out_off)) at time zone 'Asia/Jakarta',
       480 - 60 - m.in_off + m.out_off,
       case when m.in_off > 10 then 'late' else 'present' end, 'verified', 'seed'
from public.employees e
cross join generate_series(current_date - 20, current_date - 1, interval '1 day') d
cross join lateral (select ((hashtext(e.id::text || d::text) % 30 + 30) % 30) - 8 as in_off,
                           ((hashtext(d::text || e.id::text) % 20 + 20) % 20) as out_off) m
where e.company_id = 'd0000000-0000-4000-8000-000000000001'
  and extract(dow from d) = any (array[1,2,3,4,5,6])
on conflict (employee_id, attendance_date) do nothing;

insert into public.leave_requests (company_id, employee_id, leave_type_id, start_date, end_date, reason, status, owner_notes, decided_at)
select 'd0000000-0000-4000-8000-000000000001', v.emp::uuid, t.id, current_date + v.s, current_date + v.e, v.reason, v.status, v.notes,
       case when v.status = 'pending' then null else now() end
from (values
  ('d0000000-0000-4000-8000-000000000013', 'personal', 3, 3,  'Mengurus dokumen keluarga.', 'pending',  null),
  ('d0000000-0000-4000-8000-000000000014', 'annual',   9, 11, 'Acara keluarga di luar kota.', 'pending', null),
  ('d0000000-0000-4000-8000-000000000015', 'annual',  -6, -5, 'Ingin berlibur.', 'rejected', 'Bertepatan dengan stock opname.')
) v(emp, code, s, e, reason, status, notes)
join public.leave_types t on t.company_id = 'd0000000-0000-4000-8000-000000000001' and t.code = v.code
where not exists (select 1 from public.leave_requests where company_id = 'd0000000-0000-4000-8000-000000000001');

with t as (
  insert into public.tasks (company_id, title, description, priority, deadline, status, progress)
  select 'd0000000-0000-4000-8000-000000000001', v.title, v.descr, v.prio, current_date + v.dl, v.status, v.prog
  from (values
    ('Packing order Shopee', 'Kemas pesanan batch pagi dan cetak label.', 'high', 0, 'in_progress', 60, 'EMP-001'),
    ('Update stok produk', 'Sinkronkan stok fisik dengan marketplace.', 'medium', 1, 'todo', 0, 'EMP-002'),
    ('Balas chat pelanggan', 'Semua chat dibalas < 1 jam.', 'low', 5, 'in_progress', 30, 'EMP-003'),
    ('Rekap pesanan mingguan', 'Rekap pesanan untuk owner.', 'medium', -2, 'completed', 100, 'EMP-004')
  ) v(title, descr, prio, dl, status, prog, code)
  where not exists (select 1 from public.tasks where company_id = 'd0000000-0000-4000-8000-000000000001')
  returning id, title
)
insert into public.task_assignments (company_id, task_id, employee_id)
select 'd0000000-0000-4000-8000-000000000001', t.id, e.id
from t join public.employees e on e.company_id = 'd0000000-0000-4000-8000-000000000001'
 and e.employee_code = case t.title when 'Packing order Shopee' then 'EMP-001' when 'Update stok produk' then 'EMP-002'
                                    when 'Balas chat pelanggan' then 'EMP-003' else 'EMP-004' end;

-- One closed (paid) payroll period last month
insert into public.payroll_periods (company_id, period_key, start_date, end_date, payment_date, status, approved_at)
select 'd0000000-0000-4000-8000-000000000001', to_char(date_trunc('month', current_date) - interval '1 month', 'YYYY-MM'),
       (date_trunc('month', current_date) - interval '1 month')::date, (date_trunc('month', current_date) - interval '1 day')::date,
       (date_trunc('month', current_date) - interval '1 month' + interval '27 days')::date, 'paid', now()
on conflict (company_id, period_key) do nothing;

insert into public.payroll_items (company_id, period_id, employee_id, cycle_start, cycle_end, payment_date, basic_salary, allowances, net_salary, status)
select p.company_id, p.id, c.employee_id, p.start_date, p.end_date, p.payment_date, c.basic_salary, c.allowances,
       c.basic_salary + 550000, 'paid'
from public.payroll_periods p
join public.employee_salary_configurations c on c.company_id = p.company_id
where p.company_id = 'd0000000-0000-4000-8000-000000000001' and p.status = 'paid'
on conflict (period_id, employee_id) do nothing;

insert into public.payments (company_id, payroll_item_id, employee_id, amount, paid_at, method, reference)
select i.company_id, i.id, i.employee_id, i.net_salary, i.payment_date + time '14:00', 'Transfer bank (manual)', 'TRF-DEMO'
from public.payroll_items i where i.company_id = 'd0000000-0000-4000-8000-000000000001' and i.status = 'paid'
on conflict (payroll_item_id) do nothing;

insert into public.announcements (company_id, title, body, pinned)
select 'd0000000-0000-4000-8000-000000000001', 'Stock opname akhir bulan', 'Stock opname dilakukan pada hari kerja terakhir bulan ini.', true
where not exists (select 1 from public.announcements where company_id = 'd0000000-0000-4000-8000-000000000001');

select app.link_account('owner@absenninn.demo',  'd0000000-0000-4000-8000-000000000001', 'owner',    'Rina Wijaya', null, '#3B2898');
select app.link_account('aisyah@absenninn.demo', 'd0000000-0000-4000-8000-000000000001', 'employee', 'Aisyah Putri',  'd0000000-0000-4000-8000-000000000011', '#6C55F2');
select app.link_account('bima@absenninn.demo',   'd0000000-0000-4000-8000-000000000001', 'employee', 'Bima Pratama',  'd0000000-0000-4000-8000-000000000012', '#4F8DF7');
select app.link_account('citra@absenninn.demo',  'd0000000-0000-4000-8000-000000000001', 'employee', 'Citra Dewi',    'd0000000-0000-4000-8000-000000000013', '#E0559B');
select app.link_account('dimas@absenninn.demo',  'd0000000-0000-4000-8000-000000000001', 'employee', 'Dimas Anggara', 'd0000000-0000-4000-8000-000000000014', '#13A985');
select app.link_account('eka@absenninn.demo',    'd0000000-0000-4000-8000-000000000001', 'employee', 'Eka Rahma',     'd0000000-0000-4000-8000-000000000015', '#F08A10');

commit;
