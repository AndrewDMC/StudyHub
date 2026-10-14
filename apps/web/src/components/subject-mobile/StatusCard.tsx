'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import type { ExamDto } from '@studyhub/contracts';
import { REVIEW_OVERVIEW_KEY, fetchReviewOverview } from '@/lib/reviewOverview';
import { StartTaskButton } from '../StartTaskButton';
import { KIND_LABELS as EXAM_KIND_LABELS } from '../ExamsPanel';
import { currentTasks, useTodayTasks } from './queries';

const SESSION_KINDS = ['read', 'schema', 'drill'];
const OPEN_STATUSES_EXCLUDED = ['done', 'skipped', 'moved'];

const primaryCta =
  'flex min-h-11 items-center justify-center rounded-[var(--radius-control)] bg-accent px-3 text-sm font-semibold text-bg-base';
const secondaryCta =
  'flex min-h-11 items-center justify-center rounded-[var(--radius-control)] border border-border-strong px-3 text-sm font-medium text-fg-primary';
const disabledCta =
  'flex min-h-11 items-center justify-center rounded-[var(--radius-control)] border border-border px-3 text-center text-sm text-fg-muted';

function daysTo(iso: string): number {
  return Math.ceil((new Date(iso).getTime() - Date.now()) / (24 * 60 * 60 * 1000));
}

export function StatusCard({
  slug,
  documentCount,
  topicCount,
  flashcardTotal,
  nextExam,
}: {
  slug: string;
  documentCount: number;
  /** null until the topics query has succeeded. */
  topicCount: number | null;
  flashcardTotal: number | null;
  nextExam: ExamDto | undefined;
}) {
  const review = useQuery({ queryKey: REVIEW_OVERVIEW_KEY, queryFn: fetchReviewOverview });
  const tasks = useTodayTasks(slug);

  const due = review.data?.subjects.find((s) => s.slug === slug)?.due ?? 0;
  const studyTask = currentTasks(tasks.data ?? []).find(
    (t) => SESSION_KINDS.includes(t.kind) && !OPEN_STATUSES_EXCLUDED.includes(t.status),
  );

  const days = nextExam ? daysTo(nextExam.date) : null;

  return (
    <section
      aria-label="Stato della materia"
      className="rounded-[var(--radius-card)] border border-border bg-bg-surface p-4"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm text-fg-secondary">
            {documentCount} documenti
            {topicCount !== null && ` · ${topicCount} argomenti`}
            {flashcardTotal !== null && ` · ${flashcardTotal} flashcard`}
          </p>
          {nextExam && (
            <p className="mt-1 text-[13px] text-fg-muted">
              {EXAM_KIND_LABELS[nextExam.kind]} ·{' '}
              {new Date(nextExam.date).toLocaleDateString('it-IT', {
                day: 'numeric',
                month: 'long',
              })}
            </p>
          )}
        </div>
        {days !== null && (
          <div className="shrink-0 text-right">
            <b className="block font-mono text-2xl font-semibold leading-none text-fg-primary">
              {days <= 0 ? 'oggi' : days}
            </b>
            <span className="text-xs text-fg-muted">
              {days <= 0 ? 'esame' : days === 1 ? 'giorno all’esame' : 'giorni all’esame'}
            </span>
          </div>
        )}
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2">
        {review.isLoading ? (
          <span aria-busy="true" className={disabledCta}>
            Ripassa
          </span>
        ) : review.isError ? (
          <Link href={`/materie/${slug}/review`} className={primaryCta}>
            Ripassa
          </Link>
        ) : due > 0 ? (
          <Link href={`/materie/${slug}/review`} className={primaryCta}>
            Ripassa {due} card
          </Link>
        ) : (
          <button type="button" disabled className={disabledCta}>
            Nessuna card da ripassare
          </button>
        )}

        {studyTask ? (
          <StartTaskButton
            subjectSlug={slug}
            taskId={studyTask.id}
            kind={studyTask.kind}
            label="Studia ora"
            className={`${secondaryCta} w-full disabled:opacity-60`}
          />
        ) : (
          <Link href={`/materie/${slug}/piano`} className={secondaryCta}>
            Studia ora
          </Link>
        )}
      </div>
    </section>
  );
}
