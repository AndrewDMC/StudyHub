'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import type { FlashcardStatsDto } from '@studyhub/contracts';
import { formatExamCountdown } from '@/lib/format';

async function fetchStats(slug: string): Promise<FlashcardStatsDto> {
  const res = await fetch(`/api/subjects/${slug}/stats/flashcards`);
  const body = await res.json();
  if (!res.ok) throw new Error(body.error?.message ?? 'Impossibile caricare le statistiche');
  return body.stats as FlashcardStatsDto;
}

const STATE_LABELS: Record<keyof FlashcardStatsDto['countsByState'], string> = {
  new: 'Nuove',
  learning: 'In apprendimento',
  review: 'In ripasso',
  relearning: 'Da rinforzare',
};

export function StatsPanel({ subjectSlug }: { subjectSlug: string }) {
  const query = useQuery({
    queryKey: ['stats', subjectSlug],
    queryFn: () => fetchStats(subjectSlug),
  });

  const dueToday = query.data?.forecast[0]?.count ?? 0;

  return (
    <div className="rounded-[var(--radius-card)] border border-border bg-bg-surface p-3">
      <div className="mb-2 flex items-center justify-between px-1">
        <h2 className="text-xs font-medium uppercase tracking-wide text-fg-muted">Ripasso</h2>
        <Link
          href={`/materie/${subjectSlug}/review`}
          className="rounded-[var(--radius-control)] bg-accent px-2.5 py-1 text-xs font-medium text-white hover:bg-accent-hover"
        >
          Inizia ({dueToday})
        </Link>
      </div>

      {query.isLoading && <p className="px-1 text-xs text-fg-muted">Caricamento…</p>}
      {query.isError && (
        <p role="alert" className="px-1 text-xs text-danger">
          {(query.error as Error).message}
        </p>
      )}
      {query.isSuccess && (
        <div className="space-y-2 px-1 text-xs">
          <dl className="grid grid-cols-2 gap-1 font-mono tabular-nums text-fg-secondary">
            {(Object.keys(STATE_LABELS) as (keyof typeof STATE_LABELS)[]).map((state) => (
              <div key={state} className="flex justify-between gap-2">
                <dt className="font-sans text-fg-muted">{STATE_LABELS[state]}</dt>
                <dd>{query.data.countsByState[state]}</dd>
              </div>
            ))}
          </dl>
          {query.data.atRiskForNextExam && (
            <p className="rounded-[var(--radius-control)] border border-warn/40 bg-bg-inset px-2 py-1.5 text-[11px] text-warn">
              {query.data.atRiskForNextExam.atRiskCount} card a rischio per &quot;
              {query.data.atRiskForNextExam.examTitle}&quot; (
              {formatExamCountdown(query.data.atRiskForNextExam.examDate)})
            </p>
          )}
        </div>
      )}
    </div>
  );
}
