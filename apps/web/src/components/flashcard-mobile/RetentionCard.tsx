'use client';

import { retentionMessage, retentionSummary } from '@/lib/flashcardMobile';
import { SectionError, SkeletonRows } from '../subject-mobile/SectionState';
import { useFlashcardStats } from './queries';

const pct = (v: number) => `${Math.round(v * 100)}%`;

/** Real vs predicted retention from the reviews log. */
export function RetentionCard({ slug }: { slug: string }) {
  const stats = useFlashcardStats(slug);
  const retention = stats.data?.retention;
  const summary = retention ? retentionSummary(retention.buckets) : null;
  const onTrack = summary ? summary.actual >= summary.predicted - 0.03 : true;

  return (
    <section
      aria-label="Ritenzione: reale vs prevista"
      aria-busy={stats.isLoading || undefined}
      className="rounded-[var(--radius-card)] border border-border bg-bg-surface p-4"
    >
      <h2 className="mb-3 text-xs font-medium uppercase tracking-[0.06em] text-fg-muted">
        Ritenzione: reale vs prevista
      </h2>
      {stats.isLoading ? (
        <SkeletonRows count={1} />
      ) : stats.isError ? (
        <SectionError
          message="Impossibile caricare le statistiche."
          onRetry={() => void stats.refetch()}
        />
      ) : (
        <>
          <dl className="grid grid-cols-2 gap-2">
            <div className="flex flex-col-reverse rounded-[var(--radius-control)] bg-bg-raised p-3">
              <dt className="text-xs text-fg-secondary">
                Reale
                {retention && retention.sampleCount > 0 && ` · ${retention.sampleCount} ripassi`}
              </dt>
              <dd
                className={`font-mono text-xl font-semibold ${onTrack ? 'text-ok' : 'text-warn'}`}
              >
                {summary ? pct(summary.actual) : '—'}
              </dd>
            </div>
            <div className="flex flex-col-reverse rounded-[var(--radius-control)] bg-bg-raised p-3">
              <dt className="text-xs text-fg-secondary">Prevista</dt>
              <dd className="font-mono text-xl font-semibold text-fg-primary">
                {summary ? pct(summary.predicted) : '—'}
              </dd>
            </div>
          </dl>
          <p className="mt-3 text-[13px] text-fg-secondary">
            {summary
              ? retentionMessage(summary.actual, summary.predicted)
              : 'Servono ripassi ripetuti sulle stesse card per calcolarla.'}
          </p>
          {retention && retention.sampleCount > 0 && retention.sampleCount < 50 && (
            <p className="mt-1 text-xs text-fg-muted">
              Solo {retention.sampleCount} ripassi: indicativo, non ancora affidabile.
            </p>
          )}
        </>
      )}
    </section>
  );
}
