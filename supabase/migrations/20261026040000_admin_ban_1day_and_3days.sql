-- Support 1 day (suspend_1d), 3 days (suspend_3d), and permanent ban (ban_permanent)
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
  if p_action = 'suspend_1d' or p_action = 'suspend_24h' then
    update public.account_moderation set access_suspended_until = now() + interval '1 day', updated_at = now()
      where user_id = p_user_id;
  elsif p_action = 'suspend_3d' then
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
