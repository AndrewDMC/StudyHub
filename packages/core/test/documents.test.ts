import { describe, expect, it } from 'vitest';
import {
  generateStoredFilename,
  isAllowedUploadMime,
  isDocumentType,
  sniffUploadMime,
} from '../src/documents.js';

describe('isDocumentType', () => {
  it('accepts the 5 known types', () => {
    for (const t of ['appunti', 'schemi', 'esami', 'slide', 'altro']) {
      expect(isDocumentType(t)).toBe(true);
    }
  });
  it('rejects anything else', () => {
    expect(isDocumentType('video')).toBe(false);
  });
});

describe('isAllowedUploadMime', () => {
  it('accepts pdf and the 3 image types', () => {
    expect(isAllowedUploadMime('application/pdf')).toBe(true);
    expect(isAllowedUploadMime('image/jpeg')).toBe(true);
    expect(isAllowedUploadMime('image/png')).toBe(true);
    expect(isAllowedUploadMime('image/webp')).toBe(true);
  });
  it('rejects an executable or script MIME type', () => {
    expect(isAllowedUploadMime('application/x-msdownload')).toBe(false);
    expect(isAllowedUploadMime('text/html')).toBe(false);
  });
});

describe('sniffUploadMime — never trust the declared MIME/extension', () => {
  it('recognizes a PDF by its %PDF- signature', () => {
    const bytes = new TextEncoder().encode('%PDF-1.7\n...');
    expect(sniffUploadMime(bytes)).toBe('application/pdf');
  });

  it('recognizes JPEG/PNG/WEBP by magic bytes', () => {
    expect(sniffUploadMime(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
    expect(
      sniffUploadMime(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0])),
    ).toBe('image/png');
    const webp = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);
    expect(sniffUploadMime(webp)).toBe('image/webp');
  });

  it('returns null for a disguised executable (.pdf name, EXE bytes)', () => {
    const exeBytes = new Uint8Array([0x4d, 0x5a, 0x90, 0x00]); // "MZ" DOS header
    expect(sniffUploadMime(exeBytes)).toBeNull();
  });

  it('returns null for an empty buffer', () => {
    expect(sniffUploadMime(new Uint8Array())).toBeNull();
  });
});

describe('generateStoredFilename', () => {
  it('produces a uuid with the correct extension per MIME type', () => {
    expect(generateStoredFilename('application/pdf')).toMatch(/^[0-9a-f-]{36}\.pdf$/);
    expect(generateStoredFilename('image/jpeg')).toMatch(/^[0-9a-f-]{36}\.jpg$/);
  });

  it('never reuses the original filename (privacy/path-safety, docs/01 §5)', () => {
    const a = generateStoredFilename('application/pdf');
    const b = generateStoredFilename('application/pdf');
    expect(a).not.toBe(b);
  });
});

describe('sniffUploadMime — Markdown', () => {
  const enc = (t: string) => new TextEncoder().encode(t);

  it('accepts valid UTF-8 text with a .md / .markdown extension', () => {
    expect(sniffUploadMime(enc('# Titolo\n\ntesto àèì'), 'note.md')).toBe('text/markdown');
    expect(sniffUploadMime(enc('# Titolo'), 'NOTE.MARKDOWN')).toBe('text/markdown');
  });

  it('rejects text without a markdown extension', () => {
    expect(sniffUploadMime(enc('# Titolo'), 'note.txt')).toBeNull();
    expect(sniffUploadMime(enc('# Titolo'))).toBeNull();
  });

  it('rejects a binary renamed to .md (NUL bytes or invalid UTF-8)', () => {
    expect(sniffUploadMime(new Uint8Array([0x4d, 0x5a, 0x90, 0x00]), 'x.md')).toBeNull();
    expect(sniffUploadMime(new Uint8Array([0xc3, 0x28]), 'x.md')).toBeNull();
  });

  it('is an allowed upload mime and gets a .md stored name', () => {
    expect(isAllowedUploadMime('text/markdown')).toBe(true);
    expect(generateStoredFilename('text/markdown')).toMatch(/\.md$/);
  });
});
