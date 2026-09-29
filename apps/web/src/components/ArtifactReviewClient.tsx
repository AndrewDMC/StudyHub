'use client';

import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { FlashcardDto } from '@studyhub/contracts';

async function fetchCards(slug: string, artifactId: string): Promise<FlashcardDto[]> {
  const res = await fetch(`/api/subjects/${slug}/artifacts/${artifactId}/flashcards`);
  const body = await res.json();
  if (!res.ok) throw new Error(body.error?.message ?? 'Impossibile caricare le flashcard');
  return body.flashcards as FlashcardDto[];
}

async function review(
  slug: string,
  artifactId: string,
  cardId: string,
  action: 'approve' | 'discard',
) {
  const res = await fetch(`/api/subjects/${slug}/artifacts/${artifactId}/flashcards/${cardId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error?.message ?? 'Azione fallita');
  }
}

async function approveAll(slug: string, artifactId: string) {
  const res = await fetch(`/api/subjects/${slug}/artifacts/${artifactId}/approve`, {
    method: 'POST',
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error?.message ?? 'Approvazione fallita');
  }
}

/**
 * Review queue (docs/fasi/F3-ai-core.md): "accetta/modifica/scarta card per
 * card, con la citazione sorgente a fianco". Editing is intentionally left
 * out of this first pass — approve/discard covers the acceptance criterion
 * ("40 card... citazione verificabile"); inline editing is a small
 * follow-up on the same `reviewFlashcard(action:'edit')` endpoint.
 */
export function ArtifactReviewClient({
  subjectSlug,
  artifactId,
}: {
  subjectSlug: string;
  artifactId: string;
}) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ['deck-cards', artifactId],
    queryFn: () => fetchCards(subjectSlug, artifactId),
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['deck-cards', artifactId] });

  const reviewMutation = useMutation({
    mutationFn: ({ cardId, action }: { cardId: string; action: 'approve' | 'discard' }) =>
      review(subjectSlug, artifactId, cardId, action),
    onSuccess: invalidate,
  });

  const approveAllMutation = useMutation({
    mutationFn: () => approveAll(subjectSlug, artifactId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['artifacts', subjectSlug] });
    },
  });

  return (
    <div className="mx-auto max-w-3xl p-6">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <Link
            href={`/materie/${subjectSlug}`}
            className="text-xs text-fg-secondary underline-offset-2 hover:underline"
          >
            ← {subjectSlug}
          </Link>
          <h1 className="text-xl font-semibold tracking-[-0.02em]">Revisione flashcard</h1>
        </div>
        <div className="flex items-center gap-2">
          <a
            href={`/api/subjects/${subjectSlug}/artifacts/${artifactId}/export.csv`}
            className="rounded-[var(--radius-control)] border border-border px-3 py-1.5 text-sm text-fg-secondary hover:text-fg-primary"
          >
            Esporta CSV
          </a>
          <button
            type="button"
            onClick={() => approveAllMutation.mutate()}
            disabled={approveAllMutation.isPending || !query.data || query.data.length === 0}
            className="rounded-[var(--radius-control)] bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50"
          >
            Approva il mazzo
          </button>
        </div>
      </div>
      {approveAllMutation.isSuccess && <p className="mb-3 text-xs text-ok">Mazzo approvato.</p>}
      {approveAllMutation.isError && (
        <p role="alert" className="mb-3 text-xs text-danger">
          {(approveAllMutation.error as Error).message}
        </p>
      )}

      {query.isLoading && <p className="text-sm text-fg-muted">Caricamento…</p>}
      {query.isError && (
        <p role="alert" className="text-sm text-danger">
          {(query.error as Error).message}
        </p>
      )}
      {query.isSuccess && query.data.length === 0 && (
        <div className="rounded-[var(--radius-card)] border border-dashed border-border bg-bg-surface p-8 text-center text-sm text-fg-muted">
          Nessuna card da revisionare (tutte scartate, o il mazzo è vuoto).
        </div>
      )}

      {query.isSuccess && query.data.length > 0 && (
        <ul className="space-y-3">
          {query.data.map((card) => (
            <li
              key={card.id}
              className="rounded-[var(--radius-card)] border border-border bg-bg-surface p-4"
            >
              <p className="text-xs uppercase tracking-wide text-fg-muted">{card.type}</p>
              <p className="mt-1 text-sm font-medium text-fg-primary">{card.front}</p>
              <p className="mt-1 text-sm text-fg-secondary">{card.back}</p>
              {card.sourceRef && (
                <p className="mt-2 rounded-[var(--radius-control)] bg-bg-inset px-2 py-1 font-mono text-[11px] text-fg-muted">
                  pag. {card.sourceRef.page} — &quot;{card.sourceRef.quote}&quot;
                </p>
              )}
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  onClick={() => reviewMutation.mutate({ cardId: card.id, action: 'approve' })}
                  disabled={reviewMutation.isPending}
                  className="rounded-[var(--radius-control)] border border-ok px-2.5 py-1 text-xs text-ok"
                >
                  Accetta
                </button>
                <button
                  type="button"
                  onClick={() => reviewMutation.mutate({ cardId: card.id, action: 'discard' })}
                  disabled={reviewMutation.isPending}
                  className="rounded-[var(--radius-control)] border border-danger px-2.5 py-1 text-xs text-danger"
                >
                  Scarta
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
