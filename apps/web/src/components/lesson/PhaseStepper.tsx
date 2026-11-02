'use client';

import { useEffect, useRef, type KeyboardEvent } from 'react';
import { cn } from '@/lib/utils';
import {
  LESSON_PHASES,
  stepStatus,
  type PhaseProgress,
  type StandardPhase,
  type StepStatus,
} from '@/lib/lessonClient';

/** Tailwind needs the whole class name: one constant per number of phases. */
const GRID_COLUMNS: Record<number, string> = {
  4: 'grid-cols-[repeat(4,minmax(7.5rem,1fr))] md:grid-cols-[repeat(4,minmax(9.5rem,1fr))]',
  5: 'grid-cols-[repeat(5,minmax(7.5rem,1fr))] md:grid-cols-[repeat(5,minmax(9.5rem,1fr))]',
};

export type StepperPhase<P extends string = StandardPhase> = { id: P; label: string; sub: string };

const STATUS_TEXT: Record<StepStatus, string> = {
  done: ', fatta',
  current: ', fase corrente',
  todo: ', da fare',
};

/**
 * The phases of the lesson (the five standard ones, or the four of a sprint lesson via `phases` and
 * `statusOf`). Navigation is free: every step can be opened at any time (nothing is locked),
 * Left/Right/Home/End only move the focus and Enter or Space opens the step.
 */
export function PhaseStepper<P extends string = StandardPhase>({
  current,
  progress,
  phases = LESSON_PHASES as unknown as StepperPhase<P>[],
  statusOf,
  ariaLabel = 'Fasi della lezione',
  onSelect,
}: {
  current: P;
  /** Standard lesson: how far the student went (ignored when `statusOf` is given). */
  progress?: PhaseProgress;
  phases?: StepperPhase<P>[];
  statusOf?: (phase: P) => StepStatus;
  ariaLabel?: string;
  onSelect: (phase: P) => void;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const first = useRef(true);

  // Keep the current step in sight in the horizontal scroll (never on the first render).
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const el = refs.current[phases.findIndex((p) => p.id === current)];
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    el?.scrollIntoView?.({
      inline: 'center',
      block: 'nearest',
      behavior: reduce ? 'auto' : 'smooth',
    });
  }, [current]);

  function onKeyDown(e: KeyboardEvent, index: number) {
    const last = phases.length - 1;
    const next =
      e.key === 'ArrowRight'
        ? Math.min(index + 1, last)
        : e.key === 'ArrowLeft'
          ? Math.max(index - 1, 0)
          : e.key === 'Home'
            ? 0
            : e.key === 'End'
              ? last
              : null;
    if (next === null) return;
    e.preventDefault();
    refs.current[next]?.focus();
  }

  return (
    <nav aria-label={ariaLabel}>
      <ol
        className={cn('grid gap-2 overflow-x-auto', GRID_COLUMNS[phases.length] ?? GRID_COLUMNS[5])}
      >
        {phases.map((phase, i) => {
          const status = statusOf
            ? statusOf(phase.id)
            : stepStatus(
                phase.id as unknown as StandardPhase,
                current as unknown as StandardPhase,
                progress!,
              );
          return (
            <li key={phase.id} className="min-w-0">
              <button
                ref={(el) => {
                  refs.current[i] = el;
                }}
                type="button"
                aria-current={status === 'current' ? 'step' : undefined}
                onClick={() => onSelect(phase.id)}
                onKeyDown={(e) => onKeyDown(e, i)}
                className={cn(
                  'flex min-h-[3.25rem] w-full items-center gap-2.5 rounded-[var(--radius-card)] border px-3 py-2 text-left outline-none focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent',
                  status === 'current'
                    ? 'border-accent/40 bg-bg-raised'
                    : 'border-border hover:bg-bg-raised',
                )}
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    'flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold',
                    status === 'done'
                      ? 'bg-ok text-bg-base'
                      : status === 'current'
                        ? 'bg-accent text-bg-base'
                        : 'bg-border text-fg-secondary',
                  )}
                >
                  {status === 'done' ? '✓' : i + 1}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-[13px] font-medium text-fg-primary">
                    {phase.label}
                    <span className="sr-only">{STATUS_TEXT[status]}</span>
                  </span>
                  <span className="block truncate text-[11px] text-fg-secondary max-md:hidden">
                    {phase.sub}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
