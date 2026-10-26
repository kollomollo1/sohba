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
