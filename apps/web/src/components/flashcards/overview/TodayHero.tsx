'use client';

import Link from 'next/link';
import { Info, Play } from 'lucide-react';
import { NEW_CARDS_PER_DAY } from '@/lib/flashcardsView';
import { reviewHref } from '@/lib/quickReview';
import { useFlashcardStats, useSubjectOverview } from '../api';
import { BlockError } from '../shared/Skeletons';
import { CARD_BOX, FOCUS, SECTION_TITLE, SKELETON } from '../shared/styles';
import { MiniForecast } from './MiniForecast';

/** "{n} in scadenza · {m} nuove · circa {k} minuti", leaving out a zero part. */
export function heroSummary(dueCount: number, newCount: number, minutes: number): string {
  const parts: string[] = [];
  if (dueCount > 0) parts.push(`${dueCount} in scadenza`);
  if (newCount > 0) parts.push(`${newCount} nuove`);
  if (minutes > 0) parts.push(`circa ${minutes} minuti`);
  return parts.join(' · ');
}

/** Today's review: total, split, the one primary action and the 7-day outlook. */
export function TodayHero({
  slug,
  hasBlockedNew,
  onPickTopic,
}: {
  slug: string;
  hasBlockedNew: boolean;
  onPickTopic: () => void;
}) {
  const overview = useSubjectOverview(slug);
  const stats = useFlashcardStats(slug);
  const data = overview.data;
  const total = data ? data.dueCount + data.newCount : 0;
  const showRule = data && (data.newCount > 0 || hasBlockedNew);

  return (
    <section
      aria-labelledby="fc-oggi"
      aria-busy={overview.isLoading || undefined}
      className={`${CARD_BOX} grid gap-6 p-5 @3xl/fc:grid-cols-2 @3xl/fc:p-6`}
    >
      <div className="flex min-w-0 flex-col gap-4">
        <h2 id="fc-oggi" className={SECTION_TITLE}>
          Ripasso di oggi
        </h2>
        {overview.isError ? (
          <BlockError
            message="Impossibile caricare il ripasso di oggi."
            onRetry={() => void overview.refetch()}
          />
        ) : !data ? (
          <div aria-hidden="true" className="flex flex-col gap-3">
            <div className={`h-12 w-20 rounded ${SKELETON}`} />
            <div className={`h-4 w-3/4 rounded ${SKELETON}`} />
            <div className={`h-11 w-40 rounded ${SKELETON}`} />
          </div>
        ) : (
          <>
            <p className="flex flex-wrap items-baseline gap-x-3">
              <span className="text-4xl font-semibold leading-none tracking-[-0.03em] tabular-nums @3xl/fc:text-5xl">
                {total}
              </span>
              <span className="text-base text-fg-secondary">card da ripassare</span>
            </p>
            <p className="text-sm text-fg-secondary">
              {total === 0
                ? 'Hai finito per oggi.'
                : heroSummary(data.dueCount, data.newCount, data.estimatedMinutes)}
            </p>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              {total > 0 ? (
                <Link
                  href={reviewHref(slug)}
                  className={`inline-flex h-11 items-center gap-2 rounded-[var(--radius-control)] bg-accent px-5 text-sm font-semibold text-bg-base hover:bg-accent-hover ${FOCUS}`}
                >
                  <Play className="size-4" aria-hidden="true" />
                  Ripassa ora
                </Link>
              ) : (
                <button
                  type="button"
                  disabled
                  className="inline-flex h-11 items-center rounded-[var(--radius-control)] border border-border px-5 text-sm text-fg-secondary"
                >
                  Nessuna card da ripassare
                </button>
              )}
              <button
                type="button"
                onClick={onPickTopic}
                className={`min-h-10 px-1 text-[13px] text-fg-secondary hover:text-fg-primary ${FOCUS}`}
              >
                oppure scegli un argomento ↓
              </button>
            </div>
            {showRule && (
              <p className="flex items-start gap-2 text-[13px] text-fg-secondary">
                <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                <span>
                  Le card nuove entrano solo per gli argomenti già trattati nel piano, al massimo{' '}
                  {NEW_CARDS_PER_DAY} per sessione.
                </span>
              </p>
            )}
          </>
        )}
      </div>
      <MiniForecast slug={slug} forecast={stats.data?.forecast} />
    </section>
  );
}
