-- Keep a stable gender for each game profile so generated writing matches it.
alter table public.profiles
  add column if not exists demo_gender text
    check (demo_gender is null or demo_gender in ('female', 'male'));

update public.profiles
set demo_gender = case
  when username ~ '^demo_[0-9]{3}$' and substring(username from 6)::integer between 1 and 50 then 'female'
  when username ~ '^demo_[0-9]{3}$' and substring(username from 6)::integer between 51 and 100 then 'male'
  else demo_gender
end
where is_demo_account and demo_gender is null;

create or replace function public.demo_post_text(p_index integer, p_gender text)
returns text
language plpgsql
immutable
set search_path = public
as $$
declare
  v_female_posts text[] := array[
    'كنت راجعة من مشوار طويل ولقيت ماما عاملة شاي، أحلى استقبال بعد يوم مرهق.',
    'النهارده كنت متوترة من مقابلة الشغل، بس أول ما بدأت الكلام حسيت إني أهدى.',
    'خلصت حاجة كنت مأجلاها من فترة، ومبسوطة إني أخيرًا بطلت أهرب منها.',
    'أوقات ببقى محتاجة أقعد لوحدي شوية من غير ما حد يفتكر إني زعلانة.',
    'صحيت بدري وخرجت قبل الزحمة، حسيت إن اليوم بقى أطول وألطف.',
    'كنت فاكرة إن المشوار هياخد وقت كبير، لكنه خلص بسرعة ورجعت مبسوطة.',
    'النهارده اتلخبطت في المواعيد ونسيت حاجة مهمة، بس لحقت أصلح الموضوع.',
    'قعدت مع صاحبتي نحكي في كل حاجة، ورجعت البيت وأنا حاسة إن نفسيتي أحسن.',
    'عملت أكلة جديدة وكنت قلقة تطلع مش مظبوطة، بس الكل طلب مني أعملها تاني.',
    'أكتر حاجة فرحتني النهارده إن بابا افتكر يسألني عن حاجة كنت حكيتها له.',
    'كنت مستنية الرد من الصبح، ولما وصل ارتحت حتى لو النتيجة مش اللي كنت متوقعاها.',
    'نزلت أتمشى شوية وأنا متضايقة، ورجعت أهدى من غير ما أعمل حاجة كبيرة.',
    'الجو كان حلو فقررت أروح مشواري مشي، رجلي تعبت بس انبسطت بالطريق.',
    'النهارده كنت مشغولة جدًا، بس لحقت أطمن على جدتي قبل ما اليوم يخلص.',
    'لقيت صورة قديمة ليا مع صحابي، وفضلت أضحك على لبسنا وتسريحاتنا وقتها.',
    'فيه مكالمة كنت مترددة أعملها، ولما عملتها اكتشفت إن قلقي كان أكبر من الموضوع.',
    'مش كل يوم لازم أكون منتجة، النهارده اكتفيت إني خلصت الضروري وارتحت.',
    'كنت محتاجة أسمع كلمة تشجيع، وصاحبتي قالتها في وقتها بالظبط.',
    'أمي سألتني أكلت ولا لأ، وبعدها بعشر دقايق لقيتها باعتالي طبق على البيت.',
    'الطريق كان زحمة وأنا متأخرة، بس السواق استنى لحد ما ركبت وده فرحني.',
    'بدأت أتعلم حاجة جديدة أونلاين، أول درس كان سهل والتاني محتاج تركيز أكتر.',
    'النهارده قدرت أقول لأ لحاجة مش مناسبة لوقتي، ولسه بتعلم أعمل كده من غير تأنيب ضمير.',
    'رتبت الدولاب وطلعت هدوم كنت ناسية إنها عندي، كأني عملت شوبينج في البيت.',
    'كنت قلقانة على نتيجة الكشف، والحمد لله الدكتورة طمنتني وقالتلي أتابع بس.',
    'قعدت أسمع حكايات خالتي عن أيام الجامعة، وكل حكاية كانت تفتح حكاية تانية.',
    'النهارده رجعت بدري وقعدت مع إخواتي، ضحكنا على مواقف قديمة لحد ما نسينا الوقت.',
    'اتأخرت في تسليم حاجة، كلمت الشخص وشرحتله بدل ما أفضل متوترة وأأجل المكالمة.',
    'أنا مبسوطة إني بقيت أطلب المساعدة لما أحتاجها بدل ما أضغط على نفسي.',
    'جربت أعمل قهوة في البيت بطريقة مختلفة، طلعت حلوة ووفرت عليا مشوار الكافيه.',
    'كان عندي يوم مليان تفاصيل صغيرة متعبة، بس في آخره لقيت رسالة لطيفة غيرت مودّي.',
    'مشيت في شارع جانبي وأنا راجعة، واكتشفت محل ورد صغير هعدي عليه تاني.',
    'كنت فاكرة إني هقضي الويك إند في النوم، لكن خروجة بسيطة مع البنات كانت أحلى.',
    'النهارده نسيت الشاحن في البيت وفضلت محافظة على البطارية كأنها كنز.',
    'أنا فرحانة لواحدة صاحبتي حققت حاجة كانت بتحلم بيها من زمان.',
    'حضرت فطار لنفسي وقعدت آكله براحة، مش فاكرة آخر مرة بدأت يومي من غير استعجال.',
    'فيه حاجات بتضايقني لما تتراكم، فكتبتها في ورقة وبدأت أتعامل معاها واحدة واحدة.',
    'كنت متحمسة للخروجة، ولما اتلغت اتضايقت شوية وبعدها عملت لنفسي يوم لطيف في البيت.',
    'النهارده زميلتي في الشغل افتكرت إني بحب النعناع وجابتلي شاي بيه.',
    'أنا محتاجة إجازة من المنبهات والاجتماعات، حتى يوم هادي من غير خطط هيبقى جميل.',
    'اتعلمت أعمل حاجة في الموبايل كنت كل مرة أطلب من حد يساعدني فيها، إحساس حلو.',
    'روحت أزور جدتي وقعدت جنبها شوية، وجودها لوحده بيخليني أهدى.',
    'كنت متضايقة من تأخير الرد، وبعد ما اتكلمنا فهمت إن الطرف التاني كان مضغوط هو كمان.',
    'النهارده عملت لنفسي غدا بسيط بدل ما أطلب أكل، وطلع أحسن مما توقعت.',
    'لقيت فلوس كنت حطاها في جيب جاكيت من الشتاء اللي فات، مكسب غير متوقع.',
    'التمرين كان تقيل عليا النهارده، بس مبسوطة إني نزلت حتى لو ماعملتش كل اللي خططتله.',
    'قعدت أرتب صور الموبايل بدل ما أمسحها، الذكريات طلعت أكتر مما كنت فاكرة.',
    'كنت خايفة أروح المكان لوحدي، وبعد ما روحت اكتشفت إن الموضوع كان عادي ومريح.',
    'النهارده قابلت مدرسة قديمة وسألتني فاكراني ولا لأ، طبعًا فاكرة كل تفاصيل الفصل.',
    'عملت شوية تنظيف للمطبخ وشغلت أغاني بحبها، الوقت عدى أسرع مما توقعت.',
    'أنا متحمسة أبدأ الأسبوع بحاجة صغيرة جديدة بدل ما أستنى الظروف تبقى مثالية.',
    'قابلت صاحبتي صدفة قدام السوبرماركت، وقفنا نحكي لحد ما نسينا إحنا نازلين نجيب إيه.',
    'كان نفسي أخرج ومحدش كان فاضي، نزلت أتمشى لوحدي ورجعت مبسوطة.',
    'النهارده حسيت إني محتاجة أتكلم، فبعت لصاحبتي وسمعتني من غير ما تستعجلني.',
    'عملت قائمة صغيرة للحاجات اللي ورايا، شكلها بقى أهون لما كتبتها.',
    'المحل اللي تحت البيت غير مكانه، فضلت ألف عليه كأني أول مرة أعيش في المنطقة.',
    'كنت مستعجلة الصبح ونسيت أفطر، زميلتي قسمت معايا ساندوتشها وأنقذت الموقف.',
    'جربت أسيب الموبايل بعيد وأنا باكل، خدت بالي من طعم الأكل لأول مرة من فترة.',
    'النهارده قلت لنفسي أرتاح بدل ما ألومها على كل حاجة ماخلصتش.',
    'البيت كان مليان دوشة وضحك، حسيت إن اللمة دي كانت ناقصاني فعلًا.',
    'اتعلمت إن مش لازم أرد على كل رسالة فورًا، ساعات التأني بيخليني أهدى.',
    'أنا فخورة بنفسي إني كملت حاجة صعبة حتى وأنا ماكنتش واثقة في النتيجة.',
    'اشتريت حاجة كنت محتاجاها من فترة بعد ما فضلت أأجل، ارتحت إني خلصت الموضوع.',
    'النهارده خدت رأي حد بثق فيه قبل ما أقرر، وده خلاني أشوف الموضوع أوضح.',
    'قعدت في البلكونة أراقب الشارع شوية، الهدوء ده كان كل اللي محتاجاه.',
    'اتأجلت حاجة كنت مستنياها، اتضايقت بس قلت يمكن التأخير فيه خير.',
    'ضحكت من قلبي على موقف سخيف مع إخواتي، ولسه فاكرة الضحكة وأنا راجعة.',
    'كنت متوترة من أول يوم في المكان الجديد، لكن الناس كانوا ألطف مما توقعت.',
    'النهارده افتكرت أجيب طلبات البيت قبل ما ماما تفكرني، إنجاز عائلي مهم.',
    'أنا ممتنة إن عندي ناس أقدر أكلمهم لما دماغي تبقى زحمة.',
    'وصلت البيت ولقيت حد عامل شاي وحاططلي كباية، التفاصيل الصغيرة دي بتفرق.',
    'الجو قلب فجأة وأنا نازلة من غير جاكيت، واضح إني لسه مش بتعلم من أخطائي.',
    'بقيت أفرح لما أخلص حاجة واحدة بتركيز بدل ما أبدأ خمس حاجات ومكملش ولا واحدة.',
    'النهارده ماعرفتش أركز زي ما كنت عايزة، هحاول تاني بكرة من غير ضغط.',
    'قعدت مع ماما نحكي في مواضيع عادية، وبقيت مقدرة الوقت ده أكتر من زمان.',
    'كنت مترددة أغير رأيي، بس لما فكرت بهدوء لقيت إن ده الأنسب ليا.',
    'أحلى جزء في اليوم كان لما رجعت البيت ولقيت أهلي مستنييني على الغدا.',
    'مشوار البنك أخد وقت، بس الموظفة كانت محترمة وشرحتلي كل حاجة براحة.',
    'النهارده اخترت أخلص الضروري والباقي يستنى، مش لازم أعمل كل حاجة مرة واحدة.',
    'أنا فرحانة إن الجو بقى ألطف، نفسي أتمشى كل يوم حتى لو ربع ساعة.',
    'النهارده ماكانش مثالي، بس فيه لحظات صغيرة حلوة تستاهل تتسجل.',
    'قعدت أراجع الأسبوع، فيه حاجات ماخلصتش بس فيه حاجات اتحركت فعلًا.',
    'كنت محتاجة أغير جو، قعدت في مكان قريب ساعة ورجعت بدماغ أصفى.',
    'النهارده اعتذرت عن حاجة مش هقدر عليها، وحسيت براحة بدل ما أفضل شايلة همها.',
    'رجعت من مشوار طويل ولقيت البيت هادي، عملت لنفسي حاجة سخنة وقعدت أرتاح.',
    'أوقات الإنجاز فيها إنك تعدي اليوم على خير، والنهارده كان من النوع ده.',
    'أنا مبسوطة إني بطلت أقارن يومي بيوم حد تاني، كل واحدة وليها ظروفها.',
    'صحيت متأخرة وبدأ اليوم ملخبط، بس لحقت أعمل أهم حاجة قبل آخر النهار.',
    'النهارده اكتشفت إن البقال عارف طلبي المعتاد أكتر مني أنا شخصيًا.',
    'كان عندي مشوارين في ناحيتين مختلفتين، رجلي بتطلب إجازة دلوقتي.',
    'لقيت ورقة قديمة بخط إيدي فيها هدف كنت ناسيه، يمكن أرجع أحاول فيه تاني.',
    'أنا سعيدة إن صاحبتي سألت عليا النهارده من غير ما يكون فيه مناسبة.',
    'الشارع كان زحمة جدًا، بس ست في الطابور خلتني أعدي قبلها عشان كنت مستعجلة.',
    'النهارده خلصت مشوار كنت مأجلاه من أسبوع، وطلع أسهل بكتير من اللي كنت متخيلة.',
    'قعدت أسمع حكايات جدتي عن زمان، كل مرة بسمع حاجة جديدة كأني أول مرة.',
    'مش لازم اليوم يبقى مليان أحداث عشان يبقى كويس، الهدوء كان كفاية النهارده.',
    'كنت متحمسة أجرب المكان الجديد، طلع أهدى من الصور وألطف من اللي توقعت.',
    'النهارده لقيت نفسي بقول حاضر وأنا مش فاضية، لازم أراجع وقتي قبل ما أوافق.',
    'رجعت من الشغل وبدلت هدومي ونزلت تاني عشان افتكرت إن عندي طلبات ناقصة.',
    'أنا مبسوطة إني اتكلمت بصراحة بدل ما أفضل مستنية حد يفهم لوحده.',
    'أول مرة أروح مشوار جديد لوحدي من غير ما أتوتر، الخطوة الصغيرة فرقت معايا.'
  ];
begin
  if p_gender = 'female' then
    return v_female_posts[((greatest(p_index, 1) - 1) % cardinality(v_female_posts)) + 1];
  end if;
  return public.demo_post_text(p_index);
end;
$$;

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
  v_post_index integer;
  v_body text;
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
    select p.id, p.demo_gender,
      row_number() over (partition by p.demo_gender order by p.username)::integer - 1 as gender_index
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
    v_post_index := (extract(doy from v_run_date)::integer - 1) * 50 + v_account.gender_index + 1;
    v_body := public.demo_post_text(v_post_index, coalesce(v_account.demo_gender, 'male'));
    v_scheduled_at := v_start + (v_day_end - v_start) *
      (v_scheduled_count::double precision / v_eligible_count);

    insert into public.demo_daily_posts (run_date, user_id, post_id, body, scheduled_at)
    values (v_run_date, v_account.id, null, v_body, v_scheduled_at)
    on conflict (run_date, user_id) do nothing;
    if found then v_scheduled_count := v_scheduled_count + 1; end if;
  end loop;
  return v_scheduled_count;
end;
$$;

revoke execute on function public.demo_post_text(integer, text) from public, anon, authenticated;
revoke execute on function public.publish_daily_demo_posts() from public, anon, authenticated;
grant execute on function public.publish_daily_demo_posts() to service_role;

-- Refresh today's queued and already published demo posts with matching voice.
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
