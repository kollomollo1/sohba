-- Reserve the normalized username "admin" for the existing application admin.
create or replace function public.protect_admin_username()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  is_admin_account boolean := false;
begin
  select coalesce((u.raw_app_meta_data ->> 'role') = 'admin', false)
    into is_admin_account
    from auth.users u
    where u.id = new.id;

  if lower(trim(new.username)) = 'admin' and not coalesce(is_admin_account, false) then
    raise exception 'اسم المستخدم admin محجوز لحساب إدارة التطبيق.'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_reserve_admin_username on public.profiles;
create trigger profiles_reserve_admin_username
before insert or update of username on public.profiles
for each row execute function public.protect_admin_username();

revoke execute on function public.protect_admin_username() from public, anon, authenticated;
