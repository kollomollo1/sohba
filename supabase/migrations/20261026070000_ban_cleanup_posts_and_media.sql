-- ============================================================================
-- 1. Function to clean up all posts and media files of a specific user
-- ============================================================================

create or replace function public.cleanup_user_posts_and_media(p_target_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  v_storage_path text;
begin
  if p_target_user_id is null then
    return;
  end if;

  -- A. Clean storage objects for all posts of this user that have uploaded images
  for r in (
    select id, image_url
    from public.posts
    where author_id = p_target_user_id
      and image_url is not null
      and image_url like '%/media/%'
  ) loop
    v_storage_path := substring(r.image_url from '/media/(.+)$');
    if v_storage_path is not null and v_storage_path <> '' then
      v_storage_path := split_part(v_storage_path, '?', 1);
      delete from storage.objects
      where bucket_id = 'media'
        and name = v_storage_path;
    end if;
  end loop;

  -- B. Also remove any files in the user's posts storage folder (posts/<user_id>/...)
  delete from storage.objects
  where bucket_id = 'media'
    and name like 'posts/' || p_target_user_id::text || '/%';

  -- C. Delete all posts by this user from public.posts
  delete from public.posts
  where author_id = p_target_user_id;
end;
$$;

grant execute on function public.cleanup_user_posts_and_media(uuid) to service_role;

-- ============================================================================
-- 2. Update admin_set_account_restriction to purge posts & storage on any ban
-- ============================================================================

create or replace function public.admin_set_account_restriction(p_user_id uuid, p_action text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if (auth.jwt() -> 'app_metadata' ->> 'role') is distinct from 'admin' then
    raise exception 'admin role required' using errcode = '42501';
  end if;
  if p_user_id = auth.uid() then
    raise exception 'cannot moderate the current admin account' using errcode = '42501';
  end if;
  if not exists (select 1 from public.profiles where id = p_user_id) then
    raise exception 'user not found' using errcode = 'P0002';
  end if;

  insert into public.account_moderation (user_id) values (p_user_id)
    on conflict (user_id) do nothing;

  if p_action = 'suspend_1d' or p_action = 'suspend_24h' then
    update public.account_moderation
      set access_suspended_until = now() + interval '1 day', updated_at = now()
      where user_id = p_user_id;
    -- Purge all posts and images of this user
    perform public.cleanup_user_posts_and_media(p_user_id);

  elsif p_action = 'suspend_3d' then
    update public.account_moderation
      set access_suspended_until = now() + interval '3 days', updated_at = now()
      where user_id = p_user_id;
    -- Purge all posts and images of this user
    perform public.cleanup_user_posts_and_media(p_user_id);

  elsif p_action = 'ban_permanent' then
    update public.account_moderation
      set permanently_banned = true, updated_at = now()
      where user_id = p_user_id;
    -- Purge all posts and images of this user
    perform public.cleanup_user_posts_and_media(p_user_id);

  elsif p_action = 'unban' then
    update public.account_moderation set
      access_suspended_until = null,
      posting_suspended_until = null,
      permanently_banned = false,
      profile_permanently_banned = false,
      profile_auth_ban_applied = false,
      auth_ban_applied_offense = 0,
      updated_at = now()
      where user_id = p_user_id;

  else
    raise exception 'unsupported moderation action' using errcode = '22023';
  end if;
end;
$$;

revoke execute on function public.admin_set_account_restriction(uuid, text) from public, anon;
grant execute on function public.admin_set_account_restriction(uuid, text) to authenticated;

-- ============================================================================
-- 3. Automatic Trigger on account_moderation to purge posts & images on ban
--    (covers automated report threshold bans, direct updates, etc.)
-- ============================================================================

create or replace function public.on_account_moderation_ban_cleanup()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_is_banned boolean := false;
begin
  if coalesce(new.permanently_banned, false) = true then
    v_is_banned := true;
  elsif coalesce(new.profile_permanently_banned, false) = true then
    v_is_banned := true;
  elsif new.access_suspended_until is not null and new.access_suspended_until > now() then
    v_is_banned := true;
  end if;

  if v_is_banned then
    perform public.cleanup_user_posts_and_media(new.user_id);
  end if;

  return new;
end;
$$;

drop trigger if exists trg_account_moderation_ban_cleanup on public.account_moderation;
create trigger trg_account_moderation_ban_cleanup
  after insert or update on public.account_moderation
  for each row
  execute function public.on_account_moderation_ban_cleanup();
