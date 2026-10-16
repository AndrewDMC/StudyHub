'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
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

const NO_TOPICS_TEXT =
  'Questa materia non ha ancora argomenti. Estraili dal materiale per poter ordinare le card.';

/** Status area + button of the "Senza argomento" group. `noTopicsLink` is the view-specific action. */
export function AutoSortCta({
  sort,
  hasTopics,
  variant,
  noTopicsLink,
}: {
  sort: AutoSort;
  hasTopics: boolean;
  variant: 'desktop' | 'mobile';
  noTopicsLink: ReactNode;
}) {
  const statusId = `sort-status-${variant}`;
  const noTopics = !hasTopics || sort.noTopics;
  const btn =
    variant === 'mobile'
      ? 'inline-flex min-h-11 items-center gap-2 rounded-[var(--radius-control)] border border-border px-4 text-sm font-medium text-fg-primary disabled:opacity-60'
      : 'inline-flex items-center gap-1.5 rounded-[var(--radius-control)] border border-border px-2.5 py-1 text-xs text-fg-primary hover:bg-bg-inset disabled:opacity-60';
  const text = variant === 'mobile' ? 'text-sm' : 'text-xs';

  let status: ReactNode;
  if (noTopics) {
    status = (
      <>
        {NO_TOPICS_TEXT} {noTopicsLink}
      </>
    );
  } else if (sort.running) {
    status = 'Ordino le card…';
  } else if (sort.failed) {
    status = <span className="text-danger">{sort.errorText}</span>;
  } else if (sort.message) {
    status = sort.message;
  } else {
    status = 'Assegna ogni card all’argomento giusto.';
  }

  return (
    <div className="mt-2 flex min-w-0 flex-col items-start gap-2">
      {!noTopics && (
        <button
          type="button"
          onClick={sort.run}
          disabled={sort.running}
          aria-busy={sort.running || undefined}
          aria-describedby={statusId}
          className={btn}
        >
          {sort.running && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
          {sort.failed && !sort.running ? 'Riprova' : 'Ordina automaticamente'}
        </button>
      )}
      <div
        id={statusId}
        role={sort.failed && !sort.running && !noTopics ? 'alert' : 'status'}
        aria-live="polite"
        data-testid="sort-status"
        className={`min-w-0 text-fg-muted ${text}`}
      >
        {status}
      </div>
    </div>
  );
}
