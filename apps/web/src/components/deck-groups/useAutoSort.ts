'use client';

import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { sortMessage, sortView } from '@/lib/deckGroups';
import { SortConflictError, fetchSortStatus, startSort } from '@/lib/deckGroupsClient';

/** State machine of "Ordina automaticamente": start the job, poll it, report when it ends. */
export function useAutoSort(slug: string, onFinished: () => void) {
  const [jobId, setJobId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [settled, setSettled] = useState(false);
  const finishedFor = useRef<string | null>(null);
  const onFinishedRef = useRef(onFinished);
  onFinishedRef.current = onFinished;

  const start = useMutation({
    mutationFn: () => startSort(slug),
    onMutate: () => {
      setError(null);
      setMessage(null);
      setSettled(false);
    },
    onSuccess: (data) => setJobId(data.jobId),
    onError: (err) => {
      if (err instanceof SortConflictError && err.jobId) {
        setJobId(err.jobId);
        return;
      }
      setError(
        err instanceof SortConflictError
          ? err.message
          : 'Non sono riuscito a ordinare le card. Riprova.',
      );
    },
  });

  const job = useQuery({
    queryKey: ['sort-job', slug, jobId],
    queryFn: () => fetchSortStatus(slug, jobId!),
    enabled: jobId !== null,
    refetchInterval: (q) => {
      const s = q.state.data?.status;
      return s === 'succeeded' || s === 'failed' || s === 'cancelled' ? false : 2000;
    },
  });

  const view = job.data ? sortView(job.data) : null;
  const running =
    start.isPending ||
    (jobId !== null && !job.isError && (view === null || view.phase === 'running'));
  const noTopics = view?.phase === 'done' && view.noTopics;
  const failed = error !== null || view?.phase === 'failed' || job.isError;

  const phase = view?.phase ?? null;
  useEffect(() => {
    if (!view || view.phase === 'running' || finishedFor.current === jobId) return;
    finishedFor.current = jobId;
    if (view.phase === 'done' && !view.noTopics) setMessage(sortMessage(view));
    onFinishedRef.current();
  }, [phase, jobId]);

  const allSorted = view?.phase === 'done' && view.remaining === 0 && view.sorted > 0;
  useEffect(() => {
    if (!allSorted) return;
    const t = setTimeout(() => setSettled(true), 6000);
    return () => clearTimeout(t);
  }, [allSorted]);

  return {
    running,
    noTopics,
    failed,
    // The tile of unsorted cards stays visible while a sort runs or just ended.
    touched: running || message !== null || failed || noTopics,
    message: settled ? 'Tutte le card hanno un argomento.' : message,
    errorText: error ?? 'Non sono riuscito a ordinare le card. Riprova.',
    run: () => start.mutate(),
  };
}

export type AutoSort = ReturnType<typeof useAutoSort>;
