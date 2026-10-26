import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft, Settings, Share2, BadgeCheck, Pencil, X, Camera, Loader2, Users, Grid3x3, Info, MessageCircle, Flag, Ban, RotateCcw, Send,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { Avatar } from '@/components/Avatar';
import { PostCard } from '@/components/PostCard';
import type { FeedPost, Profile, Person, LikeReaction } from '@/types';

export function ProfileScreen() {
  const { userId } = useParams<{ userId?: string }>();
  const { profile: me, signOut, refreshProfile, isGuest, session } = useAuth();
  const navigate = useNavigate();
  const isMe = !userId || userId === me?.id;
  const [profile, setProfile] = useState<Profile | null>(null);
  const [posts, setPosts] = useState<FeedPost[]>([]);
  const [relation, setRelation] = useState<Person['relation']>('none');
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [reportBusy, setReportBusy] = useState(false);
  const [reportMessage, setReportMessage] = useState<string | null>(null);
  const [adminBusy, setAdminBusy] = useState(false);
  const [adminMessage, setAdminMessage] = useState<string | null>(null);
  const [profileIsAdmin, setProfileIsAdmin] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [shareFriends, setShareFriends] = useState<ShareFriend[]>([]);
  const [shareLoading, setShareLoading] = useState(false);
  const [shareBusyId, setShareBusyId] = useState<string | null>(null);
  const [shareError, setShareError] = useState<string | null>(null);
  const isAdmin = session?.user.app_metadata?.role === 'admin';

  const targetId = userId ?? me?.id;

  const load = useCallback(async () => {
    if (!targetId) return;
    setLoading(true);
    const { data: prof } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', targetId)
      .maybeSingle();
    setProfile(prof as Profile | null);
    if (prof?.id) {
      const { data: adminFlag, error: adminFlagError } = await supabase.rpc('is_admin_profile', { p_user_id: prof.id });
      setProfileIsAdmin(!adminFlagError && adminFlag === true);
    } else {
      setProfileIsAdmin(false);
    }

    // Load this user's posts via feed rpc isn't scoped per-author; use a
    // direct query — RLS will only return visible posts within the last 24h.
    const cutoff24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data: rawPosts } = await supabase
      .from('posts')
      .select('id, author_id, body, image_url, is_urgent, created_at')
      .eq('author_id', targetId)
      .gte('created_at', cutoff24h)
      .order('created_at', { ascending: false })
      .limit(20);

    // Enrich with like/comment counts + viewer_liked
    const postRows = (rawPosts ?? []) as Array<FeedPost & { viewer_liked?: boolean }>;
    if (postRows.length > 0) {
      const ids = postRows.map((p) => p.id);
      const viewerId = me?.id;
      const [{ data: reactionRows }, { data: comments }, { data: myLikes }] = await Promise.all([
        supabase.rpc('post_reaction_counts', { p_post_ids: ids }),
        supabase.from('comments').select('id, post_id').in('post_id', ids),
        supabase.from('likes').select('post_id, reaction').in('post_id', ids).eq('user_id', viewerId ?? ''),
      ]);
      const reactionCountMap = new Map<string, Partial<Record<LikeReaction, number>>>();
      (reactionRows ?? []).forEach((row: { post_id: string; reaction: LikeReaction; reaction_count: number }) => {
        const counts = reactionCountMap.get(row.post_id) ?? {};
        counts[row.reaction] = Number(row.reaction_count);
        reactionCountMap.set(row.post_id, counts);
      });
      const commentMap = new Map<string, number>();
      (comments ?? []).forEach((c: { id: string; post_id: string }) => commentMap.set(c.post_id, (commentMap.get(c.post_id) ?? 0) + 1));
      const myLikeSet = new Set((myLikes ?? []).map((l: { post_id: string }) => l.post_id));
      const myReactionMap = new Map((myLikes ?? []).map((l: { post_id: string; reaction: FeedPost['viewer_reaction'] }) => [l.post_id, l.reaction]));

      postRows.forEach((p) => {
        p.reaction_counts = reactionCountMap.get(p.id) ?? {};
        p.like_count = Object.values(p.reaction_counts).reduce((sum, value) => sum + (value ?? 0), 0);
        p.comment_count = commentMap.get(p.id) ?? 0;
        p.viewer_liked = myLikeSet.has(p.id);
        p.viewer_reaction = myReactionMap.get(p.id) ?? null;
        p.author_name = prof?.full_name ?? '';
        p.author_username = prof?.username ?? '';
        p.author_avatar = prof?.avatar_url ?? null;
        p.ctx_kind = isMe ? 'self' : relation === 'friend' ? 'friend' : 'friend_of_friend';
        p.ctx_mutual_name = null;
      });
    }
    setPosts(postRows as FeedPost[]);

    if (!isMe) {
      const { data: searchHit } = await supabase.rpc('search_people', { p_query: '', p_limit: 100 });
      const hit = ((searchPeopleByName(searchHit as Person[] | null, targetId)) as Person | null);
      setRelation(hit?.relation ?? 'none');
    }

    setLoading(false);
  }, [targetId, me?.id, isMe, relation]);

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetId]);

  useEffect(() => {
    const refreshAfterUndo = () => { void load(); };
    window.addEventListener('post-controls-undone', refreshAfterUndo);
    return () => window.removeEventListener('post-controls-undone', refreshAfterUndo);
  }, [load]);

  async function handleFriendAction() {
    if (!profile) return;
    setBusy(true);
    if (relation === 'none') {
      await supabase.rpc('request_friend', { p_target: profile.id });
      setRelation('requested');
    } else if (relation === 'friend') {
      await supabase.rpc('cancel_friend', { p_target: profile.id });
      setRelation('none');
    } else if (relation === 'requested') {
      await supabase.rpc('cancel_friend', { p_target: profile.id });
      setRelation('none');
    } else if (relation === 'incoming') {
      // find the request id
      const { data } = await supabase.rpc('my_friend_requests');
      const req = (data as FriendRequestLike[] | null)?.find((r) => r.user_id === profile.id);
      if (req) await supabase.rpc('respond_to_request', { p_request_id: req.request_id, p_accept: true });
      setRelation('friend');
    }
    setBusy(false);
  }

  async function reportProfile() {
    if (!me?.id || !profile || profileIsAdmin || reportBusy) return;
    const reason = window.prompt('اكتب سبب الإبلاغ عن هذا الحساب:');
    if (!reason?.trim()) return;
    setReportBusy(true);
    setReportMessage(null);
    const { error } = await supabase.from('profile_reports').insert({
      reporter_id: me.id,
      reported_user_id: profile.id,
      reason: reason.trim().slice(0, 1000),
    });
    setReportBusy(false);
    if (error) {
      console.error('profile report failed', error.message);
      setReportMessage(error.code === '23505' ? 'سبق أن أبلغت عن هذا الحساب.' : 'تعذّر إرسال البلاغ. تأكد من تطبيق migration بلاغات الحسابات.');
      return;
    }
    void supabase.functions.invoke('apply-report-ban', { body: { profile_id: profile.id } })
      .then(({ error: banError }) => {
        if (banError) console.error('could not sync profile report auth ban', banError.message);
      });
    setReportMessage('تم إرسال البلاغ إلى إدارة التطبيق.');
  }

  async function openProfileShare() {
    setShareOpen(true);
    setShareError(null);
    setShareLoading(true);
    const { data, error } = await supabase.rpc('my_friends');
    setShareLoading(false);
    if (error) {
      setShareError('تعذّر تحميل قائمة الأصدقاء.');
      return;
    }
    setShareFriends((data ?? []) as ShareFriend[]);
  }

  async function sendProfileLink(friendId: string) {
    if (!me?.id || !profile || shareBusyId) return;
    setShareBusyId(friendId);
    setShareError(null);
    const link = `${window.location.origin}${window.location.pathname}#/profile/${profile.id}`;
    const { error } = await supabase.from('messages').insert({
      sender_id: me.id,
      recipient_id: friendId,
      body: `شاهد بروفايل ${profile.full_name} وأضفه كصديق:\n${link}`,
    });
    setShareBusyId(null);
    if (error) {
      setShareError('تعذّر إرسال رابط البروفايل: ' + error.message);
      return;
    }
    setShareOpen(false);
    navigate(`/messages/${friendId}`);
  }

  async function moderateProfile(action: 'suspend_1d' | 'suspend_3d' | 'ban_permanent' | 'unban') {
    if (!isAdmin || !profile || adminBusy) return;
    const prompt = action === 'suspend_1d'
      ? `حظر ${profile.full_name} من دخول التطبيق لمدة 24 ساعة وحذف جميع منشوراته وصوره؟`
      : action === 'suspend_3d'
        ? `حظر ${profile.full_name} من دخول التطبيق لمدة 3 أيام وحذف جميع منشوراته وصوره؟`
        : action === 'ban_permanent'
          ? `حظر ${profile.full_name} نهائياً من دخول التطبيق وحذف جميع منشوراته وصوره؟`
          : `فك الحظر عن ${profile.full_name}؟`;
    if (!window.confirm(prompt)) return;
    setAdminBusy(true);
    setAdminMessage(null);
    const { error } = await supabase.functions.invoke('apply-report-ban', {
      body: { admin_action: action, user_id: profile.id },
    });
    setAdminBusy(false);
    if (error) {
      setAdminMessage('تعذّر تنفيذ الإجراء. تأكد من تطبيق migration لوحة الإدارة ونشر Edge Function المحدّثة.');
      return;
    }
    if (action !== 'unban') {
      setPosts([]);
    }
    setAdminMessage(action === 'unban' ? 'تم فك الحظر عن الحساب.' : action === 'suspend_1d' ? 'تم حظر الحساب لمدة 24 ساعة وحذف منشوراته وصوره.' : action === 'suspend_3d' ? 'تم حظر الحساب لمدة 3 أيام وحذف منشوراته وصوره.' : 'تم حظر الحساب نهائياً وحذف جميع منشوراته وصوره.');
  }

  if (loading) {
    return (
      <div className="app-shell items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="app-shell items-center justify-center gap-3 px-6 text-center">
        <p className="font-bold text-ink">المستخدم غير موجود</p>
        <button onClick={() => navigate(-1)} className="btn-secondary">رجوع</button>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <header className="sticky top-0 z-20 flex items-center gap-2 border-b border-surface-dim bg-surface-raised/95 px-3 py-3 backdrop-blur-md">
        {!isMe ? (
          <button onClick={() => navigate(-1)} className="flex h-10 w-10 items-center justify-center rounded-full text-ink-soft hover:bg-surface-subtle">
            <ArrowLeft className="h-5 w-5 rotate-180" />
          </button>
        ) : (
          <div className="h-10 w-10" />
        )}
        <h1 className="text-lg font-bold text-ink">حسابي</h1>
        <div className="mr-auto flex items-center gap-1">
          {!isMe && !profileIsAdmin && <button
            onClick={() => void reportProfile()}
            disabled={reportBusy}
            className="inline-flex h-10 items-center justify-center gap-1.5 rounded-full px-3 text-sm font-semibold text-error hover:bg-error-50 disabled:opacity-50"
            aria-label="الإبلاغ عن الحساب"
            title="الإبلاغ عن الحساب"
          >
            {reportBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Flag className="h-4 w-4" />}
            <span>إبلاغ</span>
          </button>}
          <button onClick={() => void openProfileShare()} className="flex h-10 w-10 items-center justify-center rounded-full text-ink-soft hover:bg-surface-subtle" aria-label="مشاركة البروفايل" title="مشاركة البروفايل">
            <Share2 className="h-5 w-5" />
          </button>
          {isMe && (
            <button onClick={() => navigate('/settings')} className="flex h-10 w-10 items-center justify-center rounded-full text-ink-soft hover:bg-surface-subtle">
              <Settings className="h-5 w-5" />
            </button>
          )}
        </div>
      </header>

      <main className="app-body">
        {/* Identity card */}
        <div className="bg-surface-raised px-4 py-6 text-center">
          <div className="relative mx-auto w-fit">
            <Avatar name={profile.full_name} src={profile.avatar_url} size={96} />
            {isMe && (
              <button
                onClick={() => setEditing(true)}
                className="absolute bottom-0 left-0 flex h-8 w-8 items-center justify-center rounded-full bg-primary text-white shadow-fab"
                aria-label="تغيير الصورة"
              >
                <Camera className="h-4 w-4" />
              </button>
            )}
          </div>
          <div className="mt-3 flex items-center justify-center gap-1.5">
            <h2 className="text-xl font-extrabold text-ink">{profile.full_name}</h2>
            <BadgeCheck className="h-5 w-5 text-primary" />
          </div>
          <p className="text-sm text-ink-muted">@{profile.username}</p>
          {profile.bio && (
            <p className="mx-auto mt-3 max-w-xs whitespace-pre-wrap text-sm leading-relaxed text-ink-soft">
              {profile.bio}
            </p>
          )}
          {reportMessage && <p className="mt-2 text-sm text-primary">{reportMessage}</p>}
          {adminMessage && <p className="mt-2 text-sm text-primary">{adminMessage}</p>}

          {isAdmin && !isMe && (
            <div className="mx-auto mt-4 flex max-w-sm flex-wrap items-center justify-center gap-2 rounded-2xl border border-error/20 bg-error-50/60 p-3">
              <span className="w-full text-xs font-bold text-error">أدوات الأدمن لهذا الحساب</span>
              <button disabled={adminBusy} onClick={() => void moderateProfile('suspend_1d')} className="inline-flex items-center gap-1.5 rounded-full bg-urgent/10 px-3 py-2 text-xs font-semibold text-urgent disabled:opacity-50">
                <Ban className="h-4 w-4" /> حظر 24 ساعة
              </button>
              <button disabled={adminBusy} onClick={() => void moderateProfile('suspend_3d')} className="inline-flex items-center gap-1.5 rounded-full bg-urgent/10 px-3 py-2 text-xs font-semibold text-urgent disabled:opacity-50">
                {adminBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Ban className="h-4 w-4" />} حظر 3 أيام
              </button>
              <button disabled={adminBusy} onClick={() => void moderateProfile('ban_permanent')} className="inline-flex items-center gap-1.5 rounded-full bg-error px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">
                <Ban className="h-4 w-4" /> حظر دائم
              </button>
              <button disabled={adminBusy} onClick={() => void moderateProfile('unban')} className="inline-flex items-center gap-1.5 rounded-full bg-surface-raised px-3 py-2 text-xs font-semibold text-ink-soft disabled:opacity-50">
                <RotateCcw className="h-4 w-4" /> فك الحظر
              </button>
            </div>
          )}

          {/* Stats */}
          <div className="mx-auto mt-5 flex max-w-xs items-center justify-center divide-x divide-surface-dim divide-x-reverse">
            <Stat value={posts.length} label="منشور" />
            <Stat value={0} label="صديق" />
            <Stat value={profile.last_urgent_post_at ? 1 : 0} label="عاجل" />
          </div>

          {/* Actions */}
          <div className="mt-5 flex items-center justify-center gap-2">
            {isMe ? (
              <>
                <button onClick={() => setEditing(true)} className="btn-secondary">
                  <Pencil className="h-4 w-4" />
                  تعديل الملف
                </button>
                {!isGuest && <button onClick={() => void signOut()} className="btn-ghost">
                  تسجيل الخروج
                </button>}
              </>
            ) : (
              <>
                {relation === 'friend' ? (
                  <>
                    <span className="chip chip-active px-4 py-2">
                      <BadgeCheck className="h-4 w-4" /> صديق
                    </span>
                    <button
                      onClick={() => navigate(`/messages/${profile.id}`)}
                      className="flex h-10 w-10 items-center justify-center rounded-full bg-accent-soft text-primary transition active:scale-90"
                      aria-label="إرسال رسالة"
                      title="إرسال رسالة"
                    >
                      <MessageCircle className="h-5 w-5" />
                    </button>
                  </>
                ) : relation === 'incoming' ? (
                  <button onClick={handleFriendAction} disabled={busy} className="btn-primary">
                    قبول الصداقة
                  </button>
                ) : relation === 'requested' ? (
                  <button onClick={handleFriendAction} disabled={busy} className="btn-secondary">
                    طلب مرسل
                  </button>
                ) : (
                  <button onClick={handleFriendAction} disabled={busy} className="btn-primary">
                    {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'إضافة صديق'}
                  </button>
                )}
              </>
            )}
          </div>
        </div>

        {/* Tabs */}
        <div className="sticky top-[57px] z-10 flex items-center gap-2 border-b border-surface-dim bg-surface-raised/95 px-3 py-2 backdrop-blur-md">
          <button className="chip chip-active">
            <Grid3x3 className="h-3.5 w-3.5" /> المنشورات
          </button>
          <button className="chip chip-inactive">
            <Info className="h-3.5 w-3.5" /> حول
          </button>
        </div>

        {/* Posts */}
        <div className="space-y-4 p-3">
          {posts.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-12 text-center">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-accent-soft">
                <Users className="h-8 w-8 text-primary" />
              </div>
              <p className="font-bold text-ink">لا توجد منشورات</p>
            </div>
          ) : (
            <div className="flex flex-col">
              {posts.map((p, index) => (
                <div key={p.id}>
                  {index > 0 && <div className="h-[2px] w-full bg-[#94a3b8] dark:bg-slate-600 my-0" />}
                  <PostCard
                    post={p}
                    onDeleted={(id) => setPosts((prev) => prev.filter((post) => post.id !== id))}
                    onSuppressed={(postId, authorId, scope) =>
                      setPosts((prev) =>
                        prev.filter((post) => (scope === 'author' ? post.author_id !== authorId : post.id !== postId))
                      )
                    }
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      </main>

      {shareOpen && profile && (
        <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/40 p-3 sm:items-center" onClick={() => setShareOpen(false)}>
          <section className="max-h-[75dvh] w-full max-w-md overflow-y-auto rounded-3xl bg-surface-raised p-4 shadow-card-raised" onClick={(event) => event.stopPropagation()}>
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-lg font-bold text-ink">إرسال رابط البروفايل</h2>
              <button onClick={() => setShareOpen(false)} className="rounded-full p-2 text-ink-muted hover:bg-surface-subtle" aria-label="إغلاق"><X className="h-5 w-5" /></button>
            </div>
            <p className="mb-3 text-sm text-ink-muted">اختر صديقًا لإرسال رابط {profile.full_name} إليه كي يفتح البروفايل ويضيفه.</p>
            {shareLoading ? <div className="flex justify-center py-5"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div>
              : shareFriends.length === 0 ? <p className="py-4 text-center text-sm text-ink-muted">لا يوجد أصدقاء لإرسال الرابط إليهم.</p>
                : <div className="divide-y divide-surface-dim">
                  {shareFriends.map((friend) => <button key={friend.user_id} disabled={shareBusyId !== null} onClick={() => void sendProfileLink(friend.user_id)} className="flex w-full items-center gap-3 py-3 text-right hover:bg-surface-subtle disabled:opacity-50">
                    <Avatar name={friend.full_name} src={friend.avatar_url} size={40} />
                    <span className="flex-1 font-semibold text-ink">{friend.full_name}</span>
                    {shareBusyId === friend.user_id ? <Loader2 className="h-4 w-4 animate-spin text-primary" /> : <Send className="h-4 w-4 text-primary" />}
                  </button>)}
                </div>}
            {shareError && <p className="mt-3 rounded-xl bg-error-50 px-3 py-2 text-sm text-error">{shareError}</p>}
          </section>
        </div>
      )}

      {editing && me && (
        <EditProfileSheet
          profile={me}
          isAdmin={isAdmin}
          onClose={() => setEditing(false)}
          onSaved={async () => {
            setEditing(false);
            await refreshProfile();
            void load();
          }}
        />
      )}
    </div>
  );
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <div className="flex flex-1 flex-col items-center px-3">
      <span className="text-lg font-extrabold text-ink">{value}</span>
      <span className="text-xs text-ink-muted">{label}</span>
    </div>
  );
}

function searchPeopleByName(list: Person[] | null, id: string): Person | null {
  if (!list) return null;
  return list.find((p) => p.id === id) ?? null;
}

type FriendRequestLike = { request_id: string; user_id: string };
type ShareFriend = { user_id: string; full_name: string; username: string; avatar_url: string | null };

function EditProfileSheet({
  profile,
  isAdmin,
  onClose,
  onSaved,
}: {
  profile: Profile;
  isAdmin: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [fullName, setFullName] = useState(profile.full_name);
  const [username, setUsername] = useState(profile.username);
  const [bio, setBio] = useState(profile.bio ?? '');
  const [avatarUrl, setAvatarUrl] = useState(profile.avatar_url);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function pickAvatar(file: File) {
    setUploadingAvatar(true);
    setError(null);
    try {
      const compressed = await compressAvatar(file);
      const path = `avatars/${profile.id}/${Date.now()}.jpg`;
      const { error: uploadError } = await supabase.storage.from('media').upload(path, compressed, {
        cacheControl: '3600', upsert: true, contentType: 'image/jpeg',
      });
      if (uploadError) throw uploadError;
      const { data } = supabase.storage.from('media').getPublicUrl(path);
      setAvatarUrl(data.publicUrl);
    } catch (uploadError) {
      console.error('avatar upload failed', uploadError);
      setError('تعذّر تجهيز أو رفع صورة الملف الشخصي. جرّب صورة بصيغة JPG أو PNG، وتأكد من سياسات التخزين.');
    } finally {
      setUploadingAvatar(false);
    }
  }

  async function save() {
    setSaving(true);
    setError(null);
    const cleanUsername = username.trim().toLowerCase().replace(/\s+/g, '_');
    if (cleanUsername === 'admin' && !isAdmin) {
      setSaving(false);
      setError('اسم المستخدم admin محجوز لحساب إدارة التطبيق.');
      return;
    }
    const { error: updErr } = await supabase
      .from('profiles')
      .update({ full_name: fullName.trim(), username: cleanUsername, bio: bio.trim(), avatar_url: avatarUrl })
      .eq('id', profile.id);
    setSaving(false);
    if (updErr) {
      setError(updErr.message.includes('الاسم محجوز لإدارة التطبيق')
        ? 'هذا الاسم محجوز لإدارة التطبيق. اختر اسمًا آخر.'
        : updErr.message.includes('username') ? 'اسم المستخدم محجوز.' : 'تعذّر الحفظ.');
      return;
    }
    onSaved();
  }

  return (
    <>
      <div className="sheet-backdrop" onClick={onClose} />
      <div className="sheet">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold text-ink">تعديل الملف الشخصي</h2>
          <button onClick={onClose} className="flex h-9 w-9 items-center justify-center rounded-full hover:bg-surface-subtle">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex justify-center">
          <label className="relative cursor-pointer" title="تغيير صورة الملف الشخصي">
            <Avatar name={fullName} src={avatarUrl} size={84} />
            <span className="absolute bottom-0 left-0 flex h-7 w-7 items-center justify-center rounded-full bg-primary text-white shadow-fab">
              {uploadingAvatar ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Camera className="h-3.5 w-3.5" />}
            </span>
            <input type="file" accept="image/*" className="hidden" disabled={uploadingAvatar} onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void pickAvatar(file);
              event.currentTarget.value = '';
            }} />
          </label>
        </div>
        <p className="mt-1 text-center text-xs text-ink-muted">يمكنك تغيير صورة البروفايل</p>

        <div className="mt-4 space-y-3">
          <div>
            <label className="mb-1 block text-xs font-semibold text-ink-soft">الاسم الكامل</label>
            <input className="input-field" value={fullName} onChange={(e) => setFullName(e.target.value)} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-ink-soft">اسم المستخدم</label>
            <input className="input-field" value={username} onChange={(e) => setUsername(e.target.value)} dir="ltr" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-ink-soft">النبذة</label>
            <textarea className="input-field min-h-[80px] resize-none" value={bio} onChange={(e) => setBio(e.target.value)} maxLength={200} />
          </div>
          {error && <p className="rounded-xl bg-error-50 px-4 py-2 text-sm text-error">{error}</p>}
          <button onClick={save} disabled={saving || uploadingAvatar} className="btn-primary w-full py-3">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'حفظ التغييرات'}
          </button>
        </div>
      </div>
    </>
  );
}

async function compressAvatar(file: File): Promise<File> {
  const bitmap = await createImageBitmap(file);
  try {
    let scale = Math.min(1, 512 / Math.max(bitmap.width, bitmap.height));
    let width = Math.max(1, Math.round(bitmap.width * scale));
    let height = Math.max(1, Math.round(bitmap.height * scale));
    for (let attempt = 0; attempt < 7; attempt++) {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Canvas unavailable');
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, width, height);
      context.drawImage(bitmap, 0, 0, width, height);
      const quality = Math.max(0.42, 0.82 - attempt * 0.1);
      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((result) => result ? resolve(result) : reject(new Error('Image compression failed')), 'image/jpeg', quality);
      });
      if (blob.size <= 180 * 1024 || attempt === 6) {
        return new File([blob], 'avatar.jpg', { type: 'image/jpeg', lastModified: Date.now() });
      }
      width = Math.max(1, Math.round(width * 0.8));
      height = Math.max(1, Math.round(height * 0.8));
    }
    throw new Error('Image compression failed');
  } finally {
    bitmap.close();
  }
}
