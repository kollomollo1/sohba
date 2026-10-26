-- ============================================================================
-- Profile auto-creation on signup. Username + full_name come from sign-up
-- metadata (user_metadata). Validates username uniqueness.
-- ============================================================================

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_full_name text := coalesce(new.raw_user_meta_data->>'full_name', 'مستخدم جديد');
  v_username text := lower(coalesce(new.raw_user_meta_data->>'username', ''));
  v_candidate text;
  v_i int := 1;
begin
  if v_username = '' then
    v_username := 'user_' || substring(encode(new.id::bytea, 'hex') from 1 for 6);
  end if;

  v_candidate := v_username;
  while exists (select 1 from public.profiles where lower(username) = v_candidate) loop
    v_i := v_i + 1;
    v_candidate := v_username || v_i::text;
  end loop;

  insert into public.profiles (id, full_name, username)
  values (new.id, v_full_name, v_candidate)
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

revoke execute on function public.handle_new_user() from public, anon, authenticated;

-- ============================================================================
-- Friendship actions (server-validated).
--   request_friend(target): inserts pending row (idempotent if already exists)
--   respond_to_request(req_id, accept): addressee accepts or rejects
--   cancel_friend(target): requester cancels pending or removes accepted friend
-- Mutual friendship is modelled as a single row; queries treat it as
-- bidirectional, so no second row is needed.
-- ============================================================================

create or replace function public.request_friend(p_target uuid)
returns void language plpgsql security definer set search_path = public as $$
declare viewer uuid := auth.uid();
begin
  if viewer is null then
    raise exception 'unauthenticated' using errcode = '42501';
  end if;
  if p_target = viewer then
    raise exception 'لا يمكنك إضافة نفسك.' using errcode = '23514';
  end if;
  if not exists (select 1 from public.profiles where id = p_target) then
    raise exception 'المستخدم غير موجود.' using errcode = '23503';
  end if;

  -- If the target already requested the viewer, auto-accept instead.
  if exists (
    select 1 from public.friendships
    where requester_id = p_target and addressee_id = viewer and status = 'pending'
  ) then
    update public.friendships
      set status = 'accepted'
      where requester_id = p_target and addressee_id = viewer;
    return;
  end if;

  insert into public.friendships (requester_id, addressee_id, status)
  values (viewer, p_target, 'pending')
  on conflict (requester_id, addressee_id) do update
    set status = excluded.status, updated_at = now()
    where public.friendships.status = 'rejected';
end;
$$;

create or replace function public.respond_to_request(p_request_id uuid, p_accept boolean)
returns void language plpgsql security definer set search_path = public as $$
declare viewer uuid := auth.uid();
begin
  if viewer is null then
    raise exception 'unauthenticated' using errcode = '42501';
  end if;
  update public.friendships
    set status = case when p_accept then 'accepted' else 'rejected' end
    where id = p_request_id and addressee_id = viewer and status = 'pending';
  if not found then
    raise exception 'الطلب غير موجود أو لا يمكنك الرد عليه.' using errcode = '42501';
  end if;
end;
$$;

create or replace function public.cancel_friend(p_target uuid)
returns void language plpgsql security definer set search_path = public as $$
declare viewer uuid := auth.uid();
begin
  if viewer is null then
    raise exception 'unauthenticated' using errcode = '42501';
  end if;
  delete from public.friendships
    where status in ('pending','accepted')
      and ((requester_id = viewer and addressee_id = p_target)
        or (requester_id = p_target and addressee_id = viewer));
end;
$$;

grant execute on function public.request_friend(uuid) to authenticated;
grant execute on function public.respond_to_request(uuid, boolean) to authenticated;
grant execute on function public.cancel_friend(uuid) to authenticated;

-- ============================================================================
-- Profile search (for adding friends). Excludes self; returns friendship state
-- relative to the viewer + mutual friend count.
-- ============================================================================

create or replace function public.search_people(p_query text, p_limit int default 20)
returns table (
  id uuid, full_name text, username text, avatar_url text,
  relation text, mutual_count bigint
)
language plpgsql security definer set search_path = public as $$
declare viewer uuid := auth.uid();
begin
  if viewer is null then
    raise exception 'unauthenticated' using errcode = '42501';
  end if;
  return query
  with vf as (
    select case when requester_id = viewer then addressee_id else requester_id end as fid
    from public.friendships
    where status = 'accepted' and (requester_id = viewer or addressee_id = viewer)
  )
  select
    pr.id, pr.full_name, pr.username, pr.avatar_url,
    case
      when exists (
        select 1 from public.friendships f
        where f.status = 'accepted'
          and ((f.requester_id = viewer and f.addressee_id = pr.id)
            or (f.requester_id = pr.id and f.addressee_id = viewer))
      ) then 'friend'
      when exists (
        select 1 from public.friendships f
        where f.status = 'pending'
          and f.requester_id = viewer and f.addressee_id = pr.id
      ) then 'requested'
      when exists (
        select 1 from public.friendships f
        where f.status = 'pending'
          and f.requester_id = pr.id and f.addressee_id = viewer
      ) then 'incoming'
      else 'none'
    end as relation,
    (select count(*) from vf join public.friendships af
       on af.status = 'accepted'
      and ((af.requester_id = pr.id and af.addressee_id = vf.fid)
        or (af.requester_id = vf.fid and af.addressee_id = pr.id))
    )::bigint as mutual_count
  from public.profiles pr
  where pr.id <> viewer
    and (
      p_query = ''
      or pr.full_name ilike '%' || p_query || '%'
      or pr.username ilike '%' || p_query || '%'
    )
  order by
    (case when pr.full_name ilike p_query || '%' then 0 else 1 end),
    pr.full_name
  limit p_limit;
end;
$$;

grant execute on function public.search_people(text, int) to authenticated;

-- ============================================================================
-- Friend lists + incoming requests for the viewer (with mutual context).
-- ============================================================================

create or replace function public.my_friend_requests()
returns table (
  request_id uuid, user_id uuid, full_name text, username text, avatar_url text,
  mutual_count bigint, created_at timestamptz
)
language plpgsql security definer set search_path = public as $$
declare viewer uuid := auth.uid();
begin
  if viewer is null then
    raise exception 'unauthenticated' using errcode = '42501';
  end if;
  return query
  with vf as (
    select case when requester_id = viewer then addressee_id else requester_id end as fid
    from public.friendships
    where status = 'accepted' and (requester_id = viewer or addressee_id = viewer)
  )
  select
    f.id, pr.id, pr.full_name, pr.username, pr.avatar_url,
    (select count(*) from vf join public.friendships af
       on af.status = 'accepted'
      and ((af.requester_id = pr.id and af.addressee_id = vf.fid)
        or (af.requester_id = vf.fid and af.addressee_id = pr.id))
    )::bigint,
    f.created_at
  from public.friendships f
  join public.profiles pr on pr.id = f.requester_id
  where f.addressee_id = viewer and f.status = 'pending'
  order by f.created_at desc;
end;
$$;

grant execute on function public.my_friend_requests() to authenticated;

create or replace function public.my_friends()
returns table (
  user_id uuid, full_name text, username text, avatar_url text
)
language plpgsql security definer set search_path = public as $$
declare viewer uuid := auth.uid();
begin
  if viewer is null then
    raise exception 'unauthenticated' using errcode = '42501';
  end if;
  return query
  select
    case when f.requester_id = viewer then f.addressee_id else f.requester_id end,
    pr.full_name, pr.username, pr.avatar_url
  from public.friendships f
  join public.profiles pr
    on pr.id = (case when f.requester_id = viewer then f.addressee_id else f.requester_id end)
  where f.status = 'accepted'
    and (f.requester_id = viewer or f.addressee_id = viewer)
  order by pr.full_name;
end;
$$;

grant execute on function public.my_friends() to authenticated;
