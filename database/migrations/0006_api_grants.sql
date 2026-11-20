-- =====================================================================
-- AbsenInn · Migration 0006 — table privileges for signed-in users
-- Newer Supabase projects no longer auto-grant table access to the API
-- roles ("Automatically expose new tables" off). Without these grants the
-- browser gets "permission denied for table profiles" at login.
-- Access stays row-restricted by the RLS policies in 0002 (employees see
-- only their own rows). The anon role gets NO table access.
-- Safe to re-run.
-- =====================================================================
grant usage on schema public to authenticated, service_role;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;
revoke all on all tables in schema public from anon;
