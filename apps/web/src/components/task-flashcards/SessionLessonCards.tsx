'use client';

import Link from 'next/link';
import { useTaskFlashcards } from './queries';
import { reviewableCount, ripassaTaskHref } from './taskFlashcardsModel';

/**
 * "Flashcard della lezione (N)": cards attached to the task a session belongs to, with a link to
 * review just those. Optional block: hidden while loading, on error, without a task or with N = 0.
 */
export function SessionLessonCards({
  slug,
  taskId,
  variant,
}: {
  slug: string;
  taskId: string | null;
  variant: 'desktop' | 'mobile';
}) {
  const cards = useTaskFlashcards(slug, taskId, !!taskId);
  const n = reviewableCount(cards.data?.items ?? []);
  if (!taskId || n === 0) return null;
  const mobile = variant === 'mobile';
  return (
    <section
      aria-labelledby="lesson-cards-title"
      data-testid="session-lesson-cards"
      className={`rounded-[var(--radius-card)] border border-border bg-bg-surface p-3 ${
        mobile ? 'mb-4 flex items-center justify-between gap-3' : ''
      }`}
    >
      <div className="min-w-0">
        <h2 id="lesson-cards-title" className="text-sm font-medium text-fg-primary">
          Flashcard della lezione ({n})
        </h2>
        <p className="text-xs text-fg-muted">Ripassa le card attaccate a questa lezione.</p>
      </div>
      <Link
        href={ripassaTaskHref(slug, taskId)}
        aria-label="Ripassa le flashcard della lezione"
        className={`inline-flex min-h-11 items-center justify-center rounded-[var(--radius-control)] bg-accent px-4 text-sm font-semibold text-bg-base ${
          mobile ? 'shrink-0' : 'mt-2'
        }`}
      >
        Ripassa
      </Link>
    </section>
  );
}
