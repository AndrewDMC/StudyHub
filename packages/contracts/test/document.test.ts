import { describe, expect, it } from 'vitest';
import { AllowedUploadMimeSchema, DocumentTypeSchema } from '../src/document.js';

describe('DocumentTypeSchema', () => {
  it('accepts the 5 known types', () => {
    for (const t of ['appunti', 'schemi', 'esami', 'slide', 'altro']) {
      expect(DocumentTypeSchema.safeParse(t).success).toBe(true);
    }
  });
  it('rejects an unknown type', () => {
    expect(DocumentTypeSchema.safeParse('video').success).toBe(false);
  });
});

describe('AllowedUploadMimeSchema', () => {
  it('accepts pdf and images, rejects everything else', () => {
    expect(AllowedUploadMimeSchema.safeParse('application/pdf').success).toBe(true);
    expect(AllowedUploadMimeSchema.safeParse('application/x-msdownload').success).toBe(false);
  });
});
