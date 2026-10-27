import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { MessageCircle, Forward, Flame, MoreHorizontal, Trash2, UserPlus, BadgeCheck, Loader2, X, EyeOff, Ban, Pencil, Flag, Send, Clock, UserX, Maximize2 } from 'lucide-react';
import type { FeedPost, LikeReaction } from '@/types';
import { Avatar } from '@/components/Avatar';
import { CommentsModal } from '@/components/CommentsModal';
import { ReactionButton } from '@/components/ReactionButton';
import { timeAgo } from '@/lib/format';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { showUndo } from '@/components/UndoToast';
import { getOptimizedPostImageUrl, deletePostImageFromCloudinary, isCloudinaryUrl } from '@/lib/cloudinary';

type Props = {
  post: FeedPost;
  isDetail?: boolean;
  onLikeToggled?: (id: string, liked: boolean, count: number, reaction: LikeReaction | null) => void;
  onDeleted?: (id: string) => void;
  onSuppressed?: (postId: string, authorId: string, scope: 'post' | 'author') => void;
  friendship?: { state: 'none' | 'friend' | 'requested' | 'incoming'; requestId?: string };
  onFriendshipChanged?: (userId: string, friendship: Props['friendship']) => void;
};

const reactionLabels: Array<{ key: LikeReaction; emoji: string; label: string }> = [
  { key: 'like', emoji: '❤️', label: 'إعجاب' },
  { key: 'laugh', emoji: '😂', label: 'ضحك' },
  { key: 'angry', emoji: '😡', label: 'غضب' },
  { key: 'surprised', emoji: '😮', label: 'استغراب' },
];

function changeReactionCounts(
  counts: FeedPost['reaction_counts'],
  previous: LikeReaction | null,
  next: LikeReaction | null,
) {
  const updated = { ...(counts ?? {}) };
  if (previous && previous !== next) updated[previous] = Math.max(0, (updated[previous] ?? 0) - 1);
  if (next && previous !== next) updated[next] = (updated[next] ?? 0) + 1;
  return updated;
}

export function PostCard({ post, isDetail, onLikeToggled, onDeleted, onSuppressed, friendship, onFriendshipChanged }: Props) {
  const navigate = useNavigate();
  const { profile, session } = useAuth();
  const isAdmin = session?.user.app_metadata?.role === 'admin';
  const [liked, setLiked] = useState(post.viewer_liked);
  const [likeCount, setLikeCount] = useState(post.like_count);
  const [selectedReaction, setSelectedReaction] = useState<LikeReaction | null>(post.viewer_reaction ?? (post.viewer_liked ? 'like' : null));
  const [reactionCounts, setReactionCounts] = useState(post.reaction_counts ?? {});
  const [likeAnim, setLikeAnim] = useState(false);
  const [busy, setBusy] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [friendBusy, setFriendBusy] = useState(false);
  const [friendError, setFriendError] = useState<string | null>(null);
  const [moderationError, setModerationError] = useState<string | null>(null);
  const [suppressed, setSuppressed] = useState(false);
  const [reportMessage, setReportMessage] = useState<string | null>(null);
  const [authorIsAdmin, setAuthorIsAdmin] = useState<boolean | null>(null);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [commentCount, setCommentCount] = useState(post.comment_count);
  const [shareOpen, setShareOpen] = useState(false);
  const [shareFriends, setShareFriends] = useState<Array<{ user_id: string; full_name: string; avatar_url: string | null }>>([]);
  const [shareLoading, setShareLoading] = useState(false);
  const [shareBusy, setShareBusy] = useState(false);
  const [shareError, setShareError] = useState<string | null>(null);
  const [sharedPost, setSharedPost] = useState<{ id: string; body: string; image_url: string | null; author_name: string; author_avatar: string | null } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const relation = friendship ?? { state: post.ctx_kind === 'friend' ? 'friend' as const : 'none' as const };

  useEffect(() => {
    setLiked(post.viewer_liked);
    setLikeCount(post.like_count);
    setCommentCount(post.comment_count);
    setSelectedReaction(post.viewer_reaction ?? (post.viewer_liked ? 'like' : null));
    setReactionCounts(post.reaction_counts ?? {});
  }, [post.id, post.like_count, post.comment_count, post.viewer_liked, post.viewer_reaction, post.reaction_counts]);

  useEffect(() => {
    if (!menuOpen) return;
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('pointerdown', closeOnOutsideClick);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsideClick);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [menuOpen]);

  useEffect(() => {
    if (!lightboxOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setLightboxOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [lightboxOpen]);

  useEffect(() => {
    let active = true;
    setAuthorIsAdmin(null);
    void supabase.rpc('is_admin_profile', { p_user_id: post.author_id }).then(({ data, error }) => {
      if (active) setAuthorIsAdmin(error ? false : data === true);
    });
    return () => { active = false; };
  }, [post.author_id]);

  const sharedPostId = post.body.match(/^\[\[shared-post:([0-9a-f-]+)\]\]$/i)?.[1] ?? null;
  useEffect(() => {
    let active = true;
    setSharedPost(null);
    if (!sharedPostId) return;
    void (async () => {
      const { data: original } = await supabase.from('posts')
        .select('id, body, image_url, author_id').eq('id', sharedPostId).maybeSingle();
      if (!active || !original) return;
      const { data: author } = await supabase.from('profiles').select('full_name, avatar_url').eq('id', original.author_id).maybeSingle();
      if (active) setSharedPost({ ...original, author_name: author?.full_name ?? 'مستخدم', author_avatar: author?.avatar_url ?? null });
    })();
    return () => { active = false; };
  }, [sharedPostId]);

  async function toggleLike() {
    if (busy) return;
    setBusy(true);
    const previousReaction = selectedReaction;
    const previousCount = likeCount;
    const previousCounts = reactionCounts;
    const nextLiked = !previousReaction;
    const nextReaction: LikeReaction | null = nextLiked ? 'like' : null;
    const nextCount = Math.max(0, likeCount + (nextLiked ? 1 : -1));
    setLiked(nextLiked);
    setLikeCount(nextCount);
    setSelectedReaction(nextReaction);
    const nextReactionCounts = changeReactionCounts(previousCounts, previousReaction, nextReaction);
    setReactionCounts(nextReactionCounts);
    setLikeAnim(nextLiked);
    onLikeToggled?.(post.id, nextLiked, nextCount, nextReaction);

    try {
      if (nextLiked) {
        const { error } = await supabase.from('likes').insert({ post_id: post.id, user_id: profile?.id, reaction: 'like' });
        if (error) throw error;
      } else {
        const { error } = await supabase.from('likes').delete().eq('post_id', post.id).eq('user_id', profile?.id ?? '');
        if (error) throw error;
      }
    } catch {
      // revert on failure
      setLiked(!nextLiked);
      setLikeCount(previousCount);
      setSelectedReaction(previousReaction);
      setReactionCounts(previousCounts);
      onLikeToggled?.(post.id, !!previousReaction, previousCount, previousReaction);
    } finally {
      setBusy(false);
      setTimeout(() => setLikeAnim(false), 400);
    }
  }

  async function selectReaction(reaction: LikeReaction) {
    if (!profile?.id || busy) return;
    setBusy(true);
    const previousReaction = selectedReaction;
    const previousCount = likeCount;
    const previousCounts = reactionCounts;
    const wasLiked = !!previousReaction;
    const nextCount = previousCount + (wasLiked ? 0 : 1);
    setSelectedReaction(reaction);
    setLiked(true);
    setLikeCount(nextCount);
    setReactionCounts(changeReactionCounts(previousCounts, previousReaction, reaction));
    onLikeToggled?.(post.id, true, nextCount, reaction);
    try {
      const result = wasLiked
        ? await supabase.from('likes').update({ reaction }).eq('post_id', post.id).eq('user_id', profile.id)
        : await supabase.from('likes').insert({ post_id: post.id, user_id: profile.id, reaction });
      if (result.error) throw result.error;
    } catch {
      setSelectedReaction(previousReaction);
      setLiked(wasLiked);
      setLikeCount(previousCount);
      setReactionCounts(previousCounts);
      onLikeToggled?.(post.id, wasLiked, previousCount, previousReaction);
    } finally {
      setBusy(false);
      setLikeAnim(true);
      setTimeout(() => setLikeAnim(false), 400);
    }
  }

  async function deletePost() {
    setMenuOpen(false);
    const isOwn = profile?.id === post.author_id;
    if (!window.confirm(isAdmin && !isOwn
      ? 'حذف هذا المنشور نهائياً بصلاحية الأدمن؟ لا يمكن التراجع عن الحذف.'
      : 'هل تريد حذف هذا المنشور؟ لا يمكن التراجع عن الحذف.')) return;
    setBusy(true);
    setDeleteError(null);

    // 1. Try unified secure delete_post RPC first (works for both author and admin)
    let { error } = await supabase.rpc('delete_post', { p_post_id: post.id });

    // 2. If delete_post RPC is not yet applied, fallback to admin_delete_post or direct delete
    if (error) {
      if (isAdmin) {
        const adminRes = await supabase.rpc('admin_delete_post', { p_post_id: post.id });
        error = adminRes.error;
      }
      if (error && isOwn) {
        const directRes = await supabase.from('posts').delete().eq('id', post.id).eq('author_id', profile?.id ?? '');
        error = directRes.error;
      }
    }

    setBusy(false);
    if (error) {
      console.error('delete post failed', error.message, error);
      setDeleteError(error.message || 'تعذّر حذف المنشور. حاول مرة أخرى.');
      return;
    }

    // 3. Post record deleted successfully; now safely delete the image from Cloudinary or Supabase Storage
    if (post.image_url) {
      if (isCloudinaryUrl(post.image_url)) {
        if (session?.access_token) {
          try {
            await deletePostImageFromCloudinary(
              post.image_url,
              session.access_token,
              post.id,
              (post as any).image_public_id
            );
          } catch (e) {
            console.warn('delete image from cloudinary error:', e);
          }
        }
      } else if (post.image_url.includes('/media/')) {
        try {
          const match = post.image_url.match(/\/media\/(.+)$/);
          if (match) {
            const storagePath = decodeURIComponent(match[1].split('?')[0]);
            void supabase.storage.from('media').remove([storagePath]);
          }
        } catch (imgErr) {
          console.warn('delete image from storage failed:', imgErr);
        }
      }
    }

    onDeleted?.(post.id);
    if (!onDeleted) navigate('/');
  }

  async function addOrAcceptFriend() {
    if (!profile || friendBusy) return;
    setFriendBusy(true);
    setFriendError(null);
    const result = relation.state === 'incoming' && relation.requestId
      ? await supabase.rpc('respond_to_request', { p_request_id: relation.requestId, p_accept: true })
      : await supabase.rpc('request_friend', { p_target: post.author_id });
    setFriendBusy(false);
    if (result.error) {
      console.error('friend request failed', result.error.message);
      setFriendError('تعذّر إرسال طلب الصداقة. حاول مرة أخرى.');
      return;
    }
    onFriendshipChanged?.(post.author_id, {
      state: relation.state === 'incoming' ? 'friend' : 'requested',
    });
  }

  async function hideThisPost() {
    if (!profile) return;
    const { error } = await supabase.from('hidden_posts').insert(
      { viewer_id: profile.id, post_id: post.id },
    );
    if (error && error.code !== '23505') {
      console.error('hide post failed', error.message);
      setModerationError('تعذّر إخفاء المنشور. تأكد من تطبيق إعدادات إخفاء المنشورات.');
      return;
    }
    setMenuOpen(false);
    setSuppressed(true);
    onSuppressed?.(post.id, post.author_id, 'post');
    if (!error) showUndo('تم إخفاء المنشور', async () => {
      const { error: undoError } = await supabase.from('hidden_posts').delete()
        .eq('viewer_id', profile.id).eq('post_id', post.id);
      if (undoError) console.error('undo hide post failed', undoError.message);
      else window.dispatchEvent(new Event('post-controls-undone'));
    });
  }

  async function muteAuthor() {
    if (!profile) return;
    const { data: existing, error: lookupError } = await supabase.from('user_content_filters')
      .select('mode').eq('viewer_id', profile.id).eq('target_user_id', post.author_id).maybeSingle();
    if (lookupError) {
      setModerationError('تعذّر قراءة إعدادات إخفاء الشخص.');
      return;
    }
    if (existing?.mode === 'block_user') {
      setModerationError('هذا الشخص محظور بالفعل.');
      return;
    }
    if (existing?.mode === 'mute_posts') {
      setMenuOpen(false);
      setSuppressed(true);
      onSuppressed?.(post.id, post.author_id, 'author');
      return;
    }
    const { error } = await supabase.from('user_content_filters').insert(
      { viewer_id: profile.id, target_user_id: post.author_id, mode: 'mute_posts' },
    );
    if (error) {
      console.error('mute author failed', error.message);
      setModerationError('تعذّر تقليل ظهور منشورات هذا الشخص.');
      return;
    }
    setMenuOpen(false);
    setSuppressed(true);
    onSuppressed?.(post.id, post.author_id, 'author');
    showUndo('تم تقليل ظهور منشورات هذا الشخص', async () => {
      const { error: undoError } = await supabase.from('user_content_filters').delete()
        .eq('viewer_id', profile.id).eq('target_user_id', post.author_id).eq('mode', 'mute_posts');
      if (undoError) console.error('undo mute author failed', undoError.message);
      else window.dispatchEvent(new Event('post-controls-undone'));
    });
  }

  async function blockAuthor() {
    if (!profile || !window.confirm('سيتم إخفاء منشورات هذا الشخص ومنع طلبات الصداقة والرسائل بينكما. هل تريد المتابعة؟')) return;
    const { data: previousFilter, error: lookupError } = await supabase.from('user_content_filters')
      .select('mode').eq('viewer_id', profile.id).eq('target_user_id', post.author_id).maybeSingle();
    if (lookupError) {
      setModerationError('تعذّر قراءة إعدادات الحظر.');
      return;
    }
    if (previousFilter?.mode === 'block_user') {
      setModerationError('هذا الشخص محظور بالفعل.');
      return;
    }
    const { error } = await supabase.from('user_content_filters').upsert(
      { viewer_id: profile.id, target_user_id: post.author_id, mode: 'block_user' },
      { onConflict: 'viewer_id,target_user_id' },
    );
    if (error) {
      console.error('block author failed', error.message);
      setModerationError('تعذّر حظر هذا الشخص. تأكد من تطبيق إعدادات الحظر.');
      return;
    }
    setMenuOpen(false);
    setSuppressed(true);
    onSuppressed?.(post.id, post.author_id, 'author');
    showUndo('تم حظر هذا الشخص', async () => {
      if (previousFilter?.mode === 'mute_posts') {
        const { error: undoError } = await supabase.from('user_content_filters')
          .update({ mode: 'mute_posts' }).eq('viewer_id', profile.id).eq('target_user_id', post.author_id);
        if (undoError) console.error('undo block failed', undoError.message);
      } else {
        const { error: undoError } = await supabase.from('user_content_filters').delete()
          .eq('viewer_id', profile.id).eq('target_user_id', post.author_id);
        if (undoError) console.error('undo block failed', undoError.message);
      }
      window.dispatchEvent(new Event('post-controls-undone'));
    });
  }

  async function adminBanAuthor(action: 'suspend_1d' | 'suspend_3d' | 'ban_permanent') {
    setMenuOpen(false);
    const prompt = action === 'suspend_1d'
      ? `حظر حساب "${post.author_name}" من التطبيق لمدة 24 ساعة (يوم)؟`
      : action === 'suspend_3d'
        ? `حظر حساب "${post.author_name}" من التطبيق لمدة 3 أيام؟`
        : `حظر حساب "${post.author_name}" نهائياً من التطبيق بالكامل؟ لا يمكن للمستخدم الدخول بعد ذلك.`;
    if (!window.confirm(prompt)) return;
    setBusy(true);
    setModerationError(null);
    try {
      // 1. Edge Function (Auth user ban + account_moderation update)
      const { data: edgeData, error: edgeErr } = await supabase.functions.invoke('apply-report-ban', {
        body: { admin_action: action, user_id: post.author_id },
      });

      // 2. Direct RPC fallback if edge function fails or target user is not an Auth user (e.g. demo/guest)
      if (edgeErr || !edgeData?.ok) {
        const { error: rpcErr } = await supabase.rpc('admin_set_account_restriction', {
          p_user_id: post.author_id,
          p_action: action,
        });
        if (rpcErr) {
          const detail = rpcErr.message || rpcErr.details || (edgeErr ? edgeErr.message : '');
          throw new Error(detail || 'فشل تنفيذ الحظر في قاعدة البيانات');
        }
      }

      // Clean storage for the current post as an immediate client-side dual guarantee
      if (post.image_url) {
        if (isCloudinaryUrl(post.image_url)) {
          if (session?.access_token) {
            void deletePostImageFromCloudinary(
              post.image_url,
              session.access_token,
              post.id,
              (post as any).image_public_id
            );
          }
        } else if (post.image_url.includes('/media/')) {
          try {
            const match = post.image_url.match(/\/media\/(.+)$/);
            if (match) {
              const storagePath = decodeURIComponent(match[1].split('?')[0]);
              void supabase.storage.from('media').remove([storagePath]);
            }
          } catch (imgErr) {
            console.warn('delete image from storage failed:', imgErr);
          }
        }
      }

      onDeleted?.(post.id);

      if (profile?.id) {
        try {
          await supabase.from('user_content_filters').upsert(
            { viewer_id: profile.id, target_user_id: post.author_id, mode: 'block_user' },
            { onConflict: 'viewer_id,target_user_id' }
          );
        } catch (e) {
          console.warn('user_content_filters upsert warning:', e);
        }
      }
      setSuppressed(true);
      onSuppressed?.(post.id, post.author_id, 'author');
      const successMsg = action === 'suspend_1d'
        ? 'تم حظر الحساب لمدة 24 ساعة وحذف جميع منشوراته وصوره.'
        : action === 'suspend_3d'
          ? 'تم حظر الحساب لمدة 3 أيام وحذف جميع منشوراته وصوره.'
          : 'تم حظر الحساب نهائياً من التطبيق وحذف جميع منشوراته وصوره.';
      setReportMessage(successMsg);
    } catch (err: unknown) {
      let message = 'خطأ غير معروف';
      if (typeof err === 'string') {
        message = err;
      } else if (err instanceof Error) {
        message = err.message;
      } else if (err && typeof err === 'object') {
        const anyErr = err as { message?: string; details?: string; hint?: string; error_description?: string };
        message = anyErr.message || anyErr.details || anyErr.error_description || JSON.stringify(err);
      }
      if (message.includes('unsupported moderation action')) {
        message = 'يرجى تشغيل كود SQL في Supabase لتفعيل خيار حظر اليوم (ملف 20261026040000_admin_ban_1day_and_3days.sql).';
      }
      setModerationError('تعذّر حظر الحساب: ' + message);
    } finally {
      setBusy(false);
    }
  }

  async function reportPost() {
    if (!profile?.id || authorIsAdmin !== false) return;
    const reason = window.prompt('اكتب سبب الإبلاغ عن هذا المنشور:');
    if (!reason?.trim()) return;
    const { error } = await supabase.from('post_reports').insert({
      reporter_id: profile.id,
      reported_user_id: post.author_id,
      post_id: post.id,
      reason: reason.trim().slice(0, 1000),
    });
    setMenuOpen(false);
    if (error) {
      console.error('report post failed', error.message);
      setReportMessage('تعذّر إرسال البلاغ. تأكد من تطبيق migration البلاغات.');
    } else {
      void supabase.functions.invoke('apply-report-ban', { body: { post_id: post.id } })
        .then(({ error: banError }) => {
          if (banError) console.error('could not sync report-based auth ban', banError.message);
        });
      setReportMessage('تم إرسال البلاغ إلى إدارة التطبيق.');
    }
  }

  async function openShareOptions() {
    setShareOpen(true);
    setShareError(null);
    setShareLoading(true);
    const { data, error } = await supabase.rpc('my_friends');
    setShareLoading(false);
    if (error) {
      setShareError('تعذّر تحميل قائمة الأصدقاء.');
      return;
    }
    setShareFriends((data ?? []) as typeof shareFriends);
  }

  function postLink() {
    return `${window.location.origin}${window.location.pathname}#/post/${sharedPost?.id ?? post.id}`;
  }

  async function shareToProfile() {
    if (!profile?.id || shareBusy) return;
    setShareBusy(true);
    setShareError(null);
    const body = `[[shared-post:${sharedPost?.id ?? post.id}]]`;
    const { error } = await supabase.from('posts').insert({ author_id: profile.id, body, image_url: null, is_urgent: false });
    setShareBusy(false);
    if (error) {
      setShareError(error.message.includes('15 دقيقة')
        ? 'يمكنك نشر منشور واحد فقط كل 15 دقيقة.'
        : 'تعذّر نشر المشاركة على بروفايلك: ' + error.message);
      return;
    }
    setShareOpen(false);
    setReportMessage('تمت مشاركة المنشور على بروفايلك.');
  }

  async function shareToFriend(friendId: string) {
    if (!profile?.id || shareBusy) return;
    setShareBusy(true);
    setShareError(null);
    const { error } = await supabase.from('messages').insert({ sender_id: profile.id, recipient_id: friendId, body: 'شارك منشورًا معك', shared_post_id: sharedPost?.id ?? post.id });
    setShareBusy(false);
    if (error) {
      setShareError('تعذّر إرسال المنشور كرسالة: ' + error.message);
      return;
    }
    setShareOpen(false);
    navigate(`/messages/${friendId}`);
  }

  if (suppressed) return null;
  const visibleReactionCounts = reactionLabels
    .map((item) => ({ ...item, count: reactionCounts[item.key] ?? 0 }))
    .filter((item) => item.count > 0)
    .sort((a, b) => b.count - a.count);

  return (
    <article
      className={`card-raised overflow-visible p-0 fade-in border border-surface-dim/80 shadow-[0_2px_8px_rgba(19,27,46,0.06)] transition-all font-noto ${
        post.is_urgent ? 'shadow-urgent animate-urgent-pulse border-urgent/40' : ''
      }`}
    >
      {post.status === 'pending_approval' && (
        <div className="flex items-center gap-2 bg-amber-500/10 px-4 py-2 text-amber-700 dark:text-amber-400">
          <Clock className="h-4 w-4" strokeWidth={2.4} />
          <span className="text-xs font-bold">بانتظار موافقة الإدارة</span>
          <span className="mr-auto text-[11px] font-medium text-amber-700/70 dark:text-amber-400/70">
            يظهر لك فقط حتى تتم مراجعته
          </span>
        </div>
      )}

      {post.is_urgent && (
        <div className="flex items-center gap-2 bg-urgent/10 px-4 py-2 text-urgent">
          <Flame className="h-4 w-4" strokeWidth={2.4} />
          <span className="text-xs font-bold">عاجل</span>
          <span className="mr-auto text-[11px] font-medium text-urgent/70">
            أولوية في صُحبتك
          </span>
        </div>
      )}

      <div className="px-3.5 pt-2.5 pb-2.5">
        {/* Header */}
        <div className="relative flex items-start gap-3">
          <button onClick={() => navigate(`/profile/${post.author_id}`)} className="shrink-0">
            <Avatar name={post.author_name} src={post.author_avatar} size={44} />
          </button>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <button
                onClick={() => navigate(`/profile/${post.author_id}`)}
                className="truncate font-bold text-ink hover:text-primary text-[15px]"
              >
                {post.author_name}
              </button>
              {profile?.id !== post.author_id && relation.state !== 'friend' && (
                <button
                  onClick={() => void addOrAcceptFriend()}
                  disabled={friendBusy || relation.state === 'requested'}
                  className={`inline-flex shrink-0 items-center gap-1 text-[11px] font-semibold ${relation.state === 'requested' ? 'text-ink-muted' : 'text-primary hover:underline'}`}
                >
                  {friendBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : relation.state === 'incoming' ? <BadgeCheck className="h-3.5 w-3.5" /> : <UserPlus className="h-3.5 w-3.5" />}
                  {relation.state === 'requested' ? 'طلب مرسل' : relation.state === 'incoming' ? 'قبول الصداقة' : 'إضافة صديق'}
                </button>
              )}
            </div>
            <time dateTime={post.created_at} className="block text-xs text-ink-muted mt-0.5 leading-tight">
              {timeAgo(post.created_at)}
            </time>
            {friendError && <p className="mt-1 text-[11px] text-error">{friendError}</p>}
          </div>
          {profile?.id === post.author_id ? (
            <div ref={menuRef} className="relative -mt-1 -ml-1">
              <button
                onClick={() => setMenuOpen((open) => !open)}
                className="rounded-full p-1.5 text-ink-muted hover:bg-surface-subtle"
                aria-label="خيارات المنشور"
                aria-expanded={menuOpen}
              >
                <MoreHorizontal className="h-5 w-5" />
              </button>
              {menuOpen && (
                <div className="absolute left-0 top-9 z-10 min-w-36 rounded-xl border border-surface-dim bg-surface-raised p-1 shadow-card-raised">
                  <button
                    onClick={() => navigate('/create', { state: { editPost: post } })}
                    className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold text-ink-soft hover:bg-surface-subtle"
                  >
                    <Pencil className="h-4 w-4" />
                    تعديل المنشور
                  </button>
                  <button
                    onClick={() => void deletePost()}
                    disabled={busy}
                    className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold text-error hover:bg-error-50"
                  >
                    <Trash2 className="h-4 w-4" />
                    حذف المنشور
                  </button>
                </div>
              )}
            </div>
          ) : profile?.id !== post.author_id ? (
            <div ref={menuRef} className="relative -mt-1 -ml-1 flex items-center gap-0.5">
              {!isAdmin && (
                <button
                  onClick={() => void muteAuthor()}
                  className="rounded-full p-1.5 text-ink-muted hover:bg-surface-subtle hover:text-error"
                  aria-label="تقليل ظهور منشورات هذا الشخص"
                  title="إظهار منشورات أقل"
                >
                  <X className="h-5 w-5" />
                </button>
              )}
              <button
                onClick={() => setMenuOpen((open) => !open)}
                className="rounded-full p-1.5 text-ink-muted hover:bg-surface-subtle"
                aria-label="خيارات المنشور"
                aria-expanded={menuOpen}
              >
                <MoreHorizontal className="h-5 w-5" />
              </button>
              {menuOpen && (
                <div className="absolute left-0 top-9 z-50 min-w-44 rounded-xl border border-surface-dim bg-surface-raised p-1 shadow-card-raised">
                  {isAdmin ? (
                    <>
                      <button
                        onClick={() => void deletePost()}
                        disabled={busy}
                        className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold text-error hover:bg-error-50 disabled:opacity-50"
                      >
                        <Trash2 className="h-4 w-4" />
                        حذف المنشور
                      </button>
                      {authorIsAdmin !== true && (
                        <>
                          <button
                            onClick={() => void adminBanAuthor('suspend_1d')}
                            disabled={busy}
                            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold text-urgent hover:bg-urgent/10 disabled:opacity-50"
                          >
                            <Clock className="h-4 w-4" />
                            حظر يوم
                          </button>
                          <button
                            onClick={() => void adminBanAuthor('suspend_3d')}
                            disabled={busy}
                            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold text-urgent hover:bg-urgent/10 disabled:opacity-50"
                          >
                            <Clock className="h-4 w-4" />
                            حظر 3 أيام
                          </button>
                          <button
                            onClick={() => void adminBanAuthor('ban_permanent')}
                            disabled={busy}
                            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold text-error hover:bg-error-50 disabled:opacity-50"
                          >
                            <UserX className="h-4 w-4" />
                            حظر نهائي
                          </button>
                        </>
                      )}
                    </>
                  ) : (
                    <>
                      <button onClick={() => void hideThisPost()} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold text-ink-soft hover:bg-surface-subtle">
                        <EyeOff className="h-4 w-4" />
                        إخفاء هذا المنشور
                      </button>
                      <button onClick={() => void muteAuthor()} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold text-ink-soft hover:bg-surface-subtle">
                        <X className="h-4 w-4" />
                        حظر منشورات الشخص
                      </button>
                      <button onClick={() => void blockAuthor()} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold text-error hover:bg-error-50">
                        <Ban className="h-4 w-4" />
                        حظر الشخص بالكامل
                      </button>
                      {authorIsAdmin === false && (
                        <button
                          onClick={() => void reportPost()}
                          className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold text-error hover:bg-error-50"
                        >
                          <Flag className="h-4 w-4" />
                          الإبلاغ عن المنشور
                        </button>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
          ) : null}
        </div>

        {deleteError && <p className="mt-3 text-sm text-error">{deleteError}</p>}
        {moderationError && <p className="mt-3 text-sm text-error">{moderationError}</p>}
        {reportMessage && <p className="mt-3 text-sm text-primary">{reportMessage}</p>}

        {/* Body */}
        {sharedPostId ? (
          <button onClick={() => sharedPost && navigate(`/post/${sharedPost.id}`)} disabled={!sharedPost} className="mt-3 block w-full rounded-xl border border-surface-dim bg-surface-subtle p-3 text-right disabled:opacity-70">
            <span className="mb-2 block text-xs font-semibold text-ink-muted">{post.author_name} شارك منشورًا</span>
            {sharedPost ? <>
              <span className="mb-2 flex items-center gap-2 text-xs font-bold text-primary">
                <Avatar name={sharedPost.author_name} src={sharedPost.author_avatar} size={28} />
                {sharedPost.author_name}
              </span>
              {sharedPost.body && <span className="block whitespace-pre-wrap break-words text-sm leading-relaxed text-ink font-noto">{sharedPost.body}</span>}
              {sharedPost.image_url && (
                <img
                  src={getOptimizedPostImageUrl(sharedPost.image_url, { width: 640 })}
                  alt=""
                  className="mt-2 max-h-80 w-full rounded-lg object-contain bg-surface-subtle/50"
                  loading="lazy"
                />
              )}
            </> : <span className="text-sm text-ink-muted">جارٍ تحميل المنشور...</span>}
          </button>
        ) : post.body && (
          <p className="mt-3 whitespace-pre-wrap break-words text-[15.5px] leading-relaxed text-ink font-noto">
            {post.body}
          </p>
        )}

        {/* Image */}
        {post.image_url && (
          <div className="relative mt-3 w-full overflow-hidden rounded-2xl border border-surface-dim/70 bg-surface-subtle group">
            <button
              type="button"
              onClick={() => {
                if (isDetail) {
                  setLightboxOpen(true);
                } else {
                  setLightboxOpen(true);
                }
              }}
              className="block w-full cursor-zoom-in text-center focus:outline-none"
              title="انقر لعرض الصورة بالحجم الكامل"
            >
              <img
                src={getOptimizedPostImageUrl(post.image_url, { width: 1200 })}
                alt="صورة المنشور"
                className={`w-full mx-auto object-contain transition-all duration-200 ${
                  isDetail ? 'max-h-[75vh]' : 'max-h-[520px]'
                }`}
                loading="lazy"
              />
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setLightboxOpen(true);
              }}
              className="absolute bottom-2.5 left-2.5 flex items-center gap-1.5 rounded-full bg-ink/75 px-3 py-1.5 text-xs font-medium text-white backdrop-blur-sm hover:bg-ink transition shadow-sm"
              title="عرض بالحجم الكامل"
            >
              <Maximize2 className="h-3.5 w-3.5" />
              <span>عرض كامل</span>
            </button>
          </div>
        )}
      </div>

      {visibleReactionCounts.length > 0 && (
        <div className="flex items-center justify-end gap-2 border-t border-surface-dim px-4 py-2" aria-label="التفاعلات على المنشور">
          {visibleReactionCounts.map((item) => (
            <span key={item.key} title={item.label} className="inline-flex items-center gap-1 text-xs text-ink-soft">
              <span className="text-base leading-none">{item.emoji}</span>
              <span>{item.count}</span>
            </span>
          ))}
        </div>
      )}

      {/* Footer / actions */}
      <div className="flex items-center gap-1 px-2 py-0.5">
        <ReactionButton
          reaction={selectedReaction}
          count={likeCount}
          disabled={busy}
          onToggle={() => void toggleLike()}
          onSelect={(reaction) => void selectReaction(reaction)}
          className="flex items-center gap-1.5 rounded-full px-3 py-2 text-sm font-medium transition-colors hover:bg-surface-subtle disabled:opacity-50"
          iconClassName={liked ? 'fill-urgent text-urgent' : 'text-ink-muted'}
          labelClassName={liked ? 'text-urgent' : 'text-ink-soft'}
          animate={likeAnim}
        />

        <button
          onClick={() => setCommentsOpen(true)}
          className="flex items-center gap-1.5 rounded-full px-3 py-2 text-sm font-medium text-ink-soft transition-colors hover:bg-surface-subtle"
          aria-label="التعليقات"
        >
          <MessageCircle className="h-5 w-5" strokeWidth={2} />
          <span>{commentCount > 0 ? commentCount : 'تعليق'}</span>
        </button>

        <button
          onClick={() => void openShareOptions()}
          aria-label="نشر المنشور"
          className="flex items-center gap-1.5 rounded-full px-3 py-2 text-sm font-medium text-ink-soft transition-colors hover:bg-surface-subtle"
        >
          <Forward className="h-5 w-5 -scale-x-100" strokeWidth={2} />
          <span>نشر</span>
        </button>
      </div>

      {commentsOpen && (
        <CommentsModal
          isOpen={commentsOpen}
          onClose={() => setCommentsOpen(false)}
          postId={post.id}
          postAuthorName={post.author_name}
          onCountChange={(count) => setCommentCount(count)}
        />
      )}

      {shareOpen && (
        <div data-modal="true" className="fixed inset-0 z-[60] flex items-end justify-center bg-black/40 p-3 sm:items-center" onClick={() => setShareOpen(false)}>
          <section className="max-h-[75dvh] w-full max-w-md overflow-y-auto rounded-3xl bg-surface-raised p-4 shadow-card-raised" onClick={(event) => event.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-lg font-bold text-ink">مشاركة المنشور</h2>
              <button onClick={() => setShareOpen(false)} className="rounded-full p-2 text-ink-muted hover:bg-surface-subtle" aria-label="إغلاق"><X className="h-5 w-5" /></button>
            </div>
            <button disabled={shareBusy} onClick={() => void shareToProfile()} className="mb-3 flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 font-semibold text-white disabled:opacity-50">
              {shareBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Forward className="h-4 w-4 -scale-x-100" />}
              نشر على بروفايلي
            </button>
            <h3 className="mb-2 text-sm font-bold text-ink">إرسال كرسالة إلى صديق</h3>
            {shareLoading ? <div className="flex justify-center py-5"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div>
              : shareFriends.length === 0 ? <p className="py-4 text-center text-sm text-ink-muted">لا يوجد أصدقاء لإرسال المنشور إليهم.</p>
                : <div className="divide-y divide-surface-dim">
                  {shareFriends.map((friend) => <button key={friend.user_id} disabled={shareBusy} onClick={() => void shareToFriend(friend.user_id)} className="flex w-full items-center gap-3 py-3 text-right hover:bg-surface-subtle disabled:opacity-50">
                    <Avatar name={friend.full_name} src={friend.avatar_url} size={40} />
                    <span className="flex-1 font-semibold text-ink">{friend.full_name}</span>
                    <Send className="h-4 w-4 text-primary" />
                  </button>)}
                </div>}
            {shareError && <p className="mt-3 rounded-xl bg-error-50 px-3 py-2 text-sm text-error">{shareError}</p>}
          </section>
        </div>
      )}
      {/* Full-Screen Image Lightbox Modal */}
      {lightboxOpen && post.image_url && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/95 backdrop-blur-md p-2 sm:p-4 animate-fade-in"
          onClick={() => setLightboxOpen(false)}
        >
          <button
            type="button"
            onClick={() => setLightboxOpen(false)}
            className="absolute top-4 left-4 z-[110] flex h-11 w-11 items-center justify-center rounded-full bg-white/20 text-white hover:bg-white/30 transition shadow-lg backdrop-blur-sm"
            aria-label="إغلاق"
            title="إغلاق (Esc)"
          >
            <X className="h-6 w-6" />
          </button>
          <div
            className="relative max-h-full max-w-full flex items-center justify-center"
            onClick={(e) => e.stopPropagation()}
          >
            <img
              src={getOptimizedPostImageUrl(post.image_url, { width: 1800 })}
              alt="صورة المنشور بالحجم الكامل"
              className="max-h-[92vh] max-w-[96vw] object-contain rounded-xl shadow-2xl select-none"
            />
          </div>
        </div>
      )}
    </article>
  );
}
