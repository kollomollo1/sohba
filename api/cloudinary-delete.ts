import type { VercelRequest, VercelResponse } from '@vercel/node';
import { v2 as cloudinary } from 'cloudinary';
import { authenticateUser, checkIfUserIsAdmin, createUserSupabase } from './utils/auth.js';

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
    const match = imageUrl.match(/\/upload\/(?:v\d+\/)?([^\.\?]+)(?:\.[a-zA-Z0-9]+)?/);
    if (match && match[1]) {
      targetPublicId = decodeURIComponent(match[1]);
    }
  }

  if (!targetPublicId || typeof targetPublicId !== 'string') {
    return res.status(400).json({ error: 'معرّف الصورة العام (public_id) مطلوب.' });
  }

  // 2. Validate user authorization: must be admin or the folder owner
  const isOwner = targetPublicId.startsWith(`sohba/posts/${user.id}/`);
  const isAdmin = await checkIfUserIsAdmin(user, authHeader);

  if (!isAdmin && !isOwner) {
    return res.status(403).json({
      error: 'غير مصرح لك بحذف هذه الصورة. يجب أن تكون صاحب المنشور أو مسؤولاً (Admin).',
    });
  }

  // 3. Verify that no OTHER post is referencing this image
  try {
    const userSupabase = createUserSupabase(authHeader);
    let query = userSupabase.from('posts').select('id', { count: 'exact', head: true });
    if (postId) {
      query = query.neq('id', postId);
    }
    // Check if targetPublicId is contained in any other post's image_url
    query = query.ilike('image_url', `%${targetPublicId}%`);

    const { count } = await query;
    if (typeof count === 'number' && count > 0) {
      // Image is still referenced by another post, safely skip deleting from Cloudinary
      return res.status(200).json({
        ok: true,
        skipped: true,
        message: 'الصورة مستخدمة في منشور آخر؛ تم الاحتفاظ بها بأمان في Cloudinary.',
      });
    }
  } catch (checkErr) {
    console.warn('[cloudinary-delete] Conflict check warning:', checkErr);
  }

  // 4. Validate Cloudinary credentials
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;

  if (!cloudName || !apiKey || !apiSecret) {
    console.error('[cloudinary-delete] Cloudinary credentials missing on server');
    return res.status(500).json({
      error: 'إعدادات Cloudinary غير مكتملة على الخادم.',
    });
  }

  cloudinary.config({
    cloud_name: cloudName,
    api_key: apiKey,
    api_secret: apiSecret,
    secure: true,
  });

  try {
    const destroyRes = await cloudinary.uploader.destroy(targetPublicId, {
      resource_type: 'image',
      invalidate: true,
    });

    return res.status(200).json({
      ok: true,
      result: destroyRes.result,
    });
  } catch (err: any) {
    console.error('[cloudinary-delete] Deletion failed:', err);
    return res.status(500).json({ error: 'فشل حذف الصورة من Cloudinary: ' + (err.message || String(err)) });
  }
}
