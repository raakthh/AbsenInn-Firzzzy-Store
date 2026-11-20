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
