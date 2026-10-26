-- ============================================================================
-- Enforce strict 30-minute interval between demo account posts
-- 1. Hard check in publish_due_demo_post() so NO demo post publishes if one was posted < 30 mins ago.
-- 2. Reschedule ALL currently pending demo posts starting 30 mins from the latest demo post.
-- 3. Update publish_daily_demo_posts() to assign 30-minute slots.
-- ============================================================================

-- 1. Function to publish next demo post with strict 30-minute rate limit
create or replace function public.publish_due_demo_post()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item public.demo_daily_posts%rowtype;
  v_post_id uuid;
  v_last_demo_post timestamptz;
begin
  -- Strict guard: check when ANY demo account last posted
  select max(p.created_at) into v_last_demo_post
  from public.posts p
  join public.profiles pr on pr.id = p.author_id
  where pr.is_demo_account;

  -- If a demo post was published less than 30 minutes ago, abort immediately
  if v_last_demo_post is not null and v_last_demo_post > now() - interval '30 minutes' then
    return 0;
  end if;

  -- Select next queued post that is due
  select * into v_item
  from public.demo_daily_posts
  where post_id is null and scheduled_at <= now()
  order by scheduled_at, run_date, user_id
  for update skip locked
  limit 1;

  if not found then return 0; end if;

  insert into public.posts (author_id, body, image_url, is_urgent)
  values (v_item.user_id, v_item.body, null, false)
  returning id into v_post_id;

  update public.demo_daily_posts
  set post_id = v_post_id, published_at = now()
  where run_date = v_item.run_date and user_id = v_item.user_id;

  update public.demo_daily_runs
  set posts_created = posts_created + 1
  where run_date = v_item.run_date;

  return 1;
end;
$$;

revoke execute on function public.publish_due_demo_post() from public, anon, authenticated;
grant execute on function public.publish_due_demo_post() to service_role;

-- 2. Daily generation function with 30-minute spacing
create or replace function public.publish_daily_demo_posts()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_run_date      date        := (now() at time zone 'UTC')::date;
  v_day_start     timestamptz;
  v_day_end       timestamptz;
  v_start         timestamptz;
  v_female_ids    uuid[];
  v_male_ids      uuid[];
  v_female_pos    integer     := 1;
  v_male_pos      integer     := 1;
  v_female_count  integer     := 0;
  v_male_count    integer     := 0;
  v_eligible_count integer    := 0;
  v_scheduled_count integer   := 0;
  v_female_remaining integer;
  v_male_remaining   integer;
  v_can_female    boolean;
  v_can_male      boolean;
  v_choose_female boolean;
  v_last_gender   text;
  v_gender_run    integer     := 0;
  v_gender        text;
  v_user_id       uuid;
  v_gender_index  integer;
  v_post_index    integer;
  v_scheduled_at  timestamptz;
  v_body          text;
  v_gap           interval    := interval '30 minutes';
begin
  perform pg_advisory_xact_lock(hashtextextended(v_run_date::text, 9943));
  v_day_start := v_run_date::timestamp at time zone 'UTC';
  v_day_end   := (v_run_date + 1)::timestamp at time zone 'UTC';
  v_start     := greatest(v_day_start + interval '6 hours', now() + interval '1 minute');
  if v_start >= v_day_end then return 0; end if;

  select
    coalesce(array_agg(p.id order by random()) filter (where p.demo_gender = 'female'), '{}'::uuid[]),
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

  v_female_count   := coalesce(array_length(v_female_ids, 1), 0);
  v_male_count     := coalesce(array_length(v_male_ids, 1), 0);
  v_eligible_count := v_female_count + v_male_count;
  if v_eligible_count = 0 then return 0; end if;

  insert into public.demo_daily_runs (run_date, posts_created)
  values (v_run_date, 0) on conflict (run_date) do nothing;

  while v_female_pos <= v_female_count or v_male_pos <= v_male_count loop
    v_female_remaining := greatest(v_female_count - v_female_pos + 1, 0);
    v_male_remaining   := greatest(v_male_count   - v_male_pos   + 1, 0);

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
      v_gender       := 'female';
      v_user_id      := v_female_ids[v_female_pos];
      v_gender_index := v_female_pos - 1;
      v_female_pos   := v_female_pos + 1;
    else
      v_gender       := 'male';
      v_user_id      := v_male_ids[v_male_pos];
      v_gender_index := v_male_pos - 1;
      v_male_pos     := v_male_pos + 1;
    end if;

    if v_last_gender = v_gender then
      v_gender_run := v_gender_run + 1;
    else
      v_last_gender := v_gender;
      v_gender_run  := 1;
    end if;

    v_post_index   := (extract(doy from v_run_date)::integer - 1) * 50 + v_gender_index + 1;
    v_body         := public.demo_post_text(v_post_index, v_gender);
    v_scheduled_at := v_start + v_gap * v_scheduled_count;

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

-- 3. IMMEDIATE RESET of all currently unposted demo posts to 30-minute intervals
do $$
declare
  v_rec record;
  v_base_time timestamptz;
  v_step integer := 0;
begin
  -- Find when the latest demo post actually was published
  select coalesce(max(p.created_at), now()) into v_base_time
  from public.posts p
  join public.profiles pr on pr.id = p.author_id
  where pr.is_demo_account;

  -- Ensure next post is at least 30 minutes in the future from latest post
  if v_base_time + interval '30 minutes' <= now() then
    v_base_time := now();
  end if;

  -- Update all pending posts in sequence with 30-minute intervals
  for v_rec in
    select run_date, user_id
    from public.demo_daily_posts
    where post_id is null
    order by scheduled_at asc, user_id asc
  loop
    v_step := v_step + 1;
    update public.demo_daily_posts
    set scheduled_at = v_base_time + (v_step * interval '30 minutes')
    where run_date = v_rec.run_date and user_id = v_rec.user_id;
  end loop;
end;
$$;
