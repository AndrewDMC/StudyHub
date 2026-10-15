'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import type { AttemptDto, AttemptItemResultDto } from '@studyhub/contracts';

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

/** Data and actions of the results page (grading polling, second opinions, drill), shared by desktop and mobile. */
export function useAttemptResults(subjectSlug: string, attemptId: string) {
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

  return { attemptQuery, resultsQuery, graded, pendingOpinions, secondOpinion, drill };
}
