-- ============================================================================
-- Feed RPC: returns the viewer's home feed.
--   - all posts visible to every authenticated app user
--   - urgent posts are pinned for 15 minutes, then ordered normally
--   - p_friends_only remains for API compatibility and is ignored
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
      and not exists (
        select 1 from public.user_content_filters f
        where (f.viewer_id = viewer and f.target_user_id = p.author_id)
          or (f.mode = 'block_user' and f.viewer_id = p.author_id and f.target_user_id = viewer)
      )
      and not exists (
        select 1 from public.hidden_posts h
        where h.viewer_id = viewer and h.post_id = p.id
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
        else 'community'
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
