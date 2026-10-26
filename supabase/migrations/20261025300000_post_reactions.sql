-- Allow a like to carry a reaction while preserving the existing like count.
alter table public.likes
  add column if not exists reaction text not null default 'like';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'likes_reaction_allowed'
      and conrelid = 'public.likes'::regclass
  ) then
    alter table public.likes
      add constraint likes_reaction_allowed
      check (reaction in ('like', 'laugh', 'angry', 'surprised'));
  end if;
end;
$$;

grant update (reaction) on public.likes to authenticated;

drop policy if exists "likes_update_own_reaction" on public.likes;
create policy "likes_update_own_reaction" on public.likes for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
