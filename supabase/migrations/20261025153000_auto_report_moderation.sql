-- Five distinct reporters on a post remove it and escalate account penalties:
-- first offense: posting suspension; second: three-day access ban; third: permanent ban.
alter table public.post_reports add column if not exists subject_post_id uuid;
update public.post_reports set subject_post_id = post_id where subject_post_id is null and post_id is not null;
drop index if exists public.post_reports_one_per_user_per_post_idx;

with duplicate_reports as (
  select id, row_number() over (partition by reporter_id, subject_post_id order by created_at, id) as duplicate_rank
  from public.post_reports where subject_post_id is not null
)
delete from public.post_reports r using duplicate_reports d
where r.id = d.id and d.duplicate_rank > 1;

create unique index if not exists post_reports_one_per_user_per_post_idx
  on public.post_reports (reporter_id, subject_post_id) where subject_post_id is not null;

create table if not exists public.account_moderation (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  offense_count integer not null default 0,
  posting_suspended_until timestamptz,
  access_suspended_until timestamptz,
  permanently_banned boolean not null default false,
  auth_ban_applied_offense integer not null default 0,
  updated_at timestamptz not null default now()
);
alter table public.account_moderation enable row level security;

create table if not exists public.admin_alerts (
  id uuid primary key default gen_random_uuid(),
  admin_id uuid not null references public.profiles(id) on delete cascade,
  message text not null,
  reported_user_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  read_at timestamptz
);
create index if not exists admin_alerts_admin_created_idx
  on public.admin_alerts (admin_id, created_at desc);
alter table public.admin_alerts enable row level security;
grant select, update (read_at) on public.admin_alerts to authenticated;
drop policy if exists "admin_alerts_select_own_admin" on public.admin_alerts;
create policy "admin_alerts_select_own_admin" on public.admin_alerts for select
  to authenticated using (
    auth.uid() = admin_id and (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
  );
drop policy if exists "admin_alerts_update_own_admin" on public.admin_alerts;
create policy "admin_alerts_update_own_admin" on public.admin_alerts for update
  to authenticated using (
    auth.uid() = admin_id and (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
  ) with check (
    auth.uid() = admin_id and (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
  );

create or replace function public.enforce_post_interval()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_last_post timestamptz;
  v_suspended_until timestamptz;
  v_access_until timestamptz;
  v_permanently_banned boolean;
begin
  perform pg_advisory_xact_lock(hashtextextended(new.author_id::text, 0));
  select m.posting_suspended_until, m.access_suspended_until, m.permanently_banned
    into v_suspended_until, v_access_until, v_permanently_banned
    from public.account_moderation m where m.user_id = new.author_id;
  if coalesce(v_permanently_banned, false) then
    raise exception 'تم حظر هذا الحساب نهائياً.' using errcode = 'P0001';
  end if;
  if v_access_until is not null and v_access_until > now() then
    raise exception 'تم إيقاف دخول هذا الحساب مؤقتاً حتى % بسبب البلاغات.', v_access_until
      using errcode = 'P0001';
  end if;
  if v_suspended_until is not null and v_suspended_until > now() then
    raise exception 'تم إيقاف النشر على حسابك حتى % بسبب البلاغات.', v_suspended_until
      using errcode = 'P0001';
  end if;
  select max(created_at) into v_last_post
    from public.posts where author_id = new.author_id;
  if v_last_post is not null and v_last_post > now() - interval '15 minutes' then
    raise exception 'يمكنك نشر منشور واحد كل 15 دقيقة.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
revoke execute on function public.enforce_post_interval() from public, anon, authenticated;

create or replace function public.process_post_report_threshold()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_author_id uuid;
  v_report_count integer;
  v_offense_count integer;
  v_alert_text text;
begin
  if new.subject_post_id is null then return new; end if;
  perform pg_advisory_xact_lock(hashtextextended(new.subject_post_id::text, 1));

  select p.author_id into v_author_id from public.posts p where p.id = new.subject_post_id;
  if v_author_id is null then return new; end if;

  select count(distinct r.reporter_id)::integer into v_report_count
    from public.post_reports r where r.subject_post_id = new.subject_post_id;
  if v_report_count < 5 then return new; end if;

  insert into public.account_moderation (user_id, offense_count)
    values (v_author_id, 1)
    on conflict (user_id) do update set
      offense_count = account_moderation.offense_count + 1,
      updated_at = now()
    returning offense_count into v_offense_count;

  if v_offense_count = 1 then
    update public.account_moderation set posting_suspended_until = now() + interval '24 hours'
      where user_id = v_author_id;
    v_alert_text := 'وصل المنشور إلى 5 بلاغات مختلفة: حُذف المنشور وأُوقف صاحبه عن النشر 24 ساعة.';
  elsif v_offense_count = 2 then
    update public.account_moderation set access_suspended_until = now() + interval '3 days'
      where user_id = v_author_id;
    v_alert_text := 'تكرر وصول منشور لصاحبه إلى 5 بلاغات: حُذف المنشور وأُوقف الحساب عن دخول التطبيق 3 أيام.';
  else
    update public.account_moderation set permanently_banned = true
      where user_id = v_author_id;
    v_alert_text := 'تكرر وصول منشور لصاحبه إلى 5 بلاغات للمرة الثالثة: حُذف المنشور وحُظر الحساب نهائياً.';
  end if;

  update public.post_reports
    set status = 'action_taken', reviewed_at = now()
    where subject_post_id = new.subject_post_id;
  delete from public.posts where id = new.subject_post_id;

  insert into public.admin_alerts (admin_id, message, reported_user_id)
    select u.id, v_alert_text, v_author_id
    from auth.users u
    where u.raw_app_meta_data ->> 'role' = 'admin';
  return new;
end;
$$;
revoke execute on function public.process_post_report_threshold() from public, anon, authenticated;
drop trigger if exists post_report_threshold_trigger on public.post_reports;
create trigger post_report_threshold_trigger after insert on public.post_reports
  for each row execute function public.process_post_report_threshold();

create or replace function public.set_report_subject_post_id()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.subject_post_id := coalesce(new.subject_post_id, new.post_id);
  return new;
end;
$$;
revoke execute on function public.set_report_subject_post_id() from public, anon, authenticated;
drop trigger if exists set_report_subject_post_id_trigger on public.post_reports;
create trigger set_report_subject_post_id_trigger before insert on public.post_reports
  for each row execute function public.set_report_subject_post_id();

create or replace function public.my_account_access_status()
returns table (allowed boolean, banned_until timestamptz, permanently_banned boolean)
language sql stable security definer set search_path = public as $$
  select
    not coalesce(m.permanently_banned, false)
      and (m.access_suspended_until is null or m.access_suspended_until <= now()),
    m.access_suspended_until,
    coalesce(m.permanently_banned, false)
  from (select auth.uid() as uid) viewer
  left join public.account_moderation m on m.user_id = viewer.uid
  where viewer.uid is not null;
$$;
revoke execute on function public.my_account_access_status() from public, anon;
grant execute on function public.my_account_access_status() to authenticated;
