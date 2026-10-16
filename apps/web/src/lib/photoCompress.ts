import { ATTEMPT_PHOTO_MAX_BYTES } from '@studyhub/core/browser';

export const PHOTO_MAX_SIDE = 2048;
/** Larger files are always re-encoded: the API limit may apply to the base64 form (+33%). */
export const PHOTO_PASSTHROUGH_MAX_BYTES = 3.5 * 1024 * 1024;
export const PHOTO_JPEG_QUALITY = 0.85;

/** True when a file of this size can be uploaded without re-encoding (if also small enough in pixels). */
export function canPassThrough(size: number): boolean {
  return size <= PHOTO_PASSTHROUGH_MAX_BYTES;
}

/** Size scaled down so the long side is at most `maxSide`; never enlarges. */
export function fitWithin(
  width: number,
  height: number,
  maxSide: number = PHOTO_MAX_SIDE,
): { width: number; height: number } {
  const longSide = Math.max(width, height);
  if (longSide <= maxSide) return { width, height };
  const scale = maxSide / longSide;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

export class PhotoCompressError extends Error {}

export const COMPRESS_ERRORS = {
  format: 'Formato non supportato: usa JPEG o PNG.',
  tooBig: 'La foto supera i 5 MB anche dopo la compressione. Prova con una foto più piccola.',
} as const;

const DIRECT_MIMES = ['image/jpeg', 'image/png', 'image/webp'];

/**
 * Downscales (long side 2048 px) and re-encodes as JPEG 0.85 in a canvas before the upload. Also
 * decodes HEIC where the browser can (Safari); otherwise throws `PhotoCompressError`.
 */
export async function compressPhoto(file: File): Promise<File> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    // Not decodable here: a supported small file can still go as it is, the server checks it.
    if (DIRECT_MIMES.includes(file.type) && canPassThrough(file.size)) return file;
    throw new PhotoCompressError(COMPRESS_ERRORS.format);
  }
  try {
    const { width, height } = fitWithin(bitmap.width, bitmap.height);
    const untouched =
      width === bitmap.width &&
      height === bitmap.height &&
      DIRECT_MIMES.includes(file.type) &&
      canPassThrough(file.size);
    if (untouched) return file;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new PhotoCompressError(COMPRESS_ERRORS.format);
    ctx.fillStyle = 'white'; // flattens transparency: JPEG has no alpha
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(bitmap, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', PHOTO_JPEG_QUALITY),
    );
    if (!blob) throw new PhotoCompressError(COMPRESS_ERRORS.format);
    if (blob.size > ATTEMPT_PHOTO_MAX_BYTES) throw new PhotoCompressError(COMPRESS_ERRORS.tooBig);
    const name = file.name.replace(/\.[^.]+$/, '') || 'foto';
    return new File([blob], `${name}.jpg`, { type: 'image/jpeg' });
  } finally {
    bitmap.close();
  }
}
