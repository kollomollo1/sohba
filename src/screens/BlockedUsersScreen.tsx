import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Ban, Loader2, RotateCcw, Search, RefreshCw, ShieldAlert } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { Avatar } from '@/components/Avatar';

type BlockedUser = {
  user_id: string;
  full_name: string;
  username: string;
  avatar_url: string | null;
  blocked_at?: string;
  ban_label?: string;
  is_admin_ban?: boolean;
};

export function BlockedUsersScreen() {
  const navigate = useNavigate();
  const { profile, session } = useAuth();
  const isAdmin = session?.user.app_metadata?.role === 'admin';

  const [blockedUsers, setBlockedUsers] = useState<BlockedUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [unblockingId, setUnblockingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  const loadBlockedUsers = useCallback(async () => {
    if (!profile?.id) return;
    setLoading(true);
    setError(null);
    try {
      const { data: myBlocked, error: myErr } = await supabase.rpc('my_blocked_users');
      if (myErr) console.error('load blocked users failed', myErr.message);

      let list: BlockedUser[] = ((myBlocked ?? []) as any[]).map((u) => ({
        user_id: u.user_id,
        full_name: u.full_name,
        username: u.username,
        avatar_url: u.avatar_url,
        blocked_at: u.blocked_at,
        ban_label: 'حظر شخصي',
        is_admin_ban: false,
      }));

      if (isAdmin) {
        const { data: adminUsers, error: adminErr } = await supabase.rpc('admin_user_overview');
        if (!adminErr && adminUsers && Array.isArray(adminUsers)) {
          const existingMap = new Map(list.map((u) => [u.user_id, u]));
          for (const u of adminUsers as any[]) {
            const activeBan = !!u.access_suspended_until && new Date(u.access_suspended_until) > new Date();
            const permBan = !!u.permanently_banned;
            if (activeBan || permBan) {
              const label = permBan
                ? 'حظر نهائي'
                : `إيقاف مؤقت حتى ${new Date(u.access_suspended_until).toLocaleDateString('ar-EG')}`;
              if (existingMap.has(u.user_id)) {
                const item = existingMap.get(u.user_id)!;
                item.ban_label = label;
                item.is_admin_ban = true;
              } else {
                existingMap.set(u.user_id, {
                  user_id: u.user_id,
                  full_name: u.full_name,
                  username: u.username,
                  avatar_url: u.avatar_url,
                  blocked_at: u.created_at,
                  ban_label: label,
                  is_admin_ban: true,
                });
              }
            }
          }
          list = Array.from(existingMap.values());
        }
      }
      setBlockedUsers(list);
    } catch (err: any) {
      setError('تعذّر تحميل قائمة المحظورين: ' + (err.message || String(err)));
    } finally {
      setLoading(false);
    }
  }, [profile?.id, isAdmin]);

  useEffect(() => {
    void loadBlockedUsers();
  }, [loadBlockedUsers]);

  async function unblockUser(userId: string) {
    if (!profile?.id) return;
    setUnblockingId(userId);
    setError(null);
    setSuccessMsg(null);
    try {
      if (isAdmin) {
        await supabase.functions.invoke('apply-report-ban', {
          body: { admin_action: 'unban', user_id: userId },
        });
        await supabase.rpc('admin_set_account_restriction', {
          p_user_id: userId,
          p_action: 'unban',
        });
      }
      const { error: delErr } = await supabase.from('user_content_filters').delete()
        .eq('viewer_id', profile.id).eq('target_user_id', userId).eq('mode', 'block_user');
      if (delErr && !isAdmin) {
        throw delErr;
      }
      setBlockedUsers((prev) => prev.filter((user) => user.user_id !== userId));
      setSuccessMsg('تم فك الحظر بنجاح.');
      setTimeout(() => setSuccessMsg(null), 3500);
    } catch (err: any) {
      console.error('unblock user failed', err.message);
      setError('تعذّر فك الحظر: ' + (err.message || 'حاول مرة أخرى.'));
    } finally {
      setUnblockingId(null);
    }
  }

  const filteredUsers = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return blockedUsers;
    return blockedUsers.filter((u) =>
      u.full_name.toLowerCase().includes(q) || u.username.toLowerCase().includes(q)
    );
  }, [blockedUsers, query]);

  return (
    <div className="app-shell">
      {/* Header */}
      <header className="sticky top-0 z-20 flex items-center gap-2 border-b border-surface-dim bg-surface-raised/95 px-3 py-3 backdrop-blur-md">
        <button
          onClick={() => navigate(-1)}
          className="flex h-10 w-10 items-center justify-center rounded-full text-ink-soft hover:bg-surface-subtle"
          aria-label="رجوع"
        >
          <ArrowLeft className="h-5 w-5 rotate-180" />
        </button>
        <div className="flex items-center gap-2">
          <Ban className="h-5 w-5 text-primary" />
          <h1 className="text-lg font-bold text-ink">قائمة الحظر</h1>
        </div>
        <span className="rounded-full bg-surface-subtle px-2.5 py-0.5 text-xs font-bold text-ink-muted">
          {blockedUsers.length}
        </span>
        <button
          onClick={() => void loadBlockedUsers()}
          disabled={loading}
          className="mr-auto flex h-9 w-9 items-center justify-center rounded-full text-primary hover:bg-primary-50 transition disabled:opacity-50"
          title="تحديث"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </header>

      <main className="app-body space-y-4 p-4">
        {/* Info card */}
        <div className="card-raised flex items-start gap-3 p-3.5 border border-surface-dim">
          <ShieldAlert className="h-5 w-5 text-primary shrink-0 mt-0.5" />
          <p className="text-xs leading-5 text-ink-muted">
            {isAdmin
              ? 'تتضمن هذه القائمة جميع الحسابات المحظورة إدارياً من التطبيق بالإضافة لأي حساب محظور شخصياً. فك الحظر يعيد إتاحة دخول الحساب للتطبيق وظهور منشوراته.'
              : 'فك الحظر يعيد إمكانية رؤية المنشورات والمحادثة السابقة ورسائلها بينك وبين المستخدم.'}
          </p>
        </div>

        {/* Search */}
        {blockedUsers.length > 3 && (
          <div className="relative">
            <Search className="absolute right-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="ابحث بالاسم أو اسم المستخدم..."
              className="input-field pr-10 text-sm"
            />
          </div>
        )}

        {error && (
          <div className="rounded-xl bg-error-50 px-3.5 py-2.5 text-sm text-error">
            {error}
          </div>
        )}

        {successMsg && (
          <div className="rounded-xl bg-primary-50 px-3.5 py-2.5 text-sm font-semibold text-primary">
            {successMsg}
          </div>
        )}

        {/* List */}
        {loading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : filteredUsers.length === 0 ? (
          <div className="card flex flex-col items-center justify-center py-12 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-surface-subtle text-ink-muted mb-3">
              <Ban className="h-7 w-7" />
            </div>
            <p className="font-bold text-ink">
              {query ? 'لا توجد نتائج مطابقة لبحثك' : 'لا يوجد مستخدمون محظورون'}
            </p>
            <p className="mt-1 text-xs text-ink-muted">
              {query ? 'جرّب كتابة اسم آخر' : 'لم تقم بحظر أي شخص حتى الآن.'}
            </p>
          </div>
        ) : (
          <div className="card-raised divide-y divide-surface-dim p-0 border border-surface-dim overflow-hidden">
            {filteredUsers.map((user) => (
              <div key={user.user_id} className="flex items-center gap-3 p-3.5 hover:bg-surface-subtle/50 transition">
                <Avatar name={user.full_name} src={user.avatar_url} size={44} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="truncate text-sm font-bold text-ink">{user.full_name}</p>
                    {user.ban_label && (
                      <span className="rounded-full bg-urgent/10 px-2 py-0.5 text-[10px] font-bold text-urgent">
                        {user.ban_label}
                      </span>
                    )}
                  </div>
                  <p className="truncate text-xs text-ink-muted mt-0.5">@{user.username}</p>
                </div>
                <button
                  onClick={() => void unblockUser(user.user_id)}
                  disabled={unblockingId === user.user_id}
                  className="inline-flex items-center gap-1.5 rounded-full bg-primary-50 px-3 py-2 text-xs font-semibold text-primary hover:bg-primary-100 disabled:opacity-50 transition shrink-0"
                >
                  {unblockingId === user.user_id ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <RotateCcw className="h-4 w-4" />
                  )}
                  فك الحظر
                </button>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
