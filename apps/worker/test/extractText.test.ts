import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { createTestDb } from '@studyhub/db/testDb';
import { chunks, documents, subjects } from '@studyhub/db';
import { createManifest, resolveDocumentSourcePath, scaffoldSubject } from '@studyhub/core';
import { extractPdfText, processExtractText } from '../src/processors/extractText.js';

async function makeFixturePdf(pageTexts: string[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const text of pageTexts) {
    const page = doc.addPage([300, 300]);
    page.drawText(text, { x: 20, y: 250, size: 12, font });
  }
  return doc.save();
}

describe('extractPdfText (pure)', () => {
  it('extracts text per page from a real PDF', async () => {
    const bytes = await makeFixturePdf(['Prima pagina.', 'Seconda pagina.']);
    const pages = await extractPdfText(bytes);
    expect(pages).toHaveLength(2);
    expect(pages[0]).toEqual({ pageNumber: 1, text: 'Prima pagina.' });
    expect(pages[1]).toEqual({ pageNumber: 2, text: 'Seconda pagina.' });
  });

  it('returns empty text for a blank page rather than throwing', async () => {
    const bytes = await makeFixturePdf(['']);
    const pages = await extractPdfText(bytes);
    expect(pages).toEqual([{ pageNumber: 1, text: '' }]);
  });
});

describe('processExtractText', () => {
  let dataRoot: string;
  let db: Awaited<ReturnType<typeof createTestDb>>;
  let subjectId: string;
  let subjectSlug: string;

  beforeEach(async () => {
    dataRoot = await mkdtemp(join(tmpdir(), 'studyhub-extract-'));
    db = await createTestDb();
    const manifest = createManifest({ name: 'Fisica 1', slug: 'fisica-1', color: 'blue' });
    const folderPath = await scaffoldSubject(dataRoot, manifest);
    subjectId = manifest.id;
    subjectSlug = manifest.slug;
    await db.insert(subjects).values({
      id: subjectId,
      slug: subjectSlug,
      name: manifest.name,
      color: manifest.color,
      folderPath,
    });
  });

  afterEach(async () => {
    await rm(dataRoot, { recursive: true, force: true });
  });

  async function insertPdfDocument(pageTexts: string[]): Promise<string> {
    const bytes = await makeFixturePdf(pageTexts);
    const storedFilename = `${randomUUID()}.pdf`;
    const storedPath = resolveDocumentSourcePath(subjectSlug, 'appunti', storedFilename, dataRoot);
    const { writeFile } = await import('node:fs/promises');
    await writeFile(storedPath, bytes);

    const docId = randomUUID();
    await db.insert(documents).values({
      id: docId,
      subjectId,
      type: 'appunti',
      originalName: 'lezione-01.pdf',
      storedPath,
      mime: 'application/pdf',
      bytes: bytes.byteLength,
      sha256: 'a'.repeat(64),
    });
    return docId;
  }

  it('extracts text, writes content.md, and inserts one chunk per page', async () => {
    const docId = await insertPdfDocument(["L'entropia non diminuisce mai.", 'Seconda pagina.']);

    const result = await processExtractText(db, dataRoot, { documentId: docId });
    expect(result.pages).toBe(2);
    expect(result.chunks).toBe(2);

    const [doc] = await db.select().from(documents).where(eq(documents.id, docId));
    expect(doc?.status).toBe('parsed');
    expect(doc?.pages).toBe(2);
    expect(doc?.mdPath).toBe(result.mdPath);
    expect(doc?.ingestedAt).toBeInstanceOf(Date);

    const md = await readFile(result.mdPath, 'utf-8');
    expect(md).toContain("L'entropia non diminuisce mai.");
    expect(md).toContain('Seconda pagina.');
    expect(md).toContain('## Pagina 1');
    expect(md).toContain('## Pagina 2');

    const origMd = await readFile(join(join(result.mdPath, '..'), 'content.orig.md'), 'utf-8');
    expect(origMd).toBe(md);

    const chunkRows = await db.select().from(chunks).where(eq(chunks.documentId, docId));
    expect(chunkRows).toHaveLength(2);
    expect(chunkRows.find((c) => c.pageFrom === 1)?.text).toBe("L'entropia non diminuisce mai.");
  });

  it('fails loudly (not silently) for a non-PDF mime, and marks the document failed', async () => {
    const docId = randomUUID();
    const storedPath = resolveDocumentSourcePath(
      subjectSlug,
      'appunti',
      `${randomUUID()}.png`,
      dataRoot,
    );
    const { writeFile } = await import('node:fs/promises');
    await writeFile(storedPath, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    await db.insert(documents).values({
      id: docId,
      subjectId,
      type: 'appunti',
      originalName: 'foto.png',
      storedPath,
      mime: 'image/png',
      bytes: 4,
      sha256: 'b'.repeat(64),
    });

    await expect(processExtractText(db, dataRoot, { documentId: docId })).rejects.toThrow(
      /OCR\/vision/,
    );

    const [doc] = await db.select().from(documents).where(eq(documents.id, docId));
    expect(doc?.status).toBe('failed');
  });

  it('throws a clear error for a non-existent document id', async () => {
    await expect(processExtractText(db, dataRoot, { documentId: randomUUID() })).rejects.toThrow(
      /document not found/,
    );
  });

  it('is idempotent: re-running does not duplicate chunks', async () => {
    const docId = await insertPdfDocument(['Unica pagina.']);
    await processExtractText(db, dataRoot, { documentId: docId });
    await processExtractText(db, dataRoot, { documentId: docId });

    const chunkRows = await db.select().from(chunks).where(eq(chunks.documentId, docId));
    expect(chunkRows).toHaveLength(1);
  });
});
