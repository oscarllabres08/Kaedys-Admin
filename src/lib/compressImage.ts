export type ImageCompressOptions = {
  maxWidth: number;
  maxHeight: number;
  maxBytes: number;
  quality?: number;
  /** Re-encode to WebP even when already under maxBytes (saves Supabase storage). */
  force?: boolean;
};

/**
 * Client-side resize + WebP encode for uploads. Falls back to original file on failure.
 */
export async function compressImageBeforeUpload(file: File, opts: ImageCompressOptions): Promise<File> {
  if (!file.type.startsWith('image/')) return file;
  if (!opts.force && file.size <= opts.maxBytes) return file;

  const qualityStart = opts.quality ?? 0.82;
  const qualities = [qualityStart, 0.72, 0.62, 0.52, 0.42];
  const objectUrl = URL.createObjectURL(file);

  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = reject;
      el.src = objectUrl;
    });

    const ratio = Math.min(opts.maxWidth / img.width, opts.maxHeight / img.height, 1);
    const targetW = Math.max(1, Math.round(img.width * ratio));
    const targetH = Math.max(1, Math.round(img.height * ratio));

    const canvas = document.createElement('canvas');
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;
    ctx.drawImage(img, 0, 0, targetW, targetH);

    let bestBlob: Blob | null = null;
    for (const q of qualities) {
      const blob = await new Promise<Blob | null>((resolve) => {
        canvas.toBlob((b) => resolve(b), 'image/webp', q);
      });
      if (!blob) continue;
      if (!bestBlob || blob.size < bestBlob.size) bestBlob = blob;
      if (blob.size <= opts.maxBytes) {
        bestBlob = blob;
        break;
      }
    }

    if (!bestBlob) return file;

    const safeBaseName = file.name.replace(/\.[^.]+$/, '');
    if (opts.force) {
      return new File([bestBlob], `${safeBaseName}.webp`, {
        type: 'image/webp',
        lastModified: Date.now(),
      });
    }
    if (bestBlob.size >= file.size) return file;

    return new File([bestBlob], `${safeBaseName}.webp`, {
      type: 'image/webp',
      lastModified: Date.now(),
    });
  } catch {
    return file;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
