/**
 * Client-side image compression for social posts.
 * Compresses images to at most half (نصف) of their original file size
 * while ensuring maximum visual clarity on mobile and desktop feeds.
 */

async function loadSourceImage(file: File): Promise<{
  width: number;
  height: number;
  draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void;
  close: () => void;
}> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
      return {
        width: bitmap.width,
        height: bitmap.height,
        draw: (ctx, w, h) => ctx.drawImage(bitmap, 0, 0, w, h),
        close: () => bitmap.close(),
      };
    } catch {
      try {
        const bitmap = await createImageBitmap(file);
        return {
          width: bitmap.width,
          height: bitmap.height,
          draw: (ctx, w, h) => ctx.drawImage(bitmap, 0, 0, w, h),
          close: () => bitmap.close(),
        };
      } catch {
        // Fall back to Image element
      }
    }
  }

  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      resolve({
        width: img.naturalWidth || img.width,
        height: img.naturalHeight || img.height,
        draw: (ctx, w, h) => ctx.drawImage(img, 0, 0, w, h),
        close: () => URL.revokeObjectURL(url),
      });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('تعذّر قراءة ملف الصورة'));
    };
    img.src = url;
  });
}

export async function compressPostImage(file: File): Promise<File> {
  const source = await loadSourceImage(file);
  try {
    const MAX_DIMENSION = 1440;
    // Target size is at most half (1/2) of original file size, capped at 500 KB
    const TARGET_MAX_BYTES = Math.min(
      Math.max(40 * 1024, Math.round(file.size / 2)),
      500 * 1024
    );

    const initialScale = Math.min(1, MAX_DIMENSION / Math.max(source.width, source.height));
    let width = Math.max(1, Math.round(source.width * initialScale));
    let height = Math.max(1, Math.round(source.height * initialScale));

    const MAX_ATTEMPTS = 6;
    let bestBlob: Blob | null = null;
    let quality = 0.84;

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Canvas context unavailable');

      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';

      // Solid white background for transparent PNG / WebP images
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, width, height);
      source.draw(ctx, width, height);

      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
          (res) => (res ? resolve(res) : reject(new Error('Image compression failed'))),
          'image/jpeg',
          quality
        );
      });

      if (!bestBlob || blob.size < bestBlob.size) {
        bestBlob = blob;
      }

      // If under target size (<= 1/6 of original size), we are done!
      if (blob.size <= TARGET_MAX_BYTES) {
        break;
      }

      // Next attempt: dynamically scale down based on how much it exceeded the target
      const overshoot = blob.size / TARGET_MAX_BYTES;
      const dimFactor = Math.max(0.75, Math.min(0.9, 1 / Math.sqrt(overshoot)));
      width = Math.max(320, Math.round(width * dimFactor));
      height = Math.max(320, Math.round(height * dimFactor));
      quality = Math.max(0.48, quality - 0.08);
    }

    if (!bestBlob) throw new Error('Compression produced no output');

    const safeName = (file.name ? file.name.replace(/\.[^/.]+$/, '') : 'post_image') + '.jpg';
    return new File([bestBlob], safeName, { type: 'image/jpeg', lastModified: Date.now() });
  } finally {
    source.close();
  }
}
