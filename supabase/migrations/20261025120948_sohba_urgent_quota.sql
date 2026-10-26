-- ============================================================================
-- Urgent-post quota: at most ONE urgent post per user per 24 hours, enforced
-- at the database regardless of what the client sends. Also stamps the
-- last_urgent_post_at counter on the profile.
-- ============================================================================

create or replace function public.enforce_urgent_quota()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  last_urgent timestamptz;
begin
  if new.is_urgent then
    select p.last_urgent_post_at into last_urgent
    from public.profiles p where p.id = new.author_id;

    if last_urgent is not null and now() - last_urgent < interval '24 hours' then
      raise exception 'عذراً، يمكنك نشر منشور عاجل واحد كل 24 ساعة.'
        using errcode = 'check_violation';
    end if;

    update public.profiles
      set last_urgent_post_at = now()
      where id = new.author_id;
  else
    -- if editing an urgent post to non-urgent, don't reset the counter
    null;
  end if;
  return new;
end;
$$;

drop trigger if exists posts_urgent_quota_trigger on public.posts;
create trigger posts_urgent_quota_trigger
  before insert or update of is_urgent on public.posts
  for each row execute function public.enforce_urgent_quota();

revoke execute on function public.enforce_urgent_quota() from public, anon, authenticated;
