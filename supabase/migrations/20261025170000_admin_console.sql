-- Admin-only read and moderation operations for the in-app control panel.
create or replace function public.admin_user_overview()
returns table (
  user_id uuid,
  full_name text,
  username text,
  avatar_url text,
  created_at timestamptz,
  post_report_count bigint,
  profile_report_count bigint,
  post_offenses integer,
  posting_suspended_until timestamptz,
  access_suspended_until timestamptz,
  permanently_banned boolean
)
language plpgsql security definer set search_path = public as $$
begin
  if (auth.jwt() -> 'app_metadata' ->> 'role') is distinct from 'admin' then
    raise exception 'admin role required' using errcode = '42501';
  end if;
  return query
  select p.id, p.full_name, p.username, p.avatar_url, p.created_at,
    coalesce(post_reports.report_count, 0),
    coalesce(profile_reports.report_count, 0),
    coalesce(m.offense_count, 0), m.posting_suspended_until, m.access_suspended_until,
    coalesce(m.permanently_banned, false) or coalesce(m.profile_permanently_banned, false)
  from public.profiles p
  left join (
    select r.reported_user_id, count(*)::bigint as report_count
    from public.post_reports r group by r.reported_user_id
  ) post_reports on post_reports.reported_user_id = p.id
  left join (
    select r.reported_user_id, count(*)::bigint as report_count
    from public.profile_reports r group by r.reported_user_id
  ) profile_reports on profile_reports.reported_user_id = p.id
  left join public.account_moderation m on m.user_id = p.id
  order by p.created_at desc;
end;
$$;
revoke execute on function public.admin_user_overview() from public, anon;
grant execute on function public.admin_user_overview() to authenticated;

create or replace function public.admin_set_account_restriction(p_user_id uuid, p_action text)
returns void language plpgsql security definer set search_path = public as $$
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
  if p_action = 'suspend_3d' then
    update public.account_moderation set access_suspended_until = now() + interval '3 days', updated_at = now()
      where user_id = p_user_id;
  elsif p_action = 'ban_permanent' then
    update public.account_moderation set permanently_banned = true, updated_at = now()
      where user_id = p_user_id;
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

create or replace function public.admin_delete_post(p_post_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if (auth.jwt() -> 'app_metadata' ->> 'role') is distinct from 'admin' then
    raise exception 'admin role required' using errcode = '42501';
  end if;
  delete from public.posts where id = p_post_id;
end;
$$;
revoke execute on function public.admin_delete_post(uuid) from public, anon;
grant execute on function public.admin_delete_post(uuid) to authenticated;
