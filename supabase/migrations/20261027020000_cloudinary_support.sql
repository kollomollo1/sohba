-- ============================================================================
-- Sohba (صُحبة) — Cloudinary integration support
-- Adds optional image_public_id column to public.posts for Cloudinary images
-- ============================================================================

alter table public.posts
  add column if not exists image_public_id text;

create index if not exists posts_image_public_id_idx
  on public.posts (image_public_id)
  where image_public_id is not null;
