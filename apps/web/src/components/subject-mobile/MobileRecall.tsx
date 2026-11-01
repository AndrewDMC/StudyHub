'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import type { ReviewOverviewSubjectDto } from '@studyhub/contracts';
import { reviewHref } from '@/lib/quickReview';
import { StartTaskButton } from '../StartTaskButton';
import { formatDayLong, type RecallVerify } from '../overview/model';
import { cardClass } from '../simulation-mobile/styles';
import { SkeletonRows } from './SectionState';

const ROW =
  'flex min-h-[60px] items-center gap-3 border-b border-border py-2 pl-4 pr-3 last:border-b-0';

function Dot({ tone }: { tone: 'ok' | 'accent' }) {
  return (
    <span
      aria-hidden="true"
      className={`size-2 shrink-0 rounded-full ${tone === 'ok' ? 'bg-ok' : 'bg-accent'}`}
    />
  );
}

function Text({ title, meta }: { title: ReactNode; meta?: ReactNode }) {
  return (
    <span className="flex min-w-0 flex-1 flex-col">
      <span className="text-sm font-medium text-fg-primary">{title}</span>
      {meta && <span className="text-[13px] text-fg-secondary">{meta}</span>}
    </span>
  );
}

/** "Ricordo": the verifications of the next days and the flashcards due. */
export function MobileRecall({
  slug,
  verifies,
  planLoading,
  review,
  reviewLoading,
  reviewError,
  onRetryReview,
}: {
  slug: string;
  verifies: RecallVerify[];
  planLoading: boolean;
  review: ReviewOverviewSubjectDto | null;
  reviewLoading: boolean;
  reviewError: boolean;
  onRetryReview: () => void;
}) {
  const due = review?.due ?? 0;
  return (
    <section
      data-testid="overview-recall"
      aria-labelledby="m-ric"
      aria-busy={planLoading || reviewLoading || undefined}
      className={`${cardClass} flex min-w-0 flex-col`}
    >
      <h2
        id="m-ric"
        className="px-4 pb-1 pt-3.5 text-xs font-medium uppercase tracking-[0.05em] text-fg-secondary"
      >
        Ricordo
      </h2>
      {(planLoading || reviewLoading) && (
        <div className="px-4 pb-3">
          <SkeletonRows count={2} />
        </div>
      )}
      {verifies.map(({ task, offset, today }) => (
        <div key={task.id} className={ROW}>
          <Dot tone="ok" />
          <Text
            title={task.title}
            meta={`${offset ? `+${offset} giorni dopo la lezione · ` : ''}${task.minutes} min${
              today ? '' : ` · ${formatDayLong(task.date)}`
            }`}
          />
          {today && (
            <StartTaskButton
              subjectSlug={slug}
              taskId={task.id}
              kind={task.kind}
              label={task.status === 'doing' ? 'Riprendi' : 'Inizia'}
              aria-label={`${task.status === 'doing' ? 'Riprendi' : 'Inizia'}: ${task.title}`}
              className="flex h-11 items-center rounded-[var(--radius-control)] border border-border-strong px-3 text-[13px] text-fg-primary disabled:opacity-60"
            />
          )}
        </div>
      ))}
      {reviewError && (
        <div className={ROW}>
          <p role="alert" className="flex-1 text-xs text-danger">
            Impossibile caricare il ripasso.
          </p>
          <button
            type="button"
            onClick={onRetryReview}
            className="min-h-11 rounded-[var(--radius-control)] border border-border px-3 text-[13px]"
          >
            Riprova
          </button>
        </div>
      )}
      {!reviewLoading && !reviewError && review && due > 0 && (
        <Link href={reviewHref(slug)} className={ROW}>
          <Dot tone="accent" />
          <Text
            title={due === 1 ? '1 flashcard da ripassare' : `${due} flashcard da ripassare`}
            meta={`circa ${review.estimatedMinutes} min`}
          />
          <span aria-hidden="true" className="text-fg-muted">
            ›
          </span>
        </Link>
      )}
      {!reviewLoading && !reviewError && review && due === 0 && (
        <div className={ROW}>
          <Dot tone="accent" />
          <Text title="Nessuna flashcard in scadenza" />
        </div>
      )}
    </section>
  );
}
