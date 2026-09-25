'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { DocumentDto, TopicDto } from '@studyhub/contracts';

const STATUS_LABEL: Record<DocumentDto['status'], string> = {
  uploaded: 'Caricato',
  parsing: 'Estrazione…',
  parsed: 'Pronto',
  failed: 'Errore',
  missing: 'Mancante',
};

const STATUS_COLOR: Record<DocumentDto['status'], string> = {
  uploaded: 'var(--fg-muted)',
  parsing: 'var(--info)',
  parsed: 'var(--ok)',
  failed: 'var(--danger)',
  missing: 'var(--warn)',
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function fetchTopics(slug: string): Promise<TopicDto[]> {
  const res = await fetch(`/api/subjects/${slug}/topics`);
  const body = await res.json();
  if (!res.ok) throw new Error(body.error?.message ?? 'Impossibile caricare gli argomenti');
  return body.topics as TopicDto[];
}

async function setDocumentTopics(
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
    <div className="mt-1">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="text-[11px] text-fg-muted underline-offset-2 hover:text-fg-secondary hover:underline"
      >
        {taggedNames.length > 0 ? taggedNames.join(', ') : 'Aggiungi argomenti'}
      </button>
      {open && (
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {topics.length === 0 && (
            <span className="text-[11px] text-fg-muted">
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
                className={`rounded-full border px-2 py-0.5 text-[11px] ${
                  checked
                    ? 'border-accent bg-accent/10 text-accent'
                    : 'border-border text-fg-secondary hover:text-fg-primary'
                }`}
              >
                {topic.name}
              </button>
            );
          })}
        </div>
      )}
      {mutation.isError && (
        <p className="mt-1 text-[11px] text-danger">{(mutation.error as Error).message}</p>
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

  const toggleSelected = (docId: string) => {
    if (!onSelectionChange) return;
    const next = new Set(selectedDocIds ?? []);
    if (next.has(docId)) next.delete(docId);
    else next.add(docId);
    onSelectionChange(next);
  };

  return (
    <div>
      {onSelectionChange && (selectedDocIds?.size ?? 0) > 0 && (
        <div className="mb-2 flex items-center justify-between px-1 text-xs text-fg-secondary">
          <span>{selectedDocIds!.size} selezionati</span>
          <button
            type="button"
            onClick={() => onSelectionChange(new Set())}
            className="text-fg-muted underline-offset-2 hover:text-fg-primary hover:underline"
          >
            Deseleziona tutti
          </button>
        </div>
      )}
      <ul className="divide-y divide-border rounded-[var(--radius-card)] border border-border bg-bg-surface">
        {documents.map((doc) => (
          <li key={doc.id} className="flex items-center justify-between gap-3 px-4 py-3">
            <div className="flex min-w-0 items-start gap-2.5">
              {onSelectionChange && doc.status === 'parsed' && (
                <input
                  type="checkbox"
                  checked={selectedDocIds?.has(doc.id) ?? false}
                  onChange={() => toggleSelected(doc.id)}
                  aria-label={`Seleziona ${doc.originalName}`}
                  className="mt-1 shrink-0"
                />
              )}
              <div className="min-w-0">
                <p className="truncate text-sm text-fg-primary">{doc.originalName}</p>
                <p className="mt-0.5 font-mono text-[11px] text-fg-muted">
                  {doc.type} · {formatBytes(doc.bytes)}
                  {doc.pages !== null ? ` · ${doc.pages} pag.` : ''}
                </p>
                {topicsQuery.isSuccess && (
                  <TopicTagger subjectSlug={subjectSlug} doc={doc} topics={topicsQuery.data} />
                )}
              </div>
            </div>
            <span
              className="shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-medium"
              style={{ color: STATUS_COLOR[doc.status], borderColor: STATUS_COLOR[doc.status] }}
            >
              {STATUS_LABEL[doc.status]}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
