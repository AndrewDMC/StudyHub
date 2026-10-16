import { describe, expect, it } from 'vitest';
import { isPassing, PASS_RATIO, sniffAttemptPhotoMime } from '../src/index.js';

describe('scoring', () => {
  it('PASS_RATIO is 0.6 and the bar is inclusive', () => {
    expect(PASS_RATIO).toBe(0.6);
    expect(isPassing(0.6)).toBe(true);
    expect(isPassing(0.59)).toBe(false);
    expect(isPassing(1)).toBe(true);
    expect(isPassing(0)).toBe(false);
  });
});

describe('sniffAttemptPhotoMime', () => {
  const heic = new Uint8Array([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63, 0, 0]);
  it('recognizes jpeg, png and webp by magic bytes', () => {
    expect(sniffAttemptPhotoMime(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
    expect(
      sniffAttemptPhotoMime(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
    ).toBe('image/png');
    const webp = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);
    expect(sniffAttemptPhotoMime(webp)).toBe('image/webp');
  });
  it('rejects heic, pdf and arbitrary bytes', () => {
    expect(sniffAttemptPhotoMime(heic)).toBeNull();
    expect(sniffAttemptPhotoMime(new TextEncoder().encode('%PDF-1.4 hello'))).toBeNull();
    expect(sniffAttemptPhotoMime(new Uint8Array([1, 2, 3]))).toBeNull();
  });
});
