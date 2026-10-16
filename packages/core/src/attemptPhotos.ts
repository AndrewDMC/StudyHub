/**
 * Photos of handwritten answers attached to an exam attempt. Magic-byte sniffing, never the
 * declared MIME (docs/01-architettura.md §5). Browser-safe: no node imports.
 */
export const ATTEMPT_PHOTO_MIMES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export const ATTEMPT_PHOTO_MAX_BYTES = 5 * 1024 * 1024;
export const ATTEMPT_PHOTO_MAX_PER_ITEM = 4;
export type AttemptPhotoMime = (typeof ATTEMPT_PHOTO_MIMES)[number];

const EXTENSIONS: Record<AttemptPhotoMime, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

export function attemptPhotoExtension(mime: AttemptPhotoMime): string {
  return EXTENSIONS[mime];
}

export function isAttemptPhotoMime(value: string): value is AttemptPhotoMime {
  return (ATTEMPT_PHOTO_MIMES as readonly string[]).includes(value);
}

function ascii(bytes: Uint8Array, from: number, len: number): string {
  let s = '';
  for (let i = from; i < from + len; i++) s += String.fromCharCode(bytes[i] ?? 0);
  return s;
}

/** Returns the photo MIME type from the file's magic bytes, or `null` if it is not an allowed image. */
export function sniffAttemptPhotoMime(bytes: Uint8Array): AttemptPhotoMime | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    bytes.length >= 8 &&
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((b, i) => bytes[i] === b)
  ) {
    return 'image/png';
  }
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP') {
    return 'image/webp';
  }
  return null;
}
