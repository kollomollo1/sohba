-- Notify a post owner when another user likes or comments on their post.
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  actor_id uuid not null references public.profiles(id) on delete cascade,
  post_id uuid not null references public.posts(id) on delete cascade,
  type text not null check (type in ('like', 'comment')),
  comment_excerpt text,
  created_at timestamptz not null default now(),
  read_at timestamptz
);

create index if not exists notifications_recipient_created_idx
  on public.notifications (recipient_id, created_at desc);
create index if not exists notifications_unread_idx
  on public.notifications (recipient_id) where read_at is null;

alter table public.notifications enable row level security;
grant select on public.notifications to authenticated;
grant update (read_at) on public.notifications to authenticated;

drop policy if exists "notifications_select_own" on public.notifications;
create policy "notifications_select_own" on public.notifications
  for select to authenticated using (auth.uid() = recipient_id);

drop policy if exists "notifications_mark_own_read" on public.notifications;
create policy "notifications_mark_own_read" on public.notifications
  for update to authenticated
  using (auth.uid() = recipient_id)
  with check (auth.uid() = recipient_id);

create or replace function public.notify_post_interaction()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid;
  v_recipient uuid;
  v_type text;
  v_excerpt text;
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

  insert into public.notifications (recipient_id, actor_id, post_id, type, comment_excerpt)
  values (v_recipient, v_actor, new.post_id, v_type, v_excerpt);
  return new;
end;
$$;
revoke execute on function public.notify_post_interaction() from public, anon, authenticated;

drop trigger if exists notify_post_like on public.likes;
create trigger notify_post_like after insert on public.likes
  for each row execute function public.notify_post_interaction();

drop trigger if exists notify_post_comment on public.comments;
create trigger notify_post_comment after insert on public.comments
  for each row execute function public.notify_post_interaction();
