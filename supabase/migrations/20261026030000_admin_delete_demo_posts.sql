-- ============================================================================
-- Function to delete all posts by demo accounts without deleting the accounts
-- ============================================================================

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

  -- 1. Delete all posts authored by demo accounts
  delete from public.posts p
  where exists (
    select 1 from public.profiles pr
    where pr.id = p.author_id and pr.is_demo_account
  );

  get diagnostics v_count = row_count;

  -- 2. Clear any queued demo daily posts in the queue
  delete from public.demo_daily_posts
  where run_date is not null;

  -- 3. Reset demo daily runs counter
  update public.demo_daily_runs
  set posts_created = 0
  where run_date is not null;

  return v_count;
end;
$$;

revoke execute on function public.admin_delete_demo_posts() from public, anon;
grant execute on function public.admin_delete_demo_posts() to authenticated;
