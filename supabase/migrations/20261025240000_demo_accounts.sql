-- Clearly labeled demo profiles with one generated Egyptian Arabic post per day.
alter table public.profiles
  add column if not exists is_demo_account boolean not null default false;

create table if not exists public.demo_daily_runs (
  run_date date primary key,
  created_at timestamptz not null default now(),
  posts_created integer not null default 0
);
alter table public.demo_daily_runs enable row level security;

create or replace function public.admin_demo_users()
returns table (
  user_id uuid,
  full_name text,
  username text,
  avatar_url text,
  created_at timestamptz,
  post_count bigint,
  last_post_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if (auth.jwt() -> 'app_metadata' ->> 'role') is distinct from 'admin' then
    raise exception 'admin role required' using errcode = '42501';
  end if;
  return query
  select p.id, p.full_name, p.username, p.avatar_url, p.created_at,
    count(po.id)::bigint, max(po.created_at)
  from public.profiles p
  left join public.posts po on po.author_id = p.id
  where p.is_demo_account
  group by p.id
  order by p.created_at;
end;
$$;
revoke execute on function public.admin_demo_users() from public, anon;
grant execute on function public.admin_demo_users() to authenticated;

create or replace function public.publish_daily_demo_posts()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_run_date date;
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
  insert into public.demo_daily_runs (run_date) values (current_date)
    on conflict (run_date) do nothing returning run_date into v_run_date;
  if v_run_date is null then return 0; end if;

  for v_slot in
    select row_number() over (order by p.username)::integer - 1
    from public.profiles p where p.is_demo_account
  loop
    -- 10 x 30 x 10 = 3,000 rotating combinations, with no duplicates among
    -- today's 100 sequential slots.
    v_slot := mod((extract(doy from current_date)::integer - 1) * 100 + v_slot, 3000);
    v_opener := v_openers[(v_slot % 10) + 1];
    v_topic := v_topics[((v_slot / 10) % 30) + 1];
    v_closer := v_closers[(v_slot / 300) + 1];

    insert into public.posts (author_id, body, image_url, is_urgent)
    select p.id, v_opener || ' ' || v_topic || '، ' || v_closer, null, false
    from public.profiles p
    where p.is_demo_account
    order by p.username
    offset v_slot % 100 limit 1;
    v_post_count := v_post_count + 1;
  end loop;

  update public.demo_daily_runs set posts_created = v_post_count where run_date = current_date;
  return v_post_count;
end;
$$;
revoke execute on function public.publish_daily_demo_posts() from public, anon, authenticated;
grant execute on function public.publish_daily_demo_posts() to service_role;

create extension if not exists pg_cron;
select cron.schedule(
  'sohba-daily-demo-posts',
  '0 6 * * *',
  'select public.publish_daily_demo_posts();'
);
