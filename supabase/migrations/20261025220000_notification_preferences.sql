-- Per-account notification preferences; enabled by default to preserve current behavior.
alter table public.profiles
  add column if not exists notify_comments boolean not null default true,
  add column if not exists notify_likes boolean not null default true;

grant update (notify_comments, notify_likes) on public.profiles to authenticated;

create or replace function public.notify_post_interaction()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid;
  v_recipient uuid;
  v_type text;
  v_excerpt text;
  v_enabled boolean;
begin
  if tg_table_name = 'likes' then
    v_actor := new.user_id;
    v_type := 'like';
  else
    v_actor := new.author_id;
    v_type := 'comment';
    v_excerpt := left(new.body, 120);
  end if;

  select p.author_id into v_recipient from public.posts p where p.id = new.post_id;
  if v_recipient is null or v_recipient = v_actor then return new; end if;

  select case when v_type = 'like' then pr.notify_likes else pr.notify_comments end
    into v_enabled from public.profiles pr where pr.id = v_recipient;
  if not coalesce(v_enabled, true) then return new; end if;

  insert into public.notifications (recipient_id, actor_id, post_id, type, comment_excerpt)
  values (v_recipient, v_actor, new.post_id, v_type, v_excerpt);
  return new;
end;
$$;

revoke execute on function public.notify_post_interaction() from public, anon, authenticated;
