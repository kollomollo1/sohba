import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Send, Heart, Loader2, Trash2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { Avatar } from '@/components/Avatar';
import { PostCard } from '@/components/PostCard';
import { timeAgo, friendContextLabel } from '@/lib/format';
import type { Comment, FeedPost, LikeReaction } from '@/types';

export function PostDetailScreen() {
  const { postId } = useParams<{ postId: string }>();
  const navigate = useNavigate();
  const { profile: me } = useAuth();
  const [post, setPost] = useState<FeedPost | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [likeCount, setLikeCount] = useState(0);
  const [selectedReaction, setSelectedReaction] = useState<LikeReaction | null>(null);

  const load = useCallback(async () => {
    if (!postId) return;
    setLoading(true);

    // Fetch post row (RLS ensures visibility)
    const { data: raw } = await supabase
      .from('posts')
      .select('id, author_id, body, image_url, is_urgent, created_at')
      .eq('id', postId)
      .maybeSingle();

    if (!raw) {
      setPost(null);
      setLoading(false);
      return;
    }

    // Author profile
    const { data: author } = await supabase
      .from('profiles')
      .select('full_name, username, avatar_url')
      .eq('id', (raw as { author_id: string }).author_id)
      .maybeSingle();

    // Likes + comments
    const [{ data: reactionRows }, { data: commentsData }, { data: myLike }] = await Promise.all([
      supabase.rpc('post_reaction_counts', { p_post_ids: [postId] }),
      supabase.rpc('post_comments', { p_post_id: postId }),
      supabase.from('likes').select('reaction').eq('post_id', postId).eq('user_id', me?.id ?? '').maybeSingle(),
    ]);

    const reactionCounts: Partial<Record<LikeReaction, number>> = {};
    (reactionRows ?? []).forEach((row: { reaction: LikeReaction; reaction_count: number }) => {
      reactionCounts[row.reaction] = Number(row.reaction_count);
    });
    const viewerId = me?.id;
    const feedPost: FeedPost = {
      ...(raw as FeedPost),
      author_name: author?.full_name ?? 'مستخدم',
      author_username: author?.username ?? '',
      author_avatar: author?.avatar_url ?? null,
      ctx_kind: (raw as { author_id: string }).author_id === viewerId ? 'self' : 'friend',
      ctx_mutual_name: null,
      like_count: Object.values(reactionCounts).reduce((sum, count) => sum + (count ?? 0), 0),
      comment_count: (commentsData as Comment[] | null)?.length ?? 0,
      viewer_liked: !!myLike?.reaction,
      viewer_reaction: (myLike?.reaction as LikeReaction | null) ?? null,
      reaction_counts: reactionCounts,
    };
    setPost(feedPost);
    setComments((commentsData as Comment[]) ?? []);
    setSelectedReaction(feedPost.viewer_reaction ?? null);
    setLikeCount(feedPost.like_count);
    setLoading(false);
  }, [postId, me?.id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function submitComment() {
    const text = draft.trim();
    if (!text || sending || !postId || !me) return;
    setSending(true);
    const optimistic: Comment = {
      id: `tmp-${Date.now()}`,
      author_id: me.id,
      body: text,
      created_at: new Date().toISOString(),
      author_name: me.full_name,
      author_username: me.username,
      author_avatar: me.avatar_url,
    };
    setComments((prev) => [...prev, optimistic]);
    setDraft('');

    const { data, error } = await supabase
      .from('comments')
      .insert({ post_id: postId, author_id: me.id, body: text })
      .select('id, created_at')
      .single();

    setSending(false);
    if (error) {
      setComments((prev) => prev.filter((c) => c.id !== optimistic.id));
      setDraft(text);
      return;
    }
    setComments((prev) =>
      prev.map((c) => (c.id === optimistic.id ? { ...c, id: (data as { id: string }).id, created_at: (data as { created_at: string }).created_at } : c)),
    );
  }

  function onDetailLikeToggled(_id: string, liked: boolean, count: number, reaction: LikeReaction | null) {
    setLikeCount(count);
    setSelectedReaction(liked ? reaction : null);
  }

  async function deleteComment(id: string) {
    setComments((prev) => prev.filter((c) => c.id !== id));
    await supabase.from('comments').delete().eq('id', id).eq('author_id', me?.id ?? '');
  }

  if (loading) {
    return (
      <div className="app-shell items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!post) {
    return (
      <div className="app-shell flex flex-col items-center justify-center gap-3 px-6 text-center">
        <p className="font-bold text-ink">المنشور غير متاح</p>
        <p className="text-sm text-ink-muted">قد يكون محذوفاً أو لا تملك صلاحية رؤيته.</p>
        <button onClick={() => navigate(-1)} className="btn-secondary">رجوع</button>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <header className="sticky top-0 z-20 flex items-center gap-2 border-b border-surface-dim bg-surface-raised/95 px-3 py-3 backdrop-blur-md">
        <button onClick={() => navigate(-1)} className="flex h-10 w-10 items-center justify-center rounded-full text-ink-soft hover:bg-surface-subtle">
          <ArrowLeft className="h-5 w-5 rotate-180" />
        </button>
        <h1 className="text-lg font-bold text-ink">المنشور</h1>
      </header>

      <main className="app-body space-y-3 p-3">
        <PostCard post={post} onLikeToggled={onDetailLikeToggled} onDeleted={() => navigate('/')} onSuppressed={() => navigate('/')} />

        {/* Like bar */}
        <div className="card flex items-center gap-3">
          <div className={`flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold ${selectedReaction ? 'bg-urgent-50 text-urgent' : 'bg-surface-subtle text-ink-soft'}`}>
            {selectedReaction && selectedReaction !== 'like'
              ? <span className="text-lg">{selectedReaction === 'laugh' ? '😂' : selectedReaction === 'angry' ? '😡' : '😮'}</span>
              : <Heart className={`h-5 w-5 ${selectedReaction ? 'fill-urgent' : ''}`} />}
            {likeCount} إعجاب
          </div>
          <span className="text-sm text-ink-muted">{comments.length} تعليق</span>
        </div>

        {/* Comments */}
        <div className="space-y-2">
          <h2 className="px-1 text-sm font-bold text-ink">التعليقات</h2>
          {comments.length === 0 ? (
            <div className="card text-center text-sm text-ink-muted">
              لا تعليقات بعد. كن أول من يعلّق!
            </div>
          ) : (
            comments.map((c) => (
              <div key={c.id} className="card flex gap-3 py-3">
                <Avatar name={c.author_name} src={c.author_avatar} size={36} />
                <div className="min-w-0 flex-1">
                  <span className="truncate text-sm font-bold text-ink">{c.author_name}</span>
                  <time className="block text-[11px] text-ink-faint leading-tight mt-0.5">{timeAgo(c.created_at)}</time>
                  <p className="mt-1 whitespace-pre-wrap break-words text-sm text-ink-soft font-noto">{c.body}</p>
                </div>
                {c.author_id === me?.id && (
                  <button
                    onClick={() => void deleteComment(c.id)}
                    className="self-start rounded-full p-1.5 text-ink-faint hover:bg-surface-subtle hover:text-error"
                    aria-label="حذف"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>
            ))
          )}
        </div>
      </main>

      {/* Composer */}
      <div className="sticky bottom-0 z-20 border-t border-surface-dim bg-surface-raised/95 px-3 py-2.5 backdrop-blur-md pb-safe">
        <div className="flex items-center gap-2">
          {me && <Avatar name={me.full_name} src={me.avatar_url} size={36} />}
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void submitComment(); }}
            placeholder="أضف تعليقاً..."
            className="input-field flex-1 py-2.5 font-noto"
          />
          <button
            onClick={submitComment}
            disabled={!draft.trim() || sending}
            className="flex h-11 w-11 items-center justify-center rounded-full bg-primary text-white shadow-fab transition active:scale-90 disabled:opacity-40"
            aria-label="إرسال"
          >
            {sending ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5 -scale-x-100" />}
          </button>
        </div>
      </div>
    </div>
  );
}
