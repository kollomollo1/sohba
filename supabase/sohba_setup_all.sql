-- Sohba Supabase setup (reviewed bundle)
-- Run only on the NEW, empty Supabase project named sohba.
-- This script creates tables, functions, policies, triggers, and the media bucket.
-- Do not run twice. Back up existing data before any re-run.



-- ============================================================================
-- MIGRATION: 20261025120850_sohba_core_schema.sql
-- ============================================================================

-- ============================================================================
-- Sohba (صُحبة) — core schema
-- Arabic RTL social network: profiles, friendships, posts, likes, comments,
-- urgent posts (1 / 24h), and a feed that surfaces friends + friends-of-friends
-- with friendship context. Privacy is enforced here via RLS, not only in the UI.
-- ============================================================================

create extension if not exists "pgcrypto";

-- ----------------------------------------------------------------------------
-- Profiles
-- ----------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  username text not null,
  bio text,
  avatar_url text,
  friends_only_feed boolean not null default false,
  last_urgent_post_at timestamptz,
  created_at timestamptz not null default now()
);

create unique index profiles_username_key on public.profiles (lower(username));

-- ----------------------------------------------------------------------------
-- Friendships (bidirectional; one row per directed relationship)
-- status: pending -> accepted | rejected. requester_id initiates.
-- ----------------------------------------------------------------------------
create table public.friendships (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references public.profiles(id) on delete cascade,
  addressee_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','accepted','rejected')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (requester_id, addressee_id),
  check (requester_id <> addressee_id)
);

create index friendships_addressee_idx on public.friendships (addressee_id, status);
create index friendships_requester_idx on public.friendships (requester_id, status);

-- ----------------------------------------------------------------------------
-- Posts
-- ----------------------------------------------------------------------------
create table public.posts (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references public.profiles(id) on delete cascade,
  body text not null default '',
  image_url text,
  is_urgent boolean not null default false,
  created_at timestamptz not null default now()
);

create index posts_author_created_idx on public.posts (author_id, created_at desc);
create index posts_created_idx on public.posts (created_at desc);

-- ----------------------------------------------------------------------------
-- Likes
-- ----------------------------------------------------------------------------
create table public.likes (
  post_id uuid not null references public.posts(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

create index likes_post_idx on public.likes (post_id);
create index likes_user_idx on public.likes (user_id);

-- ----------------------------------------------------------------------------
-- Comments
-- ----------------------------------------------------------------------------
create table public.comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now()
);

create index comments_post_created_idx on public.comments (post_id, created_at);

-- ----------------------------------------------------------------------------
-- Storage bucket for post images & avatars
-- ----------------------------------------------------------------------------
insert into storage.buckets (id, name, public) values ('media', 'media', true)
  on conflict (id) do nothing;

-- ----------------------------------------------------------------------------
-- updated_at trigger for friendships
-- ----------------------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger friendships_touch_updated_at
  before update on public.friendships
  for each row execute function public.touch_updated_at();



-- ============================================================================
-- MIGRATION: 20261025120924_sohba_rls_policies.sql
-- ============================================================================

-- ============================================================================
-- Row Level Security — privacy enforced at the database, not only in the UI.
-- ============================================================================

-- Helper: two users are accepted friends (bidirectional).
create or replace function public.are_friends(a uuid, b uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.friendships f
    where f.status = 'accepted'
      and (
        (f.requester_id = a and f.addressee_id = b)
        or (f.requester_id = b and f.addressee_id = a)
      )
  );
$$;

-- Helper: does viewer have any accepted friend in common with target?
create or replace function public.have_mutual_friend(viewer uuid, target uuid)
returns boolean language sql stable security definer set search_path = public as $$
  with viewer_friends as (
    select case when requester_id = viewer then addressee_id else requester_id end as fid
    from public.friendships
    where status = 'accepted' and (requester_id = viewer or addressee_id = viewer)
  ),
  target_friends as (
    select case when requester_id = target then addressee_id else requester_id end as fid
    from public.friendships
    where status = 'accepted' and (requester_id = target or addressee_id = target)
  )
  select exists (select 1 from viewer_friends vf join target_friends tf on vf.fid = tf.fid);
$$;

-- ----------------------------------------------------------------------------
-- Enable RLS everywhere
-- ----------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.friendships enable row level security;
alter table public.posts enable row level security;
alter table public.likes enable row level security;
alter table public.comments enable row level security;

-- ----------------------------------------------------------------------------
-- Profiles: anyone authenticated can view (needed for feed/author info);
-- writes are owner-only. friend status / feed prefs are not sensitive.
-- ----------------------------------------------------------------------------
grant select on public.profiles to authenticated;
grant update (full_name, username, bio, avatar_url, friends_only_feed) on public.profiles to authenticated;
grant delete on public.profiles to authenticated;

create policy "profiles_select" on public.profiles for select
  to authenticated using (true);

create policy "profiles_update_own" on public.profiles for update
  to authenticated using (auth.uid() = id) with check (auth.uid() = id);

create policy "profiles_delete_own" on public.profiles for delete
  to authenticated using (auth.uid() = id);

-- ----------------------------------------------------------------------------
-- Friendships: a user can see rows where they are requester or addressee.
-- Request creation, accept/reject by addressee, cancel by requester.
-- ----------------------------------------------------------------------------
grant select, insert, delete on public.friendships to authenticated;
-- Status transitions are performed only through validated SECURITY DEFINER RPCs.
-- Do not grant direct UPDATE: otherwise a requester could accept their own request.

create policy "friendships_select_involved" on public.friendships for select
  to authenticated using (auth.uid() = requester_id or auth.uid() = addressee_id);

create policy "friendships_insert_request" on public.friendships for insert
  to authenticated with check (auth.uid() = requester_id);

-- No direct UPDATE policy: use request_friend/respond_to_request/cancel_friend RPCs.

create policy "friendships_delete_involved" on public.friendships for delete
  to authenticated using (auth.uid() = requester_id or auth.uid() = addressee_id);

-- ----------------------------------------------------------------------------
-- Posts: visible to author, accepted friends, and friends-of-friends (FoF).
-- If the author has friends_only_feed = true, FoF cannot see their posts.
-- Urgent posts are still subject to the same visibility rules.
-- ----------------------------------------------------------------------------
grant select, insert, update, delete on public.posts to authenticated;

create or replace function public.can_see_post(viewer uuid, p public.posts)
returns boolean language sql stable security definer set search_path = public as $$
  select
    p.author_id = viewer
    or public.are_friends(viewer, p.author_id)
    or (
      not exists (select 1 from public.profiles pr where pr.id = p.author_id and pr.friends_only_feed)
      and public.have_mutual_friend(viewer, p.author_id)
    );
$$;

create policy "posts_select_visible" on public.posts for select
  to authenticated using (public.can_see_post(auth.uid(), posts));

create policy "posts_insert_own" on public.posts for insert
  to authenticated with check (auth.uid() = author_id);

create policy "posts_update_own" on public.posts for update
  to authenticated using (auth.uid() = author_id) with check (auth.uid() = author_id);

create policy "posts_delete_own" on public.posts for delete
  to authenticated using (auth.uid() = author_id);

-- ----------------------------------------------------------------------------
-- Likes: visible to anyone who can see the post. User manages own likes.
-- ----------------------------------------------------------------------------
grant select, insert, delete on public.likes to authenticated;

create policy "likes_select_visible" on public.likes for select
  to authenticated using (
    exists (
      select 1 from public.posts p
      where p.id = likes.post_id and public.can_see_post(auth.uid(), p)
    )
  );

create policy "likes_insert_own" on public.likes for insert
  to authenticated with check (auth.uid() = user_id);

create policy "likes_delete_own" on public.likes for delete
  to authenticated using (auth.uid() = user_id);

-- ----------------------------------------------------------------------------
-- Comments: visible to anyone who can see the post. Author manages own.
-- ----------------------------------------------------------------------------
grant select, insert, delete on public.comments to authenticated;

create policy "comments_select_visible" on public.comments for select
  to authenticated using (
    exists (
      select 1 from public.posts p
      where p.id = comments.post_id and public.can_see_post(auth.uid(), p)
    )
  );

create policy "comments_insert_own" on public.comments for insert
  to authenticated with check (auth.uid() = author_id);

create policy "comments_delete_own" on public.comments for delete
  to authenticated using (auth.uid() = author_id);

-- ----------------------------------------------------------------------------
-- Storage: media bucket — users manage their own files; public read.
-- ----------------------------------------------------------------------------
create policy "media_public_read" on storage.objects for select
  to authenticated, anon using (bucket_id = 'media');

create policy "media_user_insert_own" on storage.objects for insert
  to authenticated with check (bucket_id = 'media' and owner = auth.uid());

create policy "media_user_update_own" on storage.objects for update
  to authenticated using (bucket_id = 'media' and owner = auth.uid());

create policy "media_user_delete_own" on storage.objects for delete
  to authenticated using (bucket_id = 'media' and owner = auth.uid());

-- ----------------------------------------------------------------------------
-- Revoke execute on helper functions from anon/authenticated (they're used
-- internally by policies / SECURITY DEFINER RPCs, not called directly).
-- ----------------------------------------------------------------------------
revoke execute on function public.are_friends(uuid, uuid) from public, anon;
revoke execute on function public.have_mutual_friend(uuid, uuid) from public, anon;
revoke execute on function public.can_see_post(uuid, public.posts) from public, anon;
revoke execute on function public.touch_updated_at() from public, anon, authenticated;



-- ============================================================================
-- MIGRATION: 20261025120948_sohba_urgent_quota.sql
-- ============================================================================

-- ============================================================================
-- Urgent-post quota: at most ONE urgent post per user per 24 hours, enforced
-- at the database regardless of what the client sends. Also stamps the
-- last_urgent_post_at counter on the profile.
-- ============================================================================

create or replace function public.enforce_urgent_quota()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  last_urgent timestamptz;
begin
  if new.is_urgent then
    -- Serialize concurrent urgent-post attempts for the same user.
    select p.last_urgent_post_at into last_urgent
    from public.profiles p where p.id = new.author_id
    for update;

    if last_urgent is not null and now() - last_urgent < interval '24 hours' then
      raise exception 'عذراً، يمكنك نشر منشور عاجل واحد كل 24 ساعة.'
        using errcode = 'check_violation';
    end if;

    update public.profiles
      set last_urgent_post_at = now()
      where id = new.author_id;
  else
    -- if editing an urgent post to non-urgent, don't reset the counter
    null;
  end if;
  return new;
end;
$$;

create trigger posts_urgent_quota_trigger
  before insert or update of is_urgent on public.posts
  for each row execute function public.enforce_urgent_quota();

revoke execute on function public.enforce_urgent_quota() from public, anon, authenticated;



-- ============================================================================
-- MIGRATION: 20261025121022_sohba_feed_rpcs.sql
-- ============================================================================

-- ============================================================================
-- Feed RPC: returns the viewer's home feed.
--   - friends + friends-of-friends posts (respecting friends_only_feed)
--   - urgent posts sorted to the top within the visible window
--   - optional filter: friends_only (overrides FoF inclusion)
--   - returns author info, friendship context label, like/comment counts,
--     and whether the viewer has liked each post.
-- Friendship context (ctx_kind):
--   'self'            viewer is the author
--   'friend'          direct accepted friend
--   'friend_of_friend' FoF (one mutual friend) — includes ctx_mutual_name
--   'mutual_friend'    viewer & author share a direct mutual friend (named)
-- ============================================================================

create or replace function public.feed(
  p_limit int default 20,
  p_cursor timestamptz default now(),
  p_friends_only boolean default false
)
returns table (
  id uuid,
  author_id uuid,
  body text,
  image_url text,
  is_urgent boolean,
  created_at timestamptz,
  author_name text,
  author_username text,
  author_avatar text,
  ctx_kind text,
  ctx_mutual_name text,
  like_count bigint,
  comment_count bigint,
  viewer_liked boolean
)
language plpgsql security definer set search_path = public as $$
declare
  viewer uuid := auth.uid();
begin
  if viewer is null then
    raise exception 'unauthenticated' using errcode = '42501';
  end if;

  return query
  with visible_posts as (
    select p.id, p.author_id, p.body, p.image_url, p.is_urgent, p.created_at
    from public.posts p
    where p.created_at <= p_cursor
      and (
        p.author_id = viewer
        or public.are_friends(viewer, p.author_id)
        or (
          (not p_friends_only)
          and not exists (
            select 1 from public.profiles pr
            where pr.id = p.author_id and pr.friends_only_feed
          )
          and public.have_mutual_friend(viewer, p.author_id)
        )
      )
  ),
  viewer_friends as (
    select case when requester_id = viewer then addressee_id else requester_id end as fid
    from public.friendships
    where status = 'accepted' and (requester_id = viewer or addressee_id = viewer)
  ),
  author_friends as (
    select
      vp.id as post_id,
      case when f.requester_id = vp.author_id then f.addressee_id else f.requester_id end as fid
    from visible_posts vp
    join public.friendships f
      on f.status = 'accepted'
     and (f.requester_id = vp.author_id or f.addressee_id = vp.author_id)
  ),
  -- one mutual friend name per post (first one found)
  mutual as (
    select distinct on (af.post_id)
      af.post_id,
      pr.full_name as mutual_name
    from author_friends af
    join viewer_friends vf on af.fid = vf.fid
    join public.profiles pr on pr.id = af.fid
    where af.fid <> viewer
    order by af.post_id, pr.full_name
  ),
  ctx as (
    select
      vp.id,
      case
        when vp.author_id = viewer then 'self'
        when public.are_friends(viewer, vp.author_id) then 'friend'
        else 'friend_of_friend'
      end as kind,
      m.mutual_name
    from visible_posts vp
    left join mutual m on m.post_id = vp.id
  ),
  agg as (
    select
      p.id,
      count(l.post_id) as like_count,
      count(distinct c.id) as comment_count,
      exists(select 1 from public.likes l where l.post_id = p.id and l.user_id = viewer) as viewer_liked
    from visible_posts p
    left join public.likes l on l.post_id = p.id
    left join public.comments c on c.post_id = p.id
    group by p.id
  )
  select
    vp.id, vp.author_id, vp.body, vp.image_url, vp.is_urgent, vp.created_at,
    pr.full_name, pr.username, pr.avatar_url,
    ctx.kind,
    ctx.mutual_name,
    agg.like_count,
    agg.comment_count,
    agg.viewer_liked
  from visible_posts vp
  join public.profiles pr on pr.id = vp.author_id
  join ctx on ctx.id = vp.id
  join agg on agg.id = vp.id
  order by
    (case when vp.is_urgent and vp.created_at >= now() - interval '15 minutes' then 0 else 1 end),
    vp.created_at desc
  limit p_limit;
end;
$$;

grant execute on function public.feed(int, timestamptz, boolean) to authenticated;

-- ----------------------------------------------------------------------------
-- Comments list for a single post (with author info), respects post visibility.
-- ----------------------------------------------------------------------------
create or replace function public.post_comments(p_post_id uuid)
returns table (
  id uuid, author_id uuid, body text, created_at timestamptz,
  author_name text, author_username text, author_avatar text
)
language plpgsql security definer set search_path = public as $$
declare
  viewer uuid := auth.uid();
begin
  if viewer is null then
    raise exception 'unauthenticated' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.posts p
    where p.id = p_post_id and public.can_see_post(viewer, p)
  ) then
    raise exception 'not visible' using errcode = '42501';
  end if;

  return query
  select c.id, c.author_id, c.body, c.created_at,
         pr.full_name, pr.username, pr.avatar_url
  from public.comments c
  join public.profiles pr on pr.id = c.author_id
  where c.post_id = p_post_id
  order by c.created_at asc;
end;
$$;

grant execute on function public.post_comments(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- Like count + viewer_liked for a single post (convenience).
-- ----------------------------------------------------------------------------
create or replace function public.post_likes(p_post_id uuid)
returns table (like_count bigint, viewer_liked boolean)
language plpgsql security definer set search_path = public as $$
declare viewer uuid := auth.uid();
begin
  if viewer is null then
    raise exception 'unauthenticated' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.posts p
    where p.id = p_post_id and public.can_see_post(viewer, p)
  ) then
    raise exception 'not visible' using errcode = '42501';
  end if;
  return query
  select count(*)::bigint,
         exists(select 1 from public.likes l where l.post_id = p_post_id and l.user_id = viewer);
end;
$$;

grant execute on function public.post_likes(uuid) to authenticated;



-- ============================================================================
-- MIGRATION: 20261025121107_sohba_friendship_rpcs.sql
-- ============================================================================

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



-- ============================================================================
-- MIGRATION: 20261025121148_sohba_revoke_function_execute.sql
-- ============================================================================

-- Revoke execute from PUBLIC/anon on all SECURITY DEFINER functions so only
-- authenticated callers (or internal policy use) can reach them.
revoke execute on function public.touch_updated_at() from public, anon;
revoke execute on function public.handle_new_user() from public, anon;
revoke execute on function public.enforce_urgent_quota() from public, anon;
revoke execute on function public.are_friends(uuid, uuid) from public, anon;
revoke execute on function public.have_mutual_friend(uuid, uuid) from public, anon;
revoke execute on function public.can_see_post(uuid, public.posts) from public, anon;
revoke execute on function public.feed(int, timestamptz, boolean) from public, anon;
revoke execute on function public.post_comments(uuid) from public, anon;
revoke execute on function public.post_likes(uuid) from public, anon;
revoke execute on function public.request_friend(uuid) from public, anon;
revoke execute on function public.respond_to_request(uuid, boolean) from public, anon;
revoke execute on function public.cancel_friend(uuid) from public, anon;
revoke execute on function public.search_people(text, int) from public, anon;
revoke execute on function public.my_friend_requests() from public, anon;
revoke execute on function public.my_friends() from public, anon;



-- ============================================================================
-- MIGRATION: 20261025124000_sohba_harden_functions.sql
-- ============================================================================

-- Revoke direct execute from authenticated on internal helper functions.
-- These are used by policies/triggers only, never called by the client.
revoke execute on function public.are_friends(uuid, uuid) from authenticated;
revoke execute on function public.have_mutual_friend(uuid, uuid) from authenticated;
revoke execute on function public.can_see_post(uuid, public.posts) from authenticated;
revoke execute on function public.touch_updated_at() from authenticated;
revoke execute on function public.handle_new_user() from authenticated;
revoke execute on function public.enforce_urgent_quota() from authenticated;

-- Pin search_path explicitly on SECURITY DEFINER functions to silence the
-- mutable-search_path warning (defense in depth against schema spoofing).
alter function public.are_friends(uuid, uuid) set search_path = public;
alter function public.have_mutual_friend(uuid, uuid) set search_path = public;
alter function public.can_see_post(uuid, public.posts) set search_path = public;
alter function public.touch_updated_at() set search_path = public;
alter function public.handle_new_user() set search_path = public;
alter function public.enforce_urgent_quota() set search_path = public;
alter function public.feed(int, timestamptz, boolean) set search_path = public;
alter function public.post_comments(uuid) set search_path = public;
alter function public.post_likes(uuid) set search_path = public;
alter function public.request_friend(uuid) set search_path = public;
alter function public.respond_to_request(uuid, boolean) set search_path = public;
alter function public.cancel_friend(uuid) set search_path = public;
alter function public.search_people(text, int) set search_path = public;
alter function public.my_friend_requests() set search_path = public;
alter function public.my_friends() set search_path = public;

