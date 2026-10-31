'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { DocumentDto, TopicDto } from '@studyhub/contracts';
import { DeleteDocumentButton } from '@/components/DeleteDocumentButton';
import { StatusBadge } from '@/components/subject-tabs/StatusBadge';
import { CARD_BOX, FOCUS, LINK_TEXT } from '@/components/subject-tabs/styles';
import {
  DOC_STATUS,
  DOC_TYPE_LABELS,
  docExt,
  formatBytes,
} from '@/components/subject-tabs/documentMeta';

// One column (topics under the name, actions wrapping) until the tab container is wide enough.
const GRID =
  'grid grid-cols-1 items-start gap-x-4 gap-y-2 @3xl/tab:grid-cols-[minmax(200px,1fr)_minmax(150px,0.7fr)_auto]';
const OUTLINE_LINK = `inline-flex h-9 items-center rounded-[var(--radius-control)] border border-border-strong px-3 text-[13px] text-fg-primary hover:bg-bg-raised ${FOCUS}`;

export async function fetchTopics(slug: string): Promise<TopicDto[]> {
  const res = await fetch(`/api/subjects/${slug}/topics`);
  const body = await res.json();
  if (!res.ok) throw new Error(body.error?.message ?? 'Impossibile caricare gli argomenti');
  return body.topics as TopicDto[];
}

export async function setDocumentTopics(
  slug: string,
  documentId: string,
  topicIds: string[],
): Promise<void> {
  const res = await fetch(`/api/subjects/${slug}/documents/${documentId}/topics`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ topicIds }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error?.message ?? 'Aggiornamento argomenti fallito');
  }
}

export async function resolveDocumentType(
  slug: string,
  documentId: string,
  accept: boolean,
): Promise<void> {
  const res = await fetch(`/api/subjects/${slug}/documents/${documentId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ accept }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error?.message ?? 'Aggiornamento del tipo fallito');
  }
}

/** `classify_document_type`'s suggestion (docs/fasi/F1-ingest.md "Pagina di Triage") — a one-click accept/dismiss, never applied automatically. */
function TypeSuggestion({ subjectSlug, doc }: { subjectSlug: string; doc: DocumentDto }) {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: (accept: boolean) => resolveDocumentType(subjectSlug, doc.id, accept),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['documents', subjectSlug] }),
  });

  if (!doc.typeSuggested) return null;
  const pct = doc.typeConfidence !== null ? Math.round(doc.typeConfidence * 100) : null;

  return (
    <p className="mt-1 text-xs text-fg-secondary">
      AI: {doc.typeSuggested}
      {pct !== null ? ` (${pct}%)` : ''} —{' '}
      <button
        type="button"
        disabled={mutation.isPending}
        onClick={() => mutation.mutate(true)}
        className={`text-accent-hover underline-offset-2 hover:underline ${FOCUS}`}
      >
        conferma
      </button>{' '}
      ·{' '}
      <button
        type="button"
        disabled={mutation.isPending}
        onClick={() => mutation.mutate(false)}
        className={`text-fg-secondary underline-offset-2 hover:underline ${FOCUS}`}
      >
        ignora
      </button>
    </p>
  );
}

function TopicTagger({
  subjectSlug,
  doc,
  topics,
}: {
  subjectSlug: string;
  doc: DocumentDto;
  topics: TopicDto[];
}) {
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: (topicIds: string[]) => setDocumentTopics(subjectSlug, doc.id, topicIds),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['documents', subjectSlug] }),
  });

  const toggle = (topicId: string) => {
    const next = doc.topicIds.includes(topicId)
      ? doc.topicIds.filter((id) => id !== topicId)
      : [...doc.topicIds, topicId];
    mutation.mutate(next);
  };

  const taggedNames = topics.filter((t) => doc.topicIds.includes(t.id)).map((t) => t.name);

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-x-2">
        {taggedNames.length > 0 ? (
          <span className="text-[13px] text-fg-primary">{taggedNames.join(', ')}</span>
        ) : (
          <span className="text-[13px] text-warn">Nessun argomento</span>
        )}
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className={LINK_TEXT}
        >
          {taggedNames.length > 0 ? 'Modifica' : 'Assegna'}
        </button>
      </div>
      {open && (
        <div className="flex flex-wrap gap-1.5">
          {topics.length === 0 && (
            <span className="text-xs text-fg-secondary">
              Nessun argomento nella materia ancora.
            </span>
          )}
          {topics.map((topic) => {
            const checked = doc.topicIds.includes(topic.id);
            return (
              <button
                key={topic.id}
                type="button"
                onClick={() => toggle(topic.id)}
                disabled={mutation.isPending}
                aria-pressed={checked}
                className={`rounded-full border px-2.5 py-1 text-xs ${FOCUS} ${
                  checked
                    ? 'border-accent bg-accent-subtle text-accent-hover'
                    : 'border-border-strong text-fg-secondary hover:text-fg-primary'
                }`}
              >
                {topic.name}
              </button>
            );
          })}
        </div>
      )}
      {mutation.isError && (
        <p role="alert" className="text-xs text-danger">
          {(mutation.error as Error).message}
        </p>
      )}
    </div>
  );
}

/**
 * `document_topics` tagging (docs/fasi/F2-materie.md "Stato"): each document can carry one or
 * more topics, toggled inline. `selectedDocIds`/`onSelectionChange` are optional — a checkbox
 * per ready document lets the panels on the right (Genera, Suggerisci argomenti) scope
 * themselves to a subset instead of always "every parsed document" (F2 acceptance criterion:
 * "Seleziono 3 documenti e il pannello destro offre le azioni giuste, con costo stimato").
 */
export function DocumentList({
  subjectSlug,
  documents,
  selectedDocIds,
  onSelectionChange,
}: {
  subjectSlug: string;
  documents: DocumentDto[];
  selectedDocIds?: Set<string>;
  onSelectionChange?: (next: Set<string>) => void;
}) {
  const topicsQuery = useQuery({
    queryKey: ['topics', subjectSlug],
    queryFn: () => fetchTopics(subjectSlug),
  });
  const parentRef = useRef<HTMLDivElement>(null);

  const toggleSelected = (docId: string) => {
    if (!onSelectionChange) return;
    const next = new Set(selectedDocIds ?? []);
    if (next.has(docId)) next.delete(docId);
    else next.add(docId);
    onSelectionChange(next);
  };

  // Virtualized (docs/fasi/F2-materie.md "La pagina con 200 documenti e 2000 flashcard resta
  // reattiva"): row height varies with `TopicTagger`'s open/closed state, so rows are measured
  // (`measureElement`) rather than fixed — `estimateSize` is only the first-paint guess.
  const rowVirtualizer = useVirtualizer({
    count: documents.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 76,
    overscan: 8,
  });

  return (
    <div>
      {onSelectionChange && (selectedDocIds?.size ?? 0) > 0 && (
        <div className="mb-2 flex items-center justify-between px-1 text-xs text-fg-secondary">
          <span>{selectedDocIds!.size} selezionati</span>
          <button
            type="button"
            onClick={() => onSelectionChange(new Set())}
            className={`text-fg-secondary underline-offset-2 hover:text-fg-primary hover:underline ${FOCUS}`}
          >
            Deseleziona tutti
          </button>
        </div>
      )}
      <div className={`${CARD_BOX} overflow-hidden`}>
        <div
          aria-hidden="true"
          className="hidden items-start gap-x-4 border-b border-border px-5 py-2.5 text-xs uppercase tracking-[0.05em] text-fg-secondary @3xl/tab:grid @3xl/tab:grid-cols-[minmax(200px,1fr)_minmax(150px,0.7fr)_auto]"
        >
          <span>Documento</span>
          <span>Argomenti</span>
          <span />
        </div>
        <div ref={parentRef} className="max-h-[70vh] overflow-y-auto">
          <div style={{ height: rowVirtualizer.getTotalSize(), position: 'relative' }}>
            {rowVirtualizer.getVirtualItems().map((virtualRow) => {
              const doc = documents[virtualRow.index]!;
              const status = DOC_STATUS[doc.status];
              const showVerify = doc.type === 'schemi' && doc.status === 'parsed';
              const verifyHref = `/materie/${subjectSlug}/documenti/${doc.id}/verifica`;
              return (
                <div
                  key={doc.id}
                  data-index={virtualRow.index}
                  ref={rowVirtualizer.measureElement}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    transform: `translateY(${virtualRow.start}px)`,
                  }}
                  className={`${GRID} border-b border-border px-5 py-3`}
                >
                  <div className="min-w-0">
                    <div className="flex min-w-0 items-start gap-2.5">
                      {onSelectionChange && doc.status === 'parsed' && (
                        <input
                          type="checkbox"
                          checked={selectedDocIds?.has(doc.id) ?? false}
                          onChange={() => toggleSelected(doc.id)}
                          aria-label={`Seleziona ${doc.originalName}`}
                          className="mt-2 shrink-0"
                        />
                      )}
                      <span
                        aria-hidden="true"
                        className="grid size-8 shrink-0 place-items-center rounded-[var(--radius-control)] bg-bg-raised font-mono text-[10px] text-fg-secondary"
                      >
                        {docExt(doc.originalName)}
                      </span>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-fg-primary">
                          {doc.originalName}
                        </p>
                        <p className="text-xs text-fg-secondary">
                          {DOC_TYPE_LABELS[doc.type]} · {formatBytes(doc.bytes)}
                          {doc.pages !== null ? ` · ${doc.pages} pag.` : ''}
                        </p>
                      </div>
                    </div>
                    <TypeSuggestion subjectSlug={subjectSlug} doc={doc} />
                  </div>
                  <div className="min-w-0">
                    {topicsQuery.isSuccess && (
                      <TopicTagger subjectSlug={subjectSlug} doc={doc} topics={topicsQuery.data} />
                    )}
                  </div>
                  <div className="flex min-w-0 flex-col items-start gap-1.5 @3xl/tab:items-end">
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
                      <Link
                        href={`/materie/${subjectSlug}/documenti/${doc.id}/originale`}
                        aria-label={`Apri ${doc.originalName}`}
                        className={OUTLINE_LINK}
                      >
                        Apri
                      </Link>
                      {showVerify && doc.blockedBlocks > 0 && (
                        <Link href={verifyHref} className={`${OUTLINE_LINK} text-warn`}>
                          {doc.blockedBlocks} da verificare
                        </Link>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-3 text-xs">
                      {showVerify && doc.blockedBlocks === 0 && (
                        <Link
                          href={verifyHref}
                          className="text-fg-secondary underline-offset-2 hover:text-fg-primary hover:underline"
                        >
                          Verifica
                        </Link>
                      )}
                      {doc.status === 'parsed' && doc.mdPath && (
                        <Link
                          href={`/materie/${subjectSlug}/documenti/${doc.id}`}
                          className={`underline-offset-2 hover:underline ${
                            doc.mdConflict ? 'text-warn' : 'text-fg-secondary hover:text-fg-primary'
                          }`}
                        >
                          {doc.mdConflict ? 'Conflitto da risolvere' : 'Vedi testo'}
                        </Link>
                      )}
                      <DeleteDocumentButton
                        subjectSlug={subjectSlug}
                        doc={doc}
                        onDeleted={(id) => {
                          if (!onSelectionChange || !selectedDocIds?.has(id)) return;
                          const next = new Set(selectedDocIds);
                          next.delete(id);
                          onSelectionChange(next);
                        }}
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
