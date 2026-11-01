'use client';

import { useRef, type KeyboardEvent } from 'react';
import { cn } from '@/lib/utils';
import { phaseStatusLabel, type StepStatus } from '@/lib/lessonClient';

/**
 * The phases of the lesson on a phone: one short bar per phase with its name under it, all in view
 * (no horizontal scroll). Navigation is free like in `PhaseStepper`: Left/Right/Home/End move the focus,
 * Enter or Space opens the phase. Sticks to the top while the lesson scrolls.
 */
export function PhaseStepperCompact<P extends string>({
  current,
  phases,
  statusOf,
  ariaLabel = 'Fasi della lezione',
  onSelect,
}: {
  current: P;
  phases: { id: P; label: string }[];
  statusOf: (phase: P) => StepStatus;
  ariaLabel?: string;
  onSelect: (phase: P) => void;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

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
    <nav aria-label={ariaLabel} className="sticky top-[env(safe-area-inset-top)] z-30 bg-bg-base">
      <ol
        data-current={current}
        className={cn(
          'grid gap-1 px-4 pb-1.5 pt-2',
          phases.length === 4 ? 'grid-cols-4' : 'grid-cols-5',
        )}
      >
        {phases.map((phase, i) => {
          const status = statusOf(phase.id);
          return (
            <li key={phase.id} className="min-w-0">
              <button
                ref={(el) => {
                  refs.current[i] = el;
                }}
                type="button"
                aria-current={status === 'current' ? 'step' : undefined}
                aria-label={`Fase ${i + 1} di ${phases.length}: ${phase.label}, ${phaseStatusLabel(status)}`}
                onClick={() => onSelect(phase.id)}
                onKeyDown={(e) => onKeyDown(e, i)}
                className="flex min-h-[52px] w-full flex-col items-center justify-center gap-1 rounded-[var(--radius-control)] px-0 py-1 outline-none focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    'h-1 w-full rounded-sm',
                    status === 'done' ? 'bg-ok' : status === 'current' ? 'bg-accent' : 'bg-border',
                  )}
                />
                <span
                  aria-hidden="true"
                  className={cn(
                    'flex w-full items-center justify-center gap-0.5 text-xs font-medium',
                    status === 'current' ? 'text-fg-primary' : 'text-fg-secondary',
                  )}
                >
                  {status === 'done' && <span className="text-ok">✓</span>}
                  <span className="truncate">{phase.label}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
