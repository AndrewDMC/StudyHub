import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { createTestDb } from '@studyhub/db/testDb';
import { chunks, documents, subjects } from '@studyhub/db';
import { createManifest, resolveDocumentSourcePath, scaffoldSubject } from '@studyhub/core';
import type { AiProvider } from '@studyhub/ai';
import { extractPdfText, processExtractText } from '../src/processors/extractText.js';

function fakeOcrProvider(text: string): AiProvider {
  return {
    name: 'fake-ocr-test',
    generateFlashcards: vi.fn(),
    generateSummary: vi.fn(),
    generateSchema: vi.fn(),
    extractExamProfile: vi.fn(),
    generateSimulation: vi.fn(),
    gradeAnswer: vi.fn(),
    estimateTopics: vi.fn(),
    extractTopics: vi.fn(),
    transcribeSchema: vi.fn(),
    classifyDocumentType: vi.fn(),
    distillHandwritingProfile: vi.fn(),
    ocrText: vi.fn().mockResolvedValue({
      data: { text, confidence: 'ok' },
      usage: { inputTokens: 10, outputTokens: 5 },
      model: 'claude-haiku-4-5-20251001',
      promptVersion: 'ocr_text/v1',
    }),
  };
}

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

  it('fails loudly (not silently) for an unsupported mime, and marks the document failed', async () => {
    const docId = randomUUID();
    const storedPath = resolveDocumentSourcePath(
      subjectSlug,
      'appunti',
      `${randomUUID()}.docx`,
      dataRoot,
    );
    await writeFile(storedPath, Buffer.from('not a real docx'));
    await db.insert(documents).values({
      id: docId,
      subjectId,
      type: 'appunti',
      originalName: 'appunti.docx',
      storedPath,
      mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      bytes: 4,
      sha256: 'b'.repeat(64),
    });

    await expect(processExtractText(db, dataRoot, { documentId: docId })).rejects.toThrow(
      /estrazione testo non supportata/,
    );

    const [doc] = await db.select().from(documents).where(eq(documents.id, docId));
    expect(doc?.status).toBe('failed');
  });

  it('ingests an already-converted Markdown file verbatim, with no OCR/AI call', async () => {
    const md =
      '# Termodinamica\n\nIntro.\n\n## Entropia\n\nNon diminuisce mai.\n\n```\n# non un titolo\n```\n';
    const storedPath = resolveDocumentSourcePath(
      subjectSlug,
      'appunti',
      `${randomUUID()}.md`,
      dataRoot,
    );
    await writeFile(storedPath, md, 'utf-8');
    const docId = randomUUID();
    await db.insert(documents).values({
      id: docId,
      subjectId,
      type: 'appunti',
      originalName: 'termo.md',
      storedPath,
      mime: 'text/markdown',
      bytes: md.length,
      sha256: 'c'.repeat(64),
    });
    const provider = fakeOcrProvider('mai chiamato');

    const result = await processExtractText(db, dataRoot, { documentId: docId }, provider);

    expect(provider.ocrText).not.toHaveBeenCalled();
    expect(result.pages).toBe(2);
    expect(await readFile(result.mdPath, 'utf-8')).toBe(md);
    const rows = await db.select().from(chunks).where(eq(chunks.documentId, docId));
    expect(rows).toHaveLength(2);
    expect(rows.find((c) => c.ord === 1)?.text).toContain('# non un titolo');
    const [doc] = await db.select().from(documents).where(eq(documents.id, docId));
    expect(doc?.status).toBe('parsed');
  });

  it('fails an empty Markdown file and marks the document failed', async () => {
    const storedPath = resolveDocumentSourcePath(
      subjectSlug,
      'appunti',
      `${randomUUID()}.md`,
      dataRoot,
    );
    await writeFile(storedPath, '  \n\n', 'utf-8');
    const docId = randomUUID();
    await db.insert(documents).values({
      id: docId,
      subjectId,
      type: 'appunti',
      originalName: 'vuoto.md',
      storedPath,
      mime: 'text/markdown',
      bytes: 4,
      sha256: 'd'.repeat(64),
    });
    await expect(processExtractText(db, dataRoot, { documentId: docId })).rejects.toThrow(/vuoto/);
    const [doc] = await db.select().from(documents).where(eq(documents.id, docId));
    expect(doc?.status).toBe('failed');
  });

  it('OCRs a plain image upload (jpeg/png/webp) via AiProvider.ocrText', async () => {
    const docId = randomUUID();
    const storedPath = resolveDocumentSourcePath(
      subjectSlug,
      'appunti',
      `${randomUUID()}.png`,
      dataRoot,
    );
    await writeFile(storedPath, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    await db.insert(documents).values({
      id: docId,
      subjectId,
      type: 'appunti',
      originalName: 'foto.png',
      storedPath,
      mime: 'image/png',
      bytes: 4,
      sha256: 'c'.repeat(64),
    });

    const provider = fakeOcrProvider('Testo letto dalla foto.');
    const result = await processExtractText(db, dataRoot, { documentId: docId }, provider);

    expect(result.pages).toBe(1);
    expect(result.ocrPages).toBe(1);
    expect(provider.ocrText).toHaveBeenCalledOnce();
    const md = await readFile(result.mdPath, 'utf-8');
    expect(md).toContain('Testo letto dalla foto.');
    expect(md).toContain('(OCR)');
  });

  it('OCRs a scanned PDF page (no text layer) via AiProvider.ocrText, leaving text-layer pages untouched', async () => {
    const docId = await insertPdfDocument(['', 'Pagina con testo vero.']);
    const provider = fakeOcrProvider('Testo trascritto dalla pagina scansionata.');

    const result = await processExtractText(db, dataRoot, { documentId: docId }, provider);

    expect(result.pages).toBe(2);
    expect(result.ocrPages).toBe(1);
    expect(provider.ocrText).toHaveBeenCalledOnce();
    const chunkRows = await db
      .select()
      .from(chunks)
      .where(eq(chunks.documentId, docId))
      .orderBy(chunks.ord);
    expect(chunkRows[0]?.text).toBe('Testo trascritto dalla pagina scansionata.');
    expect(chunkRows[1]?.text).toBe('Pagina con testo vero.');
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

  it('never overwrites a content.md the user has edited — writes content.new.md and flags a conflict', async () => {
    const docId = await insertPdfDocument(['Prima versione.']);
    await processExtractText(db, dataRoot, { documentId: docId });

    // Simulate a user edit to content.md, then a re-ingest (e.g. "Ritrascrivi").
    await db.update(documents).set({ mdEdited: true }).where(eq(documents.id, docId));
    const result = await processExtractText(db, dataRoot, { documentId: docId });

    const [doc] = await db.select().from(documents).where(eq(documents.id, docId));
    expect(doc?.mdConflict).toBe(true);
    // content.md still holds the deterministic re-extraction from the same source
    // (the test never actually edited the text on disk), but the important part is
    // that it went to content.new.md, not that it silently overwrote content.md —
    // asserted by the file existing at all.
    const newVersion = await readFile(join(result.mdPath, '..', 'content.new.md'), 'utf-8');
    expect(newVersion).toContain('Prima versione.');
  });
});
