-- Account-level profile reports. Ten distinct reporters cause a permanent app ban.
alter table public.account_moderation
  add column if not exists profile_permanently_banned boolean not null default false,
  add column if not exists profile_auth_ban_applied boolean not null default false;

create table if not exists public.profile_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references public.profiles(id) on delete cascade,
  reported_user_id uuid not null references public.profiles(id) on delete cascade,
  reason text not null check (char_length(trim(reason)) between 1 and 1000),
  status text not null default 'open' check (status in ('open', 'action_taken')),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  check (reporter_id <> reported_user_id),
  unique (reporter_id, reported_user_id)
);
create index if not exists profile_reports_status_created_idx
  on public.profile_reports (status, created_at desc);
alter table public.profile_reports enable row level security;
grant insert on public.profile_reports to authenticated;
grant select, update (status, reviewed_at) on public.profile_reports to authenticated;
drop policy if exists "profile_reports_insert_own" on public.profile_reports;
create policy "profile_reports_insert_own" on public.profile_reports for insert
  to authenticated with check (auth.uid() = reporter_id and reporter_id <> reported_user_id);
drop policy if exists "profile_reports_admin_select" on public.profile_reports;
create policy "profile_reports_admin_select" on public.profile_reports for select
  to authenticated using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');
drop policy if exists "profile_reports_admin_update" on public.profile_reports;
create policy "profile_reports_admin_update" on public.profile_reports for update
  to authenticated using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
  with check ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

create or replace function public.process_profile_report_threshold()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_count integer;
  v_already_banned boolean;
begin
  perform pg_advisory_xact_lock(hashtextextended(new.reported_user_id::text, 2));
  select count(distinct r.reporter_id)::integer into v_count
    from public.profile_reports r where r.reported_user_id = new.reported_user_id;
  if v_count < 10 then return new; end if;

  select coalesce(m.profile_permanently_banned, false) into v_already_banned
    from public.account_moderation m where m.user_id = new.reported_user_id;
  if coalesce(v_already_banned, false) then return new; end if;

  insert into public.account_moderation (user_id, profile_permanently_banned)
    values (new.reported_user_id, true)
    on conflict (user_id) do update set
      profile_permanently_banned = true,
      updated_at = now();
  update public.profile_reports
    set status = 'action_taken', reviewed_at = now()
    where reported_user_id = new.reported_user_id;
  insert into public.admin_alerts (admin_id, message, reported_user_id)
    select u.id,
      'وصل الحساب إلى 10 بلاغات من مستخدمين مختلفين، وتم حظره نهائياً من التطبيق.',
      new.reported_user_id
    from auth.users u where u.raw_app_meta_data ->> 'role' = 'admin';
  return new;
end;
$$;
revoke execute on function public.process_profile_report_threshold() from public, anon, authenticated;
drop trigger if exists profile_report_threshold_trigger on public.profile_reports;
create trigger profile_report_threshold_trigger after insert on public.profile_reports
  for each row execute function public.process_profile_report_threshold();

create or replace function public.my_account_access_status()
returns table (allowed boolean, banned_until timestamptz, permanently_banned boolean)
language sql stable security definer set search_path = public as $$
  select
    not (coalesce(m.permanently_banned, false) or coalesce(m.profile_permanently_banned, false))
      and (m.access_suspended_until is null or m.access_suspended_until <= now()),
    m.access_suspended_until,
    coalesce(m.permanently_banned, false) or coalesce(m.profile_permanently_banned, false)
  from (select auth.uid() as uid) viewer
  left join public.account_moderation m on m.user_id = viewer.uid
  where viewer.uid is not null;
$$;
