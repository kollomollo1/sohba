import type { VercelRequest, VercelResponse } from '@vercel/node';
import { authenticateUser, checkIfUserIsAdmin, getServerSupabase } from './utils/auth.js';
import {
  destroyCloudinaryImage,
  isImageReferencedByOtherPosts,
  processCloudinaryDeletionQueue,
} from './utils/cloudinary-queue.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'طريقة الطلب غير مسموح بها (POST فقط)' });
  }

  // 1. Authenticate caller
  const authHeader = req.headers.authorization;
  const { user, error: authErr } = await authenticateUser(authHeader);

  if (authErr || !user) {
    return res.status(401).json({ error: authErr || 'غير مصرح لك بالحذف. يرجى تسجيل الدخول.' });
  }

  const { publicId, imageUrl, postId } = req.body || {};

  // Extract or validate publicId
  let targetPublicId = publicId;
  if (!targetPublicId && imageUrl && typeof imageUrl === 'string') {
    // Cloudinary URL format: .../image/upload/(v[0-9]+/)?(sohba/posts/...)(.[a-z]+)?
    const match = imageUrl.match(/\/upload\/(?:v\d+\/)?([^\.\?#]+)(?:\.[a-zA-Z0-9]+)?/);
    if (match && match[1]) {
      targetPublicId = decodeURIComponent(match[1]);
    }
  }

  if (!targetPublicId || typeof targetPublicId !== 'string') {
    return res.status(400).json({ error: 'معرّف الصورة العام (public_id) مطلوب.' });
  }

  // Validate that the target publicId belongs to Sohba posts
  if (!targetPublicId.startsWith('sohba/posts/')) {
    return res.status(400).json({ error: 'مسار الصورة غير صالح؛ يجب أن يكون ضمن صور المنشورات.' });
  }

  // 2. Validate user authorization: must be admin or the folder owner
  const isOwner = targetPublicId.startsWith(`sohba/posts/${user.id}/`);
  const isAdmin = await checkIfUserIsAdmin(user, authHeader);

  if (!isAdmin && !isOwner) {
    return res.status(403).json({
      error: 'غير مصرح لك بحذف هذه الصورة. يجب أن تكون صاحب المنشور أو مسؤولاً (Admin).',
    });
  }

  const serverClient = getServerSupabase();

  // 3. Check if any OTHER active post is referencing this image
  try {
    const isShared = await isImageReferencedByOtherPosts(serverClient, targetPublicId, postId);
    if (isShared) {
      // Mark any queue item as skipped
      try {
        await serverClient
          .from('cloudinary_deletion_queue')
          .update({
            status: 'skipped',
            error_message: 'الصورة مستخدمة في منشور آخر؛ تم الاحتفاظ بها بأمان في Cloudinary.',
            last_attempt_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq('image_public_id', targetPublicId);
      } catch {}

      return res.status(200).json({
        ok: true,
        deleted: false,
        skipped: true,
        message: 'الصورة مستخدمة في منشور آخر؛ تم الاحتفاظ بها بأمان في Cloudinary.',
      });
    }
  } catch (checkErr) {
    console.warn('[cloudinary-delete] Conflict check warning:', checkErr);
  }

  // 4. Destroy the image using Cloudinary API
  const destroyRes = await destroyCloudinaryImage(targetPublicId);

  if (destroyRes.success) {
    // Mark matching queue records as completed
    try {
      await serverClient
        .from('cloudinary_deletion_queue')
        .update({
          status: 'completed',
          error_message: null,
          last_attempt_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('image_public_id', targetPublicId);
    } catch {}

    // Trigger lightweight queue drain in background (fire-and-forget)
    void processCloudinaryDeletionQueue({ limit: 5, client: serverClient }).catch(() => {});

    return res.status(200).json({
      ok: true,
      deleted: true,
      result: destroyRes.result,
      message: 'تم حذف الصورة من Cloudinary بنجاح.',
    });
  } else {
    // If destroy failed, ensure queue has a record for automated retry
    try {
      await serverClient.from('cloudinary_deletion_queue').upsert(
        {
          post_id: postId || null,
          author_id: user.id,
          image_public_id: targetPublicId,
          image_url: imageUrl || null,
          status: 'failed',
          attempts: 1,
          next_retry_at: new Date(Date.now() + 2 * 60 * 1000).toISOString(),
          error_message: destroyRes.error || `Destroy returned ${destroyRes.result}`,
          last_attempt_at: new Date().toISOString(),
        },
        { onConflict: 'image_public_id' }
      );
    } catch {}

    return res.status(500).json({
      ok: false,
      deleted: false,
      error: `فشل حذف الصورة من Cloudinary: ${destroyRes.error || destroyRes.result}. تمت جدولة العملية في طابور إعادة المحاولة التلقائي.`,
    });
  }
}
