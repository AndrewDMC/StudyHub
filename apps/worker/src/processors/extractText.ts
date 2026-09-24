import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import { chunks, documents, subjects } from '@studyhub/db';
import { resolveDocumentDerivedDir } from '@studyhub/core';
import type { ExtractTextJobInput } from '@studyhub/contracts';

export interface ExtractedPage {
  pageNumber: number;
  text: string;
}

/** Pure PDF -> per-page text. No DB/FS access — kept separately testable. */
export async function extractPdfText(pdfBytes: Uint8Array): Promise<ExtractedPage[]> {
  const task = pdfjsLib.getDocument({
    data: pdfBytes,
    isEvalSupported: false,
    useSystemFonts: true,
  });
  const pdf = await task.promise;
  const pages: ExtractedPage[] = [];
  try {
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      const text = content.items
        .map((item) => ('str' in item ? item.str : ''))
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
      pages.push({ pageNumber, text });
    }
  } finally {
    await pdf.destroy();
  }
  return pages;
}

/** Rough token estimate (chars/4) — good enough for progress display, not billing. */
function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

function renderContentMarkdown(originalName: string, pages: ExtractedPage[]): string {
  const sections = pages.map((p) => `## Pagina ${p.pageNumber}\n\n${p.text || '*(pagina vuota)*'}`);
  return [
    `# ${originalName}`,
    '',
    '<!-- Estrazione deterministica del layer testo del PDF (pdfjs-dist). -->',
    '<!-- Non è la pulizia Markdown AI descritta in docs/07-markdown-layer.md: quella richiede -->',
    '<!-- un provider AI e non è ancora collegata (docs/fasi/F1-ingest.md, sezione "Stato"). -->',
    '',
    ...sections,
    '',
  ].join('\n');
}

export interface ExtractTextResult {
  pages: number;
  chunks: number;
  mdPath: string;
}

/**
 * F1 deterministic slice: extracts a text-layer PDF's content into
 * `derived/<docId>/content.md` and one chunk per page. Any other MIME type
 * fails loudly (docs/fasi/F1-ingest.md acceptance: "un ingest fallito [...]
 * mostra l'errore reale") rather than silently doing nothing — OCR/vision
 * need an AI provider that isn't wired in yet.
 */
export async function processExtractText(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  dataRoot: string,
  input: ExtractTextJobInput,
): Promise<ExtractTextResult> {
  const [doc] = await db.select().from(documents).where(eq(documents.id, input.documentId));
  if (!doc) {
    throw new Error(`document not found: ${input.documentId}`);
  }

  const [subject] = await db.select().from(subjects).where(eq(subjects.id, doc.subjectId));
  if (!subject) {
    throw new Error(`subject not found for document ${input.documentId}`);
  }

  await db.update(documents).set({ status: 'parsing' }).where(eq(documents.id, doc.id));

  try {
    if (doc.mime !== 'application/pdf') {
      throw new Error(
        `estrazione testo non supportata per ${doc.mime}: OCR/vision non sono ancora collegati (serve un provider AI)`,
      );
    }

    const pdfBytes = await fs.readFile(doc.storedPath);
    const pages = await extractPdfText(new Uint8Array(pdfBytes));

    const derivedDir = resolveDocumentDerivedDir(subject.slug, doc.id, dataRoot);
    await fs.mkdir(derivedDir, { recursive: true });
    const mdPath = join(derivedDir, 'content.md');
    const markdown = renderContentMarkdown(doc.originalName, pages);
    await fs.writeFile(mdPath, markdown, 'utf-8');
    // First generation is immutable (docs/02-filesystem-e-dati.md §6.1): kept
    // for diffing once an editable content.md exists.
    await fs.writeFile(join(derivedDir, 'content.orig.md'), markdown, 'utf-8');

    await db.delete(chunks).where(eq(chunks.documentId, doc.id));
    if (pages.length > 0) {
      await db.insert(chunks).values(
        pages.map((p, i) => ({
          id: randomUUID(),
          documentId: doc.id,
          pageFrom: p.pageNumber,
          pageTo: p.pageNumber,
          ord: i,
          text: p.text,
          tokens: estimateTokens(p.text),
        })),
      );
    }

    await db
      .update(documents)
      .set({
        status: 'parsed',
        pages: pages.length,
        mdPath,
        ingestedAt: new Date(),
      })
      .where(eq(documents.id, doc.id));

    return { pages: pages.length, chunks: pages.length, mdPath };
  } catch (err) {
    await db.update(documents).set({ status: 'failed' }).where(eq(documents.id, doc.id));
    throw err;
  }
}
