import { v2 as cloudinary } from 'cloudinary';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getServerSupabase } from './auth.js';

export interface ProcessQueueResult {
  total: number;
  deleted: number;
  skipped: number;
  failed: number;
  details?: Array<{ id: string; publicId: string; status: string; reason?: string }>;
}

/**
 * Configure Cloudinary SDK with environment variables
 */
export function initCloudinary(): boolean {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;

  if (!cloudName || !apiKey || !apiSecret) {
    return false;
  }

  cloudinary.config({
    cloud_name: cloudName,
    api_key: apiKey,
    api_secret: apiSecret,
    secure: true,
  });

  return true;
}

/**
 * Check if a Cloudinary publicId is still referenced by any active post in public.posts
 * Prevents deleting images that are shared across multiple posts.
 */
export async function isImageReferencedByOtherPosts(
  supabase: SupabaseClient,
  publicId: string,
  excludePostId?: string | null
): Promise<boolean> {
  if (!publicId) return false;

  try {
    // 1. Try querying both image_public_id and image_url
    let query = supabase.from('posts').select('id', { count: 'exact', head: true });
    if (excludePostId) {
      query = query.neq('id', excludePostId);
    }
    query = query.or(`image_public_id.eq.${publicId},image_url.ilike.%${publicId}%`);

    const { count, error } = await query;

    if (!error) {
      return typeof count === 'number' && count > 0;
    }

    // 2. If image_public_id column does not exist yet (code 42703), fallback to checking image_url
    if (error.code === '42703' || error.message?.includes('image_public_id')) {
      let fallbackQuery = supabase
        .from('posts')
        .select('id', { count: 'exact', head: true })
        .ilike('image_url', `%${publicId}%`);

      if (excludePostId) {
        fallbackQuery = fallbackQuery.neq('id', excludePostId);
      }

      const fallbackRes = await fallbackQuery;
      return typeof fallbackRes.count === 'number' && fallbackRes.count > 0;
    }

    console.warn('[cloudinary-queue] Warning checking post image reference:', error);
    // If query fails unexpectedly, return false (don't block deletion permanently unless confirmed conflict)
    return false;
  } catch (err) {
    console.warn('[cloudinary-queue] Error in isImageReferencedByOtherPosts:', err);
    return false;
  }
}

/**
 * Safely delete an image from Cloudinary (idempotent: 'ok' or 'not found' both indicate success)
 */
export async function destroyCloudinaryImage(
  publicId: string
): Promise<{ success: boolean; result: string; error?: string }> {
  if (!initCloudinary()) {
    return { success: false, result: 'missing_credentials', error: 'Cloudinary environment variables missing' };
  }

  try {
    const res = await cloudinary.uploader.destroy(publicId, {
      resource_type: 'image',
      invalidate: true,
    });

    const isOk = res.result === 'ok' || res.result === 'not found';
    return {
      success: isOk,
      result: res.result || 'unknown',
    };
  } catch (err: any) {
    console.error(`[cloudinary-queue] Destroy failed for ${publicId}:`, err);
    return {
      success: false,
      result: 'error',
      error: err.message || String(err),
    };
  }
}

/**
 * Process pending deletion tasks in public.cloudinary_deletion_queue
 */
export async function processCloudinaryDeletionQueue(options?: {
  limit?: number;
  client?: SupabaseClient;
}): Promise<ProcessQueueResult> {
  const limit = options?.limit || 25;
  const client = options?.client || getServerSupabase();

  if (!initCloudinary()) {
    console.error('[cloudinary-queue] Cloudinary credentials missing on server');
    return { total: 0, deleted: 0, skipped: 0, failed: 0 };
  }

  // 1. Fetch pending or retry-eligible items
  const nowIso = new Date().toISOString();
  let queueItems: any[] = [];

  try {
    const { data, error } = await client
      .from('cloudinary_deletion_queue')
      .select('*')
      .in('status', ['pending', 'failed'])
      .lt('attempts', 5)
      .or(`next_retry_at.is.null,next_retry_at.lte.${nowIso}`)
      .order('created_at', { ascending: true })
      .limit(limit);

    if (error) {
      // If table doesn't exist yet, fail gracefully
      if (error.code === '42P01' || error.message?.includes('cloudinary_deletion_queue')) {
        console.warn('[cloudinary-queue] Table cloudinary_deletion_queue does not exist yet.');
        return { total: 0, deleted: 0, skipped: 0, failed: 0 };
      }
      console.error('[cloudinary-queue] Failed to fetch queue items:', error);
      return { total: 0, deleted: 0, skipped: 0, failed: 0 };
    }

    queueItems = data || [];
  } catch (err) {
    console.error('[cloudinary-queue] Exception fetching queue items:', err);
    return { total: 0, deleted: 0, skipped: 0, failed: 0 };
  }

  if (queueItems.length === 0) {
    return { total: 0, deleted: 0, skipped: 0, failed: 0 };
  }

  let deleted = 0;
  let skipped = 0;
  let failed = 0;
  const details: Array<{ id: string; publicId: string; status: string; reason?: string }> = [];

  // 2. Process each queue item
  for (const item of queueItems) {
    const { id, image_public_id, post_id, attempts = 0 } = item;

    // Check if image is still referenced by any other post
    const isShared = await isImageReferencedByOtherPosts(client, image_public_id, post_id);
    if (isShared) {
      await client
        .from('cloudinary_deletion_queue')
        .update({
          status: 'skipped',
          error_message: 'الصورة مستخدمة في منشور آخر؛ تم الاحتفاظ بها بأمان.',
          last_attempt_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', id);

      skipped++;
      details.push({ id, publicId: image_public_id, status: 'skipped', reason: 'shared_post' });
      continue;
    }

    // Attempt deletion from Cloudinary
    const destroyRes = await destroyCloudinaryImage(image_public_id);

    if (destroyRes.success) {
      await client
        .from('cloudinary_deletion_queue')
        .update({
          status: 'completed',
          error_message: null,
          last_attempt_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', id);

      deleted++;
      details.push({ id, publicId: image_public_id, status: 'completed', reason: destroyRes.result });
    } else {
      const nextAttempts = attempts + 1;
      // Exponential backoff: 2^attempts minutes, capped at 60 minutes
      const delayMinutes = Math.min(60, Math.pow(2, nextAttempts));
      const nextRetryAt = new Date(Date.now() + delayMinutes * 60 * 1000).toISOString();
      const newStatus = nextAttempts >= 5 ? 'dead_letter' : 'failed';

      await client
        .from('cloudinary_deletion_queue')
        .update({
          status: newStatus,
          attempts: nextAttempts,
          next_retry_at: nextRetryAt,
          error_message: destroyRes.error || `Deletion failed with result: ${destroyRes.result}`,
          last_attempt_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', id);

      failed++;
      details.push({ id, publicId: image_public_id, status: newStatus, reason: destroyRes.error });
    }
  }

  return {
    total: queueItems.length,
    deleted,
    skipped,
    failed,
    details,
  };
}
