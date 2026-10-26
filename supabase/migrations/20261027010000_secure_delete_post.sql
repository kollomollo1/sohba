-- ============================================================================
-- Secure and reliable post deletion for both post authors and admins
-- Handles all foreign key references cleanly without constraint violations
-- ============================================================================

-- 1. Helper function: is current user an admin?
create or replace function public.is_current_user_admin()
returns boolean
language plpgsql
security definer
stable
set search_path = public, auth
as $$
declare
  v_is_admin boolean := false;
begin
  if auth.uid() is null then
    return false;
  end if;

  select coalesce((u.raw_app_meta_data ->> 'role') = 'admin', false)
    into v_is_admin
    from auth.users u
    where u.id = auth.uid();

  if not v_is_admin then
    v_is_admin := coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') = 'admin';
  end if;

  return v_is_admin;
end;
$$;

grant execute on function public.is_current_user_admin() to anon, authenticated;

-- 2. Enhanced admin_delete_post
create or replace function public.admin_delete_post(p_post_id uuid)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if not public.is_current_user_admin() then
    raise exception 'admin role required' using errcode = '42501';
  end if;

  -- Clean foreign key references to avoid constraint blocks
  delete from public.post_reports where post_id = p_post_id;
  update public.messages set shared_post_id = null where shared_post_id = p_post_id;
  delete from public.notifications where post_id = p_post_id;
  delete from public.hidden_posts where post_id = p_post_id;
  delete from public.likes where post_id = p_post_id;
  delete from public.comments where post_id = p_post_id;

  delete from public.posts where id = p_post_id;
end;
$$;

grant execute on function public.admin_delete_post(uuid) to anon, authenticated;

-- 3. Unified delete_post: permits either the author of the post OR any admin
create or replace function public.delete_post(p_post_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_author_id uuid;
  v_is_admin boolean := false;
begin
  if auth.uid() is null then
    raise exception 'authenticated user required' using errcode = '42501';
  end if;

  -- Locate the post
  select author_id into v_author_id
  from public.posts
  where id = p_post_id;

  if v_author_id is null then
    -- Already deleted
    return true;
  end if;

  v_is_admin := public.is_current_user_admin();

  -- Verify authorization: must be either the author or an admin
  if v_author_id <> auth.uid() and not v_is_admin then
    raise exception 'not authorized to delete this post' using errcode = '42501';
  end if;

  -- Clean foreign key references
  delete from public.post_reports where post_id = p_post_id;
  update public.messages set shared_post_id = null where shared_post_id = p_post_id;
  delete from public.notifications where post_id = p_post_id;
  delete from public.hidden_posts where post_id = p_post_id;
  delete from public.likes where post_id = p_post_id;
  delete from public.comments where post_id = p_post_id;

  -- Delete the post
  delete from public.posts where id = p_post_id;

  return true;
end;
$$;

grant execute on function public.delete_post(uuid) to anon, authenticated;
