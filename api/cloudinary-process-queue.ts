import type { VercelRequest, VercelResponse } from '@vercel/node';
import { authenticateUser, checkIfUserIsAdmin, getServerSupabase } from './utils/auth.js';
import { processCloudinaryDeletionQueue } from './utils/cloudinary-queue.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'طريقة الطلب غير مسموح بها (GET أو POST فقط)' });
  }

  // 1. Authorization: Allow Vercel Cron OR Authenticated Admin
  const authHeader = req.headers.authorization;
  const cronSecret = process.env.CRON_SECRET;
  const isVercelCron =
    (cronSecret && authHeader === `Bearer ${cronSecret}`) ||
    req.headers['x-vercel-cron'] === '1' ||
    req.headers['user-agent'] === 'vercel-cron/1.0';

  if (!isVercelCron) {
    const { user, error: authErr } = await authenticateUser(authHeader);
    if (authErr || !user) {
      return res.status(401).json({ error: 'غير مصرح لك بالوصول. يرجى تسجيل الدخول.' });
    }
    const isAdmin = await checkIfUserIsAdmin(user, authHeader);
    if (!isAdmin) {
      return res.status(403).json({ error: 'صلاحية مسؤول (Admin) مطلوبة لتنفيذ معالجة طابور الحذف.' });
    }
  }

  const client = getServerSupabase();

  // If requesting stats only
  if (req.query.stats === 'true' || req.query.action === 'stats') {
    try {
      const { data: statsData, error: statsErr } = await client.rpc('get_cloudinary_queue_stats');
      if (!statsErr && statsData) {
        return res.status(200).json({ ok: true, stats: statsData });
      }

      // Fallback query if RPC not yet created
      const { data: queueItems } = await client
        .from('cloudinary_deletion_queue')
        .select('status');

      const counts = {
        pending: 0,
        failed: 0,
        completed: 0,
        skipped: 0,
        dead_letter: 0,
        total: 0,
      };

      for (const item of queueItems || []) {
        counts.total++;
        if (item.status in counts) {
          (counts as any)[item.status]++;
        }
      }

      return res.status(200).json({ ok: true, stats: counts });
    } catch (e: any) {
      return res.status(200).json({ ok: true, stats: { pending: 0, failed: 0, completed: 0, skipped: 0, total: 0 } });
    }
  }

  const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit || req.body?.limit || 50), 10)));

  try {
    const result = await processCloudinaryDeletionQueue({ limit, client });
    return res.status(200).json({
      ok: true,
      message: `تمت معالجة ${result.total} مهمة حذف: ${result.deleted} محذوفة، ${result.skipped} تم الاحتفاظ بها (مشتركة)، ${result.failed} فشلت وجُدولت لإعادة المحاولة.`,
      result,
    });
  } catch (err: any) {
    console.error('[cloudinary-process-queue] Processing failed:', err);
    return res.status(500).json({ error: 'فشل معالجة طابور الحذف: ' + (err.message || String(err)) });
  }
}
