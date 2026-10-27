import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Ban, Loader2, Search, Shield, Trash2, Users, FileText, RotateCcw, Check, Image as ImageIcon, Play, Pause, Sparkles } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { Avatar } from '@/components/Avatar';
import { getOptimizedPostImageUrl, deletePostImageFromCloudinary, isCloudinaryUrl } from '@/lib/cloudinary';

type AdminUser = {
  user_id: string;
  full_name: string;
  username: string;
  avatar_url: string | null;
  created_at: string;
  post_report_count: number;
  profile_report_count: number;
  post_offenses: number;
  posting_suspended_until: string | null;
  access_suspended_until: string | null;
  permanently_banned: boolean;
};
type AdminPost = { id: string; author_id: string; body: string; image_url: string | null; created_at: string };
type DemoUser = { user_id: string; full_name: string; username: string; avatar_url: string | null; created_at: string; post_count: number; last_post_at: string | null };
type PendingPost = {
  id: string;
  author_id: string;
  body: string;
  image_url: string | null;
  is_urgent: boolean;
  created_at: string;
  status: string;
  author_name: string;
  author_username: string;
  author_avatar: string | null;
};
type Tab = 'users' | 'posts' | 'pending_images' | 'demo';

export function AdminScreen() {
  const navigate = useNavigate();
  const { session } = useAuth();
  const isAdmin = session?.user.app_metadata?.role === 'admin';
  const [tab, setTab] = useState<Tab>('users');
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [posts, setPosts] = useState<AdminPost[]>([]);
  const [pendingPosts, setPendingPosts] = useState<PendingPost[]>([]);
  const [demoUsers, setDemoUsers] = useState<DemoUser[]>([]);
  const [postOffset, setPostOffset] = useState(0);
  const [hasMorePosts, setHasMorePosts] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [demoFeedback, setDemoFeedback] = useState<string | null>(null);
  const [autoPostingEnabled, setAutoPostingEnabled] = useState(true);
  const [togglingAutoPost, setTogglingAutoPost] = useState(false);
  const [cleaningMedia, setCleaningMedia] = useState(false);
  const [mediaCleanupFeedback, setMediaCleanupFeedback] = useState<string | null>(null);

  async function cleanExpiredCloudinaryMedia() {
    if (!session?.access_token) return;
    setCleaningMedia(true);
    setMediaCleanupFeedback(null);
    setError(null);
    try {
      const res = await fetch('/api/cloudinary-cleanup-expired', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'تعذّر تنظيف وسائط كلاوديناري');
      setMediaCleanupFeedback(data.message || 'تم تنظيف وسائط كلاوديناري بنجاح.');
    } catch (err: any) {
      setError(err.message || 'فشل تنظيف وسائط كلاوديناري.');
    } finally {
      setCleaningMedia(false);
    }
  }

  const load = useCallback(async () => {
    if (!isAdmin) { setLoading(false); return; }
    setLoading(true);
    setError(null);

    void supabase.rpc('admin_get_demo_settings').then(({ data, error }) => {
      if (!error && data && (data as any[]).length > 0) {
        setAutoPostingEnabled((data as any)[0].auto_posting_enabled !== false);
      }
    });

    const [
      { data: userRows, error: userError },
      { data: postRows, error: postError },
      { data: pendingRows, error: pendingError },
      { data: demoRows, error: demoError }
    ] = await Promise.all([
      supabase.rpc('admin_user_overview'),
      supabase.from('posts').select('id, author_id, body, image_url, created_at').order('created_at', { ascending: false }).range(0, 199),
      supabase.rpc('admin_pending_posts'),
      supabase.rpc('admin_demo_users'),
    ]);
    if (userError || postError || demoError) {
      setError(userError?.message || postError?.message || demoError?.message || 'تعذّر تحميل بيانات الإدارة.');
    } else {
      setUsers((userRows ?? []) as AdminUser[]);
      setPosts((postRows ?? []) as AdminPost[]);
      setPendingPosts((pendingRows ?? []) as PendingPost[]);
      setDemoUsers((demoRows ?? []) as DemoUser[]);
      setPostOffset(postRows?.length ?? 0);
      setHasMorePosts((postRows?.length ?? 0) === 200);
    }
    setLoading(false);
  }, [isAdmin]);

  async function loadMorePosts() {
    setBusyId('more-posts');
    const { data, error: moreError } = await supabase.from('posts')
      .select('id, author_id, body, image_url, created_at')
      .order('created_at', { ascending: false }).range(postOffset, postOffset + 199);
    setBusyId(null);
    if (moreError) { setError('تعذّر تحميل المزيد من المنشورات: ' + moreError.message); return; }
    const rows = (data ?? []) as AdminPost[];
    setPosts((prev) => [...prev, ...rows]);
    setPostOffset((prev) => prev + rows.length);
    setHasMorePosts(rows.length === 200);
  }

  useEffect(() => { void load(); }, [load]);

  const filteredUsers = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return users;
    return users.filter((user) => user.full_name.toLowerCase().includes(needle) || user.username.toLowerCase().includes(needle));
  }, [users, query]);
  const filteredPosts = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return posts;
    return posts.filter((post) => post.body.toLowerCase().includes(needle) || users.find((user) => user.user_id === post.author_id)?.full_name.toLowerCase().includes(needle));
  }, [posts, users, query]);
  const userMap = useMemo(() => new Map(users.map((user) => [user.user_id, user])), [users]);

  async function updateBan(userId: string, action: 'suspend_1d' | 'suspend_3d' | 'ban_permanent' | 'unban') {
    const prompt = action === 'suspend_1d'
      ? 'إيقاف الحساب عن دخول التطبيق لمدة 24 ساعة وحذف جميع منشوراته وصوره؟'
      : action === 'suspend_3d'
        ? 'إيقاف الحساب عن دخول التطبيق لمدة 3 أيام وحذف جميع منشوراته وصوره؟'
        : action === 'ban_permanent'
          ? 'حظر هذا الحساب نهائياً وحذف جميع منشوراته وصوره؟'
          : 'فك الحظر عن هذا الحساب؟';
    if (!window.confirm(prompt)) return;
    setBusyId(userId);
    setError(null);
    const { error: actionError } = await supabase.functions.invoke('apply-report-ban', {
      body: { admin_action: action, user_id: userId },
    });
    setBusyId(null);
    if (actionError) {
      setError('تعذّر تنفيذ الإجراء الإداري: ' + actionError.message + '. تأكد من نشر Edge Function وتطبيق migration لوحة الإدارة.');
      return;
    }
    if (action !== 'unban') {
      setPosts((prev) => prev.filter((p) => p.author_id !== userId));
      setPendingPosts((prev) => prev.filter((p) => p.author_id !== userId));
    }
    await load();
  }

  async function deletePost(post: AdminPost) {
    if (!window.confirm('حذف هذا المنشور نهائياً؟')) return;
    setBusyId(post.id);
    setError(null);
    const { error: deleteError } = await supabase.rpc('admin_delete_post', { p_post_id: post.id });
    setBusyId(null);
    if (deleteError) {
      setError('تعذّر حذف المنشور: ' + deleteError.message);
    } else {
      if (post.image_url) {
        if (isCloudinaryUrl(post.image_url)) {
          if (session?.access_token) {
            try {
              await deletePostImageFromCloudinary(post.image_url, session.access_token, post.id);
            } catch (e) {
              console.warn('delete image from cloudinary error:', e);
            }
          }
        } else if (post.image_url.includes('/media/')) {
          try {
            const match = post.image_url.match(/\/media\/(.+)$/);
            if (match) {
              const storagePath = decodeURIComponent(match[1]);
              void supabase.storage.from('media').remove([storagePath]);
            }
          } catch (imgErr) {
            console.warn('delete image from storage failed:', imgErr);
          }
        }
      }
      setPosts((prev) => prev.filter((item) => item.id !== post.id));
    }
  }

  async function approvePost(postId: string) {
    setBusyId(postId);
    setError(null);
    const { error: appErr } = await supabase.rpc('admin_approve_post', { p_post_id: postId });
    setBusyId(null);
    if (appErr) {
      setError('تعذرت الموافقة على المنشور: ' + appErr.message);
    } else {
      setPendingPosts((prev) => prev.filter((p) => p.id !== postId));
      void load();
    }
  }

  async function rejectPost(postId: string) {
    if (!window.confirm('رفض هذا المنشور وحذفه نهائياً؟')) return;
    setBusyId(postId);
    setError(null);

    const pending = pendingPosts.find((p) => p.id === postId);

    const { error: rejErr } = await supabase.rpc('admin_reject_post', { p_post_id: postId });
    setBusyId(null);
    if (rejErr) {
      setError('تعذر رفض المنشور: ' + rejErr.message);
    } else {
      if (pending?.image_url) {
        if (isCloudinaryUrl(pending.image_url)) {
          if (session?.access_token) {
            try {
              await deletePostImageFromCloudinary(pending.image_url, session.access_token, postId);
            } catch (e) {
              console.warn('delete image from cloudinary error:', e);
            }
          }
        } else if (pending.image_url.includes('/media/')) {
          try {
            const match = pending.image_url.match(/\/media\/(.+)$/);
            if (match) {
              const storagePath = decodeURIComponent(match[1]);
              void supabase.storage.from('media').remove([storagePath]);
            }
          } catch (imgErr) {
            console.warn('delete image from storage failed:', imgErr);
          }
        }
      }
      setPendingPosts((prev) => prev.filter((p) => p.id !== postId));
      void load();
    }
  }

  async function manageDemoAccounts(action: 'create_100' | 'delete_all' | 'publish_today') {
    if (action === 'delete_all' && !window.confirm('حذف جميع شخصيات اللعبة ومنشوراتها نهائيًا؟')) return;
    setBusyId('demo-' + action);
    setError(null);
    setDemoFeedback(null);
    const { data, error: actionError } = await supabase.functions.invoke('manage-demo-accounts', { body: { action } });
    setBusyId(null);
    if (actionError) {
      let serverDetail = '';
      const context = (actionError as { context?: unknown }).context;
      if (context instanceof Response) {
        const body = await context.clone().json().catch(() => null) as { error?: string; message?: string } | null;
        serverDetail = body?.error ?? body?.message ?? '';
      }
      setError([
        'تعذّر تنفيذ الإجراء: ' + actionError.message,
        serverDetail,
        'راجع سجل Supabase Edge Function باسم manage-demo-accounts، وتأكد من نشرها وتطبيق migration الحسابات التجريبية.',
      ].filter(Boolean).join(' '));
      return;
    }
    let actionResultError: string | null = null;
    if (!data?.ok) {
      if (action === 'create_100') {
        const failures = Array.isArray(data?.failures) ? data.failures.slice(0, 5).join('؛ ') : '';
        actionResultError = [
          `نتيجة إنشاء الحسابات: أُنشئ ${data?.created ?? 0}، وجُهّز ${data?.ready ?? 0} من 100.`,
          failures ? `تفاصيل الحسابات: ${failures}.` : '',
          data?.publishError ? `خطأ جدولة المنشورات: ${data.publishError}.` : '',
        ].filter(Boolean).join(' ');
      } else if (action === 'delete_all') {
        actionResultError = `تم حذف ${data?.deleted ?? 0} حساب، وتعذّر حذف ${data?.failed ?? 0}.`;
      } else {
        actionResultError = `تعذّرت جدولة منشورات اليوم: ${data?.error ?? 'راجع سجل Edge Function وتأكد من تطبيق migration جدولة المنشورات.'}`;
      }
    } else if (action === 'publish_today') {
      void supabase.rpc('publish_due_demo_post');
      setDemoFeedback(data.scheduled > 0
        ? `تمت جدولة ${data.scheduled} منشورًا تبدأ من الآن (نُشر المنشور الأول فوراً!) وتتوالى باقي المنشورات تلقائياً كل نصف ساعة.`
        : 'لا توجد منشورات جديدة للجدولة؛ ربما جُدولت بالفعل أو الحسابات غير مؤهلة للنشر حاليًا.');
    } else if (action === 'create_100') {
      setDemoFeedback(`اكتملت العملية: أُنشئ ${data.created ?? 0} حسابًا جديدًا، وأصبح ${data.ready ?? 100} حسابًا جاهزًا. منشورات اليوم المجدولة: ${data.postsScheduledToday ?? 0}.`);
    } else {
      setDemoFeedback(`تم حذف ${data.deleted ?? 0} حسابًا تجريبيًا ومنشوراته.`);
    }
    await load();
    if (actionResultError) setError(actionResultError);
  }

  async function forcePublishDemoPost() {
    setBusyId('demo-force_publish');
    setError(null);
    setDemoFeedback(null);
    const { data, error: forceErr } = await supabase.rpc('admin_force_publish_demo_post');
    setBusyId(null);
    if (forceErr) {
      setError('تعذّر نشر المنشور الفوري: ' + forceErr.message);
    } else if ((data ?? 0) > 0) {
      setDemoFeedback('تم نشر منشور تجريبي جديد الآن فوراً.');
      await load();
    } else {
      setDemoFeedback('لم يتم نشر أي منشور؛ تأكد من إنشاء الـ 100 حساب وتفعيل الجدولة.');
    }
  }

  async function deleteDemoPostsOnly() {
    if (!window.confirm('هل أنت متأكد من حذف جميع منشورات الحسابات الوهمية الـ 100 مع الإبقاء على الحسابات؟')) return;
    setBusyId('demo-delete_posts_only');
    setError(null);
    setDemoFeedback(null);
    const { data, error: delErr } = await supabase.rpc('admin_delete_demo_posts');
    setBusyId(null);
    if (delErr) {
      setError('تعذّر حذف منشورات الحسابات الوهمية: ' + delErr.message);
    } else {
      setDemoFeedback(`تم بنجاح حذف ${data ?? 0} منشوراً من منشورات الحسابات الوهمية. الجدولة نظيفة وجاهزة للبدء فوراً الآن دون انتظار.`);
      await load();
    }
  }

  async function toggleAutoPosting(enabled: boolean) {
    setTogglingAutoPost(true);
    setDemoFeedback(null);
    try {
      const { error: toggleErr } = await supabase.rpc('admin_toggle_demo_auto_posting', {
        p_enabled: enabled,
      });
      if (toggleErr) throw toggleErr;
      setAutoPostingEnabled(enabled);
      setDemoFeedback(enabled
        ? 'تم تفعيل النشر التلقائي لشخصيات اللعبة بنجاح.'
        : 'تم إيقاف النشر التلقائي مؤقتاً ومسح قائمة الانتظار.');
    } catch (err: any) {
      setError('تعذّر تعديل حالة النشر التلقائي: ' + (err.message || String(err)));
    } finally {
      setTogglingAutoPost(false);
    }
  }

  if (!isAdmin) {
    return <div className="app-shell flex flex-col items-center justify-center gap-3 px-6 text-center">
      <Shield className="h-10 w-10 text-error" />
      <p className="font-bold text-ink">هذه الصفحة للأدمن فقط</p>
      <p className="text-sm text-ink-muted">تأكد من تسجيل الدخول بالحساب الإداري ثم حدّث الجلسة.</p>
      <button onClick={() => navigate('/settings')} className="btn-secondary">الإعدادات</button>
    </div>;
  }

  return <div className="app-shell">
    <header className="sticky top-0 z-20 flex items-center gap-2 border-b border-surface-dim bg-surface-raised/95 px-3 py-3 backdrop-blur-md">
      <button onClick={() => navigate('/settings')} className="flex h-10 w-10 items-center justify-center rounded-full text-ink-soft hover:bg-surface-subtle" aria-label="رجوع">
        <ArrowLeft className="h-5 w-5 rotate-180" />
      </button>
      <Shield className="h-5 w-5 text-primary" />
      <h1 className="text-lg font-bold text-ink">لوحة تحكم الأدمن</h1>
      <button onClick={() => void load()} className="mr-auto rounded-full px-3 py-2 text-xs font-semibold text-primary hover:bg-primary-50">تحديث</button>
    </header>
    <main className="app-body space-y-3 p-3">
      <div className="grid grid-cols-3 gap-2">
        <div className="card flex items-center gap-2 p-3"><Users className="h-5 w-5 text-primary shrink-0" /><div className="min-w-0"><p className="text-base font-bold text-ink truncate">{users.length}</p><p className="text-[11px] text-ink-muted">حساب</p></div></div>
        <div className="card flex items-center gap-2 p-3"><FileText className="h-5 w-5 text-primary shrink-0" /><div className="min-w-0"><p className="text-base font-bold text-ink truncate">{posts.length}</p><p className="text-[11px] text-ink-muted">أحدث المنشورات</p></div></div>
        <div className="card flex items-center gap-2 p-3"><ImageIcon className="h-5 w-5 text-urgent shrink-0" /><div className="min-w-0"><p className="text-base font-bold text-ink truncate">{pendingPosts.length}</p><p className="text-[11px] text-ink-muted">مراجعة الصور</p></div></div>
      </div>
      <div className="flex rounded-full bg-surface-subtle p-1 gap-1 overflow-x-auto no-scrollbar">
        <button onClick={() => setTab('users')} className={'chip flex-1 justify-center ' + (tab === 'users' ? 'chip-active' : 'chip-inactive')}>الحسابات</button>
        <button onClick={() => setTab('posts')} className={'chip flex-1 justify-center ' + (tab === 'posts' ? 'chip-active' : 'chip-inactive')}>المنشورات</button>
        <button onClick={() => setTab('pending_images')} className={'chip flex-1 justify-center gap-1 ' + (tab === 'pending_images' ? 'chip-active' : 'chip-inactive')}>
          مراجعة الصور
          {pendingPosts.length > 0 && (
            <span className="rounded-full bg-urgent px-1.5 py-0.5 text-[10px] font-bold text-white">
              {pendingPosts.length}
            </span>
          )}
        </button>
        <button onClick={() => setTab('demo')} className={'chip flex-1 justify-center ' + (tab === 'demo' ? 'chip-active' : 'chip-inactive')}>شخصيات اللعبة</button>
      </div>
      {tab !== 'demo' && tab !== 'pending_images' && <label className="relative block">
        <Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" />
        <input value={query} onChange={(event) => setQuery(event.target.value)} className="input-field pr-9" placeholder={tab === 'users' ? 'ابحث بالاسم أو اسم المستخدم' : 'ابحث في نص المنشور أو اسم صاحبه'} />
      </label>}
      {error && <p className="card text-sm text-error">{error}</p>}
      {loading ? <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div> : tab === 'users' ? (
        <div className="space-y-2">
          {filteredUsers.map((user) => {
            const activeAccessBan = !!user.access_suspended_until && new Date(user.access_suspended_until) > new Date();
            const activePostBan = !!user.posting_suspended_until && new Date(user.posting_suspended_until) > new Date();
            const banned = user.permanently_banned || activeAccessBan;
            return <article key={user.user_id} className="card space-y-3">
              <div className="flex items-center gap-3">
                <button onClick={() => navigate('/profile/' + user.user_id)}><Avatar name={user.full_name} src={user.avatar_url} size={46} /></button>
                <div className="min-w-0 flex-1">
                  <button onClick={() => navigate('/profile/' + user.user_id)} className="block truncate text-right text-sm font-bold text-ink">{user.full_name}</button>
                  <p className="truncate text-xs text-ink-muted">@{user.username}</p>
                </div>
                <span className={'rounded-full px-2 py-1 text-[11px] font-semibold ' + (user.permanently_banned ? 'bg-error-50 text-error' : banned || activePostBan ? 'bg-urgent/10 text-urgent' : 'bg-primary-50 text-primary')}>
                  {user.permanently_banned ? 'محظور دائمًا' : activeAccessBan ? 'إيقاف دخول' : activePostBan ? 'إيقاف نشر' : 'نشط'}
                </span>
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-muted">
                <span>بلاغات منشورات: {user.post_report_count}</span>
                <span>بلاغات بروفايل: {user.profile_report_count}</span>
                <span>مخالفات منشورات: {user.post_offenses}</span>
              </div>
              {banned ? <button disabled={busyId === user.user_id} onClick={() => void updateBan(user.user_id, 'unban')} className="inline-flex items-center justify-center gap-1.5 rounded-full bg-primary-50 px-3 py-2 text-xs font-semibold text-primary disabled:opacity-50">
                {busyId === user.user_id ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />} فك الحظر
              </button> : <div className="flex flex-wrap gap-2">
                <button disabled={busyId === user.user_id} onClick={() => void updateBan(user.user_id, 'suspend_1d')} className="rounded-full bg-urgent/10 px-3 py-2 text-xs font-semibold text-urgent disabled:opacity-50">إيقاف 24 ساعة</button>
                <button disabled={busyId === user.user_id} onClick={() => void updateBan(user.user_id, 'suspend_3d')} className="rounded-full bg-urgent/10 px-3 py-2 text-xs font-semibold text-urgent disabled:opacity-50">إيقاف 3 أيام</button>
                <button disabled={busyId === user.user_id} onClick={() => void updateBan(user.user_id, 'ban_permanent')} className="inline-flex items-center gap-1 rounded-full bg-error-50 px-3 py-2 text-xs font-semibold text-error disabled:opacity-50"><Ban className="h-3.5 w-3.5" />حظر دائم</button>
              </div>}
            </article>;
          })}
          {!filteredUsers.length && <p className="card text-center text-sm text-ink-muted">لا توجد حسابات مطابقة.</p>}
        </div>
      ) : tab === 'pending_images' ? (
        <section className="space-y-3">
          <div className="card">
            <h2 className="font-bold text-ink">المنشورات بانتظار الموافقة</h2>
            <p className="mt-1 text-xs text-ink-muted">
              أي منشور يرفع فيه المستخدم صورة يتطلب موافقة الأدمن قبل ظهوره في الخلاصة العامة.
            </p>
          </div>

          <div className="space-y-3">
            {pendingPosts.map((post) => (
              <article key={post.id} className="card space-y-3">
                <div className="flex items-center gap-3">
                  <Avatar name={post.author_name} src={post.author_avatar} size={42} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-bold text-ink">{post.author_name}</p>
                    <p className="text-xs text-ink-muted">@{post.author_username} · {new Date(post.created_at).toLocaleString('ar-EG')}</p>
                  </div>
                </div>

                {post.body && <p className="whitespace-pre-wrap break-words text-sm text-ink-soft font-noto">{post.body}</p>}

                {post.image_url && (
                  <div className="overflow-hidden rounded-xl border border-surface-dim bg-surface-subtle">
                    <img
                      src={getOptimizedPostImageUrl(post.image_url, { width: 800 })}
                      alt="مرفق المنشور"
                      className="max-h-96 w-full object-contain mx-auto bg-surface-subtle"
                      loading="lazy"
                    />
                  </div>
                )}

                <div className="flex items-center gap-2 pt-2 border-t border-surface-dim">
                  <button
                    disabled={busyId === post.id}
                    onClick={() => void approvePost(post.id)}
                    className="btn-primary flex-1 py-2 text-xs font-bold"
                  >
                    {busyId === post.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                    موافقة ونشر
                  </button>
                  <button
                    disabled={busyId === post.id}
                    onClick={() => void rejectPost(post.id)}
                    className="inline-flex items-center justify-center gap-1.5 rounded-full bg-error-50 px-4 py-2 text-xs font-semibold text-error hover:bg-error-100 disabled:opacity-50"
                  >
                    <Trash2 className="h-4 w-4" />
                    رفض وحذف
                  </button>
                </div>
              </article>
            ))}

            {!pendingPosts.length && (
              <div className="card py-10 text-center">
                <Check className="mx-auto h-8 w-8 text-success" />
                <p className="mt-2 font-bold text-ink">لا توجد منشورات قيد المراجعة</p>
                <p className="mt-1 text-xs text-ink-muted">تمت مراجعة جميع منشورات الصور بنجاح.</p>
              </div>
            )}
          </div>
        </section>
      ) : tab === 'demo' ? (
        <section className="space-y-3">
          {/* Cloudinary Expired Media Auto-Cleaner */}
          <div className="card space-y-3 border-primary/20 bg-primary-50/20">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-bold text-ink flex items-center gap-2">
                  <RotateCcw className="h-4 w-4 text-primary" />
                  صيانة وسائط كلاوديناري المنتهية (24 ساعة)
                </h3>
                <p className="text-xs text-ink-muted mt-1 leading-relaxed">
                  يقوم Vercel Cron بحذف الصور الأقدم من 24 ساعة تلقائياً يومياً. يمكنك أيضاً الضغط هنا لتفريغ وحذف جميع صور المنشورات المنتهية فوراً وتوفير رصيدك.
                </p>
              </div>
              <button
                disabled={cleaningMedia || busyId !== null}
                onClick={() => void cleanExpiredCloudinaryMedia()}
                className="btn-primary py-2 px-4 text-xs font-bold shrink-0 self-start sm:self-auto"
              >
                {cleaningMedia ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
                تنظيف الصور المنتهية الآن
              </button>
            </div>
            {mediaCleanupFeedback && (
              <p className="rounded-xl bg-emerald-500/10 px-3 py-2 text-xs font-semibold text-emerald-700 dark:text-emerald-400">
                {mediaCleanupFeedback}
              </p>
            )}
          </div>

          <div className="card space-y-3">
            <p className="text-sm leading-relaxed text-ink-soft">شخصيات خيالية للعبة بأسماء مصرية متنوعة، وموسومة «شخصية لعبة» في المنشورات والملفات الشخصية. ينشر كل حساب منشورًا يوميًا تلقائيًا.</p>

            {/* Auto-posting status toggle */}
            <div className="flex items-center justify-between rounded-2xl border border-surface-dim bg-surface-subtle p-3.5">
              <div className="flex items-center gap-3">
                <span className={`flex h-3.5 w-3.5 rounded-full shrink-0 ${autoPostingEnabled ? 'bg-success animate-pulse' : 'bg-ink-faint'}`} />
                <div>
                  <p className="text-sm font-bold text-ink">
                    {autoPostingEnabled ? 'النشر التلقائي: مفعّل' : 'النشر التلقائي: متوقف مؤقتاً'}
                  </p>
                  <p className="text-xs text-ink-muted mt-0.5">
                    {autoPostingEnabled ? 'الحسابات تنشر يومياً وفق الجدول الصباحي' : 'لن يتم نشر أي منشور جديد تلقائياً حتى تعيد تفعيله'}
                  </p>
                </div>
              </div>
              <button
                disabled={togglingAutoPost}
                onClick={() => void toggleAutoPosting(!autoPostingEnabled)}
                className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-2 text-xs font-bold transition disabled:opacity-50 shrink-0 ${
                  autoPostingEnabled
                    ? 'bg-amber-500/10 text-amber-700 dark:text-amber-400 hover:bg-amber-500/20'
                    : 'bg-primary text-white hover:bg-primary-hover shadow-sm'
                }`}
              >
                {togglingAutoPost ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : autoPostingEnabled ? (
                  <>
                    <Pause className="h-4 w-4" /> إيقاف النشر التلقائي
                  </>
                ) : (
                  <>
                    <Play className="h-4 w-4" /> تشغيل النشر التلقائي
                  </>
                )}
              </button>
            </div>

            <div className="flex flex-wrap gap-2">
              <button disabled={busyId !== null} onClick={() => void manageDemoAccounts('create_100')} className="btn-primary disabled:opacity-50">
                {busyId === 'demo-create_100' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Users className="h-4 w-4" />} إنشاء/استكمال 100 حساب
              </button>
              <button disabled={busyId !== null || demoUsers.length === 0} onClick={() => void deleteDemoPostsOnly()} className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/10 px-3.5 py-2 text-xs font-semibold text-amber-700 dark:text-amber-400 hover:bg-amber-500/20 disabled:opacity-50 transition">
                {busyId === 'demo-delete_posts_only' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />} حذف منشورات الـ 100 حساب (فقط)
              </button>
              <button disabled={busyId !== null || demoUsers.length === 0} onClick={() => void manageDemoAccounts('delete_all')} className="inline-flex items-center gap-1.5 rounded-full bg-error-50 px-3 py-2 text-xs font-semibold text-error disabled:opacity-50">
                {busyId === 'demo-delete_all' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />} حذف الـ 100 حساب بالكامل
              </button>
            </div>
            {autoPostingEnabled && (
              <div className="flex flex-wrap gap-2">
                <button disabled={busyId !== null || demoUsers.length === 0} onClick={() => void manageDemoAccounts('publish_today')} className="inline-flex items-center gap-1.5 rounded-full bg-primary-50 px-3.5 py-2 text-xs font-semibold text-primary disabled:opacity-50">
                  {busyId === 'demo-publish_today' ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />} بدء الجدولة الآن (يبدأ فوراً)
                </button>
                <button disabled={busyId !== null || demoUsers.length === 0} onClick={() => void forcePublishDemoPost()} className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-3.5 py-2 text-xs font-semibold text-emerald-700 dark:text-emerald-400 hover:bg-emerald-500/20 disabled:opacity-50 transition">
                  {busyId === 'demo-force_publish' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />} نشر منشور تجريبي فوراً (الآن)
                </button>
              </div>
            )}
            {demoFeedback && <p className="rounded-xl bg-primary-50 px-3 py-2 text-sm text-primary">{demoFeedback}</p>}
            <p className="text-xs text-ink-muted">عدد الحسابات: {demoUsers.length} · تُوزع المنشورات على اليوم، وينشر Supabase Cron منشورًا واحدًا مستحقًا كل دقيقة.</p>
          </div>
          <div className="space-y-2">
            {demoUsers.map((demo) => <article key={demo.user_id} className="card flex items-center gap-3">
              <button onClick={() => navigate('/profile/' + demo.user_id)}><Avatar name={demo.full_name} src={demo.avatar_url} size={42} /></button>
              <div className="min-w-0 flex-1">
                <button onClick={() => navigate('/profile/' + demo.user_id)} className="block truncate text-right text-sm font-bold text-ink">{demo.full_name}</button>
                <p className="text-xs text-ink-muted">@{demo.username} · {demo.post_count} منشور</p>
              </div>
              <span className="text-[11px] text-ink-faint">{demo.last_post_at ? new Date(demo.last_post_at).toLocaleDateString('ar-EG') : 'لا توجد منشورات'}</span>
            </article>)}
            {!demoUsers.length && <p className="card text-center text-sm text-ink-muted">لا توجد شخصيات لعبة. اضغط إنشاء لبدء التجربة.</p>}
          </div>
        </section>
      ) : (
        <div className="space-y-2">
          {filteredPosts.map((post) => {
            const author = userMap.get(post.author_id);
            return <article key={post.id} className="card space-y-3">
              <div className="flex items-center gap-2">
                <button onClick={() => navigate('/profile/' + post.author_id)} className="text-sm font-bold text-ink">{author?.full_name ?? 'مستخدم'}</button>
                <span className="text-xs text-ink-faint">{new Date(post.created_at).toLocaleString('ar-EG')}</span>
                <button disabled={busyId === post.id} onClick={() => void deletePost(post)} className="mr-auto inline-flex items-center gap-1 rounded-full bg-error-50 px-3 py-2 text-xs font-semibold text-error disabled:opacity-50">
                  {busyId === post.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />} حذف
                </button>
              </div>
              {post.body && <p className="whitespace-pre-wrap break-words text-sm text-ink-soft font-noto">{post.body}</p>}
              {post.image_url && (
                <img
                  src={getOptimizedPostImageUrl(post.image_url, { width: 640 })}
                  alt=""
                  className="max-h-80 w-full rounded-xl object-contain bg-surface-subtle"
                  loading="lazy"
                />
              )}
            </article>;
          })}
          {!filteredPosts.length && <p className="card text-center text-sm text-ink-muted">لا توجد منشورات مطابقة.</p>}
          {hasMorePosts && !query.trim() && <button disabled={busyId === 'more-posts'} onClick={() => void loadMorePosts()} className="btn-secondary w-full disabled:opacity-50">{busyId === 'more-posts' ? <Loader2 className="h-4 w-4 animate-spin" /> : null}تحميل منشورات أقدم</button>}
        </div>
      )}
    </main>
  </div>;
}
