import React, { useEffect, useRef, useState } from 'react';
import { MessageCircle, X, Send, Loader2, Trash2 } from 'lucide-react';
import { Avatar } from '@/components/Avatar';
import { useAuth } from '@/lib/auth';
import { timeAgo } from '@/lib/format';
import { supabase } from '@/lib/supabase';
import type { Comment } from '@/types';

type Props = {
  isOpen: boolean;
  onClose: () => void;
  postId: string;
  postAuthorName: string;
  onCountChange?: (count: number) => void;
};

export function CommentsModal({
  isOpen,
  onClose,
  postId,
  postAuthorName,
  onCountChange,
}: Props) {
  const { profile } = useAuth();
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);

  const listEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Load comments when opened
  useEffect(() => {
    if (!isOpen) return;
    let active = true;
    setLoading(true);
    setError(null);

    void (async () => {
      const { data, error: err } = await supabase.rpc('post_comments', {
        p_post_id: postId,
      });
      if (!active) return;
      setLoading(false);
      if (err) {
        console.error('load comments error:', err.message);
        setError('تعذّر تحميل التعليقات.');
      } else {
        const loaded = (data as Comment[]) ?? [];
        setComments(loaded);
        onCountChange?.(loaded.length);
      }
    })();

    return () => {
      active = false;
    };
  }, [isOpen, postId, onCountChange]);

  // Focus input on open
  useEffect(() => {
    if (isOpen) {
      const timer = setTimeout(() => {
        inputRef.current?.focus();
      }, 120);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose]);

  // Lock body scroll
  useEffect(() => {
    if (isOpen) {
      const original = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      return () => {
        document.body.style.overflow = original;
      };
    }
  }, [isOpen]);

  async function submitComment() {
    const text = draft.trim();
    if (!text || sending || !profile) return;
    setSending(true);
    setError(null);

    const tempId = `tmp-${Date.now()}`;
    const optimistic: Comment = {
      id: tempId,
      author_id: profile.id,
      body: text,
      created_at: new Date().toISOString(),
      author_name: profile.full_name,
      author_username: profile.username ?? '',
      author_avatar: profile.avatar_url ?? null,
    };

    setComments((prev) => {
      const next = [...prev, optimistic];
      onCountChange?.(next.length);
      return next;
    });
    setDraft('');

    setTimeout(() => {
      listEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, 40);

    const { data, error: insertError } = await supabase
      .from('comments')
      .insert({ post_id: postId, author_id: profile.id, body: text })
      .select('id, created_at')
      .single();

    setSending(false);

    if (insertError) {
      console.error('insert comment failed:', insertError.message);
      setComments((prev) => {
        const next = prev.filter((c) => c.id !== tempId);
        onCountChange?.(next.length);
        return next;
      });
      setDraft(text);
      setError('تعذّر إرسال التعليق. حاول مجدداً.');
    } else if (data) {
      setComments((prev) =>
        prev.map((c) =>
          c.id === tempId
            ? {
                ...c,
                id: (data as { id: string }).id,
                created_at: (data as { created_at: string }).created_at,
              }
            : c
        )
      );
    }
  }

  async function deleteComment(id: string) {
    if (!profile) return;
    setComments((prev) => {
      const next = prev.filter((c) => c.id !== id);
      onCountChange?.(next.length);
      return next;
    });
    const { error: delError } = await supabase
      .from('comments')
      .delete()
      .eq('id', id)
      .eq('author_id', profile.id);
    if (delError) {
      console.error('delete comment failed:', delError.message);
    }
  }

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4 backdrop-blur-xs transition-opacity"
      onClick={onClose}
    >
      <section
        className="flex max-h-[85dvh] w-full max-w-lg flex-col rounded-t-3xl bg-surface-raised shadow-card-raised border border-surface-dim sm:rounded-3xl sm:max-h-[75dvh] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-surface-dim px-4 py-3 bg-surface-raised/95">
          <div className="flex items-center gap-2">
            <MessageCircle className="h-5 w-5 text-primary" />
            <h2 className="text-base font-bold text-ink">التعليقات</h2>
            <span className="rounded-full bg-accent-soft px-2 py-0.5 text-xs font-bold text-primary">
              {comments.length}
            </span>
          </div>
          <button
            onClick={onClose}
            className="rounded-full p-1.5 text-ink-muted hover:bg-surface-subtle transition-colors"
            aria-label="إغلاق"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Comments List */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3 min-h-[180px] max-h-[55dvh]">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-12 gap-2 text-ink-muted">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
              <span className="text-xs">جاري تحميل التعليقات...</span>
            </div>
          ) : error && comments.length === 0 ? (
            <div className="py-8 text-center text-sm text-error">{error}</div>
          ) : comments.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 gap-2 text-center text-ink-muted">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-accent-soft text-primary">
                <MessageCircle className="h-6 w-6" />
              </div>
              <p className="font-bold text-sm text-ink">لا توجد تعليقات بعد</p>
              <p className="text-xs text-ink-muted">
                كن أول من يشارك برأيه على منشور {postAuthorName}!
              </p>
            </div>
          ) : (
            comments.map((c) => {
              const isMine = c.author_id === profile?.id;
              return (
                <div key={c.id} className="flex items-start gap-2.5">
                  <Avatar name={c.author_name} src={c.author_avatar} size={34} />
                  <div className="flex-1 min-w-0">
                    <div className="rounded-2xl bg-surface-subtle px-3.5 py-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate font-bold text-xs text-ink">
                          {c.author_name}
                        </span>
                        <time className="shrink-0 text-[10px] text-ink-faint">
                          {timeAgo(c.created_at)}
                        </time>
                      </div>
                      <p className="mt-1 whitespace-pre-wrap break-words text-sm text-ink-soft font-noto leading-relaxed">
                        {c.body}
                      </p>
                    </div>
                  </div>
                  {isMine && (
                    <button
                      onClick={() => void deleteComment(c.id)}
                      className="self-center rounded-full p-1.5 text-ink-faint hover:bg-error-50 hover:text-error transition-colors"
                      title="حذف التعليق"
                      aria-label="حذف التعليق"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              );
            })
          )}
          <div ref={listEndRef} />
        </div>

        {/* Input / Form Footer */}
        {profile ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void submitComment();
            }}
            className="border-t border-surface-dim bg-surface-raised p-3 flex items-center gap-2 pb-safe"
          >
            <Avatar name={profile.full_name} src={profile.avatar_url} size={36} />
            <input
              ref={inputRef}
              type="text"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="اكتب تعليقاً..."
              className="flex-1 rounded-full border border-surface-dim bg-surface-subtle px-4 py-2 text-sm text-ink placeholder:text-ink-faint focus:border-primary focus:bg-surface-raised focus:outline-none transition-colors"
              disabled={sending}
            />
            <button
              type="submit"
              disabled={!draft.trim() || sending}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary text-white shadow-sm transition-transform active:scale-95 disabled:opacity-40 disabled:pointer-events-none"
              aria-label="إرسال التعليق"
            >
              {sending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4 -scale-x-100" />
              )}
            </button>
          </form>
        ) : (
          <div className="border-t border-surface-dim bg-surface-subtle p-3 text-center text-xs text-ink-muted">
            سجّل الدخول لتتمكن من كتابة تعليق.
          </div>
        )}
      </section>
    </div>
  );
}
