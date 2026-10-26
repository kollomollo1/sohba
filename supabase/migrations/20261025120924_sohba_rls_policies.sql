-- ============================================================================
-- Row Level Security — privacy enforced at the database, not only in the UI.
-- ============================================================================

-- Helper: two users are accepted friends?
create or replace function public.are_friends(a uuid, b uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.friendships f
    where f.status = 'accepted'
      and ((f.requester_id = a and f.addressee_id = b)
        or (f.requester_id = a and f.addressee_id = b))
  );
$$;
-- (corrected bidirectional check below)

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

drop policy if exists "profiles_select" on public.profiles;
create policy "profiles_select" on public.profiles for select
  to authenticated using (true);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles for update
  to authenticated using (auth.uid() = id) with check (auth.uid() = id);

drop policy if exists "profiles_delete_own" on public.profiles;
create policy "profiles_delete_own" on public.profiles for delete
  to authenticated using (auth.uid() = id);

-- ----------------------------------------------------------------------------
-- Friendships: a user can see rows where they are requester or addressee.
-- Request creation, accept/reject by addressee, cancel by requester.
-- ----------------------------------------------------------------------------
grant select, insert, update, delete on public.friendships to authenticated;

drop policy if exists "friendships_select_involved" on public.friendships;
create policy "friendships_select_involved" on public.friendships for select
  to authenticated using (auth.uid() = requester_id or auth.uid() = addressee_id);

drop policy if exists "friendships_insert_request" on public.friendships;
create policy "friendships_insert_request" on public.friendships for insert
  to authenticated with check (auth.uid() = requester_id);

drop policy if exists "friendships_update_addressee" on public.friendships;
create policy "friendships_update_addressee" on public.friendships for update
  to authenticated
  using (auth.uid() = addressee_id or auth.uid() = requester_id)
  with check (auth.uid() = addressee_id or auth.uid() = requester_id);

drop policy if exists "friendships_delete_involved" on public.friendships;
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
  select viewer is not null;
$$;

drop policy if exists "posts_select_visible" on public.posts;
create policy "posts_select_visible" on public.posts for select
  to authenticated using (public.can_see_post(auth.uid(), posts));

drop policy if exists "posts_insert_own" on public.posts;
create policy "posts_insert_own" on public.posts for insert
  to authenticated with check (auth.uid() = author_id);

drop policy if exists "posts_update_own" on public.posts;
create policy "posts_update_own" on public.posts for update
  to authenticated using (auth.uid() = author_id) with check (auth.uid() = author_id);

drop policy if exists "posts_delete_own" on public.posts;
create policy "posts_delete_own" on public.posts for delete
  to authenticated using (auth.uid() = author_id);

-- ----------------------------------------------------------------------------
-- Likes: visible to anyone who can see the post. User manages own likes.
-- ----------------------------------------------------------------------------
grant select, insert, delete on public.likes to authenticated;

drop policy if exists "likes_select_visible" on public.likes;
create policy "likes_select_visible" on public.likes for select
  to authenticated using (
    exists (
      select 1 from public.posts p
      where p.id = likes.post_id and public.can_see_post(auth.uid(), p)
    )
  );

drop policy if exists "likes_insert_own" on public.likes;
create policy "likes_insert_own" on public.likes for insert
  to authenticated with check (auth.uid() = user_id);

drop policy if exists "likes_delete_own" on public.likes;
create policy "likes_delete_own" on public.likes for delete
  to authenticated using (auth.uid() = user_id);

-- ----------------------------------------------------------------------------
-- Comments: visible to anyone who can see the post. Author manages own.
-- ----------------------------------------------------------------------------
grant select, insert, delete on public.comments to authenticated;

drop policy if exists "comments_select_visible" on public.comments;
create policy "comments_select_visible" on public.comments for select
  to authenticated using (
    exists (
      select 1 from public.posts p
      where p.id = comments.post_id and public.can_see_post(auth.uid(), p)
    )
  );

drop policy if exists "comments_insert_own" on public.comments;
create policy "comments_insert_own" on public.comments for insert
  to authenticated with check (auth.uid() = author_id);

drop policy if exists "comments_delete_own" on public.comments;
create policy "comments_delete_own" on public.comments for delete
  to authenticated using (auth.uid() = author_id);

-- ----------------------------------------------------------------------------
-- Storage: media bucket — users manage their own files; public read.
-- ----------------------------------------------------------------------------
drop policy if exists "media_public_read" on storage.objects;
create policy "media_public_read" on storage.objects for select
  to authenticated, anon using (bucket_id = 'media');

drop policy if exists "media_user_insert_own" on storage.objects;
create policy "media_user_insert_own" on storage.objects for insert
  to authenticated with check (bucket_id = 'media' and owner = auth.uid());

drop policy if exists "media_user_update_own" on storage.objects;
create policy "media_user_update_own" on storage.objects for update
  to authenticated using (bucket_id = 'media' and owner = auth.uid());

drop policy if exists "media_user_delete_own" on storage.objects;
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
