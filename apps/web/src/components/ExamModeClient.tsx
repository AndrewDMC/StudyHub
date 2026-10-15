'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useIsMobile } from '@/lib/useIsMobile';
import { formatClock, useExamAttempt, type ExamAttemptState } from '@/lib/useExamAttempt';
import { ExamMobile } from './simulation-mobile/ExamMobile';

/**
 * Modalità Esame (docs/fasi/F5-esami-simulazioni.md): timer, one item at a
 * time or the whole paper, autosave, no AI help. The logic lives in `useExamAttempt`.
 */
function ExamModeDesktop({ subjectSlug, exam }: { subjectSlug: string; exam: ExamAttemptState }) {
  const { attempt, answers, remaining, saveState, error, submitError, onAnswerChange, submit } =
    exam;
  const [index, setIndex] = useState(0);
  const [showAll, setShowAll] = useState(false);

  if (error && !attempt) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-sm">
        <p role="alert" className="text-danger">
          {error}
        </p>
        <Link href={`/materie/${subjectSlug}`} className="text-fg-secondary underline">
          Torna alla materia
        </Link>
      </div>
    );
  }
  if (!attempt) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-fg-muted">
        Preparazione esame…
      </div>
    );
  }

  const items = showAll ? attempt.items : attempt.items.slice(index, index + 1);
  const lowTime = remaining <= 300;

  return (
    <div className="flex h-full flex-col bg-bg-base text-fg-primary">
      <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-3 text-xs md:px-6">
        <span className="text-fg-muted">
          Modalità esame<span className="max-md:hidden"> · nessun aiuto disponibile</span>
        </span>
        <span
          className={`font-mono text-base tabular-nums ${lowTime ? 'text-warn' : 'text-fg-primary'}`}
          aria-live={lowTime ? 'polite' : 'off'}
        >
          {formatClock(remaining)}
        </span>
        <span className="text-fg-muted" aria-live="polite">
          {saveState === 'saving' && 'Salvataggio…'}
          {saveState === 'saved' && 'Salvato'}
          {saveState === 'error' && <span className="text-danger">{error}</span>}
        </span>
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 overflow-y-auto px-4 py-4 md:px-6 md:py-6">
        <div className="mb-4 flex items-center justify-between text-xs text-fg-muted">
          <button
            type="button"
            onClick={() => setShowAll((v) => !v)}
            className="underline hover:text-fg-secondary max-md:-my-3 max-md:py-3"
          >
            {showAll ? 'Un esercizio alla volta' : 'Vista completa'}
          </button>
          {!showAll && (
            <span className="font-mono tabular-nums">
              {index + 1} / {attempt.items.length}
            </span>
          )}
        </div>

        <ol className="space-y-6">
          {items.map((item) => (
            <li
              key={item.id}
              className="rounded-[var(--radius-card)] border border-border bg-bg-surface p-4"
            >
              <div className="mb-2 flex items-baseline justify-between gap-3">
                <p className="text-sm font-medium">
                  {item.ord + 1}. {item.prompt}
                </p>
                <span className="shrink-0 font-mono text-[11px] tabular-nums text-fg-muted">
                  {item.points} pt
                </span>
              </div>
              <label className="sr-only" htmlFor={`answer-${item.id}`}>
                Risposta all&apos;esercizio {item.ord + 1}
              </label>
              <textarea
                id={`answer-${item.id}`}
                value={answers[item.id] ?? ''}
                onChange={(e) => onAnswerChange(item.id, e.target.value)}
                rows={8}
                className="w-full rounded-[var(--radius-control)] border border-border bg-bg-inset px-3 py-2 text-sm text-fg-primary outline-none focus:border-accent"
              />
            </li>
          ))}
        </ol>

        {!showAll && (
          <div className="mt-4 flex justify-between">
            <button
              type="button"
              onClick={() => setIndex((i) => Math.max(0, i - 1))}
              disabled={index === 0}
              className="rounded-[var(--radius-control)] border border-border px-3 py-1.5 text-sm text-fg-secondary disabled:opacity-40 max-md:min-h-11"
            >
              Precedente
            </button>
            <button
              type="button"
              onClick={() => setIndex((i) => Math.min(attempt.items.length - 1, i + 1))}
              disabled={index >= attempt.items.length - 1}
              className="rounded-[var(--radius-control)] border border-border px-3 py-1.5 text-sm text-fg-secondary disabled:opacity-40 max-md:min-h-11"
            >
              Successivo
            </button>
          </div>
        )}
      </main>

      <footer className="flex items-center justify-end gap-3 border-t border-border px-4 py-3 md:px-6">
        {submitError && (
          <p role="alert" className="text-xs text-danger">
            {submitError}
          </p>
        )}
        <button
          type="button"
          onClick={() => {
            if (window.confirm("Consegnare l'esame? Le risposte non saranno più modificabili."))
              void submit();
          }}
          className="rounded-[var(--radius-control)] bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover max-md:min-h-11"
        >
          Consegna
        </button>
      </footer>
    </div>
  );
}

/**
 * One branch mounted at a time, but one attempt: the hook lives here so that rotating the device
 * across md swaps the view without starting the attempt again or losing the typed text.
 */
export function ExamModeClient(props: { subjectSlug: string; simulationId: string }) {
  const isMobile = useIsMobile();
  const exam = useExamAttempt({ ...props, navigation: isMobile ? 'replace' : 'push' });
  if (isMobile === null) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-fg-muted">
        Preparazione esame…
      </div>
    );
  }
  return isMobile ? (
    <ExamMobile {...props} exam={exam} />
  ) : (
    <ExamModeDesktop subjectSlug={props.subjectSlug} exam={exam} />
  );
}
