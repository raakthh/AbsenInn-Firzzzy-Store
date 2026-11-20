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
