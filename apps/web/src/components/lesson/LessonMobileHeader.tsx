'use client';

import Link from 'next/link';
import { ChevronLeft, Pause, Play } from 'lucide-react';
import { formatClock } from '@/components/PomodoroTimer';

/**
 * Top of the lesson on a phone: back to the subject, title, "Termina" (which goes to Ricorda, where
 * the lesson is closed on purpose) and the study clock with its pause.
 */
export function LessonMobileHeader({
  slug,
  title,
  method,
  minutes,
  active,
  closesSession,
  shownMs,
  progressLabel,
  running,
  onToggleRun,
  onTerminate,
  terminatedChip,
}: {
  slug: string;
  title: string;
  method: 'standard' | 'sprint';
  minutes: number | null;
  active: boolean;
  /** "Termina" closes the session (older sprint lesson, no Ricorda) instead of going to Ricorda. */
  closesSession: boolean;
  shownMs: number;
  progressLabel: string;
  running: boolean;
  onToggleRun: () => void;
  /** `null`: no button (already in Ricorda, or the session is over). */
  onTerminate: (() => void) | null;
  terminatedChip: string | null;
}) {
  const minutesTotal = Math.floor(shownMs / 60000);
  const seconds = Math.floor(shownMs / 1000) % 60;
  return (
    <header className="pt-[env(safe-area-inset-top)]">
      <div className="flex items-center gap-2 px-3 pb-2 pt-3">
        <Link
          href={`/materie/${slug}`}
          aria-label="Torna alla materia"
          className="flex size-11 shrink-0 items-center justify-center rounded-[var(--radius-control)] text-fg-secondary outline-none hover:text-fg-primary focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
        >
          <ChevronLeft className="size-5" aria-hidden="true" />
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-[17px] font-semibold tracking-[-0.02em] text-fg-primary">
            {title}
          </h1>
          {terminatedChip ? (
            <p className="mt-0.5">
              <span className="inline-block rounded-full bg-ok/15 px-2 py-0.5 text-xs text-ok">
                {terminatedChip}
              </span>
            </p>
          ) : (
            <p className="truncate text-[13px] text-fg-secondary">
              {minutes ? `${minutes} min previsti · ` : ''}
              <span className={method === 'sprint' ? 'text-info' : 'text-accent-hover'}>
                {method === 'sprint' ? 'Sprint' : 'Standard'}
              </span>
            </p>
          )}
        </div>
        {onTerminate && (
          <button
            type="button"
            aria-label={closesSession ? 'Termina la lezione' : 'Termina: vai a Ricorda'}
            onClick={onTerminate}
            className="h-11 shrink-0 rounded-[var(--radius-control)] border border-border-strong px-3 text-sm text-fg-primary outline-none focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
          >
            Termina
          </button>
        )}
      </div>
      <div className="mx-4 flex items-center gap-2.5 rounded-lg border border-border bg-bg-surface py-1 pl-3 pr-1">
        <span
          aria-hidden="true"
          className={`size-2 shrink-0 rounded-full ${active && running ? 'bg-ok' : 'bg-border-strong'}`}
        />
        <span
          aria-label={`Tempo di studio: ${minutesTotal} minuti e ${seconds} secondi`}
          className="font-mono text-sm tabular-nums text-fg-primary"
        >
          {formatClock(shownMs)}
        </span>
        <span className="min-h-11 min-w-0 flex-1 truncate text-[13px] leading-[2.75rem] text-fg-secondary">
          {progressLabel}
        </span>
        {active && (
          <button
            type="button"
            aria-label={running ? 'Metti in pausa' : 'Riprendi lo studio'}
            onClick={onToggleRun}
            className="flex size-11 shrink-0 items-center justify-center rounded-[var(--radius-control)] text-fg-secondary outline-none hover:text-fg-primary focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
          >
            {running ? (
              <Pause className="size-4" aria-hidden="true" />
            ) : (
              <Play className="size-4" aria-hidden="true" />
            )}
          </button>
        )}
      </div>
    </header>
  );
}
