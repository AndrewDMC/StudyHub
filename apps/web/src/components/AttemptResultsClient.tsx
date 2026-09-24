'use client';

import Link from 'next/link';
import { useMutation, useQuery } from '@tanstack/react-query';
import type { AttemptDto, AttemptItemResultDto } from '@studyhub/contracts';
import { WEAK_RATIO_UI } from '@/lib/format';

async function fetchAttempt(slug: string, id: string): Promise<AttemptDto> {
  const res = await fetch(`/api/subjects/${slug}/attempts/${id}`);
  const body = await res.json();
  if (!res.ok) throw new Error(body.error?.message ?? 'Tentativo non trovato');
  return body.attempt as AttemptDto;
}

async function fetchResults(slug: string, id: string): Promise<AttemptItemResultDto[]> {
  const res = await fetch(`/api/subjects/${slug}/attempts/${id}/results`);
  const body = await res.json();
  if (!res.ok) throw new Error(body.error?.message ?? 'Risultati non disponibili');
  return body.results as AttemptItemResultDto[];
}

/**
 * Formative correction (docs/fasi/F5 Correzione): score per criterion, what
 * was missing, and always where to re-study — "Punteggio 6/10 — manca il
 * passaggio sul bilancio energetico (Appunti p. 73)", not just "6/10".
 */
export function AttemptResultsClient({
  subjectSlug,
  attemptId,
}: {
  subjectSlug: string;
  attemptId: string;
}) {
  const attemptQuery = useQuery({
    queryKey: ['attempt', attemptId],
    queryFn: () => fetchAttempt(subjectSlug, attemptId),
    // Grading runs in the worker: poll until it lands.
    refetchInterval: (q) => (q.state.data?.status === 'graded' ? false : 3000),
  });
  const graded = attemptQuery.data?.status === 'graded';
  const resultsQuery = useQuery({
    queryKey: ['attempt-results', attemptId],
    queryFn: () => fetchResults(subjectSlug, attemptId),
    enabled: graded,
  });

  const drill = useMutation({
    mutationFn: async (topicId: string) => {
      const res = await fetch(`/api/subjects/${subjectSlug}/simulations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'drill_argomento', topicId }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error?.message ?? 'Avvio drill fallito');
    },
  });

  const attempt = attemptQuery.data;

  return (
    <div className="mx-auto max-w-3xl p-6">
      <Link
        href={`/materie/${subjectSlug}`}
        className="text-xs text-fg-secondary underline-offset-2 hover:underline"
      >
        ← {subjectSlug}
      </Link>
      <h1 className="mt-1 text-xl font-semibold tracking-[-0.02em]">Correzione</h1>

      {attemptQuery.isLoading && <p className="mt-4 text-sm text-fg-muted">Caricamento…</p>}
      {attemptQuery.isError && (
        <p role="alert" className="mt-4 text-sm text-danger">
          {(attemptQuery.error as Error).message}
        </p>
      )}
      {attempt && !graded && (
        <div className="mt-4 rounded-[var(--radius-card)] border border-border bg-bg-surface p-6 text-sm text-fg-secondary">
          Esame consegnato. La correzione è in corso…
        </div>
      )}

      {attempt && graded && (
        <>
          <p className="mt-3 font-mono text-2xl tabular-nums">
            {attempt.totalAwarded} / {attempt.totalMax}
          </p>
          {attempt.weakTopics && attempt.weakTopics.length > 0 && (
            <div className="mt-3 rounded-[var(--radius-control)] border border-warn/40 bg-bg-inset px-3 py-2 text-xs text-warn">
              Argomenti deboli rilevati: la mastery è stata aggiornata e il piano li considererà.
              <div className="mt-2 flex flex-wrap gap-2">
                {attempt.weakTopics.map((topicId) => (
                  <button
                    key={topicId}
                    type="button"
                    onClick={() => drill.mutate(topicId)}
                    disabled={drill.isPending}
                    className="rounded-[var(--radius-control)] border border-warn/60 px-2 py-0.5 text-warn hover:bg-bg-raised"
                  >
                    Genera drill su questo argomento
                  </button>
                ))}
              </div>
              {drill.isSuccess && (
                <p className="mt-1 text-ok">
                  Drill in generazione — lo trovi nella pagina materia.
                </p>
              )}
              {drill.isError && (
                <p className="mt-1 text-danger">{(drill.error as Error).message}</p>
              )}
            </div>
          )}

          {resultsQuery.isError && (
            <p role="alert" className="mt-4 text-sm text-danger">
              {(resultsQuery.error as Error).message}
            </p>
          )}
          <ol className="mt-6 space-y-4">
            {(resultsQuery.data ?? []).map((r) => {
              const weak = r.max > 0 && r.awarded / r.max < WEAK_RATIO_UI;
              return (
                <li
                  key={r.itemId}
                  className="rounded-[var(--radius-card)] border border-border bg-bg-surface p-4"
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <p className="text-sm font-medium">
                      {r.ord + 1}. {r.prompt}
                    </p>
                    <span
                      className={`shrink-0 font-mono text-sm tabular-nums ${weak ? 'text-warn' : 'text-ok'}`}
                    >
                      {r.awarded}/{r.max}
                    </span>
                  </div>

                  <p className="mt-2 whitespace-pre-wrap rounded-[var(--radius-control)] bg-bg-inset px-3 py-2 text-xs text-fg-secondary">
                    {r.answer || <span className="italic text-fg-muted">Nessuna risposta</span>}
                  </p>

                  <ul className="mt-3 space-y-1 text-xs">
                    {r.criteria.map((c) => (
                      <li key={c.criterion} className="flex justify-between gap-3">
                        <span className="text-fg-secondary">
                          {c.criterion} — <span className="text-fg-muted">{c.feedback}</span>
                        </span>
                        <span className="shrink-0 font-mono tabular-nums text-fg-muted">
                          {c.awarded}/{c.max}
                        </span>
                      </li>
                    ))}
                  </ul>

                  {r.missing.length > 0 && (
                    <p className="mt-2 text-xs text-warn">Manca: {r.missing.join('; ')}</p>
                  )}

                  <p className="mt-2 text-xs text-fg-secondary">
                    Dove ripassare: pag. {r.sourceRef.page} —{' '}
                    <span className="font-mono text-[11px] text-fg-muted">
                      &quot;{r.sourceRef.quote}&quot;
                    </span>
                  </p>
                  <details className="mt-2 text-xs text-fg-muted">
                    <summary className="cursor-pointer">Soluzione di riferimento</summary>
                    <p className="mt-1 whitespace-pre-wrap">{r.solution}</p>
                  </details>
                </li>
              );
            })}
          </ol>
        </>
      )}
    </div>
  );
}
