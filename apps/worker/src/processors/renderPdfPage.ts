import { createCanvas } from '@napi-rs/canvas';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';

/**
 * Rasterizes one page of a PDF (already-loaded via `pdfjs-dist`) to a PNG
 * buffer — used to OCR a scanned page that has no text layer (`extractText.ts`).
 * `@napi-rs/canvas`'s 2D context is API-compatible with what pdfjs-dist's
 * `page.render` expects on Node (no `node-canvas`/native X11 dependency).
 */
export async function renderPdfPageToPng(
  pdf: Awaited<ReturnType<(typeof pdfjsLib)['getDocument']>['promise']>,
  pageNumber: number,
  scale = 2,
): Promise<Buffer> {
  const page = await pdf.getPage(pageNumber);
  const viewport = page.getViewport({ scale });
  const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const context = canvas.getContext('2d') as any;
  await page.render({ canvasContext: context, viewport }).promise;
  return canvas.toBuffer('image/png');
}
