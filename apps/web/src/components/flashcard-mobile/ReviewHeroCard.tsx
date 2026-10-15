'use client';

import Link from 'next/link';
import { reviewHref } from '@/lib/quickReview';
import { STAT_TILES, TONE_VAR } from '@/lib/flashcardMobile';
import { SectionError } from '../subject-mobile/SectionState';
import { useFlashcardStats, useReviewDue } from './queries';

const cta =
  'flex min-h-12 w-full items-center justify-center rounded-[var(--radius-card)] px-4 text-[15px] font-semibold';

/** "N card da ripassare oggi", the call to action and the four state counters. */
export function ReviewHeroCard({ slug }: { slug: string }) {
  const review = useReviewDue(slug);
  const stats = useFlashcardStats(slug);

  return (
    <section
      aria-label="Ripasso di oggi"
      aria-busy={review.isLoading || stats.isLoading || undefined}
      className="flex flex-col gap-3.5 rounded-[var(--radius-card)] border border-border bg-bg-surface p-4"
    >
      <div className="flex items-baseline gap-2.5">
        {review.isLoading ? (
          <span aria-hidden="true" className="h-8 w-14 animate-pulse rounded bg-bg-raised" />
        ) : (
          <b className="font-mono text-[34px] font-semibold leading-none text-fg-primary">
            {review.due}
          </b>
        )}
        <span className="text-[13px] text-fg-secondary">card da ripassare oggi</span>
      </div>

      {review.isLoading ? (
        <span aria-busy="true" className={`${cta} border border-border text-fg-muted`}>
          Inizia il ripasso
        </span>
      ) : !review.isError && review.due === 0 ? (
        <button type="button" disabled className={`${cta} border border-border text-fg-muted`}>
          Nessuna card da ripassare
        </button>
      ) : (
        <Link href={reviewHref(slug)} className={`${cta} bg-accent text-bg-base`}>
          Inizia il ripasso
        </Link>
      )}

      {stats.isError ? (
        <SectionError
          message="Impossibile caricare le statistiche."
          onRetry={() => void stats.refetch()}
        />
      ) : (
        <dl className="grid grid-cols-2 gap-2">
          {STAT_TILES.map((tile) => (
            <div
              key={tile.state}
              className="flex min-w-0 flex-col-reverse rounded-[var(--radius-control)] bg-bg-raised p-3"
            >
              <dt className="flex items-center gap-1.5 text-xs text-fg-secondary">
                <span
                  aria-hidden="true"
                  className="size-2 shrink-0 rounded-full"
                  style={{ background: TONE_VAR[tile.tone] }}
                />
                <span className="truncate">{tile.label}</span>
              </dt>
              <dd className="font-mono text-xl font-semibold text-fg-primary">
                {stats.data ? (
                  (stats.data.countsByState[tile.state] ?? 0)
                ) : (
                  <span
                    aria-hidden="true"
                    className="inline-block h-5 w-8 animate-pulse rounded bg-bg-inset"
                  />
                )}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}
