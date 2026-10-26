/**
 * Compress image client-side before uploading.
 * Scales down to max 1280px and applies JPEG compression to keep file size small (~100-250KB)
 * while preserving high visual quality.
 */
export async function compressPostImage(file: File): Promise<File> {
  const bitmap = await createImageBitmap(file);
  try {
    const MAX_DIMENSION = 1280;
    const maxSide = Math.max(bitmap.width, bitmap.height);
    const scale = maxSide > MAX_DIMENSION ? MAX_DIMENSION / maxSide : 1;

    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas context unavailable');

    // Fill white background for transparent images
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(bitmap, 0, 0, width, height);

    // Compress to JPEG with 0.82 quality
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (res) => (res ? resolve(res) : reject(new Error('Image compression failed'))),
        'image/jpeg',
        0.82
      );
    });

    const safeName = file.name.replace(/\.[^/.]+$/, '') + '.jpg';
    return new File([blob], safeName, { type: 'image/jpeg' });
  } finally {
    bitmap.close();
  }
}
