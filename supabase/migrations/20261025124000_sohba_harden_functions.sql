-- Revoke direct execute from authenticated on internal helper functions.
-- These are used by policies/triggers only, never called by the client.
revoke execute on function public.are_friends(uuid, uuid) from authenticated;
revoke execute on function public.have_mutual_friend(uuid, uuid) from authenticated;
-- The posts/likes/comments RLS policies invoke this helper directly, so the
-- authenticated role must retain EXECUTE. Its SECURITY DEFINER owner performs
-- the nested helper calls without exposing those helpers to clients.
grant execute on function public.can_see_post(uuid, public.posts) to authenticated;
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
