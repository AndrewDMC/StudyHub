'use client';

import Link from 'next/link';
import type { ReviewOverviewSubjectDto } from '@studyhub/contracts';
import { StartTaskButton } from '../StartTaskButton';
import { TabCard } from '../subject-tabs/TabCard';
import { BTN_GHOST, BTN_SECONDARY } from '../subject-tabs/styles';
import { formatDayLong, type RecallVerify } from './model';

const ROW =
  'flex min-h-[52px] items-center gap-3 rounded-[var(--radius-control)] border border-border px-3 py-2';

function Icon({ tone, children }: { tone: 'ok' | 'accent'; children: string }) {
  return (
    <span
      aria-hidden="true"
      className={`flex size-8 shrink-0 items-center justify-center rounded-[var(--radius-control)] text-sm ${
        tone === 'ok' ? 'bg-ok/10 text-ok' : 'bg-accent-subtle text-accent-hover'
      }`}
    >
      {children}
    </span>
  );
}

/** "Ricordo": the verifications of the next days and the flashcards due today. */
export function RecallCard({
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
    <TabCard label="Ricordo" labelId="ripassi">
      <div data-testid="overview-recall" className="flex flex-col gap-2">
        {planLoading && <p className="text-[13px] text-fg-secondary">Caricamento…</p>}
        {verifies.map(({ task, offset, today }) => (
          <div key={task.id} className={ROW}>
            <Icon tone="ok">✓</Icon>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-sm font-medium text-fg-primary">{task.title}</span>
              <span className="text-xs text-fg-secondary">
                {offset ? `${offset} giorni dopo la lezione · ` : ''}
                {task.minutes} min
                {today ? '' : ` · ${formatDayLong(task.date)}`}
              </span>
            </span>
            {today && (
              <StartTaskButton
                subjectSlug={slug}
                taskId={task.id}
                kind={task.kind}
                label={task.status === 'doing' ? 'Riprendi' : 'Inizia'}
                className={`${BTN_SECONDARY} h-9`}
              />
            )}
          </div>
        ))}

        {reviewLoading && <p className="text-[13px] text-fg-secondary">Caricamento…</p>}
        {reviewError && (
          <div className="flex items-center gap-2">
            <p role="alert" className="text-xs text-danger">
              Impossibile caricare il ripasso.
            </p>
            <button type="button" onClick={onRetryReview} className={BTN_GHOST}>
              Riprova
            </button>
          </div>
        )}
        {!reviewLoading && !reviewError && review && due > 0 && (
          <Link
            href={`/materie/${slug}/review`}
            className={`${ROW} transition-colors duration-120 hover:bg-bg-raised`}
          >
            <Icon tone="accent">▤</Icon>
            <span className="flex min-w-0 flex-col">
              <span className="text-sm font-medium text-fg-primary">
                {due === 1 ? '1 flashcard da ripassare' : `${due} flashcard da ripassare`}
              </span>
              <span className="text-xs text-fg-secondary">circa {review.estimatedMinutes} min</span>
            </span>
          </Link>
        )}
        {!reviewLoading && !reviewError && review && due === 0 && (
          <div className={ROW}>
            <Icon tone="accent">▤</Icon>
            <span className="flex min-w-0 flex-col">
              <span className="text-sm font-medium text-fg-primary">
                Nessuna flashcard in scadenza
              </span>
            </span>
          </div>
        )}
      </div>
    </TabCard>
  );
}
