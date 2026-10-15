'use client';

import Link from 'next/link';
import { useState } from 'react';
import { CheckCircle2, ChevronDown, ChevronRight, Layers, Play } from 'lucide-react';
import type { ReviewOverviewDto, ReviewOverviewSubjectDto } from '@studyhub/contracts';
import { SUBJECT_COLOR_HEX } from '@/lib/subjectColors';
import { SESSION_LIMITS, type ReviewScope, type SessionLimit } from '@/lib/quickReview';

const shortDate = (iso: string) =>
  new Date(iso).toLocaleDateString('it-IT', { day: 'numeric', month: 'short' });

const cardsLabel = (n: number) => (n === 1 ? '1 card' : `${n} card`);

function subjectMeta(subject: ReviewOverviewSubjectDto): string {
  const exam = subject.nextExam ? ` · Esame ${shortDate(subject.nextExam.date)}` : '';
  if (subject.due) return `${cardsLabel(subject.due)}${exam}`;
  return `Tutto ripassato${exam}`;
}

/** Mastery bar fill: from the neutral border tone (0) to `--ok` (1), so it works in both themes. */
const masteryColor = (mastery: number) =>
  `color-mix(in srgb, var(--ok) ${Math.round(mastery * 100)}%, var(--border-strong))`;

function SubjectRow({
  subject,
  expanded,
  onToggle,
  onStart,
  disabled,
}: {
  subject: ReviewOverviewSubjectDto;
  expanded: boolean;
  onToggle: () => void;
  onStart: (scope: ReviewScope) => void;
  disabled: boolean;
}) {
  const noDue = subject.due === 0;
  const topicsId = `topics-${subject.slug}`;
  return (
    <li className="overflow-hidden rounded-[var(--radius-card)] border border-border bg-bg-surface">
      <div className="flex items-stretch">
        <button
          type="button"
          onClick={() => onStart({ subjectSlug: subject.slug })}
          disabled={noDue || disabled}
          aria-label={
            noDue
              ? `${subject.name}, niente da ripassare`
              : `Ripassa ${subject.name}, ${cardsLabel(subject.due)}`
          }
          className="flex min-h-[68px] min-w-0 flex-1 items-center gap-3 py-3 pl-4 pr-2 text-left disabled:cursor-default"
        >
          <span
            aria-hidden="true"
            className="size-2.5 shrink-0 rounded-full"
            style={{ background: SUBJECT_COLOR_HEX[subject.color] }}
          />
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span
              className={`truncate text-base font-medium ${noDue ? 'text-fg-muted' : 'text-fg-primary'}`}
            >
              {subject.name}
            </span>
            <span className="truncate text-[13px] text-fg-secondary">{subjectMeta(subject)}</span>
          </span>
          <span
            className={`font-mono text-base font-medium tabular-nums ${noDue ? 'text-fg-muted' : 'text-fg-primary'}`}
          >
            {noDue ? '—' : subject.due}
          </span>
        </button>
        {subject.topics.length > 0 && (
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={expanded}
            aria-controls={topicsId}
            aria-label={`Argomenti di ${subject.name}`}
            className="flex w-[52px] shrink-0 items-center justify-center border-l border-border text-fg-secondary"
          >
            <ChevronDown
              size={20}
              strokeWidth={1.75}
              aria-hidden="true"
              className={`transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`}
            />
          </button>
        )}
      </div>
      {expanded && (
        <ul id={topicsId} className="border-t border-border bg-bg-inset">
          {subject.topics.map((topic) => {
            const topicNoDue = topic.due === 0;
            return (
              <li key={topic.id ?? 'none'} className="border-b border-bg-raised last:border-b-0">
                <button
                  type="button"
                  onClick={() => onStart({ subjectSlug: subject.slug, topicId: topic.id })}
                  disabled={topicNoDue || disabled}
                  aria-label={
                    topicNoDue
                      ? `${topic.name}, niente da ripassare`
                      : `Ripassa ${topic.name}, ${cardsLabel(topic.due)}`
                  }
                  className={`flex min-h-14 w-full items-center gap-3 py-2 pl-[38px] pr-4 text-left disabled:cursor-default ${
                    topicNoDue ? 'text-fg-muted' : 'text-fg-primary'
                  }`}
                >
                  <span className="flex min-w-0 flex-1 flex-col gap-1.5">
                    <span className="truncate text-sm font-medium">{topic.name}</span>
                    {topic.id !== null && (
                      <span className="flex items-center gap-2">
                        <span className="h-1 w-16 overflow-hidden rounded-sm bg-border">
                          {topic.mastery !== null && (
                            <span
                              className="block h-1"
                              style={{
                                width: `${Math.round(topic.mastery * 100)}%`,
                                background: masteryColor(topic.mastery),
                              }}
                            />
                          )}
                        </span>
                        <span className="font-mono text-xs text-fg-secondary">
                          padronanza{' '}
                          {topic.mastery === null ? '—' : `${Math.round(topic.mastery * 100)}%`}
                        </span>
                      </span>
                    )}
                  </span>
                  <span className="font-mono text-sm tabular-nums">
                    {topicNoDue ? '—' : topic.due}
                  </span>
                  <ChevronRight size={16} strokeWidth={1.75} aria-hidden="true" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </li>
  );
}

function SkeletonRows() {
  return (
    <ul aria-hidden="true" className="flex flex-col gap-2">
      {[0, 1, 2].map((i) => (
        <li
          key={i}
          className="h-[68px] animate-pulse rounded-[var(--radius-card)] border border-border bg-bg-surface"
        />
      ))}
    </ul>
  );
}

/**
 * Artboard 1 (docs/09-ripasso-mobile.md §C1): today's due count, the session length, the subjects
 * with their topics, "Ripassa tutto" at the bottom. Fills `<main>`; only the list scrolls.
 */
export function QuickReviewHome({
  overview,
  isLoading,
  error,
  onRetry,
  limit,
  onLimitChange,
  onStart,
  starting,
  startError,
  backHref,
}: {
  overview: ReviewOverviewDto | undefined;
  isLoading: boolean;
  error: Error | null;
  onRetry: () => void;
  limit: SessionLimit;
  onLimitChange: (limit: SessionLimit) => void;
  onStart: (scope: ReviewScope) => void;
  starting: boolean;
  startError: string | null;
  /** Deep link of a subject: where "Torna alla materia" leads when the session is empty. */
  backHref?: string | undefined;
}) {
  // First subject with something due starts open; afterwards the user's toggles win.
  const [toggled, setToggled] = useState<Record<string, boolean>>({});
  const firstDue = overview?.subjects.find((s) => s.due > 0)?.slug;
  const isExpanded = (slug: string) => toggled[slug] ?? slug === firstDue;

  const today = new Date().toLocaleDateString('it-IT', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
  const totalDue = overview?.totalDue ?? 0;

  return (
    <div className="flex h-full flex-col bg-bg-base">
      <header className="shrink-0 border-b border-border bg-technical-grid px-5 pb-4 pt-6">
        <p className="font-mono text-xs uppercase tracking-[0.04em] text-fg-secondary">{today}</p>
        <h1 className="mt-1.5 text-2xl font-semibold tracking-[-0.02em]">Ripasso rapido</h1>
        <p className="mt-1 text-sm text-fg-secondary">
          <span className="font-mono text-fg-primary">{overview ? totalDue : '—'}</span> card in
          scadenza oggi
        </p>
        <div className="mt-5">
          <p id="session-length-label" className="mb-2 text-xs font-medium text-fg-secondary">
            Card per sessione
          </p>
          <div role="group" aria-labelledby="session-length-label" className="flex gap-2">
            {SESSION_LIMITS.map((value) => {
              const on = value === limit;
              return (
                <button
                  key={value}
                  type="button"
                  aria-pressed={on}
                  onClick={() => onLimitChange(value)}
                  className={`h-11 flex-1 rounded-[var(--radius-control)] border text-sm font-medium transition-colors duration-120 ${
                    on
                      ? 'border-accent bg-accent-subtle text-fg-primary'
                      : 'border-border bg-bg-surface text-fg-secondary'
                  }`}
                >
                  {value || 'Tutte'}
                </button>
              );
            })}
          </div>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain px-4 pb-2 pt-4">
        {isLoading ? (
          <SkeletonRows />
        ) : error ? (
          <div role="alert" className="flex flex-col items-start gap-3 px-1 py-6 text-sm">
            <p className="text-danger">{error.message}</p>
            <button
              type="button"
              onClick={onRetry}
              className="h-11 rounded-[var(--radius-control)] border border-border-strong px-4 text-fg-primary"
            >
              Riprova
            </button>
          </div>
        ) : overview && overview.totalCards === 0 ? (
          <div className="bg-technical-grid flex flex-col items-start gap-2 rounded-[var(--radius-card)] border border-border px-5 py-6">
            <Layers size={22} strokeWidth={1.75} aria-hidden="true" className="text-fg-secondary" />
            <p className="text-base font-medium">Nessuna flashcard ancora</p>
            <p className="text-sm text-fg-secondary">
              Genera le flashcard dai documenti di una materia: compariranno qui.
            </p>
            <Link
              href="/materie"
              className="mt-2 inline-flex h-11 items-center rounded-[var(--radius-control)] border border-border-strong px-4 text-sm text-fg-primary"
            >
              Vai alle materie
            </Link>
          </div>
        ) : overview ? (
          <>
            {totalDue === 0 && (
              <div className="bg-technical-grid mb-4 flex items-center gap-3 rounded-[var(--radius-card)] border border-border px-4 py-4">
                <CheckCircle2 size={22} strokeWidth={1.75} aria-hidden="true" className="text-ok" />
                <div>
                  <p className="text-sm font-medium">Sei in pari</p>
                  <p className="text-xs text-fg-secondary">
                    Nessuna card in scadenza: la prossima data è qui sotto.
                  </p>
                </div>
              </div>
            )}
            <h2 className="mb-2.5 ml-1 text-xs font-medium text-fg-secondary">
              {totalDue ? 'Tocca una materia o un argomento per partire' : 'Le tue materie'}
            </h2>
            <ul className="flex flex-col gap-2">
              {/* A subject without flashcards has nothing to offer here (it shows on desktop). */}
              {overview.subjects
                .filter((subject) => subject.cardCount > 0)
                .map((subject) => (
                  <SubjectRow
                    key={subject.slug}
                    subject={subject}
                    expanded={isExpanded(subject.slug)}
                    onToggle={() =>
                      setToggled((t) => ({ ...t, [subject.slug]: !isExpanded(subject.slug) }))
                    }
                    onStart={onStart}
                    disabled={starting}
                  />
                ))}
            </ul>
          </>
        ) : null}
      </div>

      {overview && overview.totalCards > 0 && (
        <div className="shrink-0 border-t border-border bg-bg-base px-4 py-3">
          {startError && (
            <p role="alert" className="mb-2 text-center text-xs text-danger">
              {startError}
            </p>
          )}
          {startError && backHref && (
            <Link
              href={backHref}
              className="mb-2 flex min-h-11 items-center justify-center text-sm font-medium text-accent"
            >
              Torna alla materia
            </Link>
          )}
          {totalDue > 0 ? (
            <button
              type="button"
              onClick={() => onStart({})}
              disabled={starting}
              className="flex h-14 w-full items-center justify-center gap-2.5 rounded-[var(--radius-card)] bg-accent text-base font-semibold text-bg-base disabled:opacity-60"
            >
              <Play size={18} strokeWidth={2} aria-hidden="true" />
              {starting ? 'Preparazione…' : 'Ripassa tutto'}
              <span className="font-mono text-sm font-medium">
                {limit && limit < totalDue ? `${limit} di ${totalDue}` : totalDue}
              </span>
            </button>
          ) : (
            <p className="py-2 text-center text-sm text-fg-secondary">
              {overview.nextDueAt
                ? `Prossima scadenza: ${new Date(overview.nextDueAt).toLocaleString('it-IT', {
                    weekday: 'short',
                    day: 'numeric',
                    month: 'short',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}`
                : 'Tutto ripassato'}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
