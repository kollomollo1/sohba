import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Bell, Heart, MessageCircle, Loader2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { Avatar } from '@/components/Avatar';
import { timeAgo } from '@/lib/format';

type NotificationItem = {
  id: string;
  actor_id: string;
  post_id: string;
  type: 'like' | 'comment';
  comment_excerpt: string | null;
  created_at: string;
  read_at: string | null;
  actor_name: string;
  actor_avatar: string | null;
  post_excerpt: string;
};

export function NotificationsScreen() {
  const navigate = useNavigate();
  const { profile } = useAuth();
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!profile?.id) return;
    const { data: rows, error: queryError } = await supabase
      .from('notifications')
      .select('id, actor_id, post_id, type, comment_excerpt, created_at, read_at')
      .eq('recipient_id', profile.id)
      .order('created_at', { ascending: false })
      .limit(100);
    if (queryError) {
      console.error('load notifications failed', queryError.message);
      setError(queryError.code === '42P01' || queryError.code === 'PGRST205'
        ? 'جدول الإشعارات غير مضاف بعد. شغّل ملف 20261025140000_notifications.sql في Supabase.'
        : 'تعذّر تحميل الإشعارات: ' + queryError.message);
      setLoading(false);
      return;
    }
    const actorIds = [...new Set((rows ?? []).map((row) => row.actor_id))];
    const postIds = [...new Set((rows ?? []).map((row) => row.post_id))];
    const [{ data: actors }, { data: posts }] = await Promise.all([
      actorIds.length
        ? supabase.from('profiles').select('id, full_name, avatar_url').in('id', actorIds)
        : Promise.resolve({ data: [], error: null }),
      postIds.length
        ? supabase.from('posts').select('id, body').in('id', postIds)
        : Promise.resolve({ data: [], error: null }),
    ]);
    const actorMap = new Map((actors ?? []).map((actor) => [actor.id, actor]));
    const postMap = new Map((posts ?? []).map((post) => [post.id, post]));
    setItems((rows ?? []).map((row) => {
      const actor = actorMap.get(row.actor_id);
      const post = postMap.get(row.post_id);
      return {
        ...row,
        actor_name: actor?.full_name ?? 'مستخدم',
        actor_avatar: actor?.avatar_url ?? null,
        post_excerpt: row.comment_excerpt || post?.body || '',
      };
    }) as NotificationItem[]);
    setError(null);
    setLoading(false);
  }, [profile?.id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function openNotification(item: NotificationItem) {
    if (!item.read_at && profile?.id) {
      const readAt = new Date().toISOString();
      const { error: updateError } = await supabase.from('notifications')
        .update({ read_at: readAt }).eq('id', item.id).eq('recipient_id', profile.id);
      if (!updateError) {
        setItems((prev) => prev.map((notification) =>
          notification.id === item.id ? { ...notification, read_at: readAt } : notification,
        ));
        window.dispatchEvent(new Event('notifications-read'));
      }
    }
    navigate('/post/' + item.post_id);
  }

  return (
    <div className="app-shell">
      <header className="sticky top-0 z-20 flex items-center gap-2 border-b border-surface-dim bg-surface-raised/95 px-3 py-3 backdrop-blur-md">
        <button onClick={() => navigate(-1)} className="flex h-10 w-10 items-center justify-center rounded-full text-ink-soft hover:bg-surface-subtle" aria-label="رجوع">
          <ArrowLeft className="h-5 w-5 rotate-180" />
        </button>
        <Bell className="h-5 w-5 text-primary" />
        <h1 className="text-lg font-bold text-ink">الإشعارات</h1>
      </header>
      <main className="app-body p-3">
        {loading && <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>}
        {error && <p className="card text-center text-sm text-error">{error}</p>}
        {!loading && !error && items.length === 0 && (
          <div className="card flex flex-col items-center gap-3 py-12 text-center">
            <Bell className="h-10 w-10 text-primary" />
            <p className="font-semibold text-ink">لا توجد إشعارات بعد</p>
            <p className="text-sm text-ink-muted">سيظهر هنا من أعجب بمنشوراتك أو علّق عليها.</p>
          </div>
        )}
        <div className="divide-y divide-surface-dim rounded-2xl bg-surface-raised">
          {items.map((item) => (
            <button
              key={item.id}
              onClick={() => void openNotification(item)}
              className={'flex w-full items-start gap-3 p-3 text-right hover:bg-surface-subtle ' + (!item.read_at ? 'bg-primary-50' : '')}
            >
              <span className="relative shrink-0">
                <Avatar name={item.actor_name} src={item.actor_avatar} size={46} />
                <span className="absolute -bottom-1 -left-1 flex h-6 w-6 items-center justify-center rounded-full border-2 border-white bg-primary text-white">
                  {item.type === 'like' ? <Heart className="h-3 w-3 fill-current" /> : <MessageCircle className="h-3 w-3" />}
                </span>
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm text-ink">
                    <strong>{item.actor_name}</strong>
                    {item.type === 'like' ? ' أعجب بمنشورك' : ' علّق على منشورك'}
                  </span>
                  {!item.read_at && <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-primary" />}
                </span>
                {item.post_excerpt && <span className="mt-1 block truncate text-xs text-ink-muted">{item.post_excerpt}</span>}
                <time className="mt-1 block text-[11px] text-ink-faint">{timeAgo(item.created_at)}</time>
              </span>
            </button>
          ))}
        </div>
      </main>
    </div>
  );
}
