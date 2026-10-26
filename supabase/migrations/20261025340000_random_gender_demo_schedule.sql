create or replace function public.publish_daily_demo_posts()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_run_date date := (now() at time zone 'UTC')::date;
  v_day_start timestamptz;
  v_day_end timestamptz;
  v_start timestamptz;
  v_female_ids uuid[];
  v_male_ids uuid[];
  v_female_pos integer := 1;
  v_male_pos integer := 1;
  v_female_count integer := 0;
  v_male_count integer := 0;
  v_eligible_count integer := 0;
  v_scheduled_count integer := 0;
  v_female_remaining integer;
  v_male_remaining integer;
  v_can_female boolean;
  v_can_male boolean;
  v_choose_female boolean;
  v_last_gender text;
  v_gender_run integer := 0;
  v_gender text;
  v_user_id uuid;
  v_gender_index integer;
  v_post_index integer;
  v_scheduled_at timestamptz;
  v_body text;
begin
  perform pg_advisory_xact_lock(hashtextextended(v_run_date::text, 9943));
  v_day_start := v_run_date::timestamp at time zone 'UTC';
  v_day_end := (v_run_date + 1)::timestamp at time zone 'UTC';
  v_start := greatest(v_day_start + interval '6 hours', now() + interval '1 minute');
  if v_start >= v_day_end then return 0; end if;

  select coalesce(array_agg(p.id order by random()) filter (where p.demo_gender = 'female'), '{}'::uuid[]),
         coalesce(array_agg(p.id order by random()) filter (where p.demo_gender is distinct from 'female'), '{}'::uuid[])
  into v_female_ids, v_male_ids
  from public.profiles p
  left join public.account_moderation m on m.user_id = p.id
  where p.is_demo_account
    and not coalesce(m.permanently_banned, false)
    and not coalesce(m.profile_permanently_banned, false)
    and (m.access_suspended_until is null or m.access_suspended_until <= now())
    and (m.posting_suspended_until is null or m.posting_suspended_until <= now())
    and not exists (select 1 from public.demo_daily_posts dp where dp.run_date = v_run_date and dp.user_id = p.id)
    and not exists (
      select 1 from public.posts today_post
      where today_post.author_id = p.id
        and today_post.created_at >= v_day_start and today_post.created_at < v_day_end
    );

  v_female_count := coalesce(array_length(v_female_ids, 1), 0);
  v_male_count := coalesce(array_length(v_male_ids, 1), 0);
  v_eligible_count := v_female_count + v_male_count;
  if v_eligible_count = 0 then return 0; end if;

  insert into public.demo_daily_runs (run_date, posts_created)
  values (v_run_date, 0) on conflict (run_date) do nothing;

  while v_female_pos <= v_female_count or v_male_pos <= v_male_count loop
    v_female_remaining := greatest(v_female_count - v_female_pos + 1, 0);
    v_male_remaining := greatest(v_male_count - v_male_pos + 1, 0);

    v_can_female := v_female_remaining > 0 and (
      v_male_remaining = 0 or (
        (v_last_gender is distinct from 'female' or v_gender_run < 2)
        and (v_female_remaining - 1) <= 2 * v_male_remaining +
          (2 - case when v_last_gender = 'female' then v_gender_run + 1 else 1 end)
        and v_male_remaining <= 2 * v_female_remaining
      )
    );
    v_can_male := v_male_remaining > 0 and (
      v_female_remaining = 0 or (
        (v_last_gender is distinct from 'male' or v_gender_run < 2)
        and (v_male_remaining - 1) <= 2 * v_female_remaining +
          (2 - case when v_last_gender = 'male' then v_gender_run + 1 else 1 end)
        and v_female_remaining <= 2 * v_male_remaining
      )
    );

    if v_can_female and v_can_male then
      -- Weight girls 1.35x while accounting for each gender's remaining queue.
      v_choose_female := random() < (v_female_remaining * 1.35) /
        ((v_female_remaining * 1.35) + v_male_remaining);
    else
      v_choose_female := v_can_female;
    end if;

    if v_choose_female then
      v_gender := 'female';
      v_user_id := v_female_ids[v_female_pos];
      v_gender_index := v_female_pos - 1;
      v_female_pos := v_female_pos + 1;
    else
      v_gender := 'male';
      v_user_id := v_male_ids[v_male_pos];
      v_gender_index := v_male_pos - 1;
      v_male_pos := v_male_pos + 1;
    end if;

    if v_last_gender = v_gender then
      v_gender_run := v_gender_run + 1;
    else
      v_last_gender := v_gender;
      v_gender_run := 1;
    end if;

    v_post_index := (extract(doy from v_run_date)::integer - 1) * 50 + v_gender_index + 1;
    v_body := public.demo_post_text(v_post_index, v_gender);
    v_scheduled_at := v_start + (v_day_end - v_start) *
      (v_scheduled_count::double precision / v_eligible_count);

    insert into public.demo_daily_posts (run_date, user_id, post_id, body, scheduled_at)
    values (v_run_date, v_user_id, null, v_body, v_scheduled_at)
    on conflict (run_date, user_id) do nothing;
    if found then v_scheduled_count := v_scheduled_count + 1; end if;
  end loop;

  return v_scheduled_count;
end;
$$;

revoke execute on function public.publish_daily_demo_posts() from public, anon, authenticated;
grant execute on function public.publish_daily_demo_posts() to service_role;
-- Reorder today's already-queued but unpublished posts with the same weighted shuffle.
do $$
declare
  v_run_date date := (now() at time zone 'UTC')::date;
  v_day_end timestamptz;
  v_start timestamptz;
  v_female_ids uuid[];
  v_male_ids uuid[];
  v_female_pos integer := 1;
  v_male_pos integer := 1;
  v_female_count integer := 0;
  v_male_count integer := 0;
  v_female_remaining integer;
  v_male_remaining integer;
  v_can_female boolean;
  v_can_male boolean;
  v_choose_female boolean;
  v_last_gender text;
  v_gender_run integer := 0;
  v_gender text;
  v_user_id uuid;
  v_pending_count integer := 0;
  v_slot integer := 0;
  v_scheduled_at timestamptz;
begin
  v_day_end := (v_run_date + 1)::timestamp at time zone 'UTC';
  v_start := greatest((v_run_date::timestamp at time zone 'UTC') + interval '6 hours', now() + interval '1 minute');
  if v_start >= v_day_end then return; end if;

  select coalesce(array_agg(dp.user_id order by random()) filter (where p.demo_gender = 'female'), '{}'::uuid[]),
         coalesce(array_agg(dp.user_id order by random()) filter (where p.demo_gender is distinct from 'female'), '{}'::uuid[])
  into v_female_ids, v_male_ids
  from public.demo_daily_posts dp
  join public.profiles p on p.id = dp.user_id
  where dp.run_date = v_run_date and dp.post_id is null;

  v_female_count := coalesce(array_length(v_female_ids, 1), 0);
  v_male_count := coalesce(array_length(v_male_ids, 1), 0);
  v_pending_count := v_female_count + v_male_count;
  if v_pending_count = 0 then return; end if;

  while v_female_pos <= v_female_count or v_male_pos <= v_male_count loop
    v_female_remaining := greatest(v_female_count - v_female_pos + 1, 0);
    v_male_remaining := greatest(v_male_count - v_male_pos + 1, 0);
    v_can_female := v_female_remaining > 0 and (
      v_male_remaining = 0 or (
        (v_last_gender is distinct from 'female' or v_gender_run < 2)
        and (v_female_remaining - 1) <= 2 * v_male_remaining +
          (2 - case when v_last_gender = 'female' then v_gender_run + 1 else 1 end)
        and v_male_remaining <= 2 * v_female_remaining
      )
    );
    v_can_male := v_male_remaining > 0 and (
      v_female_remaining = 0 or (
        (v_last_gender is distinct from 'male' or v_gender_run < 2)
        and (v_male_remaining - 1) <= 2 * v_female_remaining +
          (2 - case when v_last_gender = 'male' then v_gender_run + 1 else 1 end)
        and v_female_remaining <= 2 * v_male_remaining
      )
    );

    if v_can_female and v_can_male then
      v_choose_female := random() < (v_female_remaining * 1.35) /
        ((v_female_remaining * 1.35) + v_male_remaining);
    else
      v_choose_female := v_can_female;
    end if;

    if v_choose_female then
      v_gender := 'female';
      v_user_id := v_female_ids[v_female_pos];
      v_female_pos := v_female_pos + 1;
    else
      v_gender := 'male';
      v_user_id := v_male_ids[v_male_pos];
      v_male_pos := v_male_pos + 1;
    end if;
    if v_last_gender = v_gender then
      v_gender_run := v_gender_run + 1;
    else
      v_last_gender := v_gender;
      v_gender_run := 1;
    end if;

    v_scheduled_at := v_start + (v_day_end - v_start) * (v_slot::double precision / v_pending_count);
    update public.demo_daily_posts
    set scheduled_at = v_scheduled_at
    where run_date = v_run_date and user_id = v_user_id and post_id is null;
    v_slot := v_slot + 1;
  end loop;
end;
$$;