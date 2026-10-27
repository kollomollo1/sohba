import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { X, Flame, Loader2, Image as ImageIcon, AlertCircle, CheckCircle } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { Avatar } from '@/components/Avatar';
import { compressPostImage } from '@/lib/imageCompression';
import {
  uploadPostImageToCloudinary,
  deletePostImageFromCloudinary,
  ALLOWED_IMAGE_TYPES,
  MAX_IMAGE_FILE_SIZE_BYTES,
} from '@/lib/cloudinary';
import type { FeedPost } from '@/types';

export function CreatePostScreen() {
  const navigate = useNavigate();
  const location = useLocation();
  const editPost = (location.state as { editPost?: FeedPost } | null)?.editPost;
  const { profile, isGuest } = useAuth();
  const [body, setBody] = useState(editPost?.body ?? '');
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [originalImageSize, setOriginalImageSize] = useState<number | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(editPost?.image_url ?? null);
  const [compressing, setCompressing] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [isUrgent, setIsUrgent] = useState(!isGuest && (editPost?.is_urgent ?? false));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = (body.trim().length > 0 || imageFile !== null || !!editPost) && !compressing;

  async function handleImageSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > MAX_IMAGE_FILE_SIZE_BYTES) {
      setError('حجم الصورة كبير جدًا؛ الحد الأقصى المسموح به هو 10 ميجابايت.');
      return;
    }

    const fileType = file.type.toLowerCase();
    const isImage = fileType.startsWith('image/') || ALLOWED_IMAGE_TYPES.some((t) => fileType.includes(t));
    if (!isImage) {
      setError('نوع الملف غير مدعوم. يرجى اختيار ملف صورة صالح (JPG, PNG, WEBP, GIF).');
      return;
    }

    setCompressing(true);
    setError(null);
    try {
      setOriginalImageSize(file.size);
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
    setUploadProgress(null);
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
    let uploadedPublicId: string | null = null;
    if (imageFile) {
      try {
        setUploadProgress(0);
        const uploadResult = await uploadPostImageToCloudinary(
          imageFile,
          authData.session.access_token,
          (percent) => setUploadProgress(percent)
        );
        uploadedImageUrl = uploadResult.url;
        uploadedPublicId = uploadResult.publicId;
      } catch (uploadErr: any) {
        console.error('Upload image to Cloudinary failed', uploadErr);
        setSubmitting(false);
        setUploadProgress(null);
        setError(uploadErr.message || 'تعذّر رفع الصورة إلى Cloudinary. يرجى التحقق من الاتصال والمحاولة مجددًا.');
        return;
      }
    }

    const basePayload = {
      author_id: profile!.id,
      body: body.trim(),
      image_url: uploadedImageUrl,
      is_urgent: !isGuest && isUrgent,
    };

    const insertRequest = (async () => {
      // 1. Try insert with image_public_id if present
      let res = await supabase
        .from('posts')
        .insert({
          ...basePayload,
          ...(uploadedPublicId ? { image_public_id: uploadedPublicId } : {}),
        })
        .select('id')
        .single();

      // 2. If image_public_id column doesn't exist yet in Supabase schema, fallback to base payload
      if (res.error && (res.error.message?.includes('image_public_id') || res.error.code === 'PGRST204')) {
        res = await supabase
          .from('posts')
          .insert(basePayload)
          .select('id')
          .single();
      }

      return res;
    })();

    const timeoutRequest = new Promise<Awaited<typeof insertRequest>>((resolve) => {
      setTimeout(() => resolve({
        data: null,
        error: { name: 'TimeoutError', message: 'Post request timed out', details: '', hint: '', code: 'TIMEOUT' },
      } as Awaited<typeof insertRequest>), 15000);
    });
    const { data, error: insErr } = await Promise.race([insertRequest, timeoutRequest]);

    setSubmitting(false);
    setUploadProgress(null);

    if (insErr) {
      console.error('create post failed', { code: insErr.code, message: insErr.message, details: insErr.details, hint: insErr.hint });

      // Clean up orphaned uploaded image from Cloudinary if post insertion failed
      if (uploadedPublicId || uploadedImageUrl) {
        void deletePostImageFromCloudinary(
          uploadedPublicId || uploadedImageUrl!,
          authData.session.access_token
        );
      }

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
            {submitting ? (
              uploadProgress !== null ? (
                <span className="inline-flex items-center gap-1.5">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>{uploadProgress}%</span>
                </span>
              ) : (
                <Loader2 className="h-4 w-4 animate-spin" />
              )
            ) : editPost ? (
              'حفظ'
            ) : (
              'نشر'
            )}
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
              {submitting && uploadProgress !== null && (
                <div className="absolute inset-0 bg-ink/50 backdrop-blur-[2px] flex flex-col items-center justify-center p-4 z-10">
                  <div className="w-full max-w-xs bg-surface-dim/80 rounded-full h-3 overflow-hidden shadow-inner">
                    <div
                      className="bg-primary h-full transition-all duration-200"
                      style={{ width: `${uploadProgress}%` }}
                    />
                  </div>
                  <span className="mt-2 text-xs font-bold text-white drop-shadow">
                    جارٍ رفع وتحسين الصورة عبر Cloudinary ({uploadProgress}%)
                  </span>
                </div>
              )}
              <button
                type="button"
                onClick={() => {
                  setImageFile(null);
                  setOriginalImageSize(null);
                  setImagePreview(null);
                }}
                className="absolute top-2 left-2 flex h-8 w-8 items-center justify-center rounded-full bg-ink/75 text-white hover:bg-ink transition shadow-sm"
                title="إزالة الصورة"
              >
                <X className="h-4 w-4" />
              </button>
              {imageFile && (
                <div className="flex items-center justify-between bg-surface-raised px-3.5 py-2 text-xs border-t border-surface-dim">
                  <span className="inline-flex items-center gap-1.5 font-bold text-emerald-600">
                    <CheckCircle className="h-4 w-4" />
                    {originalImageSize
                      ? `تم الضغط إلى نصف الحجم الأصلي (${Math.round(imageFile.size / 1024)} ك.ب بدلاً من ${Math.round(originalImageSize / 1024)} ك.ب)`
                      : `تم الضغط بحجم خفيف (${Math.round(imageFile.size / 1024)} ك.ب)`}
                  </span>
                  <span className="text-[11px] text-ink-muted">سريعة جداً في التحميل</span>
                </div>
              )}
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
