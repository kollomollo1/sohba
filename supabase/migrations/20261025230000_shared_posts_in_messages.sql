-- Store shared posts as references in direct messages, not just as pasted links.
alter table public.messages
  add column if not exists shared_post_id uuid references public.posts(id) on delete set null;

grant insert (sender_id, recipient_id, body, shared_post_id) on public.messages to authenticated;
