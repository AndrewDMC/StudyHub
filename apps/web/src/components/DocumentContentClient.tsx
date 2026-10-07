'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { diffLines } from 'diff';
import type { DocumentContentDto } from '@studyhub/contracts';
import { Button } from '@/components/ui/button';
import { ObsidianMarkdown } from '@/components/ObsidianMarkdown';

async function fetchContent(slug: string, documentId: string): Promise<DocumentContentDto> {
  const res = await fetch(`/api/subjects/${slug}/documents/${documentId}/content`);
  const body = await res.json();
  if (!res.ok) throw new Error(body.error?.message ?? 'Impossibile caricare il documento');
  return body as DocumentContentDto;
}

async function saveContent(slug: string, documentId: string, markdown: string): Promise<void> {
  const res = await fetch(`/api/subjects/${slug}/documents/${documentId}/content`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ markdown }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error?.message ?? 'Salvataggio fallito');
  }
}

async function resolveConflict(
  slug: string,
  documentId: string,
  keep: 'mine' | 'new',
): Promise<void> {
  const res = await fetch(`/api/subjects/${slug}/documents/${documentId}/content/resolve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ keep }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error?.message ?? 'Risoluzione del conflitto fallita');
  }
}

/** Line-based diff view — a re-ingest's fresh output (right) vs. the user's saved edit (left). */
function ConflictDiff({ mine, theirs }: { mine: string; theirs: string }) {
  const parts = diffLines(mine, theirs);
  return (
    <pre className="max-h-96 overflow-y-auto whitespace-pre-wrap rounded-[var(--radius-control)] border border-border bg-bg-inset p-3 font-mono text-xs">
      {parts.map((part, i) => (
        <span
          key={i}
          className={
            part.added
              ? 'block bg-ok/10 text-ok'
              : part.removed
                ? 'block bg-danger/10 text-danger'
                : 'block text-fg-secondary'
          }
        >
          {part.value}
        </span>
      ))}
    </pre>
  );
}

/**
 * Editor for a document's canonical `content.md`, with the stickiness
 * conflict UI (docs/02-filesystem-e-dati.md §6.1): once edited here, a
 * re-ingest never overwrites the file silently — it shows both versions and
 * lets the user pick.
 */
export function DocumentContentClient({
  subjectSlug,
  documentId,
}: {
  subjectSlug: string;
  documentId: string;
}) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ['documentContent', subjectSlug, documentId],
    queryFn: () => fetchContent(subjectSlug, documentId),
  });
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');

  const saveMutation = useMutation({
    mutationFn: (markdown: string) => saveContent(subjectSlug, documentId, markdown),
    onSuccess: () => {
      setEditing(false);
      queryClient.invalidateQueries({ queryKey: ['documentContent', subjectSlug, documentId] });
    },
  });

  const resolveMutation = useMutation({
    mutationFn: (keep: 'mine' | 'new') => resolveConflict(subjectSlug, documentId, keep),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ['documentContent', subjectSlug, documentId] }),
  });

  return (
    <div className="mx-auto max-w-3xl p-4 md:p-6">
      <div className="mb-4 flex items-center justify-between">
        <Link
          href={`/materie/${subjectSlug}`}
          className="text-xs text-fg-muted underline-offset-2 hover:text-fg-primary hover:underline"
        >
          ← Torna alla materia
        </Link>
        {query.isSuccess && !editing && !query.data.conflict && (
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              setDraft(query.data.markdown);
              setEditing(true);
            }}
          >
            Modifica
          </Button>
        )}
      </div>

      {query.isLoading && <p className="text-sm text-fg-muted">Caricamento…</p>}
      {query.isError && (
        <p role="alert" className="text-sm text-danger">
          {(query.error as Error).message}
        </p>
      )}

      {query.isSuccess && query.data.conflict && (
        <div className="mb-4 rounded-[var(--radius-card)] border border-warn bg-warn/10 p-4">
          <p className="mb-2 text-sm font-medium text-warn">
            Conflitto: il documento è stato ri-elaborato ma tu avevi modificato content.md a mano.
          </p>
          <p className="mb-3 text-xs text-fg-secondary">
            Rosso = solo nella tua versione, verde = solo nella nuova versione.
          </p>
          <ConflictDiff mine={query.data.markdown} theirs={query.data.conflict.newMarkdown} />
          <div className="mt-3 flex gap-2">
            <Button
              type="button"
              disabled={resolveMutation.isPending}
              onClick={() => resolveMutation.mutate('mine')}
            >
              Mantieni la mia versione
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={resolveMutation.isPending}
              onClick={() => resolveMutation.mutate('new')}
            >
              Usa la nuova versione
            </Button>
          </div>
        </div>
      )}

      {query.isSuccess && !editing && (
        <div className="rounded-[var(--radius-card)] border border-border bg-bg-surface p-6">
          <ObsidianMarkdown source={query.data.markdown} subjectSlug={subjectSlug} />
        </div>
      )}

      {query.isSuccess && editing && (
        <div className="flex flex-col gap-2">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={24}
            className="w-full rounded-[var(--radius-card)] border border-border bg-bg-inset p-4 font-mono text-sm text-fg-primary outline-none focus:border-accent"
          />
          {saveMutation.isError && (
            <p role="alert" className="text-xs text-danger">
              {(saveMutation.error as Error).message}
            </p>
          )}
          <div className="flex gap-2">
            <Button
              type="button"
              disabled={saveMutation.isPending}
              onClick={() => saveMutation.mutate(draft)}
            >
              Salva
            </Button>
            <Button type="button" variant="secondary" onClick={() => setEditing(false)}>
              Annulla
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
