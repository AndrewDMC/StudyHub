'use client';

import { Check } from 'lucide-react';
import { RATINGS, RATING_LABELS, formatSeconds, type SessionSummary } from '@/lib/quickReview';
import { RATING_COLORS } from './QuickReviewSession';

/** Artboard 4 (docs/09-ripasso-mobile.md §C3). */
export function QuickReviewSummary({
  title,
  summary,
  onRetryErrors,
  onHome,
  homeLabel = 'Torna alle materie',
  homePending = false,
}: {
  title: string;
  summary: SessionSummary;
  onRetryErrors: () => void;
  onHome: () => void;
  homeLabel?: string;
  homePending?: boolean;
}) {
  const max = Math.max(1, ...RATINGS.map((r) => summary.counts[r]));
  const tiles = [
    {
      value: String(summary.cards),
      label: summary.cards === 1 ? 'card ripassata' : 'card ripassate',
    },
    { value: `${summary.firstTryPct}%`, label: 'al primo colpo' },
    { value: formatSeconds(summary.avgMs), label: 'per card' },
  ];

  return (
    <>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-4 pt-10">
        <div className="flex size-11 items-center justify-center rounded-full border border-ok text-ok">
          <Check size={22} strokeWidth={2} aria-hidden="true" />
        </div>
        <h1 className="mt-4 text-2xl font-semibold tracking-[-0.02em]">Sessione completata</h1>
        <p className="mt-1 text-sm text-fg-secondary">{title}</p>

        <dl className="mt-6 grid grid-cols-3 gap-2">
          {tiles.map((tile) => (
            <div
              key={tile.label}
              className="flex flex-col-reverse rounded-[var(--radius-card)] border border-border bg-bg-surface p-3"
            >
              <dt className="mt-0.5 text-xs text-fg-secondary">{tile.label}</dt>
              <dd className="font-mono text-2xl font-medium">{tile.value}</dd>
            </div>
          ))}
        </dl>

        <h2 className="mb-3 mt-7 text-[13px] font-medium">Valutazioni</h2>
        <ul className="flex flex-col gap-2.5">
          {RATINGS.map((rating) => (
            <li key={rating} className="flex items-center gap-3">
              <span className="w-[72px] text-[13px]" style={{ color: RATING_COLORS[rating] }}>
                {RATING_LABELS[rating]}
              </span>
              <span className="h-2 flex-1 overflow-hidden rounded bg-bg-raised" aria-hidden="true">
                <span
                  className="block h-2"
                  style={{
                    width: `${Math.round((summary.counts[rating] / max) * 100)}%`,
                    background: RATING_COLORS[rating],
                  }}
                />
              </span>
              <span className="w-5 text-right font-mono text-[13px]">{summary.counts[rating]}</span>
            </li>
          ))}
        </ul>

        {summary.next.length > 0 && (
          <>
            <h2 className="mb-2 mt-7 text-[13px] font-medium">Prossime scadenze</h2>
            <ul className="overflow-hidden rounded-[var(--radius-card)] border border-border">
              {summary.next.map((group) => (
                <li
                  key={group.days}
                  className="flex items-center justify-between border-b border-bg-raised bg-bg-surface px-3.5 py-3 last:border-b-0"
                >
                  <span className="text-sm">{group.label}</span>
                  <span className="font-mono text-[13px] text-fg-secondary">
                    {group.count} card
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>

      <div className="flex shrink-0 flex-col gap-2 border-t border-border px-4 pb-[calc(env(safe-area-inset-bottom)+16px)] pt-3">
        {summary.errorIds.length > 0 && (
          <button
            type="button"
            onClick={onRetryErrors}
            className="flex h-14 w-full items-center justify-center gap-2.5 rounded-[var(--radius-card)] bg-accent text-base font-semibold text-bg-base"
          >
            Ripassa gli errori
            <span className="font-mono text-sm font-medium">{summary.errorIds.length}</span>
          </button>
        )}
        <button
          type="button"
          onClick={onHome}
          disabled={homePending}
          className="h-[52px] w-full rounded-[var(--radius-card)] border border-border-strong bg-bg-surface text-[15px] font-medium"
        >
          {homePending ? 'Salvo…' : homeLabel}
        </button>
      </div>
    </>
  );
}
