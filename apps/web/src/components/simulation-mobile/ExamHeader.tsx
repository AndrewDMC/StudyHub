'use client';

import type { MouseEventHandler, Ref } from 'react';
import Link from 'next/link';
import { Clock, X } from 'lucide-react';
import { formatClock } from '@/lib/useExamAttempt';
import { lowTimeAnnouncement } from '@/lib/simulationMobile';
import { iconButton } from '../document-mobile/DocHeader';

/**
 * Sticky header of the exam: exit, title, save state, timer and the "no help" banner. Before the
 * attempt is loaded (`clock` null) exit is a plain link: there is nothing to save yet.
 */
export function ExamHeader({
  title,
  exitHref,
  onExit,
  exitRef,
  clock,
  saveText,
  saveFailed,
}: {
  title: string;
  exitHref: string;
  /** Opens the exit confirmation; absent while the attempt is loading. */
  onExit?: MouseEventHandler<HTMLButtonElement>;
  exitRef?: Ref<HTMLButtonElement>;
  /** Remaining seconds, null until the attempt is loaded. */
  clock: number | null;
  saveText: string;
  saveFailed: boolean;
}) {
  const low = clock !== null && clock <= 300;
  return (
    <header className="sticky top-0 z-10 border-b border-border bg-bg-surface pt-[env(safe-area-inset-top)]">
      <div className="flex h-14 items-center gap-1 px-1">
        {onExit ? (
          <button
            type="button"
            ref={exitRef}
            aria-label="Esci dalla simulazione"
            aria-haspopup="dialog"
            onClick={onExit}
            className={iconButton}
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        ) : (
          <Link href={exitHref} aria-label="Esci dalla simulazione" className={iconButton}>
            <X className="h-5 w-5" aria-hidden="true" />
          </Link>
        )}
        <div className="min-w-0 flex-1 px-1">
          <h1 className="truncate text-[15px] font-semibold leading-tight">{title}</h1>
          <p
            aria-live="polite"
            className={`truncate text-xs ${saveFailed ? 'text-danger' : 'text-fg-muted'}`}
          >
            {saveText}
          </p>
        </div>
        {clock !== null && (
          <div
            role="timer"
            aria-label="Tempo rimasto"
            aria-live="off"
            className={`flex shrink-0 items-center gap-1.5 pr-3 font-mono text-base font-semibold tabular-nums ${low ? 'text-warn' : 'text-fg-primary'}`}
          >
            <Clock className="size-4" aria-hidden="true" />
            {formatClock(clock)}
          </div>
        )}
      </div>
      <p className="bg-[color-mix(in_srgb,var(--warn)_8%,transparent)] px-4 py-1.5 text-center text-xs text-warn">
        Modalità esame · nessun aiuto disponibile
      </p>
      <p role="status" className="sr-only">
        {clock !== null ? lowTimeAnnouncement(clock) : ''}
      </p>
    </header>
  );
}
