import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import { chunks, documents, subjects } from '@studyhub/db';
import { resolveDocumentDerivedDir } from '@studyhub/core';
import { resolveProvider, type AiProvider } from '@studyhub/ai';
import type { ExtractTextJobInput } from '@studyhub/contracts';
import { processEmbedChunks } from './embedChunks.js';
import { renderPdfPageToPng } from './renderPdfPage.js';
import { splitMarkdownSections } from './splitMarkdown.js';
import { writeCanonicalMarkdown } from './writeCanonicalMarkdown.js';

const MODEL_ROUTING_OCR = 'claude-haiku-4-5-20251001'; // plain text reading, cheap model is enough

const IMAGE_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp']);

export interface ExtractedPage {
  pageNumber: number;
  text: string;
  ocr?: boolean;
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

/**
 * OCRs every page pdfjs found no text layer for (a scanned PDF) via
 * `AiProvider.ocrText` — renders each such page to a PNG first
 * (`renderPdfPage.ts`, since the provider needs a real image file), OCRs it,
 * and fills the page's text in place. Pages that already have a text layer
 * are left untouched (no AI call, no cost).
 */
async function ocrScannedPages(
  pdfBytes: Uint8Array,
  pages: ExtractedPage[],
  provider: AiProvider,
  model: string,
): Promise<ExtractedPage[]> {
  const scannedPages = pages.filter((p) => !p.text.trim());
  if (scannedPages.length === 0) return pages;

  const task = pdfjsLib.getDocument({
    data: pdfBytes,
    isEvalSupported: false,
    useSystemFonts: true,
  });
  const pdf = await task.promise;
  const results = new Map<number, ExtractedPage>();
  try {
    for (const page of scannedPages) {
      const png = await renderPdfPageToPng(pdf, page.pageNumber);
      const tmpPath = join(tmpdir(), `studyhub-ocr-${randomUUID()}.png`);
      await fs.writeFile(tmpPath, png);
      try {
        const result = await provider.ocrText({ imagePath: tmpPath, mime: 'image/png' }, model);
        results.set(page.pageNumber, { ...page, text: result.data.text, ocr: true });
      } finally {
        await fs.rm(tmpPath, { force: true });
      }
    }
  } finally {
    await pdf.destroy();
  }

  return pages.map((p) => results.get(p.pageNumber) ?? p);
}

/** Rough token estimate (chars/4) — good enough for progress display, not billing. */
function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

function renderContentMarkdown(originalName: string, pages: ExtractedPage[]): string {
  const sections = pages.map((p) => {
    const note = p.ocr ? ' *(OCR)*' : '';
    return `## Pagina ${p.pageNumber}${note}\n\n${p.text || '*(pagina vuota)*'}`;
  });
  return [
    `# ${originalName}`,
    '',
    '<!-- Estrazione deterministica del layer testo del PDF (pdfjs-dist), con OCR (AiProvider.ocrText) -->',
    '<!-- per le pagine senza layer testo. Non è la pulizia Markdown AI completa descritta in -->',
    '<!-- docs/07-markdown-layer.md (quella normalizza in modo più ricco, non solo per-pagina). -->',
    '',
    ...sections,
    '',
  ].join('\n');
}

export interface ExtractTextResult {
  pages: number;
  chunks: number;
  mdPath: string;
  embedded: number;
  ocrPages: number;
}

/**
 * F1 slice: extracts a PDF's content into `derived/<docId>/content.md` and
 * one chunk per page — from the text layer where there is one, via
 * `AiProvider.ocrText` (vision) for scanned pages and for plain image
 * uploads (jpeg/png/webp). Any other MIME type still fails loudly
 * (docs/fasi/F1-ingest.md acceptance: "un ingest fallito [...] mostra
 * l'errore reale") rather than silently doing nothing.
 */
export async function processExtractText(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  dataRoot: string,
  input: ExtractTextJobInput,
  provider: AiProvider = resolveProvider(),
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
    let pages: ExtractedPage[];
    // Already-converted Markdown is used verbatim as content.md: no extraction,
    // no OCR, no AI cost. "Pages" are the heading-based sections (chunks).
    let markdownOverride: string | undefined;

    if (doc.mime === 'text/markdown') {
      const decoded = await fs.readFile(doc.storedPath, 'utf-8');
      const raw = decoded.charCodeAt(0) === 0xfeff ? decoded.slice(1) : decoded; // strip BOM
      const sections = splitMarkdownSections(raw);
      if (sections.length === 0) {
        throw new Error('il file Markdown è vuoto');
      }
      pages = sections.map((text, i) => ({ pageNumber: i + 1, text }));
      markdownOverride = raw.endsWith('\n') ? raw : `${raw}\n`;
    } else if (doc.mime === 'application/pdf') {
      const pdfBytes = await fs.readFile(doc.storedPath);
      const extracted = await extractPdfText(new Uint8Array(pdfBytes));
      pages = await ocrScannedPages(
        new Uint8Array(pdfBytes),
        extracted,
        provider,
        MODEL_ROUTING_OCR,
      );
    } else if (IMAGE_MIMES.has(doc.mime)) {
      const result = await provider.ocrText(
        { imagePath: doc.storedPath, mime: doc.mime },
        MODEL_ROUTING_OCR,
      );
      pages = [{ pageNumber: 1, text: result.data.text, ocr: true }];
    } else {
      throw new Error(
        `estrazione testo non supportata per ${doc.mime}: solo PDF, immagini (jpeg/png/webp) e Markdown`,
      );
    }

    const derivedDir = resolveDocumentDerivedDir(subject.slug, doc.id, dataRoot);
    const markdown = markdownOverride ?? renderContentMarkdown(doc.originalName, pages);
    const { mdPath } = await writeCanonicalMarkdown(db, doc, derivedDir, markdown);

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

    // In-process, not a separate queued job: embedding depends on the chunks
    // just written above, so calling it directly avoids a race with a
    // second BullMQ job over the ordering. `embed_chunks` still exists as
    // its own dispatchable job type (packages/contracts/src/job.ts) for a
    // manual re-embed (e.g. after swapping the embedding model).
    const { embedded } = await processEmbedChunks(db, { documentId: doc.id });

    return {
      pages: pages.length,
      chunks: pages.length,
      mdPath,
      embedded,
      ocrPages: pages.filter((p) => p.ocr).length,
    };
  } catch (err) {
    await db.update(documents).set({ status: 'failed' }).where(eq(documents.id, doc.id));
    throw err;
  }
}
