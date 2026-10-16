'use client';

import { type RefObject } from 'react';
import Link from 'next/link';
import { Download, FileText, Network, Trash2 } from 'lucide-react';
import type { DocumentDto } from '@studyhub/contracts';
import { BottomSheet } from '../subject-mobile/BottomSheet';

const rowClass =
  'flex min-h-14 w-full items-center gap-3 rounded-[var(--radius-control)] px-3 text-left text-[15px] text-fg-primary hover:bg-bg-raised';

/** Kebab of Documento: open the original, download it, or delete the document. */
export function DocumentActionsSheet({
  open,
  onOpenChange,
  slug,
  doc,
  hasGraph,
  onDelete,
  returnFocusRef,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  slug: string;
  doc: DocumentDto;
  /** The document has a schema graph: only then the canvas export makes sense. */
  hasGraph: boolean;
  onDelete: () => void;
  returnFocusRef: RefObject<HTMLElement | null>;
}) {
  return (
    <BottomSheet
      open={open}
      onOpenChange={onOpenChange}
      title="Documento"
      description={doc.originalName}
      returnFocusRef={returnFocusRef}
    >
      <div className="mt-2 flex flex-col">
        <Link href={`/materie/${slug}/documenti/${doc.id}/originale`} className={rowClass}>
          <FileText className="h-5 w-5 text-fg-secondary" aria-hidden="true" />
          Apri l&apos;originale
        </Link>
        <a
          href={`/api/subjects/${slug}/documents/${doc.id}/file`}
          download={doc.originalName}
          className={rowClass}
        >
          <Download className="h-5 w-5 text-fg-secondary" aria-hidden="true" />
          Scarica
        </a>
        {hasGraph && (
          <a
            href={`/api/subjects/${slug}/documents/${doc.id}/schema-graph/canvas`}
            download={`${doc.id}.canvas`}
            className={rowClass}
          >
            <Network className="h-5 w-5 text-fg-secondary" aria-hidden="true" />
            Esporta .canvas
          </a>
        )}
        <button type="button" onClick={onDelete} className={`${rowClass} text-danger`}>
          <Trash2 className="h-5 w-5" aria-hidden="true" />
          Elimina documento
        </button>
      </div>
    </BottomSheet>
  );
}
