'use client';

import { useEffect, useState } from 'react';
import { Download, ExternalLink } from 'lucide-react';
import { materialFilterForType, materialHref } from '@/lib/subjectTabs';
import { MarkdownFile } from '../DocumentViewerClient';
import { SectionEmpty, SectionError } from '../subject-mobile/SectionState';
import { DocHeader, iconButton } from './DocHeader';
import { DocumentViewSwitch } from './DocumentViewSwitch';
import { OriginalFooter } from './OriginalFooter';
import { useDocument } from './queries';

const PDF_ZOOM = { min: 100, max: 200, step: 25 };
const IMAGE_ZOOM = { min: 1, max: 3, step: 0.5 };

/**
 * Originale: full-screen viewer (the tab bar is hidden via `html[data-fullscreen]`).
 * PDF paging and zoom go through the `#page=&zoom=` fragment of the browser's built-in viewer:
 * iOS Safari ignores those parameters in an iframe and always shows page 1, and the page counter
 * can drift if the user scrolls inside the frame. "Apri in un'altra app" is the escape hatch.
 */
export function OriginalMobile({
  subjectSlug: slug,
  documentId,
}: {
  subjectSlug: string;
  documentId: string;
}) {
  const query = useDocument(slug, documentId);
  const doc = query.data;
  const [page, setPage] = useState(1);
  const [pdfZoom, setPdfZoom] = useState(PDF_ZOOM.min);
  const [imageZoom, setImageZoom] = useState(IMAGE_ZOOM.min);
  const [imageFailed, setImageFailed] = useState(false);

  useEffect(() => {
    document.documentElement.dataset.fullscreen = '';
    return () => {
      delete document.documentElement.dataset.fullscreen;
    };
  }, []);

  const fileUrl = `/api/subjects/${slug}/documents/${documentId}/file`;
  const backHref = materialHref(slug, doc ? materialFilterForType(doc.type) : 'tutti');

  const header = (
    <DocHeader
      backHref={backHref}
      center={
        <DocumentViewSwitch
          slug={slug}
          documentId={documentId}
          active="originale"
          textAvailable={!!doc?.mdPath}
        />
      }
      actions={
        doc && (
          <>
            <a
              href={fileUrl}
              download={doc.originalName}
              aria-label="Scarica"
              className={iconButton}
            >
              <Download className="h-5 w-5" aria-hidden="true" />
            </a>
            <a
              href={fileUrl}
              target="_blank"
              rel="noopener"
              aria-label="Apri in un'altra app"
              className={iconButton}
            >
              <ExternalLink className="h-5 w-5" aria-hidden="true" />
            </a>
          </>
        )
      }
    />
  );

  if (query.isError) {
    return (
      <div className="flex h-full min-w-0 flex-col">
        {header}
        <div className="p-4">
          <SectionError message="Documento non trovato." onRetry={() => query.refetch()} />
        </div>
      </div>
    );
  }

  if (!doc) {
    return (
      <div className="flex h-full min-w-0 flex-col">
        {header}
        <div aria-busy="true" className="flex-1 bg-bg-inset p-4">
          <div aria-hidden="true" className="aspect-[1/1.414] animate-pulse rounded bg-bg-raised" />
        </div>
      </div>
    );
  }

  const isPdf = doc.mime === 'application/pdf';
  const isImage = doc.mime.startsWith('image/');
  const isMarkdown = doc.mime === 'text/markdown';
  const pages = doc.pages;

  return (
    <div className="flex h-full min-w-0 flex-col">
      {header}
      <main className="min-h-0 flex-1 overflow-auto bg-bg-inset p-4">
        {isPdf && (
          <iframe
            key={`${page}-${pdfZoom}`}
            title={doc.originalName}
            src={`${fileUrl}#page=${page}&zoom=${pdfZoom}`}
            className="h-full min-h-[60dvh] w-full rounded border-0 bg-bg-surface"
          />
        )}
        {isImage &&
          (imageFailed ? (
            <p role="alert" className="text-sm text-danger">
              Impossibile caricare il file.
            </p>
          ) : (
            // Plain <img>: local/private document bytes, not an optimizable remote asset.
            <img
              src={fileUrl}
              alt={doc.originalName}
              onError={() => setImageFailed(true)}
              style={{ width: `${imageZoom * 100}%` }}
              className="block h-auto max-w-none"
            />
          ))}
        {isMarkdown && <MarkdownFile url={fileUrl} subjectSlug={slug} />}
        {!isPdf && !isImage && !isMarkdown && (
          <div className="space-y-3">
            <SectionEmpty>Anteprima non disponibile.</SectionEmpty>
            <a
              href={fileUrl}
              download={doc.originalName}
              className="flex min-h-11 items-center justify-center rounded-[var(--radius-control)] border border-border-strong bg-bg-raised text-sm font-medium"
            >
              Scarica
            </a>
          </div>
        )}
      </main>

      {isPdf && (
        <OriginalFooter
          zoomLabel={`${pdfZoom}%`}
          canZoomOut={pdfZoom > PDF_ZOOM.min}
          canZoomIn={pdfZoom < PDF_ZOOM.max}
          onZoomOut={() => setPdfZoom((z) => Math.max(PDF_ZOOM.min, z - PDF_ZOOM.step))}
          onZoomIn={() => setPdfZoom((z) => Math.min(PDF_ZOOM.max, z + PDF_ZOOM.step))}
          pager={
            pages !== null && pages > 0
              ? {
                  page,
                  pages,
                  onPrev: () => setPage((p) => Math.max(1, p - 1)),
                  onNext: () => setPage((p) => Math.min(pages, p + 1)),
                }
              : undefined
          }
        />
      )}
      {isImage && !imageFailed && (
        <OriginalFooter
          zoomLabel={`${imageZoom * 100}%`}
          canZoomOut={imageZoom > IMAGE_ZOOM.min}
          canZoomIn={imageZoom < IMAGE_ZOOM.max}
          onZoomOut={() => setImageZoom((z) => Math.max(IMAGE_ZOOM.min, z - IMAGE_ZOOM.step))}
          onZoomIn={() => setImageZoom((z) => Math.min(IMAGE_ZOOM.max, z + IMAGE_ZOOM.step))}
        />
      )}
    </div>
  );
}
