-- ============================================================================
-- Sohba — Temporarily disable admin approval for posts with images
-- 1. All new posts (with or without images) are immediately marked 'approved'
-- 2. Any currently pending posts are approved immediately
-- ============================================================================

-- 1. Update trigger function to immediately approve all posts
create or replace function public.set_post_approval_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- مؤقتاً: اعتماد جميع المنشورات والصور مباشرة بدون انتظار موافقة الإدارة
  new.status := 'approved';
  return new;
end;
$$;

-- 2. Approve any existing posts in pending_approval
update public.posts
set status = 'approved'
where status = 'pending_approval';
