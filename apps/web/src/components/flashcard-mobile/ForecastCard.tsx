'use client';

import { forecastPeak } from '@/lib/flashcardMobile';
import { SectionError, SkeletonRows } from '../subject-mobile/SectionState';
import { useFlashcardStats } from './queries';

function peakLabel(max: number, dayIndex: number): string {
  const when = dayIndex === 0 ? 'oggi' : dayIndex === 1 ? 'domani' : `tra ${dayIndex} giorni`;
  return `picco di ${max} card ${when}`;
}

/** "Prossimi 30 giorni": one bar per day, the tallest fills the height, today is full accent. */
export function ForecastCard({ slug }: { slug: string }) {
  const stats = useFlashcardStats(slug);
  const forecast = stats.data?.forecast ?? [];
  const { max, dayIndex } = forecastPeak(forecast);

  return (
    <section
      aria-label="Prossimi 30 giorni"
      aria-busy={stats.isLoading || undefined}
      className="rounded-[var(--radius-card)] border border-border bg-bg-surface p-4"
    >
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="text-xs font-medium uppercase tracking-[0.06em] text-fg-muted">
          Prossimi 30 giorni
        </h2>
        <span className="font-mono text-xs text-fg-muted">ripassi/giorno</span>
      </div>
      {stats.isLoading ? (
        <SkeletonRows count={1} />
      ) : stats.isError ? (
        <SectionError
          message="Impossibile caricare le statistiche."
          onRetry={() => void stats.refetch()}
        />
      ) : max === 0 ? (
        <p className="text-sm text-fg-muted">Nessun ripasso in programma nei prossimi 30 giorni.</p>
      ) : (
        <>
          <div
            role="img"
            aria-label={`Carico di ripassi nei prossimi 30 giorni, ${peakLabel(max, dayIndex)}`}
            className="flex h-24 items-end gap-[3px]"
          >
            {forecast.map((day, i) => (
              <div
                key={day.date}
                className="min-w-0 flex-1 rounded-sm"
                style={{
                  height: day.count > 0 ? `${Math.max(6, (day.count / max) * 100)}%` : '2px',
                  background:
                    i === 0
                      ? 'var(--accent)'
                      : 'color-mix(in srgb, var(--accent) 45%, var(--bg-raised))',
                }}
              />
            ))}
          </div>
          <div
            aria-hidden="true"
            className="mt-1.5 flex justify-between font-mono text-[11px] text-fg-muted"
          >
            <span>oggi</span>
            <span>+15</span>
            <span>+30</span>
          </div>
        </>
      )}
    </section>
  );
}
