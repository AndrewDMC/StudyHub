'use client';

import Link from 'next/link';
import { FileText, Image as ImageIcon } from 'lucide-react';
import type { DocumentDto } from '@studyhub/contracts';
import {
  documentStatusView,
  documentTypeLabel,
  formatDocDate,
  type DocumentStatusView,
} from '@/lib/documentStatus';
import { StatusPill } from './StatusPill';

const rowClass = 'flex min-h-16 w-full items-center gap-3 px-3.5 py-2.5 text-left';

function metaOf(doc: DocumentDto, view: DocumentStatusView): string {
  const parts = [documentTypeLabel(doc)];
  if (doc.pages !== null) parts.push(`${doc.pages} ${doc.pages === 1 ? 'pagina' : 'pagine'}`);
  parts.push(formatDocDate(doc.createdAt));
  if (view.key === 'verify' && doc.blockedBlocks > 0)
    parts.push(`${doc.blockedBlocks} da verificare`);
  return parts.join(' · ');
}

function Body({ doc, view, meta }: { doc: DocumentDto; view: DocumentStatusView; meta: string }) {
  const Icon = doc.mime.startsWith('image/') ? ImageIcon : FileText;
  return (
    <>
      <span
        aria-hidden="true"
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--radius-control)] bg-bg-raised text-fg-secondary"
      >
        <Icon className="h-5 w-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-medium text-fg-primary">
          {doc.originalName}
        </span>
        <span className="block truncate text-[13px] text-fg-secondary">{meta}</span>
      </span>
      <StatusPill view={view} />
    </>
  );
}

/**
 * One document in the Materiale list: a link to the right screen for its status, or (in selection
 * mode) a checkbox row for ready documents.
 */
export function DocumentRow({
  slug,
  doc,
  selecting,
  selected,
  onToggle,
}: {
  slug: string;
  doc: DocumentDto;
  selecting: boolean;
  selected: boolean;
  onToggle: () => void;
}) {
  const view = documentStatusView(doc);

  if (!selecting) {
    return (
      <Link
        href={view.href(slug)}
        aria-label={`${doc.originalName}, ${view.label}`}
        className={`${rowClass} hover:bg-bg-raised`}
      >
        <Body doc={doc} view={view} meta={metaOf(doc, view)} />
      </Link>
    );
  }

  const ready = doc.status === 'parsed';
  if (!ready) {
    return (
      <div aria-disabled="true" className={`${rowClass} opacity-60`}>
        <Body doc={doc} view={view} meta={`${documentTypeLabel(doc)} · non ancora pronto`} />
      </div>
    );
  }

  return (
    <label className={`${rowClass} cursor-pointer hover:bg-bg-raised`}>
      <input
        type="checkbox"
        checked={selected}
        onChange={onToggle}
        aria-label={`Seleziona ${doc.originalName}`}
        className="h-5 w-5 shrink-0 accent-[var(--accent)] -ml-1 m-3"
      />
      <Body doc={doc} view={view} meta={metaOf(doc, view)} />
    </label>
  );
}
