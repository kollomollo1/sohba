import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Shield, Bell, Flame, LogOut, Info, Globe, UserPlus, LogIn, Ban, RotateCcw, Loader2, Flag, Trash2, ShieldAlert, ChevronLeft } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { Avatar } from '@/components/Avatar';

type BlockedUser = { user_id: string; full_name: string; username: string; avatar_url: string | null; blocked_at?: string; ban_label?: string };
type ReportRow = { id: string; reporter_id: string; reported_user_id: string; post_id: string | null; reason: string; status: string; created_at: string; reporter_name?: string; reported_name?: string; post_body?: string };
type AdminAlert = { id: string; message: string; reported_user_id: string | null; created_at: string; read_at: string | null };
type ProfileReport = { id: string; reporter_id: string; reported_user_id: string; reason: string; status: string; created_at: string; reporter_name?: string; reported_name?: string };

export function SettingsScreen() {
  const navigate = useNavigate();
  const { profile, signOut, isGuest, session } = useAuth();
  const [blockedUsers, setBlockedUsers] = useState<BlockedUser[]>([]);
  const [loadingBlocked, setLoadingBlocked] = useState(true);
  const [reports, setReports] = useState<ReportRow[]>([]);
  const [profileReports, setProfileReports] = useState<ProfileReport[]>([]);
  const [reportsError, setReportsError] = useState<string | null>(null);
  const [adminBusyId, setAdminBusyId] = useState<string | null>(null);
  const [adminAlerts, setAdminAlerts] = useState<AdminAlert[]>([]);
  const [notifyComments, setNotifyComments] = useState(true);
  const [notifyLikes, setNotifyLikes] = useState(true);
  const [savingNotification, setSavingNotification] = useState<'comments' | 'likes' | null>(null);
  const [notificationError, setNotificationError] = useState<string | null>(null);
  const isAdmin = session?.user.app_metadata?.role === 'admin';

  useEffect(() => {
    if (!profile?.id) return;
    let active = true;
    void supabase.from('profiles').select('notify_comments, notify_likes').eq('id', profile.id).maybeSingle()
      .then(({ data, error }) => {
        if (!active) return;
        if (error) {
          setNotificationError('تعذّر تحميل تفضيلات الإشعارات.');
          return;
        }
        if (data) {
          setNotifyComments(data.notify_comments ?? true);
          setNotifyLikes(data.notify_likes ?? true);
        }
      });
    return () => { active = false; };
  }, [profile?.id]);

  async function updateNotificationPreference(kind: 'comments' | 'likes', enabled: boolean) {
    if (!profile?.id || savingNotification) return;
    setSavingNotification(kind);
    setNotificationError(null);
    const column = kind === 'comments' ? 'notify_comments' : 'notify_likes';
    const { error } = await supabase.from('profiles').update({ [column]: enabled }).eq('id', profile.id);
    setSavingNotification(null);
    if (error) {
      setNotificationError('تعذّر حفظ تفضيل الإشعارات. تأكد من تشغيل migration تفضيلات الإشعارات.');
      return;
    }
    if (kind === 'comments') setNotifyComments(enabled);
    else setNotifyLikes(enabled);
  }

  useEffect(() => {
    if (!profile?.id) return;
    let active = true;
    void (async () => {
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
                } else {
                  existingMap.set(u.user_id, {
                    user_id: u.user_id,
                    full_name: u.full_name,
                    username: u.username,
                    avatar_url: u.avatar_url,
                    blocked_at: u.created_at,
                    ban_label: label,
                  });
                }
              }
            }
            list = Array.from(existingMap.values());
          }
        }
        if (active) setBlockedUsers(list);
      } catch (err: any) {
        if (active) {
          setBlockedError('تعذّر تحميل قائمة المحظورين: ' + (err.message || String(err)));
        }
      } finally {
        if (active) setLoadingBlocked(false);
      }
    })();
    return () => { active = false; };
  }, [profile?.id, isAdmin]);

  useEffect(() => {
    if (!isAdmin) return;
    let active = true;
    void (async () => {
      const { data, error } = await supabase.from('post_reports')
        .select('id, reporter_id, reported_user_id, post_id, reason, status, created_at')
        .order('created_at', { ascending: false }).limit(100);
      if (!active) return;
      if (error) {
        setReportsError('تعذّر تحميل البلاغات: ' + error.message);
        return;
      }
      const rows = (data ?? []) as ReportRow[];
      const ids = [...new Set(rows.flatMap((row) => [row.reporter_id, row.reported_user_id]))];
      const postIds = [...new Set(rows.flatMap((row) => row.post_id ? [row.post_id] : []))];
      const [{ data: profiles }, { data: posts }] = await Promise.all([
        ids.length ? supabase.from('profiles').select('id, full_name').in('id', ids) : Promise.resolve({ data: [], error: null }),
        postIds.length ? supabase.from('posts').select('id, body').in('id', postIds) : Promise.resolve({ data: [], error: null }),
      ]);
      const profileMap = new Map((profiles ?? []).map((item) => [item.id, item.full_name]));
      const postMap = new Map((posts ?? []).map((item) => [item.id, item.body]));
      setReports(rows.map((row) => ({ ...row, reporter_name: profileMap.get(row.reporter_id) ?? 'مستخدم', reported_name: profileMap.get(row.reported_user_id) ?? 'مستخدم', post_body: row.post_id ? postMap.get(row.post_id) : undefined })));
    })();
    return () => { active = false; };
  }, [isAdmin]);

  useEffect(() => {
    if (!isAdmin) return;
    let active = true;
    void (async () => {
      const { data, error } = await supabase.from('profile_reports')
        .select('id, reporter_id, reported_user_id, reason, status, created_at')
        .order('created_at', { ascending: false }).limit(100);
      if (!active) return;
      if (error) {
        setReportsError('تعذّر تحميل بلاغات الحسابات: ' + error.message);
        return;
      }
      const rows = (data ?? []) as ProfileReport[];
      const ids = [...new Set(rows.flatMap((row) => [row.reporter_id, row.reported_user_id]))];
      const { data: people } = ids.length
        ? await supabase.from('profiles').select('id, full_name').in('id', ids)
        : { data: [] };
      const peopleMap = new Map((people ?? []).map((person) => [person.id, person.full_name]));
      setProfileReports(rows.map((row) => ({ ...row, reporter_name: peopleMap.get(row.reporter_id) ?? 'مستخدم', reported_name: peopleMap.get(row.reported_user_id) ?? 'مستخدم' })));
    })();
    return () => { active = false; };
  }, [isAdmin]);

  useEffect(() => {
    if (!isAdmin || !profile?.id) return;
    let active = true;
    const loadAlerts = async () => {
      const { data, error } = await supabase.from('admin_alerts')
        .select('id, message, reported_user_id, created_at, read_at')
        .eq('admin_id', profile.id).order('created_at', { ascending: false }).limit(30);
      if (active && !error) setAdminAlerts((data ?? []) as AdminAlert[]);
      if (active && error) setReportsError('تعذّر تحميل إشعارات الإدارة: ' + error.message);
    };
    void loadAlerts();
    const interval = window.setInterval(() => { void loadAlerts(); }, 10000);
    return () => { active = false; window.clearInterval(interval); };
  }, [isAdmin, profile?.id]);

  async function markAdminAlertRead(alert: AdminAlert) {
    if (alert.read_at) return;
    const readAt = new Date().toISOString();
    const { error } = await supabase.from('admin_alerts').update({ read_at: readAt })
      .eq('id', alert.id).eq('admin_id', profile?.id ?? '');
    if (!error) setAdminAlerts((prev) => prev.map((item) => item.id === alert.id ? { ...item, read_at: readAt } : item));
  }

  async function reviewReport(report: ReportRow) {
    setAdminBusyId(report.id);
    const { error } = await supabase.from('post_reports').update({ status: 'reviewed', reviewed_at: new Date().toISOString() }).eq('id', report.id);
    setAdminBusyId(null);
    if (error) setReportsError('تعذّر تحديث البلاغ.');
    else setReports((prev) => prev.map((item) => item.id === report.id ? { ...item, status: 'reviewed' } : item));
  }

  async function reviewProfileReport(report: ProfileReport) {
    setAdminBusyId(report.id);
    const { error } = await supabase.from('profile_reports').update({ status: 'action_taken', reviewed_at: new Date().toISOString() }).eq('id', report.id);
    setAdminBusyId(null);
    if (error) setReportsError('تعذّر تحديث بلاغ الحساب.');
    else setProfileReports((prev) => prev.map((item) => item.id === report.id ? { ...item, status: 'action_taken' } : item));
  }

  async function deleteReportedPost(report: ReportRow) {
    if (!window.confirm('سيتم حذف المنشور المبلّغ عنه نهائياً. هل تريد المتابعة؟')) return;
    setAdminBusyId(report.id);
    const { error } = await supabase.rpc('admin_delete_reported_post', { p_report_id: report.id });
    setAdminBusyId(null);
    if (error) setReportsError('تعذّر حذف المنشور: ' + error.message);
    else setReports((prev) => prev.map((item) => item.id === report.id ? { ...item, status: 'action_taken', post_body: undefined } : item));
  }

  return (
    <div className="app-shell">
      <header className="sticky top-0 z-20 flex items-center gap-2 border-b border-surface-dim bg-surface-raised/95 px-3 py-3 backdrop-blur-md">
        <button onClick={() => navigate(-1)} className="flex h-10 w-10 items-center justify-center rounded-full text-ink-soft hover:bg-surface-subtle">
          <ArrowLeft className="h-5 w-5 rotate-180" />
        </button>
        <h1 className="text-lg font-bold text-ink">الإعدادات</h1>
      </header>

      <main className="app-body space-y-4 p-4">
        {/* Privacy section */}
        <section>
          <h2 className="mb-2 px-1 text-xs font-bold uppercase text-ink-muted">الخصوصية والصُحبة</h2>
          <div className="card-raised divide-y divide-surface-dim p-0">
            {isGuest && <SettingRow
              icon={<UserPlus className="h-5 w-5 text-primary" />}
              title="أنت تستخدم التطبيق كضيف"
              subtitle={`اسمك داخل التطبيق: ${profile?.full_name ?? 'جارٍ التجهيز'}`}
              trailing={<span className="text-xs text-ink-muted">ضيف</span>}
            />}
            {isGuest ? <>
              <button
                onClick={() => navigate('/auth', { state: { mode: 'register' } })}
                className="flex w-full items-center gap-3 px-4 py-3.5 text-right hover:bg-surface-subtle"
              >
                <UserPlus className="h-5 w-5 text-primary" />
                <div className="flex-1">
                  <p className="font-semibold text-ink">إنشاء حساب جديد</p>
                  <p className="text-xs text-ink-muted">احتفظ بملفك ومنشوراتك على هذا الحساب</p>
                </div>
              </button>
              <button
                onClick={() => navigate('/auth', { state: { mode: 'login' } })}
                className="flex w-full items-center gap-3 px-4 py-3.5 text-right hover:bg-surface-subtle"
              >
                <LogIn className="h-5 w-5 text-primary" />
                <div className="flex-1">
                  <p className="font-semibold text-ink">تسجيل الدخول</p>
                  <p className="text-xs text-ink-muted">دخول بحساب موجود</p>
                </div>
              </button>
            </> : <>
              <SettingRow
                icon={<Shield className="h-5 w-5 text-primary" />}
                title="حساب مسجّل"
                subtitle={profile?.full_name ?? 'أنت مسجّل الدخول بحسابك.'}
                trailing={<span className="text-xs font-semibold text-primary">متصل</span>}
              />
              <button
                onClick={() => void signOut()}
                className="flex w-full items-center gap-3 px-4 py-3.5 text-right hover:bg-error-50"
              >
                <LogOut className="h-5 w-5 -scale-x-100 text-error" />
                <div className="flex-1"><p className="font-semibold text-error">تسجيل الخروج</p></div>
              </button>
            </>}
            <SettingRow
              icon={<Globe className="h-5 w-5 text-primary" />}
              title="منشورات عامة"
              subtitle="كل منشوراتك تظهر لجميع مستخدمي صُحبة."
              trailing={<span className="text-xs text-ink-muted">للجميع</span>}
            />
            <SettingRow
              icon={<Flame className="h-5 w-5 text-urgent" />}
              title="المنشورات العاجلة"
              subtitle="منشور عاجل واحد كل 24 ساعة لكل مستخدم — يثبت في المقدمة 15 دقيقة ثم يعود لترتيبه العادي."
              trailing={<span className="text-xs text-ink-muted">مفعّل</span>}
            />
            <SettingRow
              icon={<Globe className="h-5 w-5 text-primary" />}
              title="ظهور منشوراتي"
              subtitle="منشوراتك تظهر لجميع مستخدمي التطبيق."
              trailing={<span className="text-xs text-ink-muted">عام</span>}
            />
          </div>
        </section>

        {isAdmin && <section>
          <button onClick={() => navigate('/admin')} className="mb-3 flex w-full items-center gap-3 rounded-2xl bg-primary px-4 py-3.5 text-right text-white shadow-fab hover:bg-primary-700">
            <Shield className="h-5 w-5" />
            <span className="flex-1 font-bold">لوحة تحكم الحسابات والمنشورات</span>
            <span className="text-xs opacity-80">فتح</span>
          </button>
          <h2 className="mb-2 flex items-center gap-2 px-1 text-xs font-bold uppercase text-ink-muted"><Bell className="h-4 w-4" />إشعارات الإدارة</h2>
          <div className="card-raised divide-y divide-surface-dim p-0">
            {adminAlerts.length === 0 ? <p className="p-4 text-sm text-ink-muted">لا توجد إشعارات إدارية.</p> : adminAlerts.map((alert) => <button key={alert.id} onClick={() => void markAdminAlertRead(alert)} className={'w-full p-4 text-right ' + (!alert.read_at ? 'bg-primary-50' : '')}>
              <span className="block text-sm text-ink">{alert.message}</span>
              <span className="mt-1 block text-xs text-ink-faint">{new Date(alert.created_at).toLocaleString('ar-EG')}</span>
            </button>)}
          </div>
          {/* Quick links to Dedicated Report Screens */}
          <div className="mt-4 space-y-2.5">
            <button
              onClick={() => navigate('/admin/post-reports')}
              className="card flex w-full items-center gap-3.5 p-4 text-right transition hover:shadow-card-raised border border-surface-dim"
            >
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-urgent/10 text-urgent">
                <Flag className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="font-bold text-ink">بلاغات المنشورات</p>
                  {reports.filter((r) => r.status === 'open').length > 0 && (
                    <span className="rounded-full bg-urgent px-2 py-0.5 text-[11px] font-bold text-white">
                      {reports.filter((r) => r.status === 'open').length} مفتوح
                    </span>
                  )}
                </div>
                <p className="mt-0.5 text-xs text-ink-muted">
                  مراجعة البلاغات ضد المنشورات وحذف المحتوى المخالف
                </p>
              </div>
              <ChevronLeft className="h-5 w-5 text-ink-faint shrink-0" />
            </button>

            <button
              onClick={() => navigate('/admin/profile-reports')}
              className="card flex w-full items-center gap-3.5 p-4 text-right transition hover:shadow-card-raised border border-surface-dim"
            >
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-urgent/10 text-urgent">
                <ShieldAlert className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="font-bold text-ink">بلاغات الحسابات</p>
                  {profileReports.filter((r) => r.status === 'open').length > 0 && (
                    <span className="rounded-full bg-urgent px-2 py-0.5 text-[11px] font-bold text-white">
                      {profileReports.filter((r) => r.status === 'open').length} مفتوح
                    </span>
                  )}
                </div>
                <p className="mt-0.5 text-xs text-ink-muted">
                  مراجعة البلاغات ضد المستخدمين وتطبيق قرارات الحظر
                </p>
              </div>
              <ChevronLeft className="h-5 w-5 text-ink-faint shrink-0" />
            </button>
          </div>
        </section>}

        {/* Notifications (cosmetic) */}
        <section>
          <h2 className="mb-2 px-1 text-xs font-bold uppercase text-ink-muted">الإشعارات</h2>
          {notificationError && <p className="mb-2 rounded-xl bg-error-50 px-3 py-2 text-sm text-error">{notificationError}</p>}
          <div className="card-raised divide-y divide-surface-dim p-0">
            <SettingRow
              icon={<Bell className="h-5 w-5 text-primary" />}
              title="إشعارات التعليقات"
              subtitle="تنبيه عند تعليق أحد على منشوراتك."
              trailing={<Toggle on={notifyComments} disabled={savingNotification !== null} onToggle={(value) => void updateNotificationPreference('comments', value)} />}
            />
            <SettingRow
              icon={<Bell className="h-5 w-5 text-primary" />}
              title="إشعارات الإعجابات"
              subtitle="تنبيه عند إعجاب أحد بمنشوراتك."
              trailing={<Toggle on={notifyLikes} disabled={savingNotification !== null} onToggle={(value) => void updateNotificationPreference('likes', value)} />}
            />
          </div>
        </section>

        <section>
          <h2 className="mb-2 px-1 text-xs font-bold uppercase text-ink-muted">المستخدمون المحظورون</h2>
          <div className="card-raised p-0">
            <button
              onClick={() => navigate('/blocked')}
              className="flex w-full items-center gap-3 px-4 py-3.5 text-right hover:bg-surface-subtle transition"
            >
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <Ban className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="font-semibold text-ink">قائمة الحظر</p>
                  {blockedUsers.length > 0 && (
                    <span className="rounded-full bg-surface-subtle px-2 py-0.5 text-[11px] font-bold text-ink-muted">
                      {blockedUsers.length}
                    </span>
                  )}
                </div>
                <p className="text-xs text-ink-muted mt-0.5">
                  عرض الحسابات المحظورة وإدارتها وفك الحظر
                </p>
              </div>
              <ChevronLeft className="h-5 w-5 text-ink-faint shrink-0" />
            </button>
          </div>
        </section>

        {/* Account */}
        <section>
          <h2 className="mb-2 px-1 text-xs font-bold uppercase text-ink-muted">الحساب</h2>
          <div className="card-raised divide-y divide-surface-dim p-0">
            <button
              onClick={() => navigate(`/profile/${profile?.id}`)}
              className="flex w-full items-center gap-3 px-4 py-3.5 text-right hover:bg-surface-subtle"
            >
              <Shield className="h-5 w-5 text-primary" />
              <div className="flex-1">
                <p className="font-semibold text-ink">ملفي الشخصي</p>
                <p className="text-xs text-ink-muted">عرض وتعديل ملفك</p>
              </div>
            </button>
          </div>
        </section>

        {/* About */}
        <section>
          <div className="card flex items-center gap-3">
            <Info className="h-5 w-5 text-ink-muted" />
            <div className="flex-1">
              <p className="text-sm font-semibold text-ink">مجتمع Games Mix — الإصدار 1.0</p>
              <p className="text-xs text-ink-muted">شبكة اجتماعية عربية مخصصة للأصدقاء ومجتمع Games Mix.</p>
            </div>
          </div>
        </section>

        <div className="h-4" />
      </main>
    </div>
  );
}

function SettingRow({
  icon,
  title,
  subtitle,
  trailing,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  trailing: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 px-4 py-3.5">
      <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-surface-subtle">{icon}</span>
      <div className="min-w-0 flex-1">
        <p className="font-semibold text-ink">{title}</p>
        <p className="text-xs leading-snug text-ink-muted">{subtitle}</p>
      </div>
      {trailing}
    </div>
  );
}

function Toggle({ on, onToggle, disabled }: { on: boolean; onToggle: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      onClick={() => onToggle(!on)}
      disabled={disabled}
      className={`relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-50 ${
        on ? 'bg-primary' : 'bg-surface-dim'
      }`}
      aria-pressed={on}
    >
      <span
        className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${
          on ? 'left-0.5' : 'right-0.5'
        }`}
      />
    </button>
  );
}
