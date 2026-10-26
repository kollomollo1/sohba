-- Image uploads are disabled in the client. Enforce text-only posts in the
-- database too, so direct API calls cannot attach a new image URL.
create or replace function public.reject_post_images()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.image_url is not null then
    raise exception 'صور المنشورات غير مدعومة؛ المنشورات نصية فقط.'
      using errcode = '22023';
  end if;
  return new;
end;
$$;

drop trigger if exists posts_reject_images on public.posts;
create trigger posts_reject_images
before insert or update of image_url on public.posts
for each row execute function public.reject_post_images();

revoke execute on function public.reject_post_images() from public, anon, authenticated;

-- Remove client upload/download access for the app's media bucket. This does
-- not delete existing objects or public files already stored in the bucket.
drop policy if exists "media_upload_own" on storage.objects;
drop policy if exists "media_select_public" on storage.objects;
drop policy if exists "media_update_own" on storage.objects;
drop policy if exists "media_delete_own" on storage.objects;
