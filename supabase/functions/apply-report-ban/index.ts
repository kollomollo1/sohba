import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });

  const authorization = request.headers.get('Authorization');
  if (!authorization) return Response.json({ error: 'Unauthorized' }, { status: 401, headers: corsHeaders });

  const url = Deno.env.get('SUPABASE_URL')!;
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const userClient = createClient(url, anonKey, { global: { headers: { Authorization: authorization } } });
  const adminClient = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: { user }, error: userError } = await userClient.auth.getUser();
  if (userError || !user) return Response.json({ error: 'Unauthorized' }, { status: 401, headers: corsHeaders });

  let payload: { post_id?: string; profile_id?: string; admin_action?: string; user_id?: string };
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: 'Invalid request' }, { status: 400, headers: corsHeaders });
  }
  if (payload.admin_action) {
    if (user.app_metadata?.role !== 'admin') {
      return Response.json({ error: 'Admin role required' }, { status: 403, headers: corsHeaders });
    }
    const targetUserId = String(payload.user_id ?? '');
    if (!/^[0-9a-f-]{36}$/i.test(targetUserId) || targetUserId === user.id) {
      return Response.json({ error: 'Invalid target user' }, { status: 400, headers: corsHeaders });
    }
    const banDuration = payload.admin_action === 'suspend_1d' || payload.admin_action === 'suspend_24h'
      ? '24h'
      : payload.admin_action === 'suspend_3d'
        ? '72h'
        : payload.admin_action === 'ban_permanent'
          ? '876000h'
          : payload.admin_action === 'unban' ? 'none' : null;
    if (!banDuration) return Response.json({ error: 'Unsupported admin action' }, { status: 400, headers: corsHeaders });

    const { error: authActionError } = await adminClient.auth.admin.updateUserById(targetUserId, { ban_duration: banDuration });
    if (authActionError && !authActionError.message.toLowerCase().includes('not found')) {
      return Response.json({ error: 'Could not update Supabase Auth ban: ' + authActionError.message }, { status: 500, headers: corsHeaders });
    }
    const { error: moderationError } = await userClient.rpc('admin_set_account_restriction', {
      p_user_id: targetUserId,
      p_action: payload.admin_action,
    });
    if (moderationError) return Response.json({ error: moderationError.message }, { status: 500, headers: corsHeaders });
    return Response.json({ ok: true, action: payload.admin_action }, { headers: corsHeaders });
  }

  const isProfileReport = Boolean(payload.profile_id);
  const targetId = String(isProfileReport ? payload.profile_id : payload.post_id ?? '');
  if (!/^[0-9a-f-]{36}$/i.test(targetId)) return Response.json({ error: 'Invalid target id' }, { status: 400, headers: corsHeaders });

  let reportedUserId: string | undefined;
  let banDuration: string | null = null;
  let offenseCount = 0;
  if (isProfileReport) {
    const { data: rows, error } = await adminClient.from('profile_reports')
      .select('reporter_id, reported_user_id').eq('reported_user_id', targetId);
    if (error) return Response.json({ error: 'Could not verify profile reports' }, { status: 500, headers: corsHeaders });
    if (!(rows ?? []).some((row) => row.reporter_id === user.id)) {
      return Response.json({ error: 'No profile report from this user' }, { status: 403, headers: corsHeaders });
    }
    if (new Set((rows ?? []).map((row) => row.reporter_id)).size < 10) {
      return Response.json({ ok: true, action: 'threshold_not_reached' }, { headers: corsHeaders });
    }
    reportedUserId = targetId;
    const { data: moderation, error: moderationError } = await adminClient.from('account_moderation')
      .select('profile_permanently_banned, profile_auth_ban_applied')
      .eq('user_id', targetId).maybeSingle();
    if (moderationError || !moderation) return Response.json({ error: 'Moderation record missing' }, { status: 500, headers: corsHeaders });
    if (!moderation.profile_permanently_banned || moderation.profile_auth_ban_applied) {
      return Response.json({ ok: true, action: 'no_auth_ban_needed' }, { headers: corsHeaders });
    }
    banDuration = '876000h';
  } else {
    const { data: rows, error } = await adminClient.from('post_reports')
      .select('reporter_id, reported_user_id').eq('subject_post_id', targetId);
    if (error) return Response.json({ error: 'Could not verify reports' }, { status: 500, headers: corsHeaders });
    if (!(rows ?? []).some((row) => row.reporter_id === user.id)) {
      return Response.json({ error: 'No report from this user for the post' }, { status: 403, headers: corsHeaders });
    }
    if (new Set((rows ?? []).map((row) => row.reporter_id)).size < 5) {
      return Response.json({ ok: true, action: 'threshold_not_reached' }, { headers: corsHeaders });
    }
    reportedUserId = rows?.[0]?.reported_user_id;
    if (!reportedUserId || rows?.some((row) => row.reported_user_id !== reportedUserId)) {
      return Response.json({ error: 'Inconsistent report records' }, { status: 500, headers: corsHeaders });
    }
    const { data: moderation, error: moderationError } = await adminClient.from('account_moderation')
      .select('offense_count, auth_ban_applied_offense')
      .eq('user_id', reportedUserId).maybeSingle();
    if (moderationError || !moderation) return Response.json({ error: 'Moderation record missing' }, { status: 500, headers: corsHeaders });
    if (moderation.offense_count < 2 || moderation.auth_ban_applied_offense >= moderation.offense_count) {
      return Response.json({ ok: true, action: 'no_auth_ban_needed' }, { headers: corsHeaders });
    }
    offenseCount = moderation.offense_count;
    banDuration = moderation.offense_count === 2 ? '72h' : '876000h';
  }

  const { error: banError } = await adminClient.auth.admin.updateUserById(reportedUserId!, { ban_duration: banDuration! });
  if (banError) return Response.json({ error: 'Could not apply authentication ban' }, { status: 500, headers: corsHeaders });

  const update = isProfileReport
    ? { profile_auth_ban_applied: true }
    : { auth_ban_applied_offense: offenseCount };
  const { error: updateError } = await adminClient.from('account_moderation').update(update).eq('user_id', reportedUserId!);
  if (updateError) return Response.json({ error: 'Ban applied, but moderation status sync failed' }, { status: 500, headers: corsHeaders });

  return Response.json({ ok: true, action: isProfileReport ? 'permanent_profile_report_ban' : banDuration === '72h' ? 'three_day_auth_ban' : 'permanent_auth_ban' }, { headers: corsHeaders });
});
