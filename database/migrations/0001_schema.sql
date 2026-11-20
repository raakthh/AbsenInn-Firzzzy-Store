-- =====================================================================
-- AbsenInn · Migration 0001 — core schema
-- Target: Supabase PostgreSQL (15+). Idempotent where practical.
-- Every business row carries company_id (multi-tenant SaaS ready).
-- Schema is owned by these SQL migrations; Django models use
-- managed = False so Django never creates/alters these tables.
-- =====================================================================
create extension if not exists pgcrypto;
create schema if not exists app;   -- helper functions (not exposed via the REST API)

-- ---------- generic triggers ----------
create or replace function app.touch_updated_at() returns trigger
language plpgsql as $$ begin new.updated_at := now(); return new; end $$;

-- ---------- Company & users ----------
create table if not exists public.companies (
  id           uuid primary key default gen_random_uuid(),
  name         text not null check (length(trim(name)) >= 2),
  address      text,
  phone        text,
  email        text,
  logo_path    text,                                -- Supabase Storage path (company-assets bucket)
  timezone     text not null default 'Asia/Jakarta',
  email_domain text,                                -- e.g. firzzzystore.com (login emails: nickname@domain)
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table if not exists public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  company_id   uuid not null references public.companies(id) on delete cascade,
  role         text not null check (role in ('owner', 'employee')),
  full_name    text not null,
  email        text not null,
  avatar_color text not null default '#6C55F2',
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create unique index if not exists profiles_email_uq on public.profiles (lower(email));
create index if not exists profiles_company_idx on public.profiles (company_id);

create table if not exists public.employees (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references public.companies(id) on delete cascade,
  profile_id        uuid unique references public.profiles(id) on delete set null,
  employee_code     text not null,
  full_name         text not null check (length(trim(full_name)) >= 2),
  nickname          text,
  email             text not null,
  phone             text,
  address           text,
  photo_path        text,
  position          text not null,
  employment_type   text not null default 'Tetap',
  join_date         date not null,
  employment_status text not null default 'active' check (employment_status in ('active', 'inactive')),
  avatar_color      text not null default '#6C55F2',
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (company_id, employee_code)
);
create unique index if not exists employees_company_email_uq on public.employees (company_id, lower(email));
create index if not exists employees_company_idx on public.employees (company_id, employment_status);

create table if not exists public.employment_history (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  event_date  date not null default current_date,
  event       text not null,
  created_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now()
);
create index if not exists employment_history_emp_idx on public.employment_history (employee_id, event_date desc);

-- ---------- Work settings ----------
create table if not exists public.work_locations (
  id         uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name       text not null,
  address    text,
  latitude   numeric(9, 6) check (latitude between -90 and 90),
  longitude  numeric(9, 6) check (longitude between -180 and 180),
  radius_m   integer not null default 100 check (radius_m between 10 and 5000),
  is_primary boolean not null default true,
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((latitude is null) = (longitude is null))      -- both or neither; never hard-coded
);
create index if not exists work_locations_company_idx on public.work_locations (company_id);

create table if not exists public.work_schedules (
  id                        uuid primary key default gen_random_uuid(),
  company_id                uuid not null references public.companies(id) on delete cascade,
  name                      text not null default 'Jadwal Utama',
  work_start                time not null default '08:00',
  work_end                  time not null default '16:00',
  break_start               time,
  break_end                 time,
  working_days              smallint[] not null default '{1,2,3,4,5}',  -- 0 = Minggu … 6 = Sabtu
  late_tolerance_min        smallint not null default 10 check (late_tolerance_min between 0 and 240),
  early_leave_tolerance_min smallint not null default 0 check (early_leave_tolerance_min between 0 and 240),
  is_default                boolean not null default true,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  check (work_end > work_start),
  check (break_start is null or break_end is null or break_end > break_start),
  check (working_days <@ '{0,1,2,3,4,5,6}'::smallint[] and cardinality(working_days) >= 1)
);
create index if not exists work_schedules_company_idx on public.work_schedules (company_id);

create table if not exists public.company_settings (
  company_id              uuid primary key references public.companies(id) on delete cascade,
  selfie_required         boolean not null default true,
  gps_required            boolean not null default true,
  max_gps_accuracy_m      integer not null default 100 check (max_gps_accuracy_m between 5 and 1000),
  payroll_period          text not null default 'monthly' check (payroll_period in ('monthly')),
  payment_day_mode        text not null default 'fixed' check (payment_day_mode in ('fixed', 'join_date')),
  default_payment_day     smallint check (default_payment_day between 1 and 31),
  payroll_rules           jsonb not null default '{"unpaid_leave":"prorate","absent":"none","late_per_incident":0,"overtime_enabled":true}',
  default_components      jsonb not null default '[]',      -- [{name, amount}]
  annual_leave_quota_days smallint not null default 12 check (annual_leave_quota_days between 0 and 60),
  leave_approval          text not null default 'owner',
  notification_prefs      jsonb not null default '{"leave_requests":true,"attendance_reminder":true,"task_deadline":true,"payroll":true}',
  profile_editable_fields text[] not null default '{phone,address}',
  updated_at              timestamptz not null default now(),
  check (payment_day_mode = 'join_date' or default_payment_day is not null)
);

-- ---------- Attendance ----------
create table if not exists public.attendance_records (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references public.companies(id) on delete cascade,
  employee_id      uuid not null references public.employees(id) on delete cascade,
  attendance_date  date not null,
  check_in_at      timestamptz,
  check_out_at     timestamptz,
  work_minutes     integer check (work_minutes >= 0),
  status           text not null check (status in ('present','late','early_leave','sick','paid_leave','unpaid_leave','absent','needs_review')),
  location_status  text check (location_status in ('verified','outside','gps_unavailable','needs_review','not_configured','reviewed')),
  source           text not null default 'app' check (source in ('app','correction','leave','reconciliation','seed')),
  leave_request_id uuid,
  flags            text[] not null default '{}',
  notes            text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (employee_id, attendance_date),
  check (check_out_at is null or check_in_at is not null),   -- no normal check-out without check-in
  check (check_out_at is null or check_out_at > check_in_at)
);
create index if not exists attendance_company_date_idx on public.attendance_records (company_id, attendance_date desc);

-- Photos live in Supabase Storage (private bucket); only paths are stored here.
create table if not exists public.attendance_evidence (
  id                    uuid primary key default gen_random_uuid(),
  company_id            uuid not null references public.companies(id) on delete cascade,
  attendance_id         uuid not null unique references public.attendance_records(id) on delete cascade,
  employee_id           uuid not null references public.employees(id) on delete cascade,
  attendance_date       date not null,
  check_in_selfie_path  text,
  check_out_selfie_path text,
  check_in_lat          numeric(9, 6),
  check_in_lng          numeric(9, 6),
  check_out_lat         numeric(9, 6),
  check_out_lng         numeric(9, 6),
  check_in_accuracy_m   numeric(8, 2),
  check_out_accuracy_m  numeric(8, 2),
  check_in_distance_m   numeric(10, 2),
  check_out_distance_m  numeric(10, 2),
  location_status       text check (location_status in ('verified','outside','gps_unavailable','needs_review','not_configured','reviewed')),
  created_at            timestamptz not null default now()
);
create index if not exists attendance_evidence_emp_idx on public.attendance_evidence (employee_id, attendance_date desc);

create table if not exists public.attendance_corrections (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references public.companies(id) on delete cascade,
  attendance_id       uuid references public.attendance_records(id) on delete set null,
  employee_id         uuid not null references public.employees(id) on delete cascade,
  attendance_date     date not null,
  source              text not null check (source in ('owner', 'employee')),
  status              text not null default 'pending' check (status in ('pending','approved','rejected','applied')),
  requested_check_in  time,
  requested_check_out time,
  before_data         jsonb,
  after_data          jsonb,
  reason              text not null check (length(trim(reason)) >= 5),
  owner_notes         text,
  requested_by        uuid references public.profiles(id) on delete set null,
  resolved_by         uuid references public.profiles(id) on delete set null,
  created_at          timestamptz not null default now(),
  resolved_at         timestamptz
);
create index if not exists attendance_corrections_company_idx on public.attendance_corrections (company_id, status, created_at desc);

-- ---------- Leave ----------
create table if not exists public.leave_types (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references public.companies(id) on delete cascade,
  code                text not null,
  name                text not null,
  name_en             text,
  is_paid             boolean not null default true,     -- configurable per company, never assumed
  uses_quota          boolean not null default false,
  requires_attachment boolean not null default false,
  half_day            boolean not null default false,
  attendance_status   text not null check (attendance_status in ('sick','paid_leave','unpaid_leave')),
  active              boolean not null default true,
  created_at          timestamptz not null default now(),
  unique (company_id, code)
);

create table if not exists public.leave_requests (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies(id) on delete cascade,
  employee_id     uuid not null references public.employees(id) on delete cascade,
  leave_type_id   uuid not null references public.leave_types(id),
  start_date      date not null,
  end_date        date not null,
  reason          text not null check (length(trim(reason)) >= 5),
  attachment_path text,
  status          text not null default 'pending' check (status in ('pending','approved','rejected','cancelled')),
  owner_notes     text,
  requested_at    timestamptz not null default now(),
  decided_at      timestamptz,
  decided_by      uuid references public.profiles(id) on delete set null,
  check (end_date >= start_date)
);
create index if not exists leave_requests_company_idx on public.leave_requests (company_id, status, start_date);
create index if not exists leave_requests_emp_idx on public.leave_requests (employee_id, start_date desc);

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'attendance_leave_fk') then
    alter table public.attendance_records add constraint attendance_leave_fk
      foreign key (leave_request_id) references public.leave_requests(id) on delete set null;
  end if;
end $$;

-- ---------- Tasks ----------
create table if not exists public.tasks (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies(id) on delete cascade,
  title        text not null check (length(trim(title)) >= 3),
  description  text,
  priority     text not null default 'medium' check (priority in ('low','medium','high')),
  deadline     date not null,
  status       text not null default 'todo' check (status in ('todo','in_progress','completed')),  -- overdue is derived
  progress     smallint not null default 0 check (progress between 0 and 100),
  created_by   uuid references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  completed_at timestamptz
);
create index if not exists tasks_company_idx on public.tasks (company_id, status, deadline);

create table if not exists public.task_assignments (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id) on delete cascade,
  task_id     uuid not null references public.tasks(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  assigned_at timestamptz not null default now(),
  unique (task_id, employee_id)
);
create index if not exists task_assignments_emp_idx on public.task_assignments (employee_id);

create table if not exists public.task_history (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id) on delete cascade,
  task_id     uuid not null references public.tasks(id) on delete cascade,
  actor_id    uuid references public.profiles(id) on delete set null,
  action      text not null,
  from_status text,
  to_status   text,
  progress    smallint,
  created_at  timestamptz not null default now()
);
create index if not exists task_history_task_idx on public.task_history (task_id, created_at);

-- ---------- Payroll ----------
create table if not exists public.payroll_periods (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies(id) on delete cascade,
  period_key   text not null check (period_key ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  start_date   date not null,
  end_date     date not null,
  payment_date date,                          -- null when payment_day_mode = join_date (per item)
  status       text not null default 'draft' check (status in ('draft','pending_approval','approved','scheduled','paid')),
  approved_by  uuid references public.profiles(id) on delete set null,
  approved_at  timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (company_id, period_key),
  check (end_date >= start_date)
);

create table if not exists public.salary_components (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references public.companies(id) on delete cascade,
  name           text not null,
  kind           text not null check (kind in ('allowance','bonus','incentive','deduction')),
  default_amount numeric(14, 2) not null default 0 check (default_amount >= 0),
  is_active      boolean not null default true,
  created_at     timestamptz not null default now(),
  unique (company_id, name)
);

create table if not exists public.employee_salary_configurations (
  id                     uuid primary key default gen_random_uuid(),
  company_id             uuid not null references public.companies(id) on delete cascade,
  employee_id            uuid not null references public.employees(id) on delete cascade,
  basic_salary           numeric(14, 2) not null check (basic_salary >= 0),
  allowances             jsonb not null default '[]',          -- [{name, amount}]
  overtime_rate_per_hour numeric(14, 2) not null default 0 check (overtime_rate_per_hour >= 0),
  pay_day                smallint check (pay_day between 1 and 31),  -- null → derived from settings / join date
  effective_from         date not null default current_date,
  effective_to           date,
  created_at             timestamptz not null default now(),
  unique (employee_id, effective_from),
  check (effective_to is null or effective_to >= effective_from)
);
create index if not exists salary_config_emp_idx on public.employee_salary_configurations (employee_id, effective_from desc);

create table if not exists public.payroll_items (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies(id) on delete cascade,
  period_id       uuid not null references public.payroll_periods(id) on delete cascade,
  employee_id     uuid not null references public.employees(id) on delete cascade,
  cycle_start     date not null,
  cycle_end       date not null,
  payment_date    date not null,
  basic_salary    numeric(14, 2) not null default 0,
  allowances      jsonb not null default '[]',
  bonus           numeric(14, 2) not null default 0,
  incentives      numeric(14, 2) not null default 0,
  overtime_hours  numeric(6, 2) not null default 0,
  overtime_amount numeric(14, 2) not null default 0,
  deductions      jsonb not null default '[]',
  net_salary      numeric(14, 2) not null default 0,
  status          text not null default 'draft' check (status in ('draft','pending_approval','approved','scheduled','paid')),
  calc_snapshot   jsonb,                       -- inputs used by the payroll engine (Phase 6), for audit
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (period_id, employee_id)
);
create index if not exists payroll_items_emp_idx on public.payroll_items (employee_id);

create table if not exists public.payroll_adjustments (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies(id) on delete cascade,
  payroll_item_id uuid not null references public.payroll_items(id) on delete cascade,
  type            text not null check (type in ('addition', 'deduction')),
  name            text not null check (length(trim(name)) >= 3),
  amount          numeric(14, 2) not null check (amount > 0),
  created_by      uuid references public.profiles(id) on delete set null,
  created_at      timestamptz not null default now()
);

-- A payment row exists only after the owner confirms a manual transfer.
create table if not exists public.payments (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies(id) on delete cascade,
  payroll_item_id uuid not null unique references public.payroll_items(id) on delete cascade,
  employee_id     uuid not null references public.employees(id) on delete cascade,
  amount          numeric(14, 2) not null check (amount >= 0),
  paid_at         timestamptz not null,
  method          text not null,
  reference       text,
  note            text,
  confirmed_by    uuid references public.profiles(id) on delete set null,
  created_at      timestamptz not null default now()
);

create table if not exists public.payslips (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies(id) on delete cascade,
  payroll_item_id uuid not null unique references public.payroll_items(id) on delete cascade,
  employee_id     uuid not null references public.employees(id) on delete cascade,
  file_path       text,                         -- generated PDF in Storage (Phase 6)
  generated_at    timestamptz not null default now()
);

-- ---------- Notifications & audit ----------
create table if not exists public.notifications (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies(id) on delete cascade,
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  type         text not null,
  title        text not null,
  message      text not null,
  link         text,
  read_at      timestamptz,
  created_at   timestamptz not null default now()
);
create index if not exists notifications_recipient_idx on public.notifications (recipient_id, created_at desc);

create table if not exists public.announcements (
  id         uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  title      text not null check (length(trim(title)) >= 3),
  body       text not null,
  pinned     boolean not null default false,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists announcements_company_idx on public.announcements (company_id, created_at desc);

create table if not exists public.audit_logs (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id) on delete cascade,
  actor_id    uuid references public.profiles(id) on delete set null,
  actor_name  text,
  action      text not null,
  entity      text not null,
  entity_id   text,
  summary     text not null,
  details     jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists audit_logs_company_idx on public.audit_logs (company_id, created_at desc);

-- ---------- updated_at triggers ----------
do $$ declare t text; begin
  foreach t in array array['companies','profiles','employees','work_locations','work_schedules','company_settings',
                           'attendance_records','tasks','payroll_periods','payroll_items'] loop
    execute format('drop trigger if exists trg_touch on public.%I', t);
    execute format('create trigger trg_touch before update on public.%I for each row execute function app.touch_updated_at()', t);
  end loop;
end $$;

-- ---------- Auto employee code (EMP-001, EMP-002 …) per company ----------
create or replace function app.assign_employee_code() returns trigger
language plpgsql as $$
declare n int;
begin
  if new.employee_code is null or new.employee_code = '' then
    select coalesce(max(nullif(regexp_replace(employee_code, '\D', '', 'g'), '')::int), 0) + 1 into n
      from public.employees where company_id = new.company_id;
    new.employee_code := 'EMP-' || lpad(n::text, 3, '0');
  end if;
  return new;
end $$;
drop trigger if exists trg_employee_code on public.employees;
create trigger trg_employee_code before insert on public.employees for each row execute function app.assign_employee_code();

-- ---------- Company bootstrap: default settings, schedule, leave types ----------
-- Defaults are starting points only; every rule is editable by the owner in Settings.
create or replace function app.bootstrap_company(p_company uuid) returns void
language plpgsql as $$
begin
  insert into public.company_settings (company_id, default_payment_day) values (p_company, 28)
    on conflict (company_id) do nothing;
  if not exists (select 1 from public.work_schedules where company_id = p_company) then
    insert into public.work_schedules (company_id, break_start, break_end) values (p_company, '12:00', '13:00');
  end if;
  insert into public.leave_types (company_id, code, name, name_en, is_paid, uses_quota, requires_attachment, half_day, attendance_status) values
    (p_company, 'annual',   'Cuti Tahunan',       'Annual Leave',        true,  true,  false, false, 'paid_leave'),
    (p_company, 'sick',     'Sakit',              'Sick Leave',          true,  false, true,  false, 'sick'),
    (p_company, 'personal', 'Izin Pribadi',       'Personal Permission', true,  false, false, false, 'paid_leave'),
    (p_company, 'unpaid',   'Cuti Tidak Dibayar', 'Unpaid Leave',        false, false, false, false, 'unpaid_leave'),
    (p_company, 'half_day', 'Izin Setengah Hari', 'Half-day Leave',      true,  true,  false, true,  'paid_leave')
  on conflict (company_id, code) do nothing;
end $$;
