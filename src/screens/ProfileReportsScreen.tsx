import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, ShieldAlert, Loader2, Check, ExternalLink, Search, RefreshCw, Ban } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';

type ProfileReport = {
  id: string;
  reporter_id: string;
  reported_user_id: string;
  reason: string;
  status: 'open' | 'reviewed' | 'action_taken';
  created_at: string;
  reporter_name?: string;
  reported_name?: string;
  reported_username?: string;
  reported_avatar?: string | null;
};

type Filter = 'all' | 'open' | 'reviewed';

export function ProfileReportsScreen() {
  const navigate = useNavigate();
  const { session } = useAuth();
  const isAdmin = session?.user.app_metadata?.role === 'admin';
  const [reports, setReports] = useState<ProfileReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('open');
  const [query, setQuery] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!isAdmin) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);

    const { data, error: repErr } = await supabase
      .from('profile_reports')
      .select('id, reporter_id, reported_user_id, reason, status, created_at')
      .order('created_at', { ascending: false })
      .limit(100);

    if (repErr) {
      setError('تعذّر تحميل بلاغات الحسابات: ' + repErr.message);
      setLoading(false);
      return;
    }

    const rows = (data ?? []) as ProfileReport[];
    const ids = [...new Set(rows.flatMap((r) => [r.reporter_id, r.reported_user_id]))];

    const { data: people } = ids.length
      ? await supabase.from('profiles').select('id, full_name, username, avatar_url').in('id', ids)
      : { data: [] };

    const peopleMap = new Map((people ?? []).map((p) => [p.id, p]));

    setReports(
      rows.map((r) => {
        const reportedPerson = peopleMap.get(r.reported_user_id);
        const reporterPerson = peopleMap.get(r.reporter_id);
        return {
          ...r,
          reporter_name: reporterPerson?.full_name ?? 'مستخدم',
          reported_name: reportedPerson?.full_name ?? 'مستخدم',
          reported_username: reportedPerson?.username ?? '',
          reported_avatar: reportedPerson?.avatar_url,
        };
      })
    );
    setLoading(false);
  }, [isAdmin]);

  useEffect(() => {
    void load();
  }, [load]);

  async function reviewProfileReport(report: ProfileReport) {
    setBusyId(report.id);
    const { error: err } = await supabase.from('profile_reports').update({ status: 'reviewed' }).eq('id', report.id);
    setBusyId(null);
    if (err) {
      setError('تعذّر تحديث حالة البلاغ: ' + err.message);
    } else {
      setReports((prev) => prev.map((item) => (item.id === report.id ? { ...item, status: 'reviewed' } : item)));
    }
  }

  async function applyBan(userId: string, action: 'suspend_3d' | 'ban_permanent') {
    const prompt = action === 'suspend_3d'
      ? 'إيقاف هذا الحساب عن دخول التطبيق لمدة 3 أيام وحذف جميع منشوراته وصوره؟'
      : 'حظر هذا الحساب نهائياً من التطبيق وحذف جميع منشوراته وصوره؟';
    if (!window.confirm(prompt)) return;

    setBusyId(userId);
    setError(null);
    const { error: banErr } = await supabase.functions.invoke('apply-report-ban', {
      body: { admin_action: action, user_id: userId },
    });
    setBusyId(null);
    if (banErr) {
      setError('تعذّر تنفيذ الحظر: ' + banErr.message);
    } else {
      await load();
    }
  }

  const filteredReports = useMemo(() => {
    return reports.filter((r) => {
      if (filter === 'open' && r.status !== 'open') return false;
      if (filter === 'reviewed' && r.status === 'open') return false;
      if (query.trim()) {
        const q = query.trim().toLowerCase();
        const repName = (r.reporter_name ?? '').toLowerCase();
        const rptName = (r.reported_name ?? '').toLowerCase();
        const reason = (r.reason ?? '').toLowerCase();
        const uname = (r.reported_username ?? '').toLowerCase();
        return repName.includes(q) || rptName.includes(q) || reason.includes(q) || uname.includes(q);
      }
      return true;
    });
  }, [reports, filter, query]);

  const openCount = reports.filter((r) => r.status === 'open').length;

  if (!isAdmin) {
    return (
      <div className="app-shell flex flex-col items-center justify-center gap-3 px-6 text-center">
        <ShieldAlert className="h-10 w-10 text-error" />
        <p className="font-bold text-ink">هذه الصفحة للأدمن فقط</p>
        <button onClick={() => navigate('/settings')} className="btn-secondary">الإعدادات</button>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <header className="sticky top-0 z-20 flex items-center gap-2 border-b border-surface-dim bg-surface-raised/95 px-3 py-3 backdrop-blur-md">
        <button
          onClick={() => navigate('/settings')}
          className="flex h-10 w-10 items-center justify-center rounded-full text-ink-soft hover:bg-surface-subtle"
          aria-label="رجوع"
        >
          <ArrowLeft className="h-5 w-5 rotate-180" />
        </button>
        <ShieldAlert className="h-5 w-5 text-urgent" />
        <h1 className="text-lg font-bold text-ink">بلاغات الحسابات</h1>
        <button
          onClick={() => void load()}
          disabled={loading}
          className="mr-auto flex h-9 w-9 items-center justify-center rounded-full text-primary hover:bg-primary-50 transition"
          title="تحديث"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </header>

      <main className="app-body space-y-3 p-3">
        {/* Filters */}
        <div className="flex items-center gap-1.5 rounded-full bg-surface-subtle p-1">
          <button
            onClick={() => setFilter('open')}
            className={`chip flex-1 justify-center gap-1 ${filter === 'open' ? 'chip-active' : 'chip-inactive'}`}
          >
            المفتوحة
            {openCount > 0 && (
              <span className="rounded-full bg-urgent px-1.5 py-0.5 text-[10px] font-bold text-white">
                {openCount}
              </span>
            )}
          </button>
          <button
            onClick={() => setFilter('reviewed')}
            className={`chip flex-1 justify-center ${filter === 'reviewed' ? 'chip-active' : 'chip-inactive'}`}
          >
            تمت مراجعتها
          </button>
          <button
            onClick={() => setFilter('all')}
            className={`chip flex-1 justify-center ${filter === 'all' ? 'chip-active' : 'chip-inactive'}`}
          >
            جميع البلاغات ({reports.length})
          </button>
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="input-field pr-9 text-sm"
            placeholder="ابحث بالاسم أو اسم المستخدم أو سبب البلاغ..."
          />
        </div>

        {error && <p className="card text-sm text-error">{error}</p>}

        {loading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-7 w-7 animate-spin text-primary" />
          </div>
        ) : filteredReports.length === 0 ? (
          <div className="card py-12 text-center">
            <Check className="mx-auto h-8 w-8 text-success" />
            <p className="mt-2 font-bold text-ink">لا توجد بلاغات حسابات تطابق الفلتر</p>
            <p className="mt-1 text-xs text-ink-muted">جميع حسابات المستخدمين سليمة ومستقرة.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {filteredReports.map((report) => (
              <article key={report.id} className="card space-y-3 border border-surface-dim shadow-sm">
                <div className="flex items-start justify-between gap-2 border-b border-surface-dim/70 pb-2.5">
                  <div>
                    <p className="text-sm font-bold text-ink">
                      بلاغ ضد حساب{' '}
                      <button
                        onClick={() => navigate(`/profile/${report.reported_user_id}`)}
                        className="text-primary hover:underline"
                      >
                        {report.reported_name}
                      </button>
                      {report.reported_username && (
                        <span className="text-xs font-normal text-ink-muted mr-1">
                          (@{report.reported_username})
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-ink-muted">
                      مقدم البلاغ:{' '}
                      <button
                        onClick={() => navigate(`/profile/${report.reporter_id}`)}
                        className="hover:underline"
                      >
                        {report.reporter_name}
                      </button>{' '}
                      · {new Date(report.created_at).toLocaleString('ar-EG')}
                    </p>
                  </div>
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${
                      report.status === 'open'
                        ? 'bg-urgent/10 text-urgent'
                        : 'bg-surface-subtle text-ink-muted'
                    }`}
                  >
                    {report.status === 'open' ? 'مفتوح' : 'تمت المراجعة'}
                  </span>
                </div>

                <div>
                  <p className="text-xs font-semibold text-ink-muted">سبب البلاغ المقدم:</p>
                  <p className="mt-0.5 text-sm font-medium text-ink-soft bg-surface-subtle/70 rounded-xl p-2.5">
                    {report.reason}
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-surface-dim">
                  <button
                    onClick={() => navigate(`/profile/${report.reported_user_id}`)}
                    className="inline-flex items-center gap-1 rounded-full bg-primary-50 px-3.5 py-2 text-xs font-semibold text-primary hover:bg-primary-100 transition"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    عرض البروفايل
                  </button>

                  {report.status === 'open' && (
                    <>
                      <button
                        disabled={busyId === report.reported_user_id}
                        onClick={() => void applyBan(report.reported_user_id, 'suspend_3d')}
                        className="rounded-full bg-urgent/10 px-3 py-2 text-xs font-semibold text-urgent hover:bg-urgent/20 disabled:opacity-50 transition"
                      >
                        إيقاف 3 أيام
                      </button>

                      <button
                        disabled={busyId === report.reported_user_id}
                        onClick={() => void applyBan(report.reported_user_id, 'ban_permanent')}
                        className="inline-flex items-center gap-1 rounded-full bg-error-50 px-3 py-2 text-xs font-semibold text-error hover:bg-error-100 disabled:opacity-50 transition"
                      >
                        <Ban className="h-3.5 w-3.5" />
                        حظر دائم
                      </button>

                      <button
                        disabled={busyId === report.id}
                        onClick={() => void reviewProfileReport(report)}
                        className="inline-flex items-center gap-1 rounded-full bg-surface-subtle px-3.5 py-2 text-xs font-semibold text-ink-soft hover:bg-surface-dim disabled:opacity-50 transition mr-auto"
                      >
                        <Check className="h-3.5 w-3.5" />
                        تمت المراجعة
                      </button>
                    </>
                  )}
                </div>
              </article>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
