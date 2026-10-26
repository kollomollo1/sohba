-- Per-viewer post hiding, author muting, and full blocking.
create table if not exists public.user_content_filters (
  viewer_id uuid not null references public.profiles(id) on delete cascade,
  target_user_id uuid not null references public.profiles(id) on delete cascade,
  mode text not null check (mode in ('mute_posts', 'block_user')),
  created_at timestamptz not null default now(),
  primary key (viewer_id, target_user_id),
  check (viewer_id <> target_user_id)
);

create table if not exists public.hidden_posts (
  viewer_id uuid not null references public.profiles(id) on delete cascade,
  post_id uuid not null references public.posts(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (viewer_id, post_id)
);

alter table public.user_content_filters enable row level security;
alter table public.hidden_posts enable row level security;
grant select, insert, update, delete on public.user_content_filters to authenticated;
grant select, insert, delete on public.hidden_posts to authenticated;

drop policy if exists "user_content_filters_manage_own" on public.user_content_filters;
create policy "user_content_filters_manage_own" on public.user_content_filters
  for all to authenticated
  using (auth.uid() = viewer_id)
  with check (auth.uid() = viewer_id);

drop policy if exists "hidden_posts_manage_own" on public.hidden_posts;
create policy "hidden_posts_manage_own" on public.hidden_posts
  for all to authenticated
  using (auth.uid() = viewer_id)
  with check (auth.uid() = viewer_id);

create or replace function public.is_user_blocked(target uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.user_content_filters f
    where f.mode = 'block_user'
      and ((f.viewer_id = auth.uid() and f.target_user_id = target)
        or (f.viewer_id = target and f.target_user_id = auth.uid()))
  );
$$;
grant execute on function public.is_user_blocked(uuid) to authenticated;

create or replace function public.can_see_post(viewer uuid, p public.posts)
returns boolean language sql stable security definer set search_path = public as $$
  select viewer is not null
    and not exists (
      select 1 from public.user_content_filters f
      where (f.viewer_id = viewer and f.target_user_id = p.author_id)
         or (f.mode = 'block_user' and f.viewer_id = p.author_id and f.target_user_id = viewer)
    )
    and not exists (
      select 1 from public.hidden_posts h
      where h.viewer_id = viewer and h.post_id = p.id
    );
$$;
grant execute on function public.can_see_post(uuid, public.posts) to authenticated;

drop policy if exists "profiles_select" on public.profiles;
create policy "profiles_select" on public.profiles for select
  to authenticated using (
    auth.uid() = id
    or not public.is_user_blocked(id)
  );

create or replace function public.prevent_blocked_friendship()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if exists (
    select 1 from public.user_content_filters f
    where f.mode = 'block_user'
      and ((f.viewer_id = new.requester_id and f.target_user_id = new.addressee_id)
        or (f.viewer_id = new.addressee_id and f.target_user_id = new.requester_id))
  ) then
    raise exception 'لا يمكن إرسال طلب صداقة لهذا المستخدم.' using errcode = '42501';
  end if;
  return new;
end;
$$;
drop trigger if exists prevent_blocked_friendship_trigger on public.friendships;
create trigger prevent_blocked_friendship_trigger
  before insert or update on public.friendships
  for each row execute function public.prevent_blocked_friendship();
revoke execute on function public.prevent_blocked_friendship() from public, anon, authenticated;

drop policy if exists "messages_select_participant" on public.messages;
create policy "messages_select_participant" on public.messages
  for select to authenticated
  using (
    (auth.uid() = sender_id or auth.uid() = recipient_id)
    and not public.is_user_blocked(case when auth.uid() = sender_id then recipient_id else sender_id end)
  );

drop policy if exists "messages_insert_friend" on public.messages;
create policy "messages_insert_friend" on public.messages
  for insert to authenticated
  with check (
    auth.uid() = sender_id
    and not public.is_user_blocked(recipient_id)
    and (
      exists (
        select 1 from public.friendships f
        where f.status = 'accepted'
          and ((f.requester_id = sender_id and f.addressee_id = recipient_id)
            or (f.requester_id = recipient_id and f.addressee_id = sender_id))
      )
      or exists (
        select 1 from public.messages old_message
        where (old_message.sender_id = sender_id and old_message.recipient_id = recipient_id)
          or (old_message.sender_id = recipient_id and old_message.recipient_id = sender_id)
      )
    )
  );

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
      when exists (select 1 from public.friendships f where f.status = 'accepted'
        and ((f.requester_id = viewer and f.addressee_id = pr.id)
          or (f.requester_id = pr.id and f.addressee_id = viewer))) then 'friend'
      when exists (select 1 from public.friendships f where f.status = 'pending'
        and f.requester_id = viewer and f.addressee_id = pr.id) then 'requested'
      when exists (select 1 from public.friendships f where f.status = 'pending'
        and f.requester_id = pr.id and f.addressee_id = viewer) then 'incoming'
      else 'none'
    end as relation,
    (select count(*) from vf join public.friendships af
      on af.status = 'accepted'
      and ((af.requester_id = pr.id and af.addressee_id = vf.fid)
        or (af.requester_id = vf.fid and af.addressee_id = pr.id)))::bigint as mutual_count
  from public.profiles pr
  where pr.id <> viewer
    and not exists (select 1 from public.user_content_filters f
      where f.mode = 'block_user'
        and ((f.viewer_id = viewer and f.target_user_id = pr.id)
          or (f.viewer_id = pr.id and f.target_user_id = viewer)))
    and (p_query = '' or pr.full_name ilike '%' || p_query || '%' or pr.username ilike '%' || p_query || '%')
  order by (case when pr.full_name ilike p_query || '%' then 0 else 1 end), pr.full_name
  limit p_limit;
end;
$$;
grant execute on function public.search_people(text, int) to authenticated;

create or replace function public.my_blocked_users()
returns table (
  user_id uuid, full_name text, username text, avatar_url text, blocked_at timestamptz
)
language sql stable security definer set search_path = public as $$
  select p.id, p.full_name, p.username, p.avatar_url, f.created_at
  from public.user_content_filters f
  join public.profiles p on p.id = f.target_user_id
  where f.viewer_id = auth.uid() and f.mode = 'block_user'
  order by f.created_at desc;
$$;
grant execute on function public.my_blocked_users() to authenticated;

create or replace function public.my_friends()
returns table (user_id uuid, full_name text, username text, avatar_url text)
language plpgsql security definer set search_path = public as $$
declare viewer uuid := auth.uid();
begin
  if viewer is null then raise exception 'unauthenticated' using errcode = '42501'; end if;
  return query
  select case when f.requester_id = viewer then f.addressee_id else f.requester_id end,
         p.full_name, p.username, p.avatar_url
  from public.friendships f
  join public.profiles p on p.id = case when f.requester_id = viewer then f.addressee_id else f.requester_id end
  where f.status = 'accepted'
    and (f.requester_id = viewer or f.addressee_id = viewer)
    and not public.is_user_blocked(p.id)
  order by p.full_name;
end;
$$;
grant execute on function public.my_friends() to authenticated;

create or replace function public.my_friend_requests()
returns table (
  request_id uuid, user_id uuid, full_name text, username text, avatar_url text,
  mutual_count bigint, created_at timestamptz
)
language plpgsql security definer set search_path = public as $$
declare viewer uuid := auth.uid();
begin
  if viewer is null then raise exception 'unauthenticated' using errcode = '42501'; end if;
  return query
  with vf as (
    select case when requester_id = viewer then addressee_id else requester_id end as fid
    from public.friendships
    where status = 'accepted' and (requester_id = viewer or addressee_id = viewer)
  )
  select f.id, p.id, p.full_name, p.username, p.avatar_url,
    (select count(*) from vf join public.friendships af
      on af.status = 'accepted'
      and ((af.requester_id = p.id and af.addressee_id = vf.fid)
        or (af.requester_id = vf.fid and af.addressee_id = p.id)))::bigint,
    f.created_at
  from public.friendships f
  join public.profiles p on p.id = f.requester_id
  where f.addressee_id = viewer and f.status = 'pending'
    and not public.is_user_blocked(p.id)
  order by f.created_at desc;
end;
$$;
grant execute on function public.my_friend_requests() to authenticated;
