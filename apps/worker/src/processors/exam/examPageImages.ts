import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { eq, inArray } from 'drizzle-orm';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import { documents } from '@studyhub/db';
import { resolveDocumentDerivedDir } from '@studyhub/core';
import { renderPdfPageToPng } from '../renderPdfPage.js';

/** Caps keep the opt-in multimodal call bounded: every image is billed as input tokens. */
export const MAX_PAGES_PER_EXAM = 8;
export const MAX_PAGES_TOTAL = 24;
const RENDER_SCALE = 1.5;

export interface ExamPageImage {
  path: string;
  mime: string;
  label: string;
}

/**
 * Pages of the given past-exam documents as images, for the multimodal profile extraction
 * (docs/fasi/F5 "Rischi": figures/graphs are lost by text extraction). PDFs are rasterized once
 * into `derived/<docId>/exam_pages/` and reused on later runs; a photo/scan document is its own
 * image. The first `MAX_PAGES_PER_EXAM` pages of each exam are used, `MAX_PAGES_TOTAL` overall.
 */
export async function collectExamPageImages(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  dataRoot: string,
  subjectSlug: string,
  docIds: string[],
): Promise<ExamPageImage[]> {
  const docs: {
    id: string;
    originalName: string;
    mime: string;
    storedPath: string;
  }[] = await db
    .select({
      id: documents.id,
      originalName: documents.originalName,
      mime: documents.mime,
      storedPath: documents.storedPath,
    })
    .from(documents)
    .where(inArray(documents.id, docIds));
  docs.sort((a, b) => docIds.indexOf(a.id) - docIds.indexOf(b.id));

  const out: ExamPageImage[] = [];
  for (const doc of docs) {
    if (out.length >= MAX_PAGES_TOTAL) break;
    const room = Math.min(MAX_PAGES_PER_EXAM, MAX_PAGES_TOTAL - out.length);

    if (doc.mime.startsWith('image/')) {
      out.push({ path: doc.storedPath, mime: doc.mime, label: doc.originalName });
      continue;
    }
    if (doc.mime !== 'application/pdf') continue;

    const dir = join(resolveDocumentDerivedDir(subjectSlug, doc.id, dataRoot), 'exam_pages');
    await fs.mkdir(dir, { recursive: true });
    const bytes = new Uint8Array(await fs.readFile(doc.storedPath));
    const pdf = await pdfjsLib.getDocument({
      data: bytes,
      isEvalSupported: false,
      useSystemFonts: true,
    }).promise;
    try {
      const last = Math.min(pdf.numPages, room);
      for (let n = 1; n <= last; n += 1) {
        const path = join(dir, `p${n}.png`);
        const cached = await fs
          .stat(path)
          .then((s) => s.size > 0)
          .catch(() => false);
        if (!cached) await fs.writeFile(path, await renderPdfPageToPng(pdf, n, RENDER_SCALE));
        out.push({ path, mime: 'image/png', label: `${doc.originalName} · p. ${n}` });
      }
    } finally {
      await pdf.destroy();
    }
  }
  return out;
}
