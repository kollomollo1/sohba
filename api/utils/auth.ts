import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let _serverSupabase: SupabaseClient | null = null;

export function getServerSupabase(): SupabaseClient {
  if (!_serverSupabase) {
    const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '';
    const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '';

    if (!supabaseUrl || !supabaseAnonKey) {
      throw new Error('Supabase environment variables (VITE_SUPABASE_URL / SUPABASE_URL and VITE_SUPABASE_ANON_KEY / SUPABASE_ANON_KEY) are missing on the server.');
    }

    _serverSupabase = createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });
  }
  return _serverSupabase;
}

export const serverSupabase = new Proxy({} as SupabaseClient, {
  get(_target, prop) {
    const client = getServerSupabase();
    const val = (client as any)[prop];
    return typeof val === 'function' ? val.bind(client) : val;
  },
});

export async function authenticateUser(authHeader: string | undefined) {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return { user: null, error: 'رمز المصادقة غير موجود أو غير صالح' };
  }

  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!token) {
    return { user: null, error: 'رمز المصادقة فارغ' };
  }

  try {
    const client = getServerSupabase();
    const { data, error } = await client.auth.getUser(token);
    if (error || !data.user) {
      return { user: null, error: error?.message || 'المستخدم غير مسجل أو انتهت صلاحية الجلسة' };
    }

    return { user: data.user, error: null };
  } catch (err: any) {
    return { user: null, error: err.message || 'فشل الاتصال بخدمة المصادقة' };
  }
}

