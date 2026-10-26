import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Flag, Loader2, Trash2, Check, ExternalLink, Search, RefreshCw } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';

type ReportRow = {
  id: string;
  reporter_id: string;
  reported_user_id: string;
  post_id: string | null;
  reason: string;
  status: 'open' | 'reviewed' | 'action_taken';
  created_at: string;
  reporter_name?: string;
  reported_name?: string;
  post_body?: string;
  post_image_url?: string | null;
};

type Filter = 'all' | 'open' | 'reviewed';

export function PostReportsScreen() {
  const navigate = useNavigate();
  const { session } = useAuth();
  const isAdmin = session?.user.app_metadata?.role === 'admin';
  const [reports, setReports] = useState<ReportRow[]>([]);
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
      .from('post_reports')
      .select('id, reporter_id, reported_user_id, post_id, reason, status, created_at')
      .order('created_at', { ascending: false })
      .limit(100);

    if (repErr) {
      setError('تعذّر تحميل بلاغات المنشورات: ' + repErr.message);
      setLoading(false);
      return;
    }

    const rows = (data ?? []) as ReportRow[];
    const ids = [...new Set(rows.flatMap((r) => [r.reporter_id, r.reported_user_id]))];
    const postIds = [...new Set(rows.flatMap((r) => (r.post_id ? [r.post_id] : [])))];

    const [{ data: profiles }, { data: posts }] = await Promise.all([
      ids.length ? supabase.from('profiles').select('id, full_name').in('id', ids) : Promise.resolve({ data: [] }),
      postIds.length ? supabase.from('posts').select('id, body, image_url').in('id', postIds) : Promise.resolve({ data: [] }),
    ]);

    const profileMap = new Map((profiles ?? []).map((p) => [p.id, p.full_name]));
    const postMap = new Map((posts ?? []).map((p) => [p.id, p]));

    setReports(
      rows.map((r) => {
        const postData = r.post_id ? postMap.get(r.post_id) : undefined;
        return {
          ...r,
          reporter_name: profileMap.get(r.reporter_id) ?? 'مستخدم',
          reported_name: profileMap.get(r.reported_user_id) ?? 'مستخدم',
          post_body: postData?.body,
          post_image_url: postData?.image_url,
        };
      })
    );
    setLoading(false);
  }, [isAdmin]);

  useEffect(() => {
    void load();
  }, [load]);

  async function reviewReport(report: ReportRow) {
    setBusyId(report.id);
    const { error: err } = await supabase.from('post_reports').update({ status: 'reviewed' }).eq('id', report.id);
    setBusyId(null);
    if (err) {
      setError('تعذّر تحديث البلاغ: ' + err.message);
    } else {
      setReports((prev) => prev.map((item) => (item.id === report.id ? { ...item, status: 'reviewed' } : item)));
    }
  }

  async function deleteReportedPost(report: ReportRow) {
    if (!report.post_id) return;
    if (!window.confirm('حذف هذا المنشور المبلغ عنه نهائياً؟')) return;
    setBusyId(report.id);
    const { error: delErr } = await supabase.rpc('admin_delete_post', { p_post_id: report.post_id });
    if (delErr) {
      setBusyId(null);
      setError('تعذّر حذف المنشور: ' + delErr.message);
      return;
    }
    await supabase.from('post_reports').update({ status: 'action_taken' }).eq('id', report.id);
    setReports((prev) => prev.map((item) => (item.id === report.id ? { ...item, status: 'action_taken' } : item)));
    setBusyId(null);
  }

  const filteredReports = useMemo(() => {
    return reports.filter((r) => {
      if (filter === 'open' && r.status !== 'open') return false;
      if (filter === 'reviewed' && r.status === 'open') return false;
      if (query.trim()) {
        const q = query.trim().toLowerCase();
        const repName = (r.reporter_name ?? '').toLowerCase();
        const rptName = (r.reported_name ?? '').toLowerCase();
        const body = (r.post_body ?? '').toLowerCase();
        const reason = (r.reason ?? '').toLowerCase();
        return repName.includes(q) || rptName.includes(q) || body.includes(q) || reason.includes(q);
      }
      return true;
    });
  }, [reports, filter, query]);

  const openCount = reports.filter((r) => r.status === 'open').length;

  if (!isAdmin) {
    return (
      <div className="app-shell flex flex-col items-center justify-center gap-3 px-6 text-center">
        <Flag className="h-10 w-10 text-error" />
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
        <Flag className="h-5 w-5 text-urgent" />
        <h1 className="text-lg font-bold text-ink">بلاغات المنشورات</h1>
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
            placeholder="ابحث باسم المستخدم أو سبب البلاغ أو محتوى المنشور..."
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
            <p className="mt-2 font-bold text-ink">لا توجد بلاغات تطابق الفلتر</p>
            <p className="mt-1 text-xs text-ink-muted">جميع المنشورات تحت المتابعة المستمرة.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {filteredReports.map((report) => (
              <article key={report.id} className="card space-y-3 border border-surface-dim shadow-sm">
                <div className="flex items-start justify-between gap-2 border-b border-surface-dim/70 pb-2.5">
                  <div>
                    <p className="text-sm font-bold text-ink">
                      بلاغ ضد{' '}
                      <button
                        onClick={() => navigate(`/profile/${report.reported_user_id}`)}
                        className="text-primary hover:underline"
                      >
                        {report.reported_name}
                      </button>
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
                        : report.status === 'reviewed'
                          ? 'bg-primary-50 text-primary'
                          : 'bg-surface-subtle text-ink-muted'
                    }`}
                  >
                    {report.status === 'open' ? 'مفتوح' : report.status === 'reviewed' ? 'تمت المراجعة' : 'تم اتخاذ إجراء'}
                  </span>
                </div>

                <div>
                  <p className="text-xs font-semibold text-ink-muted">سبب البلاغ:</p>
                  <p className="mt-0.5 text-sm font-medium text-ink-soft bg-surface-subtle/70 rounded-xl p-2.5">
                    {report.reason}
                  </p>
                </div>

                {report.post_body && (
                  <div>
                    <p className="text-xs font-semibold text-ink-muted">محتوى المنشور المبلغ عنه:</p>
                    <p className="mt-0.5 whitespace-pre-wrap break-words rounded-xl border border-surface-dim bg-surface p-3 text-xs text-ink-soft">
                      {report.post_body}
                    </p>
                  </div>
                )}

                {report.post_image_url && (
                  <div className="overflow-hidden rounded-xl border border-surface-dim bg-surface-subtle">
                    <img src={report.post_image_url} alt="مرفق المنشور" className="max-h-60 w-full object-cover" />
                  </div>
                )}

                <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-surface-dim">
                  {report.post_id && (
                    <button
                      onClick={() => navigate(`/post/${report.post_id}`)}
                      className="inline-flex items-center gap-1 rounded-full bg-primary-50 px-3.5 py-2 text-xs font-semibold text-primary hover:bg-primary-100 transition"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                      عرض المنشور
                    </button>
                  )}

                  {report.status === 'open' && (
                    <>
                      {report.post_id && (
                        <button
                          disabled={busyId === report.id}
                          onClick={() => void deleteReportedPost(report)}
                          className="inline-flex items-center gap-1 rounded-full bg-error-50 px-3.5 py-2 text-xs font-semibold text-error hover:bg-error-100 disabled:opacity-50 transition"
                        >
                          {busyId === report.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                          حذف المنشور
                        </button>
                      )}

                      <button
                        disabled={busyId === report.id}
                        onClick={() => void reviewReport(report)}
                        className="inline-flex items-center gap-1 rounded-full bg-surface-subtle px-3.5 py-2 text-xs font-semibold text-ink-soft hover:bg-surface-dim disabled:opacity-50 transition"
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
