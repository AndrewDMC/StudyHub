// Pure/browser-safe: no node:* imports (see browser.ts). Path resolution
// that touches the filesystem lives in documentPaths.ts instead.

/** docs/02-filesystem-e-dati.md §1 sources/ sub-folders, plus "altro". */
export const DOCUMENT_TYPES = ['appunti', 'schemi', 'esami', 'slide', 'altro'] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

export function isDocumentType(value: string): value is DocumentType {
  return (DOCUMENT_TYPES as readonly string[]).includes(value);
}

/**
 * Upload allowlist for the F1 deterministic slice (docs/fasi/F1-ingest.md
 * "Stato" addendum): PDF is the only type actually parsed today; images are
 * accepted for storage (appunti/schemi are often photos) but not yet
 * processed — that needs OCR/vision, deferred pending an AI provider.
 * Documents already converted to Markdown (.md) skip extraction/OCR entirely.
 */
export const ALLOWED_UPLOAD_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'text/markdown',
] as const;
export type AllowedUploadMime = (typeof ALLOWED_UPLOAD_MIME_TYPES)[number];

const MIME_EXTENSIONS: Record<AllowedUploadMime, string> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'text/markdown': 'md',
};

export function isAllowedUploadMime(value: string): value is AllowedUploadMime {
  return (ALLOWED_UPLOAD_MIME_TYPES as readonly string[]).includes(value);
}

const MARKDOWN_EXTENSION = /\.(md|markdown)$/i;

/**
 * Markdown has no magic bytes, so it is the one type accepted on the strength
 * of the file extension — but only if the content is also valid UTF-8 without
 * NUL bytes (i.e. genuinely text, never a renamed binary).
 */
function looksLikeMarkdown(bytes: Uint8Array, originalName: string): boolean {
  if (!MARKDOWN_EXTENSION.test(originalName)) return false;
  if (bytes.includes(0)) return false;
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return true;
  } catch {
    return false;
  }
}

/**
 * Magic-byte sniffing (docs/01-architettura.md §5: never trust a declared
 * MIME/extension). Returns null if the bytes don't match any allowed type.
 * `originalName` is consulted only for already-converted Markdown documents.
 */
export function sniffUploadMime(bytes: Uint8Array, originalName = ''): AllowedUploadMime | null {
  if (bytes.length >= 5 && bytesStartWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) {
    return 'application/pdf'; // "%PDF-"
  }
  if (bytes.length >= 3 && bytesStartWith(bytes, [0xff, 0xd8, 0xff])) {
    return 'image/jpeg';
  }
  if (
    bytes.length >= 8 &&
    bytesStartWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  ) {
    return 'image/png';
  }
  if (
    bytes.length >= 12 &&
    bytesStartWith(bytes, [0x52, 0x49, 0x46, 0x46]) && // "RIFF"
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50 // "WEBP"
  ) {
    return 'image/webp';
  }
  if (looksLikeMarkdown(bytes, originalName)) {
    return 'text/markdown';
  }
  return null;
}

function bytesStartWith(bytes: Uint8Array, prefix: number[]): boolean {
  return prefix.every((byte, i) => bytes[i] === byte);
}

/** `<uuid>.<ext>` — the original filename is kept only as `original_name` in DB (docs/01 §5). */
export function generateStoredFilename(mime: AllowedUploadMime): string {
  return `${globalThis.crypto.randomUUID()}.${MIME_EXTENSIONS[mime]}`;
}
