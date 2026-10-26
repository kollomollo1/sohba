-- Add varied, context-matched emojis to some generated demo posts.
-- Keep the existing natural and discussion-starter text as the source.
do $$
begin
  if to_regprocedure('public.demo_post_text_with_emojis(integer,text)') is null
    and to_regprocedure('public.demo_post_text(integer,text)') is not null then
    alter function public.demo_post_text(integer, text) rename to demo_post_text_with_emojis;
  end if;
end;
$$;

create or replace function public.demo_post_text(p_index integer, p_gender text)
returns text
language plpgsql
immutable
set search_path = public
as $$
declare
  v_body text := public.demo_post_text_with_emojis(p_index, p_gender);
begin
  -- Questions and invitations to share an opinion get a thinking emoji.
  if v_body ~ '[؟?]' or v_body ~* '(احكولنا|قولولنا|رشحولنا|رشحولي|مين عنده|إيه رأيكم|تختاري إيه|تختار إيه)' then
    return v_body || ' 🤔';
  end if;

  -- Match the emoji to the subject when the post has a clear emotional cue.
  if v_body ~* '(ضحك|بضحك|أضحك|ضحكت|مضحك|قهقه)' then
    return v_body || ' 😂';
  elsif v_body ~* '(بحب|حب|صاحبتي|صاحبي|ماما|أمي|بابا|أهلي|جدتي|ممتنة|مبسوط|مبسوطة|فرحان|فرحانة)' then
    return v_body || ' ❤️';
  elsif v_body ~* '(زعلان|زعلانة|متضايق|متضايقة|قلقان|قلقانة|خايف|خايفة|اتضايقت|حزين|حزينة|ضغط)' then
    return v_body || ' 😔';
  end if;

  -- Leave most remaining posts plain; add a light emoji to a small subset.
  if mod(greatest(p_index, 1), 4) = 1 then
    return v_body || ' 🙂';
  end if;
  return v_body;
end;
$$;

revoke execute on function public.demo_post_text(integer, text) from public, anon, authenticated;
grant execute on function public.demo_post_text(integer, text) to service_role;

-- Refresh today's queued posts and posts already published from those queue rows.
with ranked as (
  select dp.run_date, dp.user_id, dp.post_id, p.demo_gender,
    row_number() over (partition by dp.run_date, p.demo_gender order by dp.scheduled_at, dp.user_id)::integer - 1 as gender_index
  from public.demo_daily_posts dp
  join public.profiles p on p.id = dp.user_id
  where dp.run_date = (now() at time zone 'UTC')::date
)
update public.demo_daily_posts dp
set body = public.demo_post_text(
  (extract(doy from ranked.run_date)::integer - 1) * 50 + ranked.gender_index + 1,
  coalesce(ranked.demo_gender, 'male')
)
from ranked
where dp.run_date = ranked.run_date and dp.user_id = ranked.user_id;

update public.posts po
set body = dp.body
from public.demo_daily_posts dp
where dp.post_id = po.id
  and dp.run_date = (now() at time zone 'UTC')::date;
