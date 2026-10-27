-- ============================================================================
-- Sohba (صُحبة) — Cloudinary Deletion Queue & Automated Cleanup Triggers
-- ============================================================================

-- 1. Ensure image_public_id column exists on public.posts
alter table public.posts
  add column if not exists image_public_id text;

create index if not exists posts_image_public_id_idx
  on public.posts (image_public_id)
  where image_public_id is not null;

-- 2. Create deletion queue table
create table if not exists public.cloudinary_deletion_queue (
  id uuid primary key default gen_random_uuid(),
  post_id uuid,
  author_id uuid,
  image_public_id text not null,
  image_url text,
  status text not null default 'pending' check (status in ('pending', 'processing', 'completed', 'failed', 'skipped', 'dead_letter')),
  attempts integer not null default 0,
  last_attempt_at timestamptz,
  next_retry_at timestamptz default now(),
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Immediately enable Row Level Security on the table
alter table public.cloudinary_deletion_queue enable row level security;

-- Admin read policy
drop policy if exists "admin_read_cloudinary_queue" on public.cloudinary_deletion_queue;
create policy "admin_read_cloudinary_queue"
  on public.cloudinary_deletion_queue
  for select
  to authenticated
  using (public.is_current_user_admin());

create index if not exists idx_cloudinary_queue_status_retry
  on public.cloudinary_deletion_queue (status, next_retry_at)
  where status in ('pending', 'failed');

create index if not exists idx_cloudinary_queue_public_id
  on public.cloudinary_deletion_queue (image_public_id);

create index if not exists idx_cloudinary_queue_post_id
  on public.cloudinary_deletion_queue (post_id);

-- 3. Trigger function to automatically enqueue Cloudinary images on ANY post deletion
create or replace function public.on_post_deleted_enqueue_cloudinary()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_public_id text := old.image_public_id;
begin
  -- If image_public_id is null/empty, extract from image_url if it's a Cloudinary URL
  if (v_public_id is null or v_public_id = '') and old.image_url is not null then
    if old.image_url like '%cloudinary.com%' then
      -- Matches /upload/(v[0-9]+/)?(sohba/posts/...)
      v_public_id := substring(old.image_url from '/upload/(?:v[0-9]+/)?([^.?#]+)');
    end if;
  end if;

  -- Only enqueue if this is a Sohba post image under sohba/posts/
  if v_public_id is not null and v_public_id <> '' and v_public_id like 'sohba/posts/%' then
    insert into public.cloudinary_deletion_queue (
      post_id,
      author_id,
      image_public_id,
      image_url,
      status,
      created_at,
      updated_at
    ) values (
      old.id,
      old.author_id,
      v_public_id,
      old.image_url,
      'pending',
      now(),
      now()
    );
  end if;

  return old;
end;
$$;

drop trigger if exists trg_post_deleted_enqueue_cloudinary on public.posts;
create trigger trg_post_deleted_enqueue_cloudinary
  before delete on public.posts
  for each row
  execute function public.on_post_deleted_enqueue_cloudinary();

-- 4. Queue retrieval and update RPCs
create or replace function public.get_pending_cloudinary_deletions(p_limit int default 50)
returns setof public.cloudinary_deletion_queue
language sql
security definer
stable
set search_path = public
as $$
  select *
  from public.cloudinary_deletion_queue
  where status in ('pending', 'failed')
    and attempts < 5
    and (next_retry_at is null or next_retry_at <= now())
  order by created_at asc
  limit coalesce(p_limit, 50);
$$;

create or replace function public.update_cloudinary_queue_item(
  p_id uuid,
  p_status text,
  p_error text default null,
  p_attempts int default null,
  p_next_retry timestamptz default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.cloudinary_deletion_queue
  set
    status = p_status,
    error_message = p_error,
    attempts = coalesce(p_attempts, attempts),
    next_retry_at = p_next_retry,
    last_attempt_at = now(),
    updated_at = now()
  where id = p_id;
end;
$$;

-- Note: written in pure SQL to avoid Supabase linter false-positives
create or replace function public.get_cloudinary_queue_stats()
returns json
language sql
security definer
stable
set search_path = public
as $$
  select json_build_object(
    'pending', count(*) filter (where status = 'pending'),
    'failed', count(*) filter (where status = 'failed'),
    'completed', count(*) filter (where status = 'completed'),
    'skipped', count(*) filter (where status = 'skipped'),
    'dead_letter', count(*) filter (where status = 'dead_letter'),
    'total', count(*)
  )
  from public.cloudinary_deletion_queue;
$$;

grant execute on function public.get_pending_cloudinary_deletions(int) to authenticated, service_role;
grant execute on function public.update_cloudinary_queue_item(uuid, text, text, int, timestamptz) to authenticated, service_role;
grant execute on function public.get_cloudinary_queue_stats() to authenticated, service_role;
