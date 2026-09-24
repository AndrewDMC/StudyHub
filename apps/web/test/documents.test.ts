import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTestDb } from '@studyhub/db/testDb';
import { createSubject } from '../src/lib/subjects';
import { listDocuments, uploadDocument, UploadError } from '../src/lib/documents';

const PDF_BYTES = new TextEncoder().encode('%PDF-1.7\n%%mock pdf for upload tests%%');
const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

describe('uploadDocument', () => {
  let dataRoot: string;
  let db: Awaited<ReturnType<typeof createTestDb>>;
  let subjectSlug: string;

  beforeEach(async () => {
    dataRoot = await mkdtemp(join(tmpdir(), 'studyhub-upload-'));
    db = await createTestDb();
    const subject = await createSubject(db, dataRoot, { name: 'Fisica 1', color: 'blue' });
    subjectSlug = subject.slug;
  });

  afterEach(async () => {
    await rm(dataRoot, { recursive: true, force: true });
  });

  it('stores the file under sources/<type>/ and indexes it', async () => {
    const result = await uploadDocument(db, dataRoot, subjectSlug, {
      type: 'appunti',
      originalName: 'lezione-01.pdf',
      bytes: PDF_BYTES,
    });

    expect(result.duplicate).toBe(false);
    expect(result.document.mime).toBe('application/pdf');
    expect(result.document.status).toBe('uploaded');

    const stored = join(dataRoot, 'subjects', subjectSlug, 'sources', 'appunti');
    const files = await (await import('node:fs/promises')).readdir(stored);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/\.pdf$/);

    const s = await stat(join(stored, files[0]!));
    expect(s.size).toBe(PDF_BYTES.byteLength);
  });

  it('never trusts a declared extension: sniffs real bytes and rejects unknown formats', async () => {
    await expect(
      uploadDocument(db, dataRoot, subjectSlug, {
        type: 'appunti',
        originalName: 'totally-a-pdf.pdf',
        bytes: new TextEncoder().encode('not actually a pdf'),
      }),
    ).rejects.toMatchObject({ code: 'unsupported_file_type' });
  });

  it('rejects an empty file', async () => {
    await expect(
      uploadDocument(db, dataRoot, subjectSlug, {
        type: 'appunti',
        originalName: 'x.pdf',
        bytes: new Uint8Array(),
      }),
    ).rejects.toMatchObject({ code: 'empty_file' });
  });

  it('rejects upload to a non-existent subject', async () => {
    await expect(
      uploadDocument(db, dataRoot, 'does-not-exist', {
        type: 'appunti',
        originalName: 'x.pdf',
        bytes: PDF_BYTES,
      }),
    ).rejects.toMatchObject({ code: 'subject_not_found' });
  });

  it('dedups by sha256 within the same subject: second upload is a no-op', async () => {
    const first = await uploadDocument(db, dataRoot, subjectSlug, {
      type: 'appunti',
      originalName: 'a.pdf',
      bytes: PDF_BYTES,
    });
    const second = await uploadDocument(db, dataRoot, subjectSlug, {
      type: 'slide', // even with a different declared type/name, same bytes = same doc
      originalName: 'a-copy.pdf',
      bytes: PDF_BYTES,
    });

    expect(second.duplicate).toBe(true);
    expect(second.document.id).toBe(first.document.id);

    const docs = await listDocuments(db, subjectSlug);
    expect(docs).toHaveLength(1);
  });

  it('accepts PNG images (stored, not yet parsed — see extract_text)', async () => {
    const result = await uploadDocument(db, dataRoot, subjectSlug, {
      type: 'schemi',
      originalName: 'foto.png',
      bytes: PNG_BYTES,
    });
    expect(result.document.mime).toBe('image/png');
  });
});

describe('listDocuments', () => {
  it('throws UploadError for an unknown subject', async () => {
    const db = await createTestDb();
    await expect(listDocuments(db, 'nope')).rejects.toBeInstanceOf(UploadError);
  });

  it('returns an empty list for a subject with no documents yet', async () => {
    const dataRoot = await mkdtemp(join(tmpdir(), 'studyhub-upload-empty-'));
    try {
      const db = await createTestDb();
      const subject = await createSubject(db, dataRoot, { name: 'Chimica', color: 'green' });
      expect(await listDocuments(db, subject.slug)).toEqual([]);
    } finally {
      await rm(dataRoot, { recursive: true, force: true });
    }
  });
});
