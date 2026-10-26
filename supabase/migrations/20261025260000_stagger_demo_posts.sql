-- Queue demo posts and publish them gradually instead of creating all 100 at once.
alter table public.demo_daily_posts
  alter column post_id drop not null,
  add column if not exists body text,
  add column if not exists scheduled_at timestamptz,
  add column if not exists published_at timestamptz;

create or replace function public.publish_daily_demo_posts()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account record;
  v_run_date date := (now() at time zone 'UTC')::date;
  v_day_start timestamptz;
  v_day_end timestamptz;
  v_start timestamptz;
  v_scheduled_at timestamptz;
  v_eligible_count integer;
  v_scheduled_count integer := 0;
  v_slot integer;
  v_body text;
  v_openers text[] := array[
    'من الحاجات اللي بتروقني إن', 'اكتشفت النهارده إن', 'أحلى حاجة في اليوم كانت إن',
    'بصراحة بقيت بحب إن', 'يا جماعة مفيش أحلى من إن', 'كنت محتاج أفكر نفسي إن',
    'تفصيلة صغيرة بس فرقت معايا وهي إن', 'بعد يوم طويل اكتشفت إن',
    'من فترة وأنا بحاول أفتكر إن', 'حاجة بسيطة بس بتبسطني وهي إن'
  ];
  v_topics text[] := array[
    'أتمشى شوية وقت الغروب', 'أشرب شاي بالنعناع بعد الغدا', 'أسمع أغنية قديمة بحبها',
    'أقعد مع أهلي حتى لو من غير مناسبة', 'أرتب حاجتي وأنا مش مستعجل', 'أكلم صاحب قديم وأسأل عليه',
    'أجرب أكلة جديدة في البيت', 'أخلص مشوار مأجله من فترة', 'أصحى بدري وأبدأ اليوم براحة',
    'أقعد في البلكونة وأتابع الشارع', 'أبعد عن الموبايل شوية قبل النوم', 'أضحك من قلبي مع ناس قريبة',
    'أجيب حاجة حلوة وأنا راجع البيت', 'أخطط لخروجة بسيطة في الويك إند', 'أساعد حد في حاجة صغيرة',
    'أقرا كام صفحة قبل ما أنام', 'أهتم بنباتات البلكونة', 'أمشي بدل ما أركب مواصلة للمشوار القريب',
    'أجرب مكان جديد في منطقتي', 'أقضي وقت هادي من غير دوشة', 'أعمل أكلة البيت اللي بحبها',
    'أفتكر موقف حلو من أيام المدرسة', 'أصور السما لما لونها يبقى جميل', 'أتعلم حاجة جديدة حتى لو بسيطة',
    'أبدأ في حاجة كنت مأجلها', 'أقعد مع صحابي من غير ما نبص في الساعة', 'أسمع حكايات جدي وجدتي',
    'أشوف فيلم قديم بحبه', 'أصحى ألاقي الجو لطيف', 'أقول لحد قريب مني إني مقدره'
  ];
  v_closers text[] := array[
    'إيه أكتر تفصيلة بسيطة بتبسطكم؟', 'ربنا يديم اللمة الحلوة والناس الجدعة.',
    'إنتوا بتفصلوا من ضغط اليوم إزاي؟', 'يمكن الحاجات الصغيرة هي اللي بتفرق بجد.',
    'مين بيحب يعمل كده برضه؟', 'يومكم يبقى خفيف ولطيف يا رب.',
    'رشحولي حاجة جديدة أجربها المرة الجاية.', 'قولولي رأيكم.',
    'محتاجين نفتكر الحاجات الحلوة دي أكتر.', 'إيه خطتكم للويك إند؟'
  ];
begin
  perform pg_advisory_xact_lock(hashtextextended(v_run_date::text, 9943));
  v_day_start := v_run_date::timestamp at time zone 'UTC';
  v_day_end := (v_run_date + 1)::timestamp at time zone 'UTC';
  v_start := greatest(v_day_start + interval '6 hours', now() + interval '1 minute');

  select count(*)::integer into v_eligible_count
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
  if v_eligible_count = 0 or v_start >= v_day_end then return 0; end if;

  insert into public.demo_daily_runs (run_date, posts_created)
  values (v_run_date, 0) on conflict (run_date) do nothing;

  for v_account in
    select p.id, row_number() over (order by p.username)::integer - 1 as account_index
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
      )
    order by p.username
  loop
    v_slot := mod((extract(doy from v_run_date)::integer - 1) * 100 + v_account.account_index, 3000);
    v_body := v_openers[(v_slot % 10) + 1] || ' ' ||
      v_topics[((v_slot / 10) % 30) + 1] || '، ' ||
      v_closers[(v_slot / 300) + 1];
    v_scheduled_at := v_start + (v_day_end - v_start) *
      (v_account.account_index::double precision / v_eligible_count);

    insert into public.demo_daily_posts (run_date, user_id, post_id, body, scheduled_at)
    values (v_run_date, v_account.id, null, v_body, v_scheduled_at)
    on conflict (run_date, user_id) do nothing;
    if found then v_scheduled_count := v_scheduled_count + 1; end if;
  end loop;
  return v_scheduled_count;
end;
$$;

create or replace function public.publish_due_demo_post()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item public.demo_daily_posts%rowtype;
  v_post_id uuid;
begin
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

revoke execute on function public.publish_daily_demo_posts() from public, anon, authenticated;
revoke execute on function public.publish_due_demo_post() from public, anon, authenticated;
grant execute on function public.publish_daily_demo_posts() to service_role;
grant execute on function public.publish_due_demo_post() to service_role;

select cron.schedule('sohba-daily-demo-posts', '0 6 * * *',
  'select public.publish_daily_demo_posts();');
select cron.schedule('sohba-publish-demo-queue', '* * * * *',
  'select public.publish_due_demo_post();');
