-- ============================================================================
-- Fix admin_delete_demo_posts: Add safe WHERE clauses to prevent
-- "DELETE requires a WHERE clause" error under PostgreSQL safeupdate extension.
-- ============================================================================

create or replace function public.admin_delete_demo_posts()
returns integer
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_count integer := 0;
begin
  -- 1. Verify admin privilege
  if coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') <> 'admin' then
    if not exists (
      select 1 from auth.users u
      where u.id = auth.uid() and (u.raw_app_meta_data ->> 'role') = 'admin'
    ) then
      raise exception 'admin role required' using errcode = '42501';
    end if;
  end if;

  -- 2. Clear related records first to ensure no constraint violations
  delete from public.post_reports
  where post_id in (
    select id from public.posts p
    where exists (select 1 from public.profiles pr where pr.id = p.author_id and pr.is_demo_account = true)
  );

  update public.messages
  set shared_post_id = null
  where shared_post_id in (
    select id from public.posts p
    where exists (select 1 from public.profiles pr where pr.id = p.author_id and pr.is_demo_account = true)
  );

  delete from public.notifications
  where post_id in (
    select id from public.posts p
    where exists (select 1 from public.profiles pr where pr.id = p.author_id and pr.is_demo_account = true)
  );

  delete from public.hidden_posts
  where post_id in (
    select id from public.posts p
    where exists (select 1 from public.profiles pr where pr.id = p.author_id and pr.is_demo_account = true)
  );

  delete from public.likes
  where post_id in (
    select id from public.posts p
    where exists (select 1 from public.profiles pr where pr.id = p.author_id and pr.is_demo_account = true)
  );

  delete from public.comments
  where post_id in (
    select id from public.posts p
    where exists (select 1 from public.profiles pr where pr.id = p.author_id and pr.is_demo_account = true)
  );

  -- 3. Clear queued demo daily posts (safe WHERE clause to satisfy safeupdate)
  delete from public.demo_daily_posts
  where run_date is not null;

  -- 4. Delete all posts authored by demo accounts
  delete from public.posts p
  where exists (
    select 1 from public.profiles pr
    where pr.id = p.author_id and pr.is_demo_account = true
  );

  get diagnostics v_count = row_count;

  -- 5. Clear runs counter so re-scheduling is completely fresh (safe WHERE clause to satisfy safeupdate)
  delete from public.demo_daily_runs
  where run_date is not null;

  return v_count;
end;
$$;

revoke execute on function public.admin_delete_demo_posts() from public, anon;
grant execute on function public.admin_delete_demo_posts() to authenticated;
