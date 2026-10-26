-- Add unread-message status for projects where the original messages migration ran.
alter table public.messages add column if not exists read_at timestamptz;
grant update (read_at) on public.messages to authenticated;

drop policy if exists "messages_mark_received_read" on public.messages;
create policy "messages_mark_received_read" on public.messages
  for update to authenticated
  using (auth.uid() = recipient_id)
  with check (auth.uid() = recipient_id);
