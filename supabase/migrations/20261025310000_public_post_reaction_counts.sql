-- Return a small aggregate per visible post instead of downloading every like.
create or replace function public.post_reaction_counts(p_post_ids uuid[])
returns table (post_id uuid, reaction text, reaction_count bigint)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_viewer uuid := auth.uid();
begin
  if v_viewer is null then
    raise exception 'unauthenticated' using errcode = '42501';
  end if;

  return query
  select l.post_id, l.reaction, count(*)::bigint
  from public.likes l
  join public.posts p on p.id = l.post_id
  where l.post_id = any(coalesce(p_post_ids, array[]::uuid[]))
    and public.can_see_post(v_viewer, p)
  group by l.post_id, l.reaction;
end;
$$;

revoke execute on function public.post_reaction_counts(uuid[]) from public, anon;
grant execute on function public.post_reaction_counts(uuid[]) to authenticated;
