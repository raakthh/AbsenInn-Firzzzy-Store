-- AbsenInn · schema.sql — GENERATED from database/migrations/*.sql (do not edit by hand)
-- Run once in Supabase → SQL Editor. Safe to re-run.

set client_min_messages = warning;

-- >>> 0001_schema.sql
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


-- >>> 0002_security.sql
-- =====================================================================
-- AbsenInn · Migration 0002 — authorization (Row Level Security)
-- Rules (brief §3 & §6):
--   • Owner: full access, but only to rows of their own company.
--   • Employee: only their own personal data; never other employees'
--     payroll or selfies; cannot approve leave, change payroll config
--     or write attendance directly (check-in goes through Django,
--     which connects with a privileged DB role and validates itself).
-- Helper functions are SECURITY DEFINER so policies never recurse.
-- =====================================================================

-- ---------- identity helpers ----------
create or replace function app.company_id() returns uuid
language sql stable security definer set search_path = public as $$
  select company_id from public.profiles where id = auth.uid() and is_active
$$;

create or replace function app.is_owner() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'owner' and is_active)
$$;

create or replace function app.employee_id() returns uuid
language sql stable security definer set search_path = public as $$
  select e.id from public.employees e
  join public.profiles p on p.id = e.profile_id
  where p.id = auth.uid() and p.is_active and e.employment_status = 'active'
$$;

-- Payroll visibility for employees: only items of periods already approved.
create or replace function app.payroll_item_visible(p_item uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.payroll_items i join public.payroll_periods p on p.id = i.period_id
    where i.id = p_item and i.employee_id = app.employee_id() and p.status in ('approved','scheduled','paid'))
$$;
create or replace function app.period_visible(p_period uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.payroll_items i join public.payroll_periods p on p.id = i.period_id
    where p.id = p_period and i.employee_id = app.employee_id() and p.status in ('approved','scheduled','paid'))
$$;
create or replace function app.task_assigned(p_task uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.task_assignments where task_id = p_task and employee_id = app.employee_id())
$$;

revoke all on schema app from public;
grant usage on schema app to authenticated, service_role;
grant execute on function app.company_id(), app.is_owner(), app.employee_id(),
  app.payroll_item_visible(uuid), app.period_visible(uuid), app.task_assigned(uuid) to authenticated, service_role;

-- ---------- column guards for self-service updates ----------
-- Employees may edit only the profile fields the owner allows (company_settings.profile_editable_fields).
create or replace function app.guard_employee_update() returns trigger
language plpgsql security definer set search_path = public as $$
declare allowed text[];
begin
  if auth.uid() is null or app.is_owner() then return new; end if;   -- backend / owner
  select profile_editable_fields into allowed from public.company_settings where company_id = old.company_id;
  allowed := coalesce(allowed, '{}');
  if (new.full_name, new.nickname, new.email, new.position, new.join_date, new.employment_status, new.employment_type,
      new.company_id, new.profile_id, new.employee_code, new.avatar_color)
     is distinct from
     (old.full_name, old.nickname, old.email, old.position, old.join_date, old.employment_status, old.employment_type,
      old.company_id, old.profile_id, old.employee_code, old.avatar_color) then
    raise exception 'Hanya owner yang dapat mengubah data kepegawaian' using errcode = '42501';
  end if;
  if new.phone is distinct from old.phone and not ('phone' = any(allowed)) then
    raise exception 'Kolom telepon tidak dapat diubah' using errcode = '42501'; end if;
  if new.address is distinct from old.address and not ('address' = any(allowed)) then
    raise exception 'Kolom alamat tidak dapat diubah' using errcode = '42501'; end if;
  if new.photo_path is distinct from old.photo_path and not ('photo' = any(allowed)) then
    raise exception 'Foto profil tidak dapat diubah' using errcode = '42501'; end if;
  return new;
end $$;
drop trigger if exists trg_guard_employee on public.employees;
create trigger trg_guard_employee before update on public.employees for each row execute function app.guard_employee_update();

-- Employees may only move status/progress of tasks assigned to them.
create or replace function app.guard_task_update() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or app.is_owner() then
    if new.status = 'completed' and old.status <> 'completed' then new.completed_at := coalesce(new.completed_at, now()); new.progress := 100; end if;
    if new.status <> 'completed' then new.completed_at := null; end if;
    return new;
  end if;
  if (new.title, new.description, new.priority, new.deadline, new.company_id, new.created_by)
     is distinct from (old.title, old.description, old.priority, old.deadline, old.company_id, old.created_by) then
    raise exception 'Karyawan hanya dapat mengubah status dan progress tugas' using errcode = '42501';
  end if;
  if new.status = 'completed' then new.progress := 100; new.completed_at := coalesce(old.completed_at, now());
  else new.completed_at := null; if new.status = 'todo' then new.progress := 0; end if; end if;
  return new;
end $$;
drop trigger if exists trg_guard_task on public.tasks;
create trigger trg_guard_task before update on public.tasks for each row execute function app.guard_task_update();

-- Task history is written automatically (cannot be forged by clients).
create or replace function app.log_task_change() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into public.task_history (company_id, task_id, actor_id, action, to_status, progress)
    values (new.company_id, new.id, auth.uid(), 'Tugas dibuat', new.status, new.progress);
  elsif new.status is distinct from old.status or new.progress is distinct from old.progress then
    insert into public.task_history (company_id, task_id, actor_id, action, from_status, to_status, progress)
    values (new.company_id, new.id, auth.uid(),
            case when new.status is distinct from old.status then 'Status diubah' else 'Progress diperbarui' end,
            old.status, new.status, new.progress);
  elsif (new.title, new.deadline, new.priority, new.description) is distinct from (old.title, old.deadline, old.priority, old.description) then
    insert into public.task_history (company_id, task_id, actor_id, action) values (new.company_id, new.id, auth.uid(), 'Detail tugas diperbarui');
  end if;
  return new;
end $$;
drop trigger if exists trg_log_task on public.tasks;
create trigger trg_log_task after insert or update on public.tasks for each row execute function app.log_task_change();

-- Recipients may only mark notifications as read.
create or replace function app.guard_notification_update() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return new; end if;
  if (new.recipient_id, new.company_id, new.type, new.title, new.message, new.link, new.created_at)
     is distinct from (old.recipient_id, old.company_id, old.type, old.title, old.message, old.link, old.created_at) then
    raise exception 'Notifikasi hanya dapat ditandai dibaca' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists trg_guard_notification on public.notifications;
create trigger trg_guard_notification before update on public.notifications for each row execute function app.guard_notification_update();

-- ---------- enable RLS everywhere ----------
do $$ declare t text; begin
  foreach t in array array['companies','profiles','employees','employment_history','work_locations','work_schedules','company_settings',
    'attendance_records','attendance_evidence','attendance_corrections','leave_types','leave_requests','tasks','task_assignments',
    'task_history','payroll_periods','salary_components','employee_salary_configurations','payroll_items','payroll_adjustments',
    'payments','payslips','notifications','announcements','audit_logs'] loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- Owner: full CRUD on company-scoped tables of their own company.
do $$ declare t text; begin
  foreach t in array array['employees','employment_history','work_locations','work_schedules','company_settings',
    'attendance_records','attendance_evidence','attendance_corrections','leave_types','leave_requests','tasks','task_assignments',
    'payroll_periods','salary_components','employee_salary_configurations','payroll_items','payroll_adjustments',
    'payments','payslips','announcements','profiles'] loop
    execute format('drop policy if exists owner_all on public.%I', t);
    execute format('create policy owner_all on public.%I for all to authenticated
      using (company_id = app.company_id() and app.is_owner())
      with check (company_id = app.company_id() and app.is_owner())', t);
  end loop;
end $$;

-- Company members: read shared, non-sensitive company configuration.
do $$ declare t text; begin
  foreach t in array array['work_locations','work_schedules','company_settings','leave_types','announcements'] loop
    execute format('drop policy if exists member_read on public.%I', t);
    execute format('create policy member_read on public.%I for select to authenticated using (company_id = app.company_id())', t);
  end loop;
end $$;

-- companies
drop policy if exists member_read on public.companies;
create policy member_read on public.companies for select to authenticated using (id = app.company_id());
drop policy if exists owner_update on public.companies;
create policy owner_update on public.companies for update to authenticated
  using (id = app.company_id() and app.is_owner()) with check (id = app.company_id() and app.is_owner());

-- profiles: everyone reads their own row
drop policy if exists self_read on public.profiles;
create policy self_read on public.profiles for select to authenticated using (id = auth.uid());

-- employees: own row; update guarded by trigger above
drop policy if exists self_read on public.employees;
create policy self_read on public.employees for select to authenticated using (id = app.employee_id());
drop policy if exists self_update on public.employees;
create policy self_update on public.employees for update to authenticated
  using (id = app.employee_id()) with check (id = app.employee_id());

drop policy if exists self_read on public.employment_history;
create policy self_read on public.employment_history for select to authenticated using (employee_id = app.employee_id());

-- attendance: employees read only their own; no direct writes
drop policy if exists self_read on public.attendance_records;
create policy self_read on public.attendance_records for select to authenticated using (employee_id = app.employee_id());
drop policy if exists self_read on public.attendance_evidence;
create policy self_read on public.attendance_evidence for select to authenticated using (employee_id = app.employee_id());

-- attendance corrections: employees read own and may only file new pending requests
drop policy if exists self_read on public.attendance_corrections;
create policy self_read on public.attendance_corrections for select to authenticated using (employee_id = app.employee_id());
drop policy if exists self_request on public.attendance_corrections;
create policy self_request on public.attendance_corrections for insert to authenticated with check (
  employee_id = app.employee_id() and company_id = app.company_id() and source = 'employee' and status = 'pending'
  and resolved_by is null and resolved_at is null and attendance_id is null and attendance_date <= current_date);

-- leave: employees read own and submit pending requests (cannot approve)
drop policy if exists self_read on public.leave_requests;
create policy self_read on public.leave_requests for select to authenticated using (employee_id = app.employee_id());
drop policy if exists self_request on public.leave_requests;
create policy self_request on public.leave_requests for insert to authenticated with check (
  employee_id = app.employee_id() and company_id = app.company_id() and status = 'pending'
  and decided_at is null and decided_by is null and coalesce(owner_notes, '') = ''
  and exists (select 1 from public.leave_types t where t.id = leave_type_id and t.company_id = app.company_id() and t.active));

-- tasks: employees see & update (status/progress only, via trigger) tasks assigned to them
drop policy if exists assignee_read on public.tasks;
create policy assignee_read on public.tasks for select to authenticated using (app.task_assigned(id));
drop policy if exists assignee_update on public.tasks;
create policy assignee_update on public.tasks for update to authenticated using (app.task_assigned(id)) with check (app.task_assigned(id));
drop policy if exists self_read on public.task_assignments;
create policy self_read on public.task_assignments for select to authenticated using (employee_id = app.employee_id());
drop policy if exists owner_read on public.task_history;
create policy owner_read on public.task_history for select to authenticated using (company_id = app.company_id() and app.is_owner());
drop policy if exists assignee_read on public.task_history;
create policy assignee_read on public.task_history for select to authenticated using (app.task_assigned(task_id));

-- payroll: employees read ONLY their own items, and only after approval
drop policy if exists self_read on public.payroll_items;
create policy self_read on public.payroll_items for select to authenticated using (app.payroll_item_visible(id));
drop policy if exists self_read on public.payroll_periods;
create policy self_read on public.payroll_periods for select to authenticated using (app.period_visible(id));
drop policy if exists self_read on public.payroll_adjustments;
create policy self_read on public.payroll_adjustments for select to authenticated using (app.payroll_item_visible(payroll_item_id));
drop policy if exists self_read on public.payments;
create policy self_read on public.payments for select to authenticated using (app.payroll_item_visible(payroll_item_id));
drop policy if exists self_read on public.payslips;
create policy self_read on public.payslips for select to authenticated using (app.payroll_item_visible(payroll_item_id));
-- salary_components & employee_salary_configurations: owner only (no employee policy)

-- notifications: private to the recipient (owners do not read employees' notifications)
drop policy if exists recipient_read on public.notifications;
create policy recipient_read on public.notifications for select to authenticated using (recipient_id = auth.uid());
drop policy if exists recipient_mark_read on public.notifications;
create policy recipient_mark_read on public.notifications for update to authenticated
  using (recipient_id = auth.uid()) with check (recipient_id = auth.uid());
drop policy if exists owner_send on public.notifications;
create policy owner_send on public.notifications for insert to authenticated with check (
  company_id = app.company_id() and app.is_owner()
  and exists (select 1 from public.profiles p where p.id = recipient_id and p.company_id = app.company_id()));

-- audit log: append-only, readable by the owner
drop policy if exists owner_read on public.audit_logs;
create policy owner_read on public.audit_logs for select to authenticated using (company_id = app.company_id() and app.is_owner());
drop policy if exists owner_append on public.audit_logs;
create policy owner_append on public.audit_logs for insert to authenticated
  with check (company_id = app.company_id() and app.is_owner() and actor_id = auth.uid());

-- Anonymous visitors get nothing.
revoke all on all tables in schema public from anon;


-- >>> 0003_storage.sql
-- =====================================================================
-- AbsenInn · Migration 0003 — Supabase Storage buckets & policies
-- All buckets are PRIVATE. Files are read through short-lived signed URLs.
-- Path convention: <company_id>/<employee_id>/<file>
--   attendance-selfies : uploaded by the Django backend only (service role)
--   leave-attachments  : employees upload into their own folder
--   company-assets     : logo, owner-managed
-- If your project rejects policies on storage.objects from the SQL editor,
-- create the same rules in Dashboard → Storage → Policies.
-- =====================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('attendance-selfies', 'attendance-selfies', false, 2097152, array['image/jpeg','image/png','image/webp']),
  ('leave-attachments',  'leave-attachments',  false, 5242880, array['application/pdf','image/jpeg','image/png']),
  ('company-assets',     'company-assets',     false, 2097152, array['image/png','image/jpeg','image/svg+xml','image/webp'])
on conflict (id) do nothing;

-- Selfies: owner of the company, or the employee whose folder it is. No client uploads.
drop policy if exists "absenninn selfies read" on storage.objects;
create policy "absenninn selfies read" on storage.objects for select to authenticated using (
  bucket_id = 'attendance-selfies' and (
    ((storage.foldername(name))[1] = app.company_id()::text and app.is_owner())
    or (storage.foldername(name))[2] = app.employee_id()::text));

-- Leave attachments: employee uploads/reads own folder; owner reads company folder.
drop policy if exists "absenninn attachments read" on storage.objects;
create policy "absenninn attachments read" on storage.objects for select to authenticated using (
  bucket_id = 'leave-attachments' and (
    ((storage.foldername(name))[1] = app.company_id()::text and app.is_owner())
    or (storage.foldername(name))[2] = app.employee_id()::text));
drop policy if exists "absenninn attachments upload" on storage.objects;
create policy "absenninn attachments upload" on storage.objects for insert to authenticated with check (
  bucket_id = 'leave-attachments'
  and (storage.foldername(name))[1] = app.company_id()::text
  and (storage.foldername(name))[2] = app.employee_id()::text);

-- Company assets: members read, owner writes.
drop policy if exists "absenninn assets read" on storage.objects;
create policy "absenninn assets read" on storage.objects for select to authenticated using (
  bucket_id = 'company-assets' and (storage.foldername(name))[1] = app.company_id()::text);
drop policy if exists "absenninn assets write" on storage.objects;
create policy "absenninn assets write" on storage.objects for insert to authenticated with check (
  bucket_id = 'company-assets' and (storage.foldername(name))[1] = app.company_id()::text and app.is_owner());
drop policy if exists "absenninn assets update" on storage.objects;
create policy "absenninn assets update" on storage.objects for update to authenticated using (
  bucket_id = 'company-assets' and (storage.foldername(name))[1] = app.company_id()::text and app.is_owner());


-- >>> 0004_admin_helpers.sql
-- =====================================================================
-- AbsenInn · Migration 0004 — admin helpers (run by SQL editor / backend only)
-- link_account: connects an existing Supabase Auth user (created in
-- Dashboard → Authentication → Users) to a company profile/employee.
-- Not executable by app users.
-- =====================================================================
create or replace function app.link_account(p_email text, p_company uuid, p_role text, p_full_name text,
                                            p_employee uuid default null, p_color text default '#6C55F2')
returns uuid language plpgsql security definer set search_path = public as $$
declare uid uuid;
begin
  select id into uid from auth.users where lower(email) = lower(p_email);
  if uid is null then
    raise notice 'Akun % belum ada di Supabase Auth — buat dulu di Authentication → Users, lalu jalankan ulang.', p_email;
    return null;
  end if;
  insert into public.profiles (id, company_id, role, full_name, email, avatar_color)
  values (uid, p_company, p_role, p_full_name, lower(p_email), p_color)
  on conflict (id) do update set company_id = excluded.company_id, role = excluded.role,
    full_name = excluded.full_name, email = excluded.email, avatar_color = excluded.avatar_color, is_active = true;
  if p_employee is not null then
    update public.employees set profile_id = uid where id = p_employee;
  end if;
  raise notice 'Akun % terhubung sebagai %.', p_email, p_role;
  return uid;
end $$;
revoke all on function app.link_account(text, uuid, text, text, uuid, text) from public, authenticated, anon;


-- >>> 0005_task_history_clock.sql
-- =====================================================================
-- AbsenInn · Migration 0005 — ordering of task history (Phase 5)
-- History rows written by the trigger inside one transaction all got the
-- same now() (= transaction start), so their order was ambiguous.
-- clock_timestamp() gives each row its real insertion time.
-- Safe to re-run.
-- =====================================================================
alter table public.task_history alter column created_at set default clock_timestamp();
