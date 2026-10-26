import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, MessageCircle, Loader2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { Avatar } from '@/components/Avatar';
import { timeAgo } from '@/lib/format';

type Conversation = {
  userId: string;
  name: string;
  avatar: string | null;
  body: string;
  createdAt: string;
  unread: boolean;
};

export function MessagesInboxScreen() {
  const navigate = useNavigate();
  const { profile } = useAuth();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!profile?.id) return;
    let active = true;
    void (async () => {
      const { data: rows, error: messagesError } = await supabase
        .from('messages')
        .select('sender_id, recipient_id, body, created_at, read_at')
        .or('sender_id.eq.' + profile.id + ',recipient_id.eq.' + profile.id)
        .order('created_at', { ascending: false })
        .limit(200);
      if (!active) return;
      if (messagesError) {
        setError(messagesError.code === '42P01' || messagesError.code === 'PGRST205'
          ? 'جدول الرسائل غير مضاف بعد. شغّل ملف 20261025130000_messages.sql في Supabase.'
          : 'تعذّر تحميل الرسائل: ' + messagesError.message);
        setLoading(false);
        return;
      }
      const latest = new Map<string, { body: string; createdAt: string; unread: boolean }>();
      (rows ?? []).forEach((row) => {
        const otherId = row.sender_id === profile.id ? row.recipient_id : row.sender_id;
        const current = latest.get(otherId);
        if (!current) {
          latest.set(otherId, {
            body: row.body,
            createdAt: row.created_at,
            unread: row.recipient_id === profile.id && row.read_at === null,
          });
        } else if (row.recipient_id === profile.id && row.read_at === null) {
          current.unread = true;
        }
      });
      const userIds = [...latest.keys()];
      if (userIds.length === 0) {
        setConversations([]);
        setLoading(false);
        return;
      }
      const { data: people, error: peopleError } = await supabase
        .from('profiles')
        .select('id, full_name, avatar_url')
        .in('id', userIds);
      if (!active) return;
      if (peopleError) {
        setError('تعذّر تحميل أسماء أصحاب المحادثات.');
      } else {
        const byId = new Map((people ?? []).map((person) => [person.id, person]));
        setConversations(userIds.flatMap((userId) => {
          const person = byId.get(userId);
          const recent = latest.get(userId);
          return person && recent
            ? [{ userId, name: person.full_name, avatar: person.avatar_url, body: recent.body, createdAt: recent.createdAt, unread: recent.unread }]
            : [];
        }));
      }
      setLoading(false);
    })();
    return () => { active = false; };
  }, [profile?.id]);

  return (
    <div className="app-shell">
      <header className="sticky top-0 z-20 flex items-center gap-2 border-b border-surface-dim bg-surface-raised/95 px-3 py-3 backdrop-blur-md">
        <button onClick={() => navigate(-1)} className="flex h-10 w-10 items-center justify-center rounded-full text-ink-soft hover:bg-surface-subtle" aria-label="رجوع">
          <ArrowLeft className="h-5 w-5 rotate-180" />
        </button>
        <h1 className="text-lg font-bold text-ink">الرسائل</h1>
      </header>
      <main className="app-body p-3">
        {loading && <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>}
        {error && <p className="card text-center text-sm text-error">{error}</p>}
        {!loading && !error && conversations.length === 0 && (
          <div className="card flex flex-col items-center gap-3 py-12 text-center">
            <MessageCircle className="h-10 w-10 text-primary" />
            <p className="font-semibold text-ink">لا توجد محادثات بعد</p>
            <p className="text-sm text-ink-muted">افتح قائمة الأصدقاء واضغط أيقونة الرسالة لبدء محادثة.</p>
          </div>
        )}
        <div className="divide-y divide-surface-dim rounded-2xl bg-surface-raised">
          {conversations.map((conversation) => (
            <button
              key={conversation.userId}
              onClick={() => navigate('/messages/' + conversation.userId)}
              className={'flex w-full items-center gap-3 p-3 text-right hover:bg-surface-subtle ' + (conversation.unread ? 'bg-primary-50' : '')}
            >
              <Avatar name={conversation.name} src={conversation.avatar} size={48} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <p className={'truncate ' + (conversation.unread ? 'font-extrabold text-primary-800' : 'font-bold text-ink')}>{conversation.name}</p>
                  <time className="shrink-0 text-[11px] text-ink-faint">{timeAgo(conversation.createdAt)}</time>
                </div>
                <div className="mt-1 flex items-center justify-between gap-2">
                  <p className={'truncate text-sm ' + (conversation.unread ? 'font-semibold text-ink' : 'text-ink-muted')}>{conversation.body}</p>
                  {conversation.unread && <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-urgent" aria-label="رسالة غير مقروءة" />}
                </div>
              </div>
            </button>
          ))}
        </div>
      </main>
    </div>
  );
}
