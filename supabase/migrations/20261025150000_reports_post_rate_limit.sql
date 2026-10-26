-- User reports and a database-enforced posting interval.
create table if not exists public.post_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references public.profiles(id) on delete cascade,
  reported_user_id uuid not null references public.profiles(id) on delete cascade,
  post_id uuid references public.posts(id) on delete set null,
  reason text not null check (char_length(trim(reason)) between 1 and 1000),
  status text not null default 'open' check (status in ('open', 'reviewed', 'action_taken')),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz
);

create index if not exists post_reports_status_created_idx
  on public.post_reports (status, created_at desc);
alter table public.post_reports enable row level security;
grant insert on public.post_reports to authenticated;
grant select, update (status, reviewed_at) on public.post_reports to authenticated;

drop policy if exists "post_reports_insert_own" on public.post_reports;
create policy "post_reports_insert_own" on public.post_reports for insert
  to authenticated with check (auth.uid() = reporter_id and reporter_id <> reported_user_id);
drop policy if exists "post_reports_admin_select" on public.post_reports;
create policy "post_reports_admin_select" on public.post_reports for select
  to authenticated using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');
drop policy if exists "post_reports_admin_update" on public.post_reports;
create policy "post_reports_admin_update" on public.post_reports for update
  to authenticated using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
  with check ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

create or replace function public.admin_delete_reported_post(p_report_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_post_id uuid;
begin
  if (auth.jwt() -> 'app_metadata' ->> 'role') is distinct from 'admin' then
    raise exception 'admin role required' using errcode = '42501';
  end if;
  select post_id into v_post_id from public.post_reports where id = p_report_id;
  if v_post_id is not null then
    delete from public.posts where id = v_post_id;
  end if;
  update public.post_reports
     set status = 'action_taken', reviewed_at = now()
   where id = p_report_id;
end;
$$;
revoke execute on function public.admin_delete_reported_post(uuid) from public, anon;
grant execute on function public.admin_delete_reported_post(uuid) to authenticated;

-- Serialize concurrent inserts by author to prevent two posts bypassing the limit.
create or replace function public.enforce_post_interval()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_last_post timestamptz;
begin
  perform pg_advisory_xact_lock(hashtextextended(new.author_id::text, 0));
  select max(created_at) into v_last_post
    from public.posts where author_id = new.author_id;
  if v_last_post is not null and v_last_post > now() - interval '15 minutes' then
    raise exception 'يمكنك نشر منشور واحد كل 15 دقيقة.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
revoke execute on function public.enforce_post_interval() from public, anon, authenticated;
drop trigger if exists posts_interval_limit on public.posts;
create trigger posts_interval_limit before insert on public.posts
  for each row execute function public.enforce_post_interval();

-- To grant admin access, set this in the Supabase SQL Editor for the admin's email:
-- update auth.users set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || '{"role":"admin"}'::jsonb
-- where email = 'YOUR_ADMIN_EMAIL';
