-- ============================================================================
-- Enable Image Uploads with Admin Approval
-- 1. Storage policies to allow uploading images to 'posts/<uid>/...'
-- 2. Add 'status' column to public.posts ('approved', 'pending_approval', 'rejected')
-- 3. Trigger: any post with an image_url is automatically marked 'pending_approval'
-- 4. RLS & feed(): only show approved posts (or author's own posts)
-- 5. Admin RPCs: admin_pending_posts(), admin_approve_post(), admin_reject_post()
-- ============================================================================

-- 1. Storage bucket & policies
insert into storage.buckets (id, name, public)
values ('media', 'media', true)
on conflict (id) do update set public = true;

drop trigger if exists posts_reject_images on public.posts;

drop policy if exists "media_user_insert_own_post_image" on storage.objects;
create policy "media_user_insert_own_post_image" on storage.objects for insert
  to authenticated with check (
    bucket_id = 'media'
    and owner = auth.uid()
    and (storage.foldername(name))[1] = 'posts'
    and (storage.foldername(name))[2] = auth.uid()::text
  );

drop policy if exists "media_user_update_own_post_image" on storage.objects;
create policy "media_user_update_own_post_image" on storage.objects for update
  to authenticated using (
    bucket_id = 'media'
    and owner = auth.uid()
    and (storage.foldername(name))[1] = 'posts'
    and (storage.foldername(name))[2] = auth.uid()::text
  );

drop policy if exists "media_user_delete_own_post_image" on storage.objects;
create policy "media_user_delete_own_post_image" on storage.objects for delete
  to authenticated using (
    bucket_id = 'media'
    and (
      (owner = auth.uid() and (storage.foldername(name))[1] = 'posts')
      or coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') = 'admin'
    )
  );

drop policy if exists "media_public_read_all" on storage.objects;
create policy "media_public_read_all" on storage.objects for select
  to authenticated, anon using (bucket_id = 'media');

-- 2. Add status column to posts
alter table public.posts
  add column if not exists status text not null default 'approved';

update public.posts set status = 'approved' where status is null;

-- 3. Trigger for image posts
create or replace function public.set_post_approval_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.image_url is not null and btrim(new.image_url) <> '' then
    if coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') <> 'admin' then
      new.status := 'pending_approval';
    else
      new.status := coalesce(new.status, 'approved');
    end if;
  else
    new.status := 'approved';
  end if;
  return new;
end;
$$;

drop trigger if exists post_approval_status_trigger on public.posts;
create trigger post_approval_status_trigger
before insert on public.posts
for each row execute function public.set_post_approval_status();

-- 4. RLS & visibility
create or replace function public.can_see_post(viewer uuid, p public.posts)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select viewer is not null
    and p.created_at >= now() - interval '24 hours'
    and (
      p.status = 'approved'
      or p.author_id = viewer
      or coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') = 'admin'
    );
$$;

drop policy if exists "posts_select_visible" on public.posts;
create policy "posts_select_visible" on public.posts for select
  to authenticated using (public.can_see_post(auth.uid(), posts));

-- Update feed()
drop function if exists public.feed(int, timestamptz, boolean);

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
  viewer_liked boolean,
  status text
)
language plpgsql security definer set search_path = public as $$
declare
  viewer uuid := auth.uid();
begin
  if viewer is null then
    raise exception 'unauthenticated' using errcode = '42501';
  end if;

  perform public.delete_expired_posts();

  return query
  with visible_posts as (
    select p.id, p.author_id, p.body, p.image_url, p.is_urgent, p.created_at, p.status
    from public.posts p
    where p.created_at <= p_cursor
      and p.created_at >= now() - interval '24 hours'
      and (p.status = 'approved' or p.author_id = viewer)
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
    select case when fr.requester_id = viewer then fr.addressee_id else fr.requester_id end as fid
    from public.friendships fr
    where fr.status = 'accepted' and (fr.requester_id = viewer or fr.addressee_id = viewer)
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
    agg.viewer_liked,
    vp.status
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

-- 5. Admin management RPCs
create or replace function public.admin_pending_posts()
returns table (
  id uuid,
  author_id uuid,
  body text,
  image_url text,
  is_urgent boolean,
  created_at timestamptz,
  status text,
  author_name text,
  author_username text,
  author_avatar text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') <> 'admin' then
    raise exception 'admin role required' using errcode = '42501';
  end if;

  return query
  select
    p.id, p.author_id, p.body, p.image_url, p.is_urgent, p.created_at, p.status,
    pr.full_name as author_name,
    pr.username as author_username,
    pr.avatar_url as author_avatar
  from public.posts p
  join public.profiles pr on pr.id = p.author_id
  where p.status = 'pending_approval'
  order by p.created_at desc;
end;
$$;

create or replace function public.admin_approve_post(p_post_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_post public.posts%rowtype;
begin
  if coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') <> 'admin' then
    raise exception 'admin role required' using errcode = '42501';
  end if;

  update public.posts
  set status = 'approved',
      created_at = now()
  where id = p_post_id
  returning * into v_post;

  if v_post.is_urgent then
    update public.profiles
    set last_urgent_post_at = now()
    where id = v_post.author_id;
  end if;

  return true;
end;
$$;

create or replace function public.admin_reject_post(p_post_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') <> 'admin' then
    raise exception 'admin role required' using errcode = '42501';
  end if;

  delete from public.posts
  where id = p_post_id;

  return true;
end;
$$;

grant execute on function public.admin_pending_posts() to authenticated;
grant execute on function public.admin_approve_post(uuid) to authenticated;
grant execute on function public.admin_reject_post(uuid) to authenticated;
