-- ============================================================================
-- Auto-delete posts after 24 hours
-- 1. Function public.delete_expired_posts() to delete posts older than 24h
-- 2. Cron schedule every 10 minutes to auto-purge expired posts
-- 3. Update public.can_see_post() to only allow viewing posts < 24h old
-- 4. Update public.feed() RPC to auto-purge and filter posts >= now() - 24 hours
-- 5. Purge any currently expired posts immediately
-- ============================================================================

-- 1. Cleanup function
create or replace function public.delete_expired_posts()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  delete from public.posts p
  where p.created_at < now() - interval '24 hours';

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke execute on function public.delete_expired_posts() from public, anon;
grant execute on function public.delete_expired_posts() to authenticated, service_role;

-- 2. Cron job every 10 minutes
create extension if not exists pg_cron;

do $$
begin
  perform cron.unschedule('sohba-cleanup-expired-posts');
exception when others then
  null;
end;
$$;

select cron.schedule(
  'sohba-cleanup-expired-posts',
  '*/10 * * * *',
  'select public.delete_expired_posts();'
);

-- 3. RLS visibility check: hide posts older than 24 hours
create or replace function public.can_see_post(viewer uuid, p public.posts)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select viewer is not null and p.created_at >= now() - interval '24 hours';
$$;

drop policy if exists "posts_select_visible" on public.posts;
create policy "posts_select_visible" on public.posts for select
  to authenticated using (public.can_see_post(auth.uid(), posts));

-- 4. Update feed() RPC to purge expired posts and enforce 24h window
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

  -- Inline cleanup whenever feed is fetched
  perform public.delete_expired_posts();

  return query
  with visible_posts as (
    select p.id, p.author_id, p.body, p.image_url, p.is_urgent, p.created_at
    from public.posts p
    where p.created_at <= p_cursor
      and p.created_at >= now() - interval '24 hours'
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

-- 5. Delete existing posts older than 24 hours right now
delete from public.posts p where p.created_at < now() - interval '24 hours';
