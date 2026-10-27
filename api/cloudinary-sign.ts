import type { VercelRequest, VercelResponse } from '@vercel/node';
import { v2 as cloudinary } from 'cloudinary';
import { authenticateUser } from './utils/auth.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Only accept POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'طريقة الطلب غير مسموح بها (POST فقط)' });
  }

  // 1. Authenticate user via Supabase
  const authHeader = req.headers.authorization;
  const { user, error: authErr } = await authenticateUser(authHeader);

  if (authErr || !user) {
    return res.status(401).json({ error: authErr || 'غير مصرح لك بالرفع. يرجى تسجيل الدخول.' });
  }

  // 2. Validate Cloudinary configuration
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;

  if (!cloudName || !apiKey || !apiSecret) {
    console.error('[cloudinary-sign] Cloudinary configuration missing');
    return res.status(500).json({
      error: 'إعدادات Cloudinary غير مكتملة على الخادم. تأكد من إضافة CLOUDINARY_CLOUD_NAME و CLOUDINARY_API_KEY و CLOUDINARY_API_SECRET.',
    });
  }

  // Configure cloudinary
  cloudinary.config({
    cloud_name: cloudName,
    api_key: apiKey,
    api_secret: apiSecret,
    secure: true,
  });

  try {
    // 3. Generate secure upload parameters strictly scoped to this user's folder
    const timestamp = Math.floor(Date.now() / 1000);
    const folder = `sohba/posts/${user.id}`;

    const paramsToSign: Record<string, string | number> = {
      folder,
      timestamp,
    };

    const signature = cloudinary.utils.api_sign_request(paramsToSign, apiSecret);

    return res.status(200).json({
      signature,
      timestamp,
      folder,
      apiKey,
      cloudName,
      uploadUrl: `https://api.cloudinary.com/v1_1/${cloudName}/image/upload`,
    });
  } catch (err: any) {
    console.error('[cloudinary-sign] Error generating signature:', err);
    return res.status(500).json({ error: 'فشل في توليد توقيع الرفع الآمن: ' + (err.message || String(err)) });
  }
}
