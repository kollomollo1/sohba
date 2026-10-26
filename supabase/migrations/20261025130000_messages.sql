-- Direct messages between accepted friends.
create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references public.profiles(id) on delete cascade,
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  body text not null check (char_length(trim(body)) between 1 and 5000),
  created_at timestamptz not null default now(),
  read_at timestamptz,
  check (sender_id <> recipient_id)
);

create index if not exists messages_conversation_created_idx
  on public.messages (sender_id, recipient_id, created_at);
create index if not exists messages_recipient_created_idx
  on public.messages (recipient_id, created_at desc);

alter table public.messages enable row level security;
grant select, insert on public.messages to authenticated;
grant update (read_at) on public.messages to authenticated;

drop policy if exists "messages_select_participant" on public.messages;
create policy "messages_select_participant" on public.messages
  for select to authenticated
  using (auth.uid() = sender_id or auth.uid() = recipient_id);

drop policy if exists "messages_insert_friend" on public.messages;
create policy "messages_insert_friend" on public.messages
  for insert to authenticated
  with check (
    auth.uid() = sender_id
    and exists (
      select 1 from public.friendships f
      where f.status = 'accepted'
        and (
          (f.requester_id = sender_id and f.addressee_id = recipient_id)
          or (f.requester_id = recipient_id and f.addressee_id = sender_id)
        )
    )
  );

drop policy if exists "messages_mark_received_read" on public.messages;
create policy "messages_mark_received_read" on public.messages
  for update to authenticated
  using (auth.uid() = recipient_id)
  with check (auth.uid() = recipient_id);
