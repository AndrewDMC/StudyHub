'use client';

import type { ReactNode } from 'react';
import type { DocumentDto } from '@studyhub/contracts';
import type { DocumentType } from '@studyhub/core/browser';
import { useSelection } from '@/lib/selection';
import { DocumentUploadForm } from './DocumentUploadForm';
import { DocumentList } from './DocumentList';
import { TabEmptyState } from './subject-tabs/TabEmptyState';
import { TabHeader } from './subject-tabs/TabHeader';
import { TabSection } from './subject-tabs/TabSection';
import { TAB_STACK } from './subject-tabs/styles';

interface TabConfig {
  description?: string;
  uploadLabel: string;
  uploadVariant: 'primary' | 'secondary';
  /** Fixed section title (with count); otherwise "{n} documenti". */
  sectionTitle?: string;
  emptyTitle: string;
  emptyText: string;
  note?: string;
}

const TAB_CONFIG: Partial<Record<DocumentType, TabConfig>> = {
  appunti: {
    uploadLabel: 'Carica',
    uploadVariant: 'primary',
    emptyTitle: 'Ancora nessun appunto',
    emptyText: 'Carica gli appunti della materia: PDF, immagini o file Markdown.',
    note: 'Un documento entra in una lezione solo se ha almeno un argomento. Il planner divide le lezioni sulle sue pagine.',
  },
  schemi: {
    description:
      'Schemi del corso: parole chiave e dettagli tecnici, niente frasi. Servono a ritrovare le cose, non a memorizzarle.',
    uploadLabel: 'Carica uno schema',
    uploadVariant: 'secondary',
    emptyTitle: 'Ancora nessuno schema',
    emptyText: 'Carica uno schema del corso: potrai controllarne la trascrizione.',
  },
  esami: {
    uploadLabel: 'Carica un tema',
    uploadVariant: 'secondary',
    sectionTitle: "Temi d'esame",
    emptyTitle: "Ancora nessun tema d'esame",
    emptyText:
      'Carica i temi degli esami passati: servono per lo stile del docente e per le simulazioni.',
  },
  altro: {
    uploadLabel: 'Carica',
    uploadVariant: 'primary',
    emptyTitle: 'Ancora nessun materiale',
    emptyText: 'Carica slide, dispense o altro materiale della materia.',
  },
};

/**
 * A document-type tab (Appunti/Schemi/Esami/Altro): filtered upload + list. When one or more topics
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
  extra?: ReactNode;
}) {
  const { docIds, setDocIds, topicIds } = useSelection();
  const config = TAB_CONFIG[type] ?? TAB_CONFIG.altro!;
  const filtering = topicIds.size > 0;
  const filtered = documents
    .filter((d) => includeTypes.includes(d.type))
    .filter((d) => !filtering || d.topicIds.some((id) => topicIds.has(id)));

  const suffix = filtering ? ' (filtrati per argomento)' : '';
  const sectionTitle = (config.sectionTitle ?? `${filtered.length} documenti`) + suffix;

  return (
    <div className={TAB_STACK}>
      {extra}
      <TabHeader
        {...(config.description ? { description: config.description } : {})}
        actions={
          <DocumentUploadForm
            subjectSlug={subjectSlug}
            defaultType={type}
            label={config.uploadLabel}
            variant={config.uploadVariant}
          />
        }
      />
      <TabSection title={sectionTitle} {...(config.sectionTitle ? { count: filtered.length } : {})}>
        {filtered.length === 0 ? (
          filtering ? (
            <TabEmptyState
              title="Nessun documento"
              text="Nessun documento di questo tipo taggato agli argomenti selezionati."
            />
          ) : (
            <TabEmptyState title={config.emptyTitle} text={config.emptyText} />
          )
        ) : (
          <DocumentList
            subjectSlug={subjectSlug}
            documents={filtered}
            selectedDocIds={docIds}
            onSelectionChange={setDocIds}
          />
        )}
      </TabSection>
      {config.note && <p className="text-[13px] text-fg-secondary">{config.note}</p>}
    </div>
  );
}
