'use client';

import type { DocumentDto } from '@studyhub/contracts';
import type { DocumentType } from '@studyhub/core/browser';
import { useSelection } from '@/lib/selection';
import { DocumentUploadForm } from './DocumentUploadForm';
import { DocumentList } from './DocumentList';

/**
 * A document-type tab (Appunti/Schemi/Esami): filtered upload + list. When one or more topics
 * are selected in the left tree, the list also filters down to documents tagged to them
 * (docs/fasi/F2-materie.md "Sinistra ... filtro globale della pagina", via `document_topics`).
 * The AI panel lives once at the page level now (see `SubjectDetailClientInner`), not per-tab.
 */
export function DocumentTypeTab({
  subjectSlug,
  type,
  includeTypes = [type],
  documents,
  extra,
}: {
  subjectSlug: string;
  /** The type the upload form starts on. */
  type: DocumentType;
  /** Every type listed in the tab (the "Altro" tab also collects `slide`). */
  includeTypes?: DocumentType[];
  documents: DocumentDto[];
  extra?: React.ReactNode;
}) {
  const { docIds, setDocIds, topicIds } = useSelection();
  const filtered = documents
    .filter((d) => includeTypes.includes(d.type))
    .filter((d) => topicIds.size === 0 || d.topicIds.some((id) => topicIds.has(id)));

  return (
    <div className="min-w-0 space-y-6">
      {extra}
      <section>
        <h2 className="mb-2 text-sm font-medium text-fg-secondary">Carica materiale</h2>
        <DocumentUploadForm subjectSlug={subjectSlug} defaultType={type} />
      </section>
      <section>
        <h2 className="mb-2 text-sm font-medium text-fg-secondary">
          {filtered.length} documenti
          {topicIds.size > 0 && ' (filtrati per argomento)'}
        </h2>
        {filtered.length === 0 ? (
          <div className="rounded-[var(--radius-card)] border border-dashed border-border bg-bg-surface p-8 text-center text-sm text-fg-muted">
            {topicIds.size > 0
              ? 'Nessun documento di questo tipo taggato agli argomenti selezionati.'
              : 'Nessun documento di questo tipo ancora.'}
          </div>
        ) : (
          <DocumentList
            subjectSlug={subjectSlug}
            documents={filtered}
            selectedDocIds={docIds}
            onSelectionChange={setDocIds}
          />
        )}
      </section>
    </div>
  );
}
