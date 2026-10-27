import type { VercelRequest, VercelResponse } from '@vercel/node';
import { v2 as cloudinary } from 'cloudinary';
import { authenticateUser, checkIfUserIsAdmin, getServerSupabase } from './utils/auth.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Allow GET (standard for Cron) and POST (for Admin triggers)
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'طريقة الطلب غير مسموح بها (GET أو POST فقط)' });
  }

  // 1. Authorization: Allow Vercel Cron OR Authenticated Admin
  const authHeader = req.headers.authorization;
  const cronSecret = process.env.CRON_SECRET;
  const isVercelCron = (cronSecret && authHeader === `Bearer ${cronSecret}`) || req.headers['x-vercel-cron'] === '1';

  if (!isVercelCron) {
    const { user, error: authErr } = await authenticateUser(authHeader);
    if (authErr || !user) {
      return res.status(401).json({ error: 'غير مصرح لك بالوصول. يرجى تسجيل الدخول.' });
    }
    const isAdmin = await checkIfUserIsAdmin(user, authHeader);
    if (!isAdmin) {
      return res.status(403).json({ error: 'صلاحية مسؤول (Admin) مطلوبة لتنفيذ التنظيف الدوري.' });
    }
  }

  // 2. Validate Cloudinary configuration
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;

  if (!cloudName || !apiKey || !apiSecret) {
    return res.status(500).json({ error: 'إعدادات Cloudinary غير مكتملة على الخادم.' });
  }

  cloudinary.config({
    cloud_name: cloudName,
    api_key: apiKey,
    api_secret: apiSecret,
    secure: true,
  });

  try {
    // 3. Purge expired posts from Supabase database as well
    try {
      const client = getServerSupabase();
      await client.rpc('delete_expired_posts');
    } catch (dbErr) {
      console.warn('[cloudinary-cleanup] Warning running delete_expired_posts on Supabase:', dbErr);
    }

    // 4. Scan Cloudinary for posts older than 24 hours
    const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;
    const now = Date.now();
    let nextCursor: string | undefined = undefined;
    const expiredPublicIds: string[] = [];

    do {
      const result: any = await cloudinary.api.resources({
        type: 'upload',
        prefix: 'sohba/posts/',
        max_results: 500,
        next_cursor: nextCursor,
      });

      for (const resource of result.resources || []) {
        const resourceCreated = new Date(resource.created_at).getTime();
        // Check if the image was created 24 or more hours ago
        if (now - resourceCreated >= TWENTY_FOUR_HOURS_MS) {
          expiredPublicIds.push(resource.public_id);
        }
      }

      nextCursor = result.next_cursor;
    } while (nextCursor);

    if (expiredPublicIds.length === 0) {
      return res.status(200).json({
        ok: true,
        message: 'لا توجد صور منتهية الصلاحية (> 24 ساعة) في كلاوديناري.',
        deletedCount: 0,
      });
    }

    // 5. Delete expired images in batches of 100 (Cloudinary API limit)
    let totalDeleted = 0;
    for (let i = 0; i < expiredPublicIds.length; i += 100) {
      const batch = expiredPublicIds.slice(i, i + 100);
      await cloudinary.api.delete_resources(batch);
      totalDeleted += batch.length;
    }

    return res.status(200).json({
      ok: true,
      message: `تم تنظيف وحذف ${totalDeleted} صورة منتهية الصلاحية من كلاوديناري بنجاح.`,
      deletedCount: totalDeleted,
    });
  } catch (err: any) {
    console.error('[cloudinary-cleanup] Failed to clean expired images:', err);
    return res.status(500).json({ error: 'فشل في تنظيف صور كلاوديناري: ' + (err.message || String(err)) });
  }
}
