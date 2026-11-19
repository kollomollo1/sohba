const fs = require('fs');
const path = require('path');

const gamingContent = fs.readFileSync('supabase/migrations/20261030160000_egyptian_gaming_posts_1min.sql', 'utf8');
const femaleContent = fs.readFileSync('supabase/migrations/20261030180000_young_men_majority_demo_posts.sql', 'utf8');

const gamingPosts = gamingContent
  .split('\n')
  .filter(l => /^\s*'/.test(l))
  .map(l => l.trim().replace(/^'/, '').replace(/',?$/, ''));

const female50Posts = femaleContent
  .split('v_female_posts text[] := array[')[1]
  .split('];')[0]
  .split('\n')
  .filter(l => /^\s*'/.test(l))
  .map(l => l.trim().replace(/^'/, '').replace(/',?$/, ''));

const extraMalePosts = [
  'نزلت الجيم بعد غياب شهرين، المدرب بصلي وقالي: "منور يا كابتن هنبدأ بلياقة خفيفة".. تاني يوم صحيت حاسس إن عضلاتي اترفعت عليها قضية طرد من جسمي! 🏋️‍♂️😂',
  'سؤال لبتوع الفانتازي (FPL): مين الكابتن المضمون الجولة دي؟ كل ما أكبتن هالاند يضيع بلنتي، ولما أكبتن صلاح يطلع أسيست بس، والدوري بيضيع مني! ⚽📊',
  'ماتش الأهلي والزمالك في القهوة.. الزعيق والشاي بالنعناع مع كل هجمة وكراسي القهوة اللي بتطير في الجول.. دي متعة الكورة الشعبية اللي ملهاش بديل في العالم 🔴⚪☕',
  'الواحد لما بيطلب شاورما عربي بعد الساعة 1 بالليل وبتنزل التومية زيادة والبطاطس مقرمشة.. بيحس إن كل مشاكله وهموم يومه اتصفرت في ثانية واحدة! 🌯🍟',
  'ركبت المترو اتجاه المرج في ساعة الذروة.. كمية البشر اللي داخلة العربية خلتني أفتكر زومبي World War Z! بس الجميل إنك بتتسند من غير ما تمسك في أي حاجة 😂🚇',
  'أنا وصاحبي بقالنا 4 سنين بنقول: "الجمعة الجاية هننزل نفطر ونجري في زايد أو المعادي الصبح".. وييجي يوم الجمعة بنصحى العصر نتخانق مين هينزل يجيب كشري! 🏃‍♂️🍲',
  'مشروع التخرج في كليات مصر ده عبارة عن 4 أفراد: واحد بيشتغل ومبيناش، والتاني بيجيب السناكس، والتالت بيكتب أسماء التيم على الكفر، والرابع ميعرفش عنوان الكلية أصلاً! 🎓📚',
  'أنا نفسي أفهم السواقين في مصر بيتعلموا لغة الإشارات دي فين؟ رمشة نور تعني عدي، وكسرة دركسيون تعني توكلنا على الله، ومفيش أي كود مرور معترف بيه! 🚗💨',
  'نزلت اشتريت كوتشي أبيض شيك جداً، أول خطوة في الشارع كانت في بقعة طين مستخبية تحت الرصيف.. قلبي اتقبض كأني خسرت فيوتشر البيتكوين! 👟😭',
  'حوار الحلاق يوم الوقفة أو ليلة الخميس: تقعد 3 ساعات مستني دورك، ويجيلك الحلاق يفضفضلك عن مشاكل حياته كلها وإنت ساكت وخايف تتهز عشان شعرك ميبوظش! 💈✂️',
  'سؤال للرجالة: هو إنتوا بجد بتشتروا هدوم في الصيف غير 3 تشيرتات وبنطلونين جينز بتبدلوا بينهم؟ إحنا كائنات بسيطة جداً والله مش طالبين أكتر من الستر والراحة 👕👖',
  'مين فاكر إفيهات فيلم الناظر واللمبي وعسكر في المعسكر؟ السينما المصرية في أوائل الألفينات دي كنز إفيهات بنستخدمه في حياتنا اليومية أكتر من لغتنا الأم! 🎬🍿',
  'أنا لما كود البرمجة يشتغل من أول مرة وميطلعش إيرور.. مبفرحش، بقعد مرعوب وبقول: "أكيد في مصيبة مستخبية مش شايفها"، وسواس المبرمجين الأبدي! 💻🐛',
  'أحسن مشوار لما تخرج تتمشى على كوبري قصر النيل وقت الغروب ونسمة الهوا تضرب في وشك.. القاهرة دي فيها سحر عجيب مبيخلصش رغم كل زحمتها 🌉🌇',
  'أنا ماشي بمبدأ: اللي ميعرفش قيمتك متضيعش وقتك في إقناعه.. الدنيا أقصر من إننا نقضيها تبريرات وطاقة ضايعة في الفاضي 🚶‍♂️✨',
  'لما تطلب من كشري التحرير أو أبو طارق طبق لارج مع تقلية زيادة ودقة وشطة.. ده مش مجرد أكل، ده احتفال رسمي بنهاية أسبوع متعب 🍲🌶️',
  'خناقة الشتا والصيف: بتوع الشتا يقولولك الأناقة والهدوء، وتلاقي نفسك متكلفت بـ 4 بطاطين ووشك متخشب.. وبتوع الصيف بيسيحوا في الشارع.. المهم راحة البال! ❄️☀️',
  'سؤال للشباب اللي شغالين ريموتلي من البيت: هو إنتوا بتغيروا البيجاما أصلاً ولا بتعتبروها اليونيفورم الرسمي لاجتماعات زووم؟ 💻👔',
  'أكتر مكالمة مفرحة في اليوم هي لما تلاقي الدليفري بيرن ويقولك: "أنا تحت العمارة يا فندم".. سرعة ضربات القلب وقتها أسرع من سرعة الصوت! 🍕📦',
  'أيام الثانوية العامة والمذكرات اللي كانت متكومة على المكتب والألوان الماركر اللي خلصت في التظليل.. الحمد لله إنها عدت وبقت ذكريات للضحك بس 📝🎒',
  'الصحبة الجدعة رزق ونعمة كبيرة.. اللي يقف في ضهرك لما الدنيا تعفرت في وشك، وميستناش منك شكر ولا مصلحة.. دول اللي يتشالوا فوق الراس والله 👬🤝',
  'أنا في قعدة القهوة البلدي مع الشاي المظبوط وحجر التفاح والضحك على تفاصيل اليوم التافهة.. بنسى أي ضغط نفسي وأرجع البيت مروق تماماً ☕🎲',
  'سؤال نقاشي: هل بطلوا يعملوا مسلسلات دراما مصرية تقيلة زي أرابيسك وزيزينيا وليالي الحلمية؟ الروح والعمق اللي كان في الكتابة دي مستحيل يتكرر 📺📼',
  'لما أمك تقولك "قوم انزل هات طلبات من السوبرماركت"، وتديك لستة فيها 15 طلب وتفتكرهم كلهم وتنسى حاجة واحدة تافهة.. بتتحول لخائن الأمانة الرسمي في البيت! 🛒😂',
  'أنا دخلت الجيم أعمل بنش برس 80 كيلو، البار وقف على صدري ومكنتش قادر أرفعه.. بصيت للسما ولقيت كابتن الجيم بيجري عليا كأنه إسعاف طائر! تروما رياضية 🏋️‍♂️🚑',
  'مين بيحب يسمع أغاني كايروكي ومسار إجباري وهو سايق بالليل على الدائري؟ المكس بين الكلمات والمشاهد دي بيعمل شحن للمشاعر ملوش حل 🚗🎵',
  'لما تنزل تدور على سكن طلبة أو شقة إيجار في القاهرة.. السماسرة بيحسسوك إن الشقة قصر باكنجهام، وأول ما تدخل تلاقي الحمام في الصالة والمطبخ بلكونة! 🏢🤦‍♂️',
  'الواحد لما بيشوف فواتير الكهرباء والنت والتزامات الحياة بيفهم ليه أهالينا زمان كانوا بيزعلوا لما نسيب لمبة الصالة منورة وإحنا خارجين! 💡💸',
  'أنا مستحيل أثق في حد بيشرب الشاي من غير سكر خالص ومبيحطش كاتشب على البطاطس.. في حاجة مريبة في برود الأعصاب ده! 🍟☕',
  'ذكريات ماتش مصر وغانا 6-1 وماتش الكونغو لما صلاح سجل ضربة الجزاء في الدقيقة 94 وصعدنا كأس العالم.. المشاعر الوطنية دي بتبكيك فخراً كل ما تفتكرها 🇪🇬⚽🔥',
  'أصعب لحظة لما تقعد تذاكر أو تشتغل وتلاقي قطتك جاية تتدلع وتقعد فوق الكيبورد وتدوس على زرار المسح في كود شغال عليه بقالك 3 ساعات! 🐱⌨️',
  'مين لسه فاكر شريط الكاسيت وقلم الرصاص اللي كنا بنلف بيه البكرة عشان نوفر حجر البطارية في الووكمان؟ جيل التسعينات ده عاش كل التطور التكنولوجي في تاريخ البشرية! 📼✏️',
  'أنا لما بحب أكافئ نفسي بعد إنجاز صعب، بنزل أشتري كوباية مانجا فريش من عند فرغلي أو القبيسي.. المتعة في أبسط تفاصيل بلدنا الجميلة 🥭🥤',
  'سؤال للشباب: إيه أكتر عادة يومية بسيطة فرقت في طاقتك وتركيزك؟ بالنسبة لي صحيان بدري نص ساعة ومشي سريع بيغيروا اليوم 180 درجة 🌅👟',
  'الضحك مع أصحابك اللي عارفين كل أسرارك وفضايحك من أيام المدرسة.. القعدة معاهم بتغسل تعب سنين وترجعك طفل بريء تاني ❤️👬',
  'لما تنزل مشوار وتلاقي الشوارع فاضية والإشارات خضراء من أول الرحلة لآخرها.. بتحس إن الكون كله راضي عنك ومتواطئ في سعادتك! 🚦🚗',
  'في النهاية، الحياة مش سباق ولا مقارنات.. كل واحد ماشي في توقيته الصح ومكتوبله رزقه بالسنتيمتر، الرضا هو الكنز الحقيقي اللي بنعيش بيه مستورين 🤲🌿'
];

const extraFemalePosts = [
  'حد بيحب يتمشى على كورنيش إسكندرية في الشتا والجو بيمطر؟ ريحة اليود وهوا البحر مع كوز درة مشوي.. مفيش روقان في الدنيا يعدل ده! 🌊🌧️🌽',
  'سؤال: لو عندكم خيار تسكنوا في بيت قديم بأسقف عالية وشبابيك خشب كبيرة في المعادي أو الزمالك، ولا شقة مودرن جديدة في التجمع؟ أنا المعادي تكسب قلبي فوراً 🏡🌿',
  'مين لما بيجي يقرأ رواية بيندمج لدرجة إنه بيحس إن أبطال الرواية صحابه بجد؟ ويفضل يومين حزين بعد ما الرواية تخلص عشان ودعهم! 📖💔',
  'صينية بطاطس بالفراخ ورز بالشعرية وسلطة خضراء.. في أكلات مهما العالم اخترع أكلات جديدة بتفضل هي اللي بتطبطب على الروح 🍲🍗🤍',
  'أنا بحب جداً ريحة الورد البلدي والياسمين لما ينزل عليهم ندى الصبح.. تفاصيل صغيرة بس بتخلي بداية اليوم مليانة أمل وتفاؤل 🌸🌱',
  'إيه أكتر مكان في القاهرة بتحسوا فيه بالأمان والراحة وبتحبوا تروحوا تقعدوا فيه لوحدكم؟ شاركونا أماكنكم السرية ☕🏙️',
  'لعبة Monument Valley والموسيقى الهادية والألغاز البصرية اللي فيها.. من أهدى وأرق الألعاب اللي لعبتها على الموبايل 🏰✨🎧',
  'أكتر حاجة بحبها في الشتا لما كلنا نتجمع في الصالة ونتفرج على فيلم عائلي مع الفشار والبطاطين والضحك.. الدفا ده ميتعوضش 🍿🛋️❄️',
  'مين بيحب يحتفظ بكل التذاكر القديمة، تذاكر القطر والسينما والحفلات والجوابات؟ الصندوق ده بيبقى كبسولة زمنية لذكريات غالية 💌🎟️',
  'في نهاية اليوم، رسالة تذكير: متقسيش على نفسك.. إنتي بتعملي اللي عليكي والخير جاي في وقته المناسب دايماً، توكلي على الله ونامي مرتاحة 🌸🤍🤲'
];

const malePosts = gamingPosts.concat(extraMalePosts).slice(0, 240);
const femalePosts = female50Posts.concat(extraFemalePosts).slice(0, 60);

// Escape single quotes for SQL: replace ' with ''
function sqlQuote(str) {
  const unescaped = str.replace(/''/g, "'");
  return "'" + unescaped.replace(/'/g, "''") + "'";
}

const maleSqlEntries = malePosts.map((p, i) => `    -- [${i + 1}]\n    ${sqlQuote(p)}`).join(',\n');
const femaleSqlEntries = femalePosts.map((p, i) => `    -- [${i + 1}]\n    ${sqlQuote(p)}`).join(',\n');

const sqlMigration = `-- ============================================================================
-- Sohba (صُحبة) — Random 5 to 15-Minute Interval & Strictly Unique Demo Posts
-- 1. Interval: Randomly between 5 and 15 minutes between fake account posts
--    (organically varying between 300 and 900 seconds).
-- 2. No Duplicate Posts:
--    - 240 completely unique young Egyptian men posts (3 cycles of 80 distinct posts).
--    - 60 completely unique Egyptian women posts (3 cycles of 20 distinct posts).
--    - Interleaved 4:1 (4 young men : 1 woman).
--    - Within any batch of 100 posts, all 100 posts are 100% distinct.
--    - Across ANY sliding window of 100 consecutive posts, zero duplicates are guaranteed!
-- 3. Resets pending queue and launches the new randomized schedule immediately.
-- ============================================================================

-- ============================================================================
-- 1. demo_post_text(p_index, p_gender): 240 Male Posts & 60 Female Posts
-- ============================================================================

create or replace function public.demo_post_text(p_index integer, p_gender text default 'male')
returns text
language plpgsql
immutable
set search_path = public
as $$
declare
  v_idx integer;
  v_male_posts text[] := array[
${maleSqlEntries}
  ];

  v_female_posts text[] := array[
${femaleSqlEntries}
  ];
begin
  if p_gender = 'female' then
    v_idx := ((abs(p_index - 1)) % 60) + 1;
    return v_female_posts[v_idx];
  else
    v_idx := ((abs(p_index - 1)) % 240) + 1;
    return v_male_posts[v_idx];
  end if;
end;
$$;

revoke execute on function public.demo_post_text(integer, text) from public, anon, authenticated;
grant execute on function public.demo_post_text(integer, text) to service_role;

-- ============================================================================
-- 2. schedule_next_demo_batch(): Random 5 to 15-Minute Gap & Guaranteed Unique 100 Posts
-- ============================================================================

create or replace function public.schedule_next_demo_batch()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_run_date date := current_date;
  v_last_scheduled timestamptz;
  v_cursor timestamptz;
  v_account record;
  v_scheduled_count integer := 0;
  v_total_published integer := 0;
  v_batch_num integer := 0;
  v_post_index integer;
  v_body text;
  v_gender text;
  v_scheduled_at timestamptz;
  v_rand_seconds integer;
begin
  -- 1. Respect master pause toggle
  if exists (select 1 from public.demo_post_settings where id = 1 and not auto_posting_enabled) then
    return 0;
  end if;

  -- 2. Advisory lock prevents concurrent scheduling races
  if not pg_try_advisory_xact_lock(hashtextextended('schedule_next_demo_batch', 8821)) then
    return 0;
  end if;

  -- 3. Determine start time: right after the last queued post, or NOW if empty/overdue
  select max(scheduled_at) into v_last_scheduled
  from public.demo_daily_posts
  where post_id is null;

  if v_last_scheduled is null or v_last_scheduled < now() then
    v_cursor := now();
  else
    v_cursor := v_last_scheduled;
  end if;

  -- 4. Calculate total posts published so far to rotate batches continuously
  select coalesce(sum(posts_created), 0)::integer into v_total_published
  from public.demo_daily_runs;

  v_batch_num := v_total_published / 100;

  -- 5. Schedule 100 demo accounts with 4:1 young men to women pattern
  --    Using disjoint sets per batch guaranteeing 0 duplicates in any consecutive 100 posts
  for v_account in
    with active_accounts as (
      select
        p.id,
        coalesce(p.demo_gender, 'male') as demo_gender,
        p.username
      from public.profiles p
      left join public.account_moderation m on m.user_id = p.id
      where p.is_demo_account
        and not coalesce(m.permanently_banned, false)
        and not coalesce(m.profile_permanently_banned, false)
        and (m.access_suspended_until is null or m.access_suspended_until <= now())
        and (m.posting_suspended_until is null or m.posting_suspended_until <= now())
    ),
    males as (
      select
        id,
        demo_gender,
        row_number() over (order by username, id)::integer - 1 as m_idx
      from active_accounts
      where demo_gender = 'male'
    ),
    females as (
      select
        id,
        demo_gender,
        row_number() over (order by username, id)::integer - 1 as f_idx
      from active_accounts
      where demo_gender = 'female'
    ),
    ordered_slots as (
      -- 4 young men for every 1 woman:
      -- Slots: 0,1,2,3 (males), 4 (female), 5,6,7,8 (males), 9 (female)...
      select
        id,
        demo_gender,
        m_idx as gender_index,
        ((m_idx / 4) * 5 + (m_idx % 4))::integer as slot_rank
      from males
      union all
      select
        id,
        demo_gender,
        f_idx as gender_index,
        (f_idx * 5 + 4)::integer as slot_rank
      from females
    )
    select
      id,
      demo_gender,
      gender_index,
      row_number() over (order by slot_rank, id)::integer - 1 as account_index
    from ordered_slots
    order by slot_rank, id
  loop
    v_gender := v_account.demo_gender;

    -- Strict cycling:
    -- Each batch takes a fresh set of 80 male posts and 20 female posts
    -- Ensures ZERO duplicate posts within any 100 consecutive posts
    if v_gender = 'female' then
      v_post_index := ((v_batch_num * 20 + v_account.gender_index) % 60) + 1;
    else
      v_post_index := ((v_batch_num * 80 + v_account.gender_index) % 240) + 1;
    end if;

    v_body := public.demo_post_text(v_post_index, v_gender);

    -- Timing: First post at v_cursor, subsequent posts spaced by random 5 to 15 minutes (300 to 900 seconds)
    if v_scheduled_count = 0 and v_cursor <= now() then
      v_scheduled_at := v_cursor;
    else
      v_rand_seconds := 300 + floor(random() * 601)::integer;
      v_cursor := v_cursor + (v_rand_seconds::text || ' seconds')::interval;
      v_scheduled_at := v_cursor;
    end if;

    insert into public.demo_daily_posts (run_date, user_id, post_id, body, scheduled_at)
    values (v_run_date, v_account.id, null, v_body, v_scheduled_at);

    v_scheduled_count := v_scheduled_count + 1;
  end loop;

  return v_scheduled_count;
end;
$$;

grant execute on function public.schedule_next_demo_batch() to anon, authenticated, service_role;

-- ============================================================================
-- 3. publish_due_demo_post(): Smooth Delivery & Randomized Backlog Smoothing
-- ============================================================================

create or replace function public.publish_due_demo_post()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item public.demo_daily_posts%rowtype;
  v_post_id uuid;
  v_unposted_count integer;
begin
  -- 1. Check auto-posting toggle
  if exists (select 1 from public.demo_post_settings where id = 1 and not auto_posting_enabled) then
    return 0;
  end if;

  -- 2. Check remaining unposted queue size. If < 5 (or 0), automatically refill next 100 batch!
  select count(*) into v_unposted_count
  from public.demo_daily_posts
  where post_id is null;

  if v_unposted_count < 5 then
    perform public.schedule_next_demo_batch();
  end if;

  -- 3. If backlog exists (> 15 minutes overdue due to no active viewers), realign queue smoothly from NOW
  -- Spaced by random 5 to 15 minutes so posts never dump in a burst!
  if exists (
    select 1 from public.demo_daily_posts
    where post_id is null and scheduled_at < now() - interval '15 minutes'
  ) then
    with reordered as (
      select
        id,
        sum((300 + floor(random() * 601))::integer) over (
          order by scheduled_at asc
          rows between unbounded preceding and 1 preceding
        ) as offset_seconds
      from public.demo_daily_posts
      where post_id is null
    )
    update public.demo_daily_posts dp
    set scheduled_at = now() + (coalesce(r.offset_seconds, 0)::text || ' seconds')::interval
    from reordered r
    where dp.id = r.id;
  end if;

  -- 4. Select the earliest scheduled post that is due
  select * into v_item
  from public.demo_daily_posts
  where post_id is null and scheduled_at <= now()
  order by scheduled_at asc
  for update skip locked
  limit 1;

  if not found then
    return 0;
  end if;

  -- 5. Publish to public.posts
  insert into public.posts (author_id, body, image_url, is_urgent)
  values (v_item.user_id, v_item.body, null, false)
  returning id into v_post_id;

  -- 6. Mark as published
  update public.demo_daily_posts
  set post_id = v_post_id, published_at = now()
  where id = v_item.id;

  -- 7. Update daily runs counter
  insert into public.demo_daily_runs (run_date, posts_created)
  values (current_date, 1)
  on conflict (run_date) do update
    set posts_created = public.demo_daily_runs.posts_created + 1;

  -- 8. Clean up old published queue logs (> 48h old) to keep database light
  delete from public.demo_daily_posts
  where post_id is not null and published_at < now() - interval '48 hours';

  return 1;
end;
$$;

grant execute on function public.publish_due_demo_post() to anon, authenticated, service_role;

-- ============================================================================
-- 4. publish_daily_demo_posts(): Manual or Admin trigger
-- ============================================================================

create or replace function public.publish_daily_demo_posts()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_scheduled integer;
begin
  if exists (select 1 from public.demo_post_settings where id = 1 and not auto_posting_enabled) then
    return 0;
  end if;

  -- Clear any unposted queue rows so we start fresh right now
  delete from public.demo_daily_posts where post_id is null;

  -- Schedule the next 100 batch with random 5-15 minute gaps and 0 duplicates
  v_scheduled := public.schedule_next_demo_batch();

  -- Immediately publish post #1 right now!
  perform public.publish_due_demo_post();

  return v_scheduled;
end;
$$;

grant execute on function public.publish_daily_demo_posts() to anon, authenticated, service_role;

-- ============================================================================
-- 5. Register pg_cron to trigger publish_due_demo_post every minute
--    (Checks each minute and publishes whenever a post's random time is reached)
-- ============================================================================

do $$
begin
  perform cron.unschedule('sohba-publish-demo-post-1min');
exception when others then null;
end;
$$;

do $$
begin
  perform cron.unschedule('sohba-publish-demo-post-15min');
exception when others then null;
end;
$$;

do $$
begin
  perform cron.unschedule('sohba-publish-demo-post-random');
exception when others then null;
end;
$$;

do $$
begin
  perform cron.schedule(
    'sohba-publish-demo-post-random',
    '* * * * *',
    'select public.publish_due_demo_post();'
  );
exception when others then null;
end;
$$;

-- ============================================================================
-- 6. Instantly clear pending queue and launch the new randomized schedule NOW!
-- ============================================================================
delete from public.demo_daily_posts where post_id is null;
select public.publish_daily_demo_posts();
`;

const targetFile = 'supabase/migrations/20261030190000_demo_posts_15min_no_duplicates_100.sql';
fs.writeFileSync(targetFile, sqlMigration, 'utf8');
console.log('Successfully wrote migration to:', targetFile);
console.log('File size:', fs.statSync(targetFile).size, 'bytes');

// Also create 20261030200000_demo_random_5_to_15_min.sql so both filenames exist if tracked
const targetFile2 = 'supabase/migrations/20261030200000_demo_random_5_to_15_min.sql';
fs.writeFileSync(targetFile2, sqlMigration, 'utf8');
console.log('Successfully wrote migration to:', targetFile2);
