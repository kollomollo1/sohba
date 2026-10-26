-- Let authenticated clients determine whether a profile belongs to an admin,
-- without exposing app_metadata itself. Used only to hide report controls.
create or replace function public.is_admin_profile(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select coalesce((u.raw_app_meta_data ->> 'role') = 'admin', false)
  from auth.users u
  where u.id = p_user_id;
$$;

revoke execute on function public.is_admin_profile(uuid) from public, anon;
grant execute on function public.is_admin_profile(uuid) to authenticated;
