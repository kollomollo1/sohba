import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Loader2, Send } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { Avatar } from '@/components/Avatar';

type DirectMessage = {
  id: string;
  sender_id: string;
  recipient_id: string;
  body: string;
  created_at: string;
  shared_post_id?: string | null;
  shared_post?: { body: string; author_name: string; author_avatar: string | null; image_url: string | null } | null;
};

export function MessagesScreen() {
  const { userId } = useParams<{ userId: string }>();
  const navigate = useNavigate();
  const { profile: me } = useAuth();
  const [peer, setPeer] = useState<{ full_name: string; avatar_url: string | null } | null>(null);
  const [messages, setMessages] = useState<DirectMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  const loadMessages = useCallback(async () => {
    if (!me?.id || !userId) return;
    const { data: markedRead, error: readError } = await supabase
      .from('messages')
      .update({ read_at: new Date().toISOString() })
      .eq('recipient_id', me.id)
      .eq('sender_id', userId)
      .is('read_at', null)
      .select('id');
    if (readError) {
      console.error('mark messages read failed', readError.message);
    } else if (markedRead?.length) {
      window.dispatchEvent(new Event('messages-read'));
    }
    const filter = 'and(sender_id.eq.' + me.id + ',recipient_id.eq.' + userId + '),and(sender_id.eq.' + userId + ',recipient_id.eq.' + me.id + ')';
    const { data, error: queryError } = await supabase
      .from('messages')
      .select('id, sender_id, recipient_id, body, created_at, shared_post_id')
      .or(filter)
      .order('created_at', { ascending: true })
      .limit(200);
    if (queryError) {
      console.error('load messages failed', queryError.message);
      setError(queryError.code === '42P01' || queryError.code === 'PGRST205'
        ? 'جدول الرسائل غير مضاف بعد. شغّل ملف 20261025130000_messages.sql في Supabase.'
        : 'تعذّر تحميل المحادثة: ' + queryError.message);
      return;
    }
    setError(null);
    const rows = (data ?? []) as DirectMessage[];
    const sharedIds = [...new Set(rows.flatMap((row) => row.shared_post_id ? [row.shared_post_id] : []))];
    if (sharedIds.length) {
      const { data: sharedRows } = await supabase.from('posts').select('id, body, image_url, author_id').in('id', sharedIds);
      const authorIds = [...new Set((sharedRows ?? []).map((row) => row.author_id))];
      const { data: authors } = authorIds.length
        ? await supabase.from('profiles').select('id, full_name, avatar_url').in('id', authorIds)
        : { data: [] };
      const authorsById = new Map((authors ?? []).map((author) => [author.id, author]));
      const posts = new Map((sharedRows ?? []).map((row) => {
        const author = authorsById.get(row.author_id);
        return [row.id, { body: row.body, image_url: row.image_url, author_name: author?.full_name ?? 'مستخدم', author_avatar: author?.avatar_url ?? null }];
      }));
      rows.forEach((row) => { if (row.shared_post_id) row.shared_post = posts.get(row.shared_post_id) ?? null; });
    }
    setMessages(rows);
  }, [me?.id, userId]);

  useEffect(() => {
    if (!userId || !me?.id) return;
    let active = true;
    setLoading(true);
    void (async () => {
      const { data: recipient, error: recipientError } = await supabase
        .from('profiles')
        .select('full_name, avatar_url')
        .eq('id', userId)
        .maybeSingle();
      if (!active) return;
      if (recipientError || !recipient) {
        setError('تعذّر العثور على هذا المستخدم.');
        setLoading(false);
        return;
      }
      setPeer(recipient);
      await loadMessages();
      if (active) setLoading(false);
    })();
    const interval = window.setInterval(() => { void loadMessages(); }, 5000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [userId, me?.id, loadMessages]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function sendMessage() {
    const body = draft.trim();
    if (!body || !me?.id || !userId || sending) return;
    setSending(true);
    setError(null);
    const { error: sendError } = await supabase.from('messages').insert({
      sender_id: me.id,
      recipient_id: userId,
      body,
    });
    setSending(false);
    if (sendError) {
      console.error('send message failed', sendError.message);
      setError(sendError.code === '42501'
        ? 'المراسلة متاحة بين الأصدقاء فقط.'
        : 'تعذّر إرسال الرسالة: ' + sendError.message);
      return;
    }
    setDraft('');
    await loadMessages();
  }

  return (
    <div className="app-shell h-dvh overflow-hidden">
      <header className="z-20 flex shrink-0 items-center gap-3 border-b border-surface-dim bg-surface-raised/95 px-3 py-3 backdrop-blur-md">
        <button onClick={() => navigate(-1)} className="flex h-10 w-10 items-center justify-center rounded-full text-ink-soft hover:bg-surface-subtle" aria-label="رجوع">
          <ArrowLeft className="h-5 w-5 rotate-180" />
        </button>
        {peer && <Avatar name={peer.full_name} src={peer.avatar_url} size={40} />}
        <div className="min-w-0">
          <h1 className="truncate font-bold text-ink">{peer?.full_name ?? 'المحادثة'}</h1>
          <p className="text-xs text-ink-muted">رسائل خاصة</p>
        </div>
      </header>

      <main className="min-h-0 flex-1 flex flex-col gap-3 overflow-y-auto p-3">
        {loading && <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>}
        {!loading && messages.length === 0 && !error && (
          <p className="my-auto py-8 text-center text-sm text-ink-muted">ابدأ المحادثة برسالة لطيفة.</p>
        )}
        {messages.map((message) => {
          const mine = message.sender_id === me?.id;
          return (
            <div key={message.id} className={'flex ' + (mine ? 'justify-start' : 'justify-end')}>
              <div className={'max-w-[82%] rounded-2xl px-4 py-2.5 ' + (mine ? 'rounded-br-md bg-primary text-white' : 'rounded-bl-md bg-surface-raised text-ink shadow-card')}>
                <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">
                  {message.body.split(/(https?:\/\/[^\s]+)/g).map((part, index) =>
                    /^https?:\/\//.test(part)
                      ? <a key={index} href={part} className="underline underline-offset-2" dir="ltr">{part}</a>
                      : part,
                  )}
                </p>
                {message.shared_post_id && message.shared_post && <button onClick={() => navigate(`/post/${message.shared_post_id}`)} className="mt-2 block w-full rounded-xl border border-surface-dim/40 bg-white/10 p-3 text-right">
                  <span className="mb-2 flex items-center gap-2 text-xs font-bold"><Avatar name={message.shared_post.author_name} src={message.shared_post.author_avatar} size={28} />منشور من {message.shared_post.author_name}</span>
                  {message.shared_post.body && <span className="block whitespace-pre-wrap break-words text-sm">{message.shared_post.body}</span>}
                  {message.shared_post.image_url && <img src={message.shared_post.image_url} alt="" className="mt-2 max-h-48 w-full rounded-lg object-cover" />}
                  <span className="mt-2 block text-xs underline">فتح المنشور</span>
                </button>}
                <time className={'mt-1 block text-left text-[10px] ' + (mine ? 'text-white/70' : 'text-ink-faint')}>
                  {new Date(message.created_at).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })}
                </time>
              </div>
            </div>
          );
        })}
        <div ref={endRef} />
      </main>

      {error && <p className="mx-3 mb-2 rounded-xl bg-error-50 px-3 py-2 text-sm text-error">{error}</p>}
      <div className="shrink-0 border-t border-surface-dim bg-surface-raised/95 px-3 py-2.5 backdrop-blur-md pb-safe">
        <div className="flex items-end gap-2">
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                void sendMessage();
              }
            }}
            placeholder="اكتب رسالة..."
            rows={1}
            maxLength={5000}
            className="input-field min-h-11 flex-1 resize-none py-2.5"
          />
          <button
            onClick={() => void sendMessage()}
            disabled={!draft.trim() || sending}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary text-white shadow-fab disabled:opacity-50"
            aria-label="إرسال الرسالة"
          >
            {sending ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5 -scale-x-100" />}
          </button>
        </div>
      </div>
    </div>
  );
}
