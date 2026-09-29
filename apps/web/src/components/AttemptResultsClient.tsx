'use client';

import { useEffect, useState } from 'react';
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

async function requestSecondOpinion(slug: string, attemptId: string, itemId: string) {
  const res = await fetch(
    `/api/subjects/${slug}/attempts/${attemptId}/items/${itemId}/second-opinion`,
    { method: 'POST' },
  );
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error?.message ?? 'Richiesta seconda opinione fallita');
  }
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
  const [pendingOpinions, setPendingOpinions] = useState<Set<string>>(new Set());
  const resultsQuery = useQuery({
    queryKey: ['attempt-results', attemptId],
    queryFn: () => fetchResults(subjectSlug, attemptId),
    enabled: graded,
    // A requested second opinion also runs in the worker: keep polling while one is out.
    refetchInterval: () => (pendingOpinions.size > 0 ? 3000 : false),
  });

  const secondOpinion = useMutation({
    mutationFn: (itemId: string) => requestSecondOpinion(subjectSlug, attemptId, itemId),
    onSuccess: (_data, itemId) => setPendingOpinions((s) => new Set(s).add(itemId)),
  });

  useEffect(() => {
    if (!resultsQuery.isSuccess || pendingOpinions.size === 0) return;
    const landed = [...pendingOpinions].filter(
      (itemId) => resultsQuery.data.find((r) => r.itemId === itemId)?.secondOpinion,
    );
    if (landed.length === 0) return;
    setPendingOpinions((s) => {
      const next = new Set(s);
      for (const itemId of landed) next.delete(itemId);
      return next;
    });
    // Deliberately keyed on the fetched data only (a state updater must not re-run on its own writes).
  }, [resultsQuery.data]);

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

                  {r.secondOpinion ? (
                    <div className="mt-3 rounded-[var(--radius-control)] border border-accent/40 bg-bg-inset px-3 py-2 text-xs">
                      <p className="font-medium text-accent">
                        Seconda opinione ({r.secondOpinion.model}): {r.secondOpinion.awarded}/
                        {r.max}
                      </p>
                      <ul className="mt-1.5 space-y-1">
                        {r.secondOpinion.criteria.map((c) => (
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
                      {r.secondOpinion.missing.length > 0 && (
                        <p className="mt-1.5 text-warn">
                          Manca: {r.secondOpinion.missing.join('; ')}
                        </p>
                      )}
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => secondOpinion.mutate(r.itemId)}
                      disabled={secondOpinion.isPending || pendingOpinions.has(r.itemId)}
                      className="mt-3 rounded-[var(--radius-control)] border border-border px-2 py-1 text-[11px] text-fg-secondary hover:text-fg-primary disabled:opacity-50"
                    >
                      {pendingOpinions.has(r.itemId)
                        ? 'Seconda opinione in corso…'
                        : 'Chiedi una seconda opinione'}
                    </button>
                  )}
                  {secondOpinion.isError && secondOpinion.variables === r.itemId && (
                    <p role="alert" className="mt-1.5 text-[11px] text-danger">
                      {(secondOpinion.error as Error).message}
                    </p>
                  )}
                </li>
              );
            })}
          </ol>
        </>
      )}
    </div>
  );
}
