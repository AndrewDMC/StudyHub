'use client';

import Link from 'next/link';
import type { DocumentDto } from '@studyhub/contracts';

const linkButton =
  'inline-flex min-h-11 items-center justify-center rounded-[var(--radius-control)] border border-border-strong bg-bg-raised px-4 text-sm font-medium';

/** Stands in for the text and the CTAs when the document has no extracted text to show. */
export function DocumentStatusPanel({
  slug,
  doc,
  onDelete,
}: {
  slug: string;
  doc: DocumentDto;
  onDelete: () => void;
}) {
  const originalLink = (
    <Link href={`/materie/${slug}/documenti/${doc.id}/originale`} className={linkButton}>
      Vedi l&apos;originale
    </Link>
  );
  const deleteButton = (
    <button
      type="button"
      onClick={onDelete}
      className="inline-flex min-h-11 items-center justify-center rounded-[var(--radius-control)] border border-danger px-4 text-sm font-medium text-danger"
    >
      Elimina
    </button>
  );
  const box = 'rounded-[var(--radius-card)] border border-border bg-bg-surface p-4 text-sm';

  if (doc.status === 'uploaded')
    return (
      <div role="status" className={box}>
        In coda per l&apos;estrazione.
      </div>
    );
  if (doc.status === 'parsing')
    return (
      <div role="status" aria-busy="true" className={box}>
        Estrazione in corso…
      </div>
    );
  if (doc.status === 'failed')
    return (
      <div role="alert" className={box}>
        <p className="text-danger">Estrazione non riuscita.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {originalLink}
          {deleteButton}
        </div>
      </div>
    );
  if (doc.status === 'missing')
    return (
      <div role="alert" className={box}>
        <p className="text-danger">File non trovato nella cartella dati.</p>
        <div className="mt-3 flex flex-wrap gap-2">{deleteButton}</div>
      </div>
    );

  // parsed, but nothing extracted (typical for schemas and past exams)
  return (
    <div className={box}>
      <p className="text-fg-secondary">Nessun testo estratto per questo documento.</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {originalLink}
        {doc.type === 'schemi' && (
          <Link href={`/materie/${slug}/documenti/${doc.id}/verifica`} className={linkButton}>
            Verifica trascrizione
          </Link>
        )}
      </div>
    </div>
  );
}
