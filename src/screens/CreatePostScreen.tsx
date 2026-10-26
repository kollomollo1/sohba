import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { X, Flame, Loader2, Image as ImageIcon, AlertCircle } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { Avatar } from '@/components/Avatar';
import { compressPostImage } from '@/lib/imageCompression';
import type { FeedPost } from '@/types';

export function CreatePostScreen() {
  const navigate = useNavigate();
  const location = useLocation();
  const editPost = (location.state as { editPost?: FeedPost } | null)?.editPost;
  const { profile, isGuest } = useAuth();
  const [body, setBody] = useState(editPost?.body ?? '');
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(editPost?.image_url ?? null);
  const [compressing, setCompressing] = useState(false);
  const [isUrgent, setIsUrgent] = useState(!isGuest && (editPost?.is_urgent ?? false));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = (body.trim().length > 0 || imageFile !== null || !!editPost) && !compressing;

  async function handleImageSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setCompressing(true);
    setError(null);
    try {
      const compressed = await compressPostImage(file);
      setImageFile(compressed);
      setImagePreview(URL.createObjectURL(compressed));
    } catch (err) {
      console.error('Image compression failed', err);
      setError('تعذّر ضغط الصورة، يرجى اختيار صورة أخرى.');
    } finally {
      setCompressing(false);
    }
  }

  async function submit() {
    if (!canSubmit || submitting) return;
    if (!profile) {
      setError('لم يكتمل إعداد ملف الضيف. تأكد من تطبيق ملفات migrations على مشروع Supabase ثم حدّث الصفحة.');
      return;
    }
    setSubmitting(true);
    setError(null);

    const { data: authData, error: authError } = await supabase.auth.getSession();
    if (authError || !authData.session || authData.session.user.id !== profile.id) {
      console.error('post author/session mismatch', {
        sessionUserId: authData.session?.user.id,
        profileId: profile.id,
        authError: authError?.message,
      });
      setSubmitting(false);
      setError('جلسة الضيف لا تطابق ملفه الشخصي. حدّث الصفحة لتجديد الجلسة ثم حاول مرة أخرى.');
      return;
    }

    if (editPost) {
      const { error: updateError } = await supabase
        .from('posts')
        .update({ body: body.trim() })
        .eq('id', editPost.id)
        .eq('author_id', profile.id);
      setSubmitting(false);
      if (updateError) {
        console.error('edit post failed', updateError.message);
        setError('تعذّر تعديل المنشور: ' + updateError.message);
        return;
      }
      navigate(`/post/${editPost.id}`, { replace: true });
      return;
    }

    let uploadedImageUrl: string | null = null;
    if (imageFile) {
      const filePath = `posts/${profile.id}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.jpg`;
      const { error: uploadErr } = await supabase.storage.from('media').upload(filePath, imageFile, {
        contentType: 'image/jpeg',
        upsert: false,
      });
      if (uploadErr) {
        console.error('Upload image failed', uploadErr);
        setSubmitting(false);
        setError('تعذّر رفع الصورة: ' + uploadErr.message);
        return;
      }
      const { data: pubData } = supabase.storage.from('media').getPublicUrl(filePath);
      uploadedImageUrl = pubData.publicUrl;
    }

    const insertRequest = supabase
      .from('posts')
      .insert({
        author_id: profile!.id,
        body: body.trim(),
        image_url: uploadedImageUrl,
        is_urgent: !isGuest && isUrgent,
      })
      .select('id')
      .single();

    const timeoutRequest = new Promise<Awaited<typeof insertRequest>>((resolve) => {
      setTimeout(() => resolve({
        data: null,
        error: { name: 'TimeoutError', message: 'Post request timed out', details: '', hint: '', code: 'TIMEOUT' },
      } as Awaited<typeof insertRequest>), 15000);
    });
    const { data, error: insErr } = await Promise.race([insertRequest, timeoutRequest]);

    setSubmitting(false);

    if (insErr) {
      console.error('create post failed', { code: insErr.code, message: insErr.message, details: insErr.details, hint: insErr.hint });
      const msg = insErr.message || '';
      if (insErr.code === 'TIMEOUT') {
        setError('انتهت مهلة الاتصال بقاعدة البيانات. تحقق من إعدادات Supabase ثم حاول مجددًا.');
      } else if (msg.includes('إيقاف النشر')) {
        setError('تم إيقاف النشر على هذا الحساب لمدة 24 ساعة بسبب البلاغات.');
      } else if (msg.includes('24') || msg.includes('urgent')) {
        setError('عذراً، يمكنك نشر منشور عاجل واحد كل 24 ساعة.');
      } else if (msg.includes('15 دقيقة')) {
        setError('يمكنك نشر منشور واحد فقط كل 15 دقيقة. حاول بعد انتهاء المدة.');
      } else if (insErr.code === '42P01' || insErr.code === 'PGRST205') {
        setError('جدول المنشورات غير موجود في قاعدة البيانات. طبّق ملفات migrations على مشروع Supabase الحالي.');
      } else if (insErr.code === '42501') {
        setError(`رفضت قاعدة البيانات الإذن: ${insErr.message}${insErr.details ? ` — ${insErr.details}` : ''}`);
      } else if (insErr.code === '23503' || insErr.code === '23502') {
        setError('ملف الضيف غير موجود أو غير مكتمل. تأكد من تفعيل trigger إنشاء الملف وتطبيق migrations.');
      } else {
        setError(`تعذّر نشر المنشور: ${insErr.message}`);
      }
      return;
    }

    if (uploadedImageUrl) {
      navigate('/', { replace: true });
    } else {
      navigate(`/post/${data.id}`, { replace: true });
    }
  }

  return (
    <div className="app-shell">
      <header className="sticky top-0 z-20 border-b border-surface-dim bg-surface-raised/95 backdrop-blur-md">
        <div className="flex items-center gap-3 px-4 py-3">
          <button
            onClick={() => navigate(-1)}
            className="flex h-10 w-10 items-center justify-center rounded-full text-ink-soft hover:bg-surface-subtle"
            aria-label="إغلاق"
          >
            <X className="h-5 w-5" />
          </button>
          <h1 className="text-lg font-bold text-ink">{editPost ? 'تعديل المنشور' : 'منشور جديد'}</h1>
          <button
            onClick={submit}
            disabled={!canSubmit || submitting}
            className="btn-primary mr-auto px-5 py-2"
          >
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : editPost ? 'حفظ' : 'نشر'}
          </button>
        </div>
      </header>

      <main className="app-body px-4 pt-4">
        {/* Author row */}
        <div className="flex items-center gap-3">
          <Avatar name={profile?.full_name ?? ''} src={profile?.avatar_url} size={48} />
          <div className="min-w-0 flex-1">
            <p className="truncate font-bold text-ink">{profile?.full_name}</p>
            <p className="mt-1.5 text-xs text-ink-muted">سيظهر منشورك لكل مستخدمي صُحبة</p>
          </div>
        </div>

        {/* Body */}
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="بماذا تفكر؟ شارك صُحبتك..."
          className="mt-4 min-h-[140px] w-full resize-none rounded-2xl border border-surface-dim bg-surface-raised p-4 text-[16px] leading-relaxed text-ink placeholder:text-ink-faint focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary-100 font-noto"
          autoFocus
        />

        {/* Image upload button & preview */}
        <div className="mt-3">
          <input
            id="post-image-input"
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => void handleImageSelect(e)}
            disabled={submitting || compressing}
          />

          {imagePreview ? (
            <div className="relative overflow-hidden rounded-2xl border border-surface-dim bg-surface-subtle">
              <img src={imagePreview} alt="معاينة الصورة" className="max-h-72 w-full object-cover" />
              <button
                type="button"
                onClick={() => {
                  setImageFile(null);
                  setImagePreview(null);
                }}
                className="absolute top-2 left-2 flex h-8 w-8 items-center justify-center rounded-full bg-ink/75 text-white hover:bg-ink transition shadow-sm"
                title="إزالة الصورة"
              >
                <X className="h-4 w-4" />
              </button>
              <div className="flex items-center gap-2 bg-amber-500/10 px-3 py-2 text-xs font-medium text-amber-700 dark:text-amber-400">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>المنشورات التي تحتوي على صور تخضع لمراجعة قسم الإدارة قبل ظهورها للجميع.</span>
              </div>
            </div>
          ) : (
            <label
              htmlFor="post-image-input"
              className={`flex cursor-pointer items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-surface-dim p-4 text-ink-muted hover:border-primary/50 hover:bg-surface-subtle hover:text-primary transition ${
                compressing ? 'opacity-50 pointer-events-none' : ''
              }`}
            >
              {compressing ? (
                <>
                  <Loader2 className="h-5 w-5 animate-spin text-primary" />
                  <span className="text-sm font-medium text-primary">جارٍ ضغط الصورة بحجم صغير وجودة عالية...</span>
                </>
              ) : (
                <>
                  <ImageIcon className="h-5 w-5" />
                  <span className="text-sm font-medium">إضافة صورة للمنشور</span>
                </>
              )}
            </label>
          )}
        </div>

        {/* Urgent toggle is available only to registered accounts. */}
        {!isGuest && (
          <button
            onClick={() => setIsUrgent((v) => !v)}
            disabled={!!editPost}
            className={`mt-4 flex w-full items-center gap-3 rounded-2xl border p-4 transition-all ${
              isUrgent
                ? 'border-urgent/40 bg-urgent-50 shadow-urgent'
                : 'border-surface-dim bg-surface-raised'
            } ${editPost ? 'cursor-not-allowed opacity-70' : ''}`}
          >
            <span
              className={`flex h-11 w-11 items-center justify-center rounded-xl transition-colors ${
                isUrgent ? 'bg-urgent text-white' : 'bg-surface-subtle text-ink-muted'
              }`}
            >
              <Flame className="h-5 w-5" />
            </span>
            <div className="flex-1 text-right">
              <p className={`font-bold ${isUrgent ? 'text-urgent' : 'text-ink'}`}>وسم كمنشور عاجل</p>
              <p className="text-xs text-ink-muted">
                {editPost
                  ? 'لا يمكن تغيير حالة العاجل بعد نشره.'
                  : isUrgent
                    ? 'سيظهر في مقدمة الخلاصة 15 دقيقة (بدون إشعار).'
                    : 'منشور عاجل واحد كل 24 ساعة لكل مستخدم.'}
              </p>
            </div>
            <span
              className={`relative h-6 w-11 rounded-full transition-colors ${isUrgent ? 'bg-urgent' : 'bg-surface-dim'}`}
            >
              <span
                className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${
                  isUrgent ? 'left-0.5' : 'right-0.5'
                }`}
              />
            </span>
          </button>
        )}

        {error && (
          <p className="mt-4 rounded-xl bg-error-50 px-4 py-2.5 text-sm font-medium text-error animate-pop">
            {error}
          </p>
        )}
      </main>
    </div>
  );
}
