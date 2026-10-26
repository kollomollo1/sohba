-- Track daily demo posts per account, so a Cron run before account creation
-- does not block posting later the same day.
create table if not exists public.demo_daily_posts (
  run_date date not null,
  user_id uuid not null references public.profiles(id) on delete cascade,
  post_id uuid not null references public.posts(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (run_date, user_id),
  unique (post_id)
);
alter table public.demo_daily_posts enable row level security;

create or replace function public.publish_daily_demo_posts()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account record;
  v_post_id uuid;
  v_post_count integer := 0;
  v_slot integer;
  v_opener text;
  v_topic text;
  v_closer text;
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
  -- Serialize daily runs and allow retries for accounts created after Cron ran.
  perform pg_advisory_xact_lock(hashtextextended(current_date::text, 9943));

  for v_account in
    select p.id, row_number() over (order by p.username)::integer - 1 as account_index
    from public.profiles p
    left join public.account_moderation m on m.user_id = p.id
    where p.is_demo_account
      and not coalesce(m.permanently_banned, false)
      and not coalesce(m.profile_permanently_banned, false)
      and (m.access_suspended_until is null or m.access_suspended_until <= now())
      and (m.posting_suspended_until is null or m.posting_suspended_until <= now())
      and not exists (
        select 1 from public.demo_daily_posts dp
        where dp.run_date = current_date and dp.user_id = p.id
      )
      and not exists (
        select 1 from public.posts today_post
        where today_post.author_id = p.id
          and today_post.created_at >= date_trunc('day', now())
      )
    order by p.username
  loop
    v_slot := mod((extract(doy from current_date)::integer - 1) * 100 + v_account.account_index, 3000);
    v_opener := v_openers[(v_slot % 10) + 1];
    v_topic := v_topics[((v_slot / 10) % 30) + 1];
    v_closer := v_closers[(v_slot / 300) + 1];

    insert into public.posts (author_id, body, image_url, is_urgent)
    values (v_account.id, v_opener || ' ' || v_topic || '، ' || v_closer, null, false)
    returning id into v_post_id;

    insert into public.demo_daily_posts (run_date, user_id, post_id)
    values (current_date, v_account.id, v_post_id);
    v_post_count := v_post_count + 1;
  end loop;

  if v_post_count > 0 then
    insert into public.demo_daily_runs (run_date, posts_created)
    values (current_date, v_post_count)
    on conflict (run_date) do update set
      posts_created = public.demo_daily_runs.posts_created + excluded.posts_created,
      created_at = now();
  end if;
  return v_post_count;
end;
$$;

revoke execute on function public.publish_daily_demo_posts() from public, anon, authenticated;
grant execute on function public.publish_daily_demo_posts() to service_role;
select cron.schedule(
  'sohba-daily-demo-posts',
  '0 6 * * *',
  'select public.publish_daily_demo_posts();'
);
