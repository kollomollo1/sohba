import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const girls = [
  'مريم السيد', 'سارة حسن', 'نورهان علي', 'ملك إبراهيم', 'ياسمين عبدالسلام',
  'ندى عادل', 'منة فؤاد', 'آية منصور', 'بسمة سالم', 'دينا محمود',
  'رحمة عبدالرحمن', 'هبة جابر', 'سلمى فتحي', 'جنى مراد', 'فرح حمدي',
  'مي صبري', 'شهد خليل', 'ريم سعيد', 'هاجر أمين', 'رنا حجازي',
];
const boys = [
  'عمر السيد', 'يوسف حسن', 'أحمد علي', 'محمود إبراهيم', 'كريم عبدالسلام',
  'مصطفى منصور', 'محمد سالم', 'إسلام محمود', 'حسام عبدالرحمن', 'طارق جابر',
  'زياد فتحي', 'آدم مراد', 'خالد حمدي', 'عمرو صبري', 'حازم خليل',
  'شريف سعيد', 'مروان أمين', 'باسم حجازي', 'رامي زكي', 'علي ناصر',
  'إبراهيم عبدالعزيز', 'سيف رشدي', 'حسن الدسوقي', 'فادي يونس', 'وليد بدوي',
  'بدر حمدان', 'يحيى رجب', 'أنس شوقي', 'أمير زهران', 'مازن توفيق',
  'إيهاب بركات', 'سامر فوزي', 'أدهم سلامة', 'رؤوف الشاذلي', 'معتز أبوالنجا',
  'هاني المصري', 'سيف مرسي', 'وائل عطية', 'رامي درويش', 'عمر جاد',
  'نبيل عيسى', 'سامح رزق', 'مصطفى عوض', 'حازم حنفي', 'شادي كامل',
  'تامر عبدالمنعم', 'فارس غنيم', 'مهند توفيق', 'شريف فؤاد', 'أيمن مجدي',
  'حمزة عثمان', 'يوسف الشريف', 'كريم ممدوح', 'أحمد الشناوي', 'باسل إكرامي',
  'مالك أشرف', 'زياد الشامي', 'نديم البحيري', 'عاصم القاضي', 'زياد مهران',
  'مصطفى غالي', 'هشام عابدين', 'معاذ النجار', 'بلال الهواري', 'تيمور شكري',
  'شريف العطار', 'لؤي زهران', 'يحيى الباز', 'سليم الصاوي', 'مروان خفاجة',
  'يوسف والي', 'عمر الخواجة', 'مازن الغندور', 'خالد العريان', 'أدهم الشافعي',
  'ريان بدير', 'شهاب فهمي', 'راجي الجوهري', 'يامن صيام', 'عمار رضوان',
];

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return Response.json({ error: 'Method not allowed' }, { status: 405, headers: corsHeaders });

  const authorization = request.headers.get('Authorization');
  if (!authorization) return Response.json({ error: 'Unauthorized' }, { status: 401, headers: corsHeaders });

  const url = Deno.env.get('SUPABASE_URL')!;
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const userClient = createClient(url, anonKey, { global: { headers: { Authorization: authorization } } });
  const adminClient = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: { user }, error: authError } = await userClient.auth.getUser();
  if (authError || !user) return Response.json({ error: 'Unauthorized' }, { status: 401, headers: corsHeaders });
  if (user.app_metadata?.role !== 'admin') return Response.json({ error: 'Admin role required' }, { status: 403, headers: corsHeaders });

  let action: string;
  try { action = (await request.json()).action; }
  catch { return Response.json({ error: 'Invalid request' }, { status: 400, headers: corsHeaders }); }

  if (action === 'publish_today') {
    const { data, error } = await adminClient.rpc('publish_daily_demo_posts');
    if (error) return Response.json({ error: error.message }, { status: 500, headers: corsHeaders });
    await adminClient.rpc('publish_due_demo_post');
    return Response.json({ ok: true, scheduled: data ?? 0 }, { headers: corsHeaders });
  }

  if (action === 'create_100') {
    const { data: userPage, error: listError } = await adminClient.auth.admin.listUsers({ page: 1, perPage: 1000 });
    if (listError) return Response.json({ error: 'Could not inspect existing demo accounts' }, { status: 500, headers: corsHeaders });
    const existingByEmail = new Map((userPage.users ?? []).map((account) => [account.email?.toLowerCase(), account]));
    const jobs = Array.from({ length: 100 }, (_, index) => index + 1);
    let created = 0;
    const failures: string[] = [];
    let cursor = 0;
    const workers = Array.from({ length: 8 }, async () => {
      while (cursor < jobs.length) {
        const number = jobs[cursor++];
        const key = String(number).padStart(3, '0');
        const email = `guest${key}@demo.sohba.test`;
        const female = number > 80;
        const fullName = female ? girls[number - 81] : boys[number - 1];
        const demoGender = female ? 'female' : 'male';
        const username = `demo_${key}`;
        const avatarNumber = female ? number - 80 : ((number - 1) % 50) + 1;
        const avatarUrl = `/demo-avatars/${demoGender}_${String(avatarNumber).padStart(3, '0')}.jpg`;
        let account = existingByEmail.get(email);

        if (!account) {
          const { data, error } = await adminClient.auth.admin.createUser({
            email,
            password: `${crypto.randomUUID()}-Aa9!`,
            email_confirm: true,
            user_metadata: { full_name: fullName, username, is_demo_account: true, demo_gender: demoGender },
          });
          if (error || !data.user) {
            failures.push(`${key}: ${error?.message ?? 'create user failed'}`);
            continue;
          }
          account = data.user;
          created++;
        }

        const { error: metadataError } = await adminClient.auth.admin.updateUserById(account.id, {
          app_metadata: { ...account.app_metadata, is_demo_account: true },
          user_metadata: { ...account.user_metadata, full_name: fullName, username, is_demo_account: true, demo_gender: demoGender },
        });
        const { error: profileError } = await adminClient.from('profiles').upsert({
          id: account.id, full_name: fullName, username, is_demo_account: true, demo_gender: demoGender, avatar_url: avatarUrl,
        }, { onConflict: 'id' });
        if (metadataError || profileError) failures.push(`${key}: ${metadataError?.message ?? profileError?.message}`);
      }
    });
    await Promise.all(workers);
    const { data: published, error: publishError } = await adminClient.rpc('publish_daily_demo_posts');
    return Response.json({
      ok: failures.length === 0 && !publishError,
      created,
      ready: 100 - failures.length,
      postsScheduledToday: publishError ? null : published,
      failures: failures.slice(0, 10),
      publishError: publishError?.message,
    }, { status: failures.length || publishError ? 207 : 200, headers: corsHeaders });
  }

  if (action === 'delete_all') {
    const { data: demoProfiles, error: profilesError } = await adminClient.from('profiles')
      .select('id').eq('is_demo_account', true);
    if (profilesError) return Response.json({ error: profilesError.message }, { status: 500, headers: corsHeaders });
    const ids = (demoProfiles ?? []).map((item) => item.id).filter((id) => id !== user.id);
    let deleted = 0;
    const failures: string[] = [];
    for (let start = 0; start < ids.length; start += 10) {
      const results = await Promise.all(ids.slice(start, start + 10).map(async (id) => {
        const { error } = await adminClient.auth.admin.deleteUser(id);
        return { id, error };
      }));
      for (const result of results) {
        if (result.error) failures.push(result.id);
        else deleted++;
      }
    }
    return Response.json({ ok: failures.length === 0, deleted, failed: failures.length }, {
      status: failures.length ? 207 : 200, headers: corsHeaders,
    });
  }

  return Response.json({ error: 'Unsupported action' }, { status: 400, headers: corsHeaders });
});
