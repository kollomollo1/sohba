import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Flame, Loader2, RefreshCw } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { Avatar } from '@/components/Avatar';
import { PostCard } from '@/components/PostCard';
import type { FeedPost, LikeReaction } from '@/types';

type Filter = 'all' | 'urgent';
type FriendStatus = { state: 'none' | 'friend' | 'requested' | 'incoming'; requestId?: string };

export function HomeFeedScreen() {
  const { profile, isGuest } = useAuth();
  const navigate = useNavigate();
  const [posts, setPosts] = useState<FeedPost[]>([]);
  const [filter, setFilter] = useState<Filter>('all');
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [friendships, setFriendships] = useState<Record<string, FriendStatus>>({});

  // Pull-to-refresh state
  const [pullY, setPullY] = useState(0);
  const [isPulling, setIsPulling] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const pullStartY = useRef(0);
  const PULL_THRESHOLD = 72; // px needed to trigger refresh

  useEffect(() => {
    if (!profile?.id) return;
    let active = true;
    void supabase
      .from('friendships')
      .select('id, requester_id, addressee_id, status')
      .or(`requester_id.eq.${profile.id},addressee_id.eq.${profile.id}`)
      .then(({ data, error }) => {
        if (!active) return;
        if (error) {
          console.error('could not load friendship statuses', error.message);
          return;
        }
        const next: Record<string, FriendStatus> = {};
        (data ?? []).forEach((row) => {
          const otherId = row.requester_id === profile.id ? row.addressee_id : row.requester_id;
          const state = row.status === 'accepted'
            ? 'friend'
            : row.status !== 'pending'
              ? 'none'
              : row.requester_id === profile.id ? 'requested' : 'incoming';
          next[otherId] = { state, requestId: row.id };
        });
        setFriendships(next);
      });
    return () => { active = false; };
  }, [profile?.id]);

  const loadFeed = useCallback(
    async (reset: boolean, currentFilter: Filter) => {
      if (reset) {
        setLoading(true);
        setError(null);
      } else {
        setLoadingMore(true);
      }

      const friendsOnly = false;
      const limit = 20;
      const cursorArg = reset ? new Date().toISOString() : cursor;

      const feedRequest = supabase.rpc('feed', {
        p_limit: limit,
        p_cursor: cursorArg,
        p_friends_only: friendsOnly,
      });
      const timeoutRequest = new Promise<Awaited<typeof feedRequest>>((resolve) => {
        setTimeout(() => resolve({
          data: null,
          error: { name: 'TimeoutError', message: 'Feed request timed out', details: '', hint: '', code: 'TIMEOUT' },
        } as Awaited<typeof feedRequest>), 15000);
      });
      const { data, error: rpcError } = await Promise.race([feedRequest, timeoutRequest]);

      if (rpcError) {
        console.error('feed load failed', { code: rpcError.code, message: rpcError.message, details: rpcError.details, hint: rpcError.hint });
        setError(
          rpcError.code === 'PGRST202' || rpcError.code === '42883'
            ? 'وظيفة الخلاصة غير موجودة في قاعدة البيانات. شغّل ملف 20261025121022_sohba_feed_rpcs.sql في Supabase.'
            : rpcError.code === 'TIMEOUT'
              ? 'انتهت مهلة الاتصال بقاعدة البيانات. تحقق من اتصال الإنترنت وإعدادات Supabase ثم أعد المحاولة.'
              : `تعذّر تحميل المنشورات: ${rpcError.message}`,
        );
        setLoading(false);
        setLoadingMore(false);
        return;
      }

      const feedRows = (data ?? []) as FeedPost[];
      const postIds = feedRows.map((post) => post.id);
      let ownLikes: Array<{ post_id: string; reaction: FeedPost['viewer_reaction'] }> = [];
      let reactionRows: Array<{ post_id: string; reaction: LikeReaction; reaction_count: number }> = [];
      if (postIds.length) {
        const ownLikesRequest = profile?.id
          ? supabase.from('likes').select('post_id, reaction').in('post_id', postIds).eq('user_id', profile.id)
          : Promise.resolve({ data: [] });
        const [ownLikesResult, reactionResult] = await Promise.all([
          ownLikesRequest,
          supabase.rpc('post_reaction_counts', { p_post_ids: postIds }),
        ]);
        ownLikes = (ownLikesResult.data ?? []) as typeof ownLikes;
        reactionRows = (reactionResult.data ?? []) as typeof reactionRows;
      }
      const reactionByPost = new Map(ownLikes.map((like) => [like.post_id, like.reaction]));
      const countsByPost = new Map<string, Partial<Record<LikeReaction, number>>>();
      reactionRows.forEach((row) => {
        const counts = countsByPost.get(row.post_id) ?? {};
        counts[row.reaction] = Number(row.reaction_count);
        countsByPost.set(row.post_id, counts);
      });
      const rows = feedRows.map((post) => ({
        ...post,
        viewer_reaction: reactionByPost.get(post.id) ?? null,
        reaction_counts: countsByPost.get(post.id) ?? {},
      }));
      const visible = currentFilter === 'urgent' ? rows.filter((p) => p.is_urgent) : rows;

      setPosts((prev) => (reset ? visible : [...prev, ...visible]));
      if (rows.length > 0) {
        setCursor(rows[rows.length - 1].created_at);
      } else if (reset) {
        setCursor(null);
      }
      setHasMore(rows.length === limit && (currentFilter === 'all' || visible.length === rows.length));
      setLoading(false);
      setLoadingMore(false);
    },
    [cursor, profile?.id],
  );

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'auto' });
    void loadFeed(true, filter);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  useEffect(() => {
    const refreshHomeFeed = () => {
      window.scrollTo({ top: 0, behavior: 'auto' });
      void loadFeed(true, filter);
    };
    window.addEventListener('home-feed-refresh-requested', refreshHomeFeed);
    return () => window.removeEventListener('home-feed-refresh-requested', refreshHomeFeed);
  }, [filter, loadFeed]);

  useEffect(() => {
    const refreshAfterUndo = () => { void loadFeed(true, filter); };
    window.addEventListener('post-controls-undone', refreshAfterUndo);
    return () => window.removeEventListener('post-controls-undone', refreshAfterUndo);
  }, [filter, loadFeed]);

  // ── Back-button → scroll to top ──────────────────────────────────────────
  useEffect(() => {
    // Push a dummy history entry so the back button hits us first
    window.history.pushState({ homeFeedScrollGuard: true }, '');

    const onPopState = (e: PopStateEvent) => {
      if (window.scrollY > 0) {
        // User is scrolled down → scroll to top and re-push the guard
        e.preventDefault?.();
        window.scrollTo({ top: 0, behavior: 'smooth' });
        window.history.pushState({ homeFeedScrollGuard: true }, '');
      }
      // If already at top, let normal navigation proceed
    };

    window.addEventListener('popstate', onPopState);
    return () => {
      window.removeEventListener('popstate', onPopState);
    };
  }, []);

  // ── Pull-to-refresh touch handlers ───────────────────────────────────────
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (window.scrollY === 0) {
      pullStartY.current = e.touches[0].clientY;
      setIsPulling(true);
    }
  }, []);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (!isPulling) return;
    const delta = e.touches[0].clientY - pullStartY.current;
    if (delta > 0) {
      // Dampen the pull with sqrt for a natural rubber-band feel
      setPullY(Math.min(Math.sqrt(delta) * 5, PULL_THRESHOLD + 20));
    }
  }, [isPulling]);

  const handleTouchEnd = useCallback(() => {
    if (!isPulling) return;
    setIsPulling(false);
    if (pullY >= PULL_THRESHOLD && !loading && !isRefreshing) {
      setIsRefreshing(true);
      setPullY(0);
      void (async () => {
        await loadFeed(true, filter);
        setIsRefreshing(false);
      })();
    } else {
      setPullY(0);
    }
  }, [isPulling, pullY, loading, isRefreshing, loadFeed, filter]);

  function onLikeToggled(id: string, liked: boolean, count: number, reaction: FeedPost['viewer_reaction']) {
    setPosts((prev) =>
      prev.map((p) => {
        if (p.id !== id) return p;
        const reactionCounts = { ...(p.reaction_counts ?? {}) };
        if (p.viewer_reaction && p.viewer_reaction !== reaction) {
          reactionCounts[p.viewer_reaction] = Math.max(0, (reactionCounts[p.viewer_reaction] ?? 0) - 1);
        }
        if (reaction && p.viewer_reaction !== reaction) {
          reactionCounts[reaction] = (reactionCounts[reaction] ?? 0) + 1;
        }
        return { ...p, viewer_liked: liked, viewer_reaction: reaction, reaction_counts: reactionCounts, like_count: count };
      }),
    );
  }

  function onPostDeleted(id: string) {
    setPosts((prev) => prev.filter((post) => post.id !== id));
  }

  function onPostSuppressed(postId: string, authorId: string, scope: 'post' | 'author') {
    setPosts((prev) => prev.filter((post) => scope === 'author' ? post.author_id !== authorId : post.id !== postId));
  }

  function onFriendshipChanged(userId: string, relation: FriendStatus | undefined) {
    if (!relation) return;
    setFriendships((prev) => ({ ...prev, [userId]: relation }));
  }

  const isEmpty = !loading && posts.length === 0;

  return (
    <div
      className="app-shell"
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      {/* Pull-to-refresh indicator */}
      {(pullY > 0 || isRefreshing) && (
        <div
          className="pointer-events-none sticky top-12 z-30 flex justify-center overflow-hidden transition-all duration-150"
          style={{ height: isRefreshing ? 48 : pullY > 0 ? pullY : 0 }}
        >
          <div className="flex h-12 items-center gap-2 text-primary">
            <RefreshCw
              className={`h-5 w-5 ${isRefreshing ? 'animate-spin' : ''}`}
              style={{
                transform: !isRefreshing ? `rotate(${(pullY / PULL_THRESHOLD) * 360}deg)` : undefined,
                opacity: Math.min(pullY / PULL_THRESHOLD, 1),
              }}
            />
            <span className="text-xs font-semibold text-ink-soft">
              {isRefreshing ? 'جارٍ التحديث...' : pullY >= PULL_THRESHOLD ? 'اترك للتحديث' : 'اسحب للتحديث'}
            </span>
          </div>
        </div>
      )}

      <main className="app-body space-y-4 px-3 pt-3">
        {/* Quick composer */}
        <button
          onClick={() => navigate('/create')}
          className="card flex w-full items-center gap-3 text-right transition-shadow hover:shadow-card-raised"
        >
          {profile && <Avatar name={profile.full_name} src={profile.avatar_url} size={40} />}
          <span className="flex-1 text-sm text-ink-muted">
            بماذا تفكر يا {profile?.full_name?.split(' ')[0] ?? 'صديق'}؟ شارك صُحبتك...
          </span>
          <span className="text-xs font-semibold text-primary">إضافة منشور</span>
        </button>

        {/* Filter tabs */}
        <div className="flex items-center gap-2 overflow-x-auto no-scrollbar">
          <button
            onClick={() => setFilter('all')}
            className={`chip ${filter === 'all' ? 'chip-active' : 'chip-inactive'}`}
          >
            كل المنشورات
          </button>
          <button
            onClick={() => setFilter('urgent')}
            className={`chip ${filter === 'urgent' ? 'bg-urgent text-white' : 'chip-inactive'}`}
          >
            <Flame className="h-3.5 w-3.5" />
            العاجل فقط
          </button>
          <button
            onClick={() => void loadFeed(true, filter)}
            className="chip chip-inactive mr-auto"
            aria-label="تحديث"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Loading skeletons */}
        {loading && (
          <div className="space-y-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="card-raised space-y-3 p-4">
                <div className="flex gap-3">
                  <div className="skeleton h-11 w-11 rounded-full" />
                  <div className="flex-1 space-y-2">
                    <div className="skeleton h-3 w-32" />
                    <div className="skeleton h-2 w-24" />
                  </div>
                </div>
                <div className="skeleton h-3 w-full" />
                <div className="skeleton h-3 w-4/5" />
              </div>
            ))}
          </div>
        )}

        {/* Error */}
        {error && !loading && (
          <div className="card text-center">
            <p className="text-sm text-ink-soft">{error}</p>
            <button onClick={() => void loadFeed(true, filter)} className="btn-secondary mt-3">
              إعادة المحاولة
            </button>
          </div>
        )}

        {/* Empty */}
        {isEmpty && !error && (
          <div className="card flex flex-col items-center gap-3 py-12 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-accent-soft">
              <Flame className="h-8 w-8 text-primary" />
            </div>
            <div>
              <p className="font-bold text-ink">لا توجد منشورات بعد</p>
              <p className="mt-1 text-sm text-ink-muted">
                أضف أصدقاء أو شارك أول منشور لك لتبدأ صُحبتك.
              </p>
            </div>
            {!isGuest && (
              <button onClick={() => navigate('/create')} className="btn-primary mt-2">
                أنشئ منشوراً
              </button>
            )}
          </div>
        )}

        {/* Feed */}
        {!loading && (
          <div className="flex flex-col gap-2.5">
            {posts.map((post, index) => (
              <div key={post.id} className="flex flex-col gap-2.5">
                {index > 0 && <div className="h-[1px] w-full bg-[#d5dbe4] dark:bg-slate-700" />}
                <PostCard
                  post={post}
                  onLikeToggled={onLikeToggled}
                  onDeleted={onPostDeleted}
                  onSuppressed={onPostSuppressed}
                  friendship={friendships[post.author_id]}
                  onFriendshipChanged={onFriendshipChanged}
                />
              </div>
            ))}
          </div>
        )}

        {/* Load more */}
        {!loading && hasMore && posts.length > 0 && (
          <button
            onClick={() => void loadFeed(false, filter)}
            disabled={loadingMore}
            className="btn-ghost mx-auto flex w-full items-center justify-center gap-2 py-3"
          >
            {loadingMore ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                جارٍ التحميل...
              </>
            ) : (
              'تحميل المزيد'
            )}
          </button>
        )}
      </main>
    </div>
  );
}
