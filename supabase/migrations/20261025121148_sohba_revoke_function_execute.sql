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
