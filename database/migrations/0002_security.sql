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
