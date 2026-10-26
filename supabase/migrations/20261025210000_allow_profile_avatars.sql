-- Permit image uploads only under the caller's own avatars/<user-id>/ path.
-- Text-only post uploads remain disabled.
drop policy if exists "media_user_insert_own" on storage.objects;
drop policy if exists "media_user_update_own" on storage.objects;
drop policy if exists "media_user_delete_own" on storage.objects;

create policy "media_user_insert_own_avatar" on storage.objects for insert
  to authenticated with check (
    bucket_id = 'media'
    and owner = auth.uid()
    and (storage.foldername(name))[1] = 'avatars'
    and (storage.foldername(name))[2] = auth.uid()::text
  );

create policy "media_user_update_own_avatar" on storage.objects for update
  to authenticated using (
    bucket_id = 'media'
    and owner = auth.uid()
    and (storage.foldername(name))[1] = 'avatars'
    and (storage.foldername(name))[2] = auth.uid()::text
  ) with check (
    bucket_id = 'media'
    and owner = auth.uid()
    and (storage.foldername(name))[1] = 'avatars'
    and (storage.foldername(name))[2] = auth.uid()::text
  );

create policy "media_user_delete_own_avatar" on storage.objects for delete
  to authenticated using (
    bucket_id = 'media'
    and owner = auth.uid()
    and (storage.foldername(name))[1] = 'avatars'
    and (storage.foldername(name))[2] = auth.uid()::text
  );
