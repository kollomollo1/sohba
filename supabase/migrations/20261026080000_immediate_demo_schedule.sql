-- ============================================================================
-- Immediate Demo Post Scheduling & Instant Publishing
-- 1. publish_daily_demo_posts(): starts NOW, publishes 1st post instantly, spaces rest by 30 mins
-- 2. publish_due_demo_post(): granted to anon/auth so frontend background runner triggers it
-- 3. admin_force_publish_demo_post(): publish next demo post on-demand instantly
-- 4. admin_delete_demo_posts(): complete clean slate to allow immediate re-scheduling
-- ============================================================================

-- 1. publish_due_demo_post
create or replace function public.publish_due_demo_post()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item public.demo_daily_posts%rowtype;
  v_post_id uuid;
begin
  -- If auto-posting is paused in settings, do nothing
  if exists (select 1 from public.demo_post_settings where id = 1 and not auto_posting_enabled) then
    return 0;
  end if;

  -- Select earliest scheduled post that is due
  select * into v_item
  from public.demo_daily_posts
  where post_id is null and scheduled_at <= now()
  order by scheduled_at asc, user_id asc
  for update skip locked
  limit 1;

  if not found then
    return 0;
  end if;

  -- Insert into public.posts
  insert into public.posts (author_id, body, image_url, is_urgent)
  values (v_item.user_id, v_item.body, null, false)
  returning id into v_post_id;

  -- Mark as published
  update public.demo_daily_posts
  set post_id = v_post_id, published_at = now()
  where run_date = v_item.run_date and user_id = v_item.user_id;

  -- Update daily runs count
  insert into public.demo_daily_runs (run_date, posts_created)
  values (v_item.run_date, 1)
  on conflict (run_date) do update
    set posts_created = public.demo_daily_runs.posts_created + 1;

  return 1;
end;
$$;

grant execute on function public.publish_due_demo_post() to anon, authenticated, service_role;

-- 2. publish_daily_demo_posts (Immediate scheduling from now)
create or replace function public.publish_daily_demo_posts()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_run_date date := current_date;
  v_start timestamptz := now();
  v_account record;
  v_scheduled_count integer := 0;
  v_post_index integer;
  v_body text;
  v_gender text;
  v_scheduled_at timestamptz;
  v_gap interval := interval '30 minutes';
begin
  -- Check if auto-posting is disabled
  if exists (select 1 from public.demo_post_settings where id = 1 and not auto_posting_enabled) then
    return 0;
  end if;

  -- Clear any previously unposted queue rows so we schedule fresh starting NOW
  delete from public.demo_daily_posts where post_id is null;

  -- Schedule all active demo accounts
  for v_account in
    select
      p.id,
      coalesce(p.demo_gender, 'male') as demo_gender,
      row_number() over (order by random())::integer - 1 as account_index
    from public.profiles p
    left join public.account_moderation m on m.user_id = p.id
    where p.is_demo_account
      and not coalesce(m.permanently_banned, false)
      and not coalesce(m.profile_permanently_banned, false)
      and (m.access_suspended_until is null or m.access_suspended_until <= now())
      and (m.posting_suspended_until is null or m.posting_suspended_until <= now())
    order by random()
  loop
    v_gender := v_account.demo_gender;
    v_post_index := (extract(doy from v_run_date)::integer - 1) * 50 + (v_account.account_index % 50) + 1;
    v_body := public.demo_post_text(v_post_index, v_gender);

    -- Post #1 starts NOW! Next posts spaced by 30 minutes
    v_scheduled_at := v_start + (v_scheduled_count * v_gap);

    insert into public.demo_daily_posts (run_date, user_id, post_id, body, scheduled_at)
    values (v_run_date, v_account.id, null, v_body, v_scheduled_at)
    on conflict (run_date, user_id) do update set
      post_id = null,
      body = excluded.body,
      scheduled_at = excluded.scheduled_at;

    v_scheduled_count := v_scheduled_count + 1;
  end loop;

  -- Immediately publish the first post RIGHT NOW so feed gets a post instantly!
  perform public.publish_due_demo_post();

  return v_scheduled_count;
end;
$$;

grant execute on function public.publish_daily_demo_posts() to anon, authenticated, service_role;

-- 3. admin_force_publish_demo_post (Instant on-demand publish for testing)
create or replace function public.admin_force_publish_demo_post()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item public.demo_daily_posts%rowtype;
  v_post_id uuid;
begin
  if coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') <> 'admin' then
    raise exception 'admin role required' using errcode = '42501';
  end if;

  -- Pick the next unposted item regardless of scheduled_at
  select * into v_item
  from public.demo_daily_posts
  where post_id is null
  order by scheduled_at asc, user_id asc
  for update skip locked
  limit 1;

  -- If queue is empty, schedule today's batch first
  if not found then
    perform public.publish_daily_demo_posts();
    select * into v_item
    from public.demo_daily_posts
    where post_id is null
    order by scheduled_at asc, user_id asc
    for update skip locked
    limit 1;
  end if;

  if not found then
    return 0;
  end if;

  insert into public.posts (author_id, body, image_url, is_urgent)
  values (v_item.user_id, v_item.body, null, false)
  returning id into v_post_id;

  update public.demo_daily_posts
  set post_id = v_post_id, published_at = now()
  where run_date = v_item.run_date and user_id = v_item.user_id;

  insert into public.demo_daily_runs (run_date, posts_created)
  values (v_item.run_date, 1)
  on conflict (run_date) do update
    set posts_created = public.demo_daily_runs.posts_created + 1;

  return 1;
end;
$$;

revoke execute on function public.admin_force_publish_demo_post() from public, anon;
grant execute on function public.admin_force_publish_demo_post() to authenticated;

-- 4. admin_delete_demo_posts (Full clean slate)
create or replace function public.admin_delete_demo_posts()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  if coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') <> 'admin' then
    raise exception 'admin role required' using errcode = '42501';
  end if;

  -- 1. Delete all posts by demo accounts
  delete from public.posts p
  where exists (
    select 1 from public.profiles pr
    where pr.id = p.author_id and pr.is_demo_account
  );

  get diagnostics v_count = row_count;

  -- 2. Clear all queued demo posts (with WHERE clause for safeupdate)
  delete from public.demo_daily_posts
  where run_date is not null;

  -- 3. Clear runs counter so re-scheduling is completely fresh (with WHERE clause for safeupdate)
  delete from public.demo_daily_runs
  where run_date is not null;

  return v_count;
end;
$$;

revoke execute on function public.admin_delete_demo_posts() from public, anon;
grant execute on function public.admin_delete_demo_posts() to authenticated;
