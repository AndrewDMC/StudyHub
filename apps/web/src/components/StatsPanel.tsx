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

/** Mastery 0..1 → a cell tint (accent at growing strength); no data → the neutral inset. */
function masteryStyle(mastery: number | null): React.CSSProperties {
  if (mastery === null) return {};
  return {
    backgroundColor: `color-mix(in srgb, var(--accent) ${Math.round(mastery * 90) + 10}%, transparent)`,
  };
}

/** Bars for the next 30 days; the tallest day fills the height. Today is emphasised. */
function ForecastBars({ forecast }: { forecast: FlashcardStatsDto['forecast'] }) {
  const max = Math.max(1, ...forecast.map((d) => d.count));
  return (
    <div>
      <p className="mb-1 text-[11px] text-fg-muted">Prossimi 30 giorni</p>
      <div
        className="flex h-14 items-end gap-px"
        role="img"
        aria-label="Card in scadenza nei prossimi 30 giorni"
      >
        {forecast.map((d, i) => (
          <div
            key={d.date}
            title={`${d.date}: ${d.count}`}
            className={`flex-1 rounded-t-sm ${i === 0 ? 'bg-accent' : 'bg-accent/50'}`}
            style={{ height: `${Math.max(d.count === 0 ? 0 : 6, (d.count / max) * 100)}%` }}
          />
        ))}
      </div>
      <div className="mt-0.5 flex justify-between font-mono text-[10px] text-fg-muted">
        <span>oggi</span>
        <span>picco {max}</span>
        <span>+30g</span>
      </div>
    </div>
  );
}

function MasteryHeatmap({
  subjectSlug,
  topics,
}: {
  subjectSlug: string;
  topics: FlashcardStatsDto['topicMastery'];
}) {
  if (topics.length === 0) return null;
  return (
    <div>
      <p className="mb-1 text-[11px] text-fg-muted">Mastery per argomento</p>
      <ul className="grid grid-cols-2 gap-1 sm:grid-cols-3">
        {topics.map((t) => (
          <li key={t.topicId}>
            <Link
              href={`/materie/${subjectSlug}/review?topicId=${t.topicId}`}
              title={
                t.mastery === null
                  ? `${t.name}: nessun dato`
                  : `${t.name}: ${Math.round(t.mastery * 100)}% — ripassa solo questo argomento`
              }
              style={masteryStyle(t.mastery)}
              className="flex items-center justify-between gap-2 rounded-[var(--radius-control)] border border-border bg-bg-inset px-2 py-1 text-[11px] text-fg-primary hover:border-accent"
            >
              <span className="truncate">{t.name}</span>
              <span className="font-mono tabular-nums text-fg-secondary">
                {t.mastery === null ? '—' : `${Math.round(t.mastery * 100)}%`}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Predicted vs actual recall per bucket; a wide gap means FSRS's defaults don't fit this learner. */
function RetentionCurve({ retention }: { retention: FlashcardStatsDto['retention'] }) {
  return (
    <div>
      <p className="mb-1 text-[11px] text-fg-muted">Ritenzione: reale vs prevista</p>
      {retention.buckets.length === 0 ? (
        <p className="text-[11px] text-fg-muted">
          Servono ripassi ripetuti sulle stesse card per calcolarla.
        </p>
      ) : (
        <table className="w-full font-mono text-[11px] tabular-nums text-fg-secondary">
          <thead className="text-fg-muted">
            <tr>
              <th className="text-left font-normal">Prevista</th>
              <th className="text-right font-normal">Reale</th>
              <th className="text-right font-normal">Ripassi</th>
            </tr>
          </thead>
          <tbody>
            {retention.buckets.map((b) => (
              <tr key={b.from}>
                <td>{Math.round(b.predicted * 100)}%</td>
                <td
                  className={`text-right ${Math.abs(b.actual - b.predicted) > 0.1 ? 'text-warn' : ''}`}
                >
                  {Math.round(b.actual * 100)}%
                </td>
                <td className="text-right">{b.count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {retention.sampleCount > 0 && retention.sampleCount < 50 && (
        <p className="mt-1 text-[10px] text-fg-muted">
          Solo {retention.sampleCount} ripassi: indicativo, non ancora affidabile.
        </p>
      )}
    </div>
  );
}

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
          {query.data.suspendedCount + query.data.flaggedCount > 0 && (
            <p className="text-[11px] text-fg-muted">
              {query.data.suspendedCount} sospese · {query.data.flaggedCount} segnalate (fuori dal
              ripasso)
            </p>
          )}
          <ForecastBars forecast={query.data.forecast} />
          <MasteryHeatmap subjectSlug={subjectSlug} topics={query.data.topicMastery} />
          <RetentionCurve retention={query.data.retention} />
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
