-- Prevent non-admin accounts from impersonating app administration by name.
create or replace function public.guard_reserved_admin_display_name()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_name text;
  v_latin_name text;
begin
  if coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') = 'admin' then
    return new;
  end if;

  v_name := lower(translate(coalesce(new.full_name, ''), 'أإآٱ', 'اااا'));
  v_name := regexp_replace(v_name, '[ًٌٍَُِّْـ]', '', 'g');
  v_latin_name := regexp_replace(v_name, '[^a-z0-9]+', ' ', 'g');

  if position('ادمن' in v_name) > 0
    or position('مدير' in v_name) > 0
    or position('مشرف' in v_name) > 0
    or position('ادارة' in v_name) > 0
    or position('مسؤول النظام' in v_name) > 0
    or v_latin_name ~ '(^| )(admin|administrator|root|moderator|mod|staff|support)[0-9]*( |$)'
  then
    raise exception 'الاسم محجوز لإدارة التطبيق.' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_guard_reserved_admin_name on public.profiles;
create trigger profiles_guard_reserved_admin_name
before insert or update of full_name on public.profiles
for each row execute function public.guard_reserved_admin_display_name();

revoke execute on function public.guard_reserved_admin_display_name() from public, anon, authenticated;
