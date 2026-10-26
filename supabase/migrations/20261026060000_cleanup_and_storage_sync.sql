-- ============================================================================
-- 1. Auto-cleanup uploaded images from Supabase Storage when a post is deleted
-- ============================================================================

create or replace function public.on_post_deleted_cleanup()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_storage_path text;
begin
  -- If the deleted post had an uploaded image in the 'media' bucket
  if old.image_url is not null and old.image_url like '%/media/%' then
    -- Extract the file path inside the bucket (e.g. posts/userId/timestamp_random.jpg)
    v_storage_path := substring(old.image_url from '/media/(.+)$');
    if v_storage_path is not null and v_storage_path <> '' then
      delete from storage.objects
      where bucket_id = 'media'
        and name = v_storage_path;
    end if;
  end if;
  return old;
end;
$$;

drop trigger if exists trg_post_deleted_cleanup on public.posts;
create trigger trg_post_deleted_cleanup
  before delete on public.posts
  for each row
  execute function public.on_post_deleted_cleanup();

-- ============================================================================
-- 2. Enhanced delete_expired_posts() to purge all posts > 24 hours
--    (Includes: regular posts, urgent posts, image posts, demo posts)
-- ============================================================================

create or replace function public.delete_expired_posts()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  -- Delete all posts created more than 24 hours ago
  delete from public.posts p
  where p.created_at < now() - interval '24 hours';

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

grant execute on function public.delete_expired_posts() to anon, authenticated, service_role;

-- ============================================================================
-- 3. Ensure admin_delete_post hard-deletes from public.posts
-- ============================================================================

create or replace function public.admin_delete_post(p_post_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') <> 'admin' then
    raise exception 'admin role required' using errcode = '42501';
  end if;

  delete from public.posts where id = p_post_id;
end;
$$;

grant execute on function public.admin_delete_post(uuid) to authenticated;

-- ============================================================================
-- 4. Purge any currently expired posts right now
-- ============================================================================

select public.delete_expired_posts();
