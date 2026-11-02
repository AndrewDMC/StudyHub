'use client';

import { useEffect, useRef, type KeyboardEvent, type MutableRefObject } from 'react';
import type { SessionItemCitationDto } from '@studyhub/contracts';
import { Button } from '@/components/ui/button';
import { CitationChips, Markdown } from '@/components/SessionBriefing';
import { LessonError, LessonSkeleton } from '@/components/lesson/LessonStatus';
import {
  ratedCount,
  toInlineMath,
  type SelfAssessment,
  type SprintExerciseView,
  type SprintView,
} from '@/lib/lessonClient';
import { cn } from '@/lib/utils';

const OPTIONS: { value: SelfAssessment; label: string; mark: string; selected: string }[] = [
  { value: 'correct', label: 'Giusto', mark: '✓', selected: 'border-ok text-ok bg-bg-raised' },
  {
    value: 'wrong',
    label: 'Sbagliato',
    mark: '✕',
    selected: 'border-danger text-danger bg-bg-raised',
  },
  {
    value: 'unknown',
    label: 'Non so da dove partire',
    mark: '?',
    selected: 'border-warn text-warn bg-bg-raised',
  },
];

/** "Giusto" and "Sbagliato" need the solution on screen; "Non so da dove partire" is always possible. */
export function canChoose(value: SelfAssessment, solutionVisible: boolean): boolean {
  return value === 'unknown' || solutionVisible;
}

function Assessment({
  exercise,
  active,
  busy,
  onRate,
}: {
  exercise: SprintExerciseView;
  active: boolean;
  busy: boolean;
  onRate: (state: SelfAssessment) => void;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const visible = exercise.solution !== null;
  const enabled = OPTIONS.map((o) => active && canChoose(o.value, visible));
  const selectedIndex = OPTIONS.findIndex((o) => o.value === exercise.selfAssessment);
  // Roving tabindex: the selected one, else the first that can be chosen.
  const tabbable =
    selectedIndex >= 0 && enabled[selectedIndex] ? selectedIndex : enabled.indexOf(true);
  const hintId = `sx-hint-${exercise.id}`;
  const showHint = active && !visible;

  function onKeyDown(e: KeyboardEvent, index: number) {
    const dir =
      e.key === 'ArrowRight' || e.key === 'ArrowDown'
        ? 1
        : e.key === 'ArrowLeft' || e.key === 'ArrowUp'
          ? -1
          : 0;
    if (dir === 0) return;
    e.preventDefault();
    for (let step = 1; step <= OPTIONS.length; step++) {
      const next = (index + dir * step + OPTIONS.length * step) % OPTIONS.length;
      if (enabled[next]) {
        refs.current[next]?.focus();
        if (!busy) onRate(OPTIONS[next]!.value);
        return;
      }
    }
  }

  return (
    <div className="space-y-1.5">
      <div
        role="radiogroup"
        aria-label={`Come è andata, esercizio ${exercise.n}`}
        className="flex flex-wrap gap-2 max-md:flex-col"
      >
        {OPTIONS.map((o, i) => {
          const checked = exercise.selfAssessment === o.value;
          const ok = enabled[i]!;
          return (
            <button
              key={o.value}
              ref={(el) => {
                refs.current[i] = el;
              }}
              type="button"
              role="radio"
              aria-checked={checked}
              aria-disabled={ok ? undefined : true}
              aria-describedby={!ok && showHint ? hintId : undefined}
              tabIndex={i === tabbable ? 0 : -1}
              onClick={() => {
                if (ok && !busy && !checked) onRate(o.value);
              }}
              onKeyDown={(e) => onKeyDown(e, i)}
              className={cn(
                'h-9 rounded-[var(--radius-control)] border px-3 text-left text-[13px] outline-none focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent max-md:h-11 max-md:w-full',
                checked ? o.selected : 'border-border-strong text-fg-secondary',
                !ok && 'cursor-default opacity-60',
              )}
            >
              {checked && (
                <span aria-hidden="true" className="mr-1">
                  {o.mark}
                </span>
              )}
              {o.label}
            </button>
          );
        })}
      </div>
      {showHint && (
        <p id={hintId} className="text-xs text-fg-muted">
          Guarda la soluzione per dire se era giusto.
        </p>
      )}
    </div>
  );
}

function ExerciseCardSprint({
  exercise,
  active,
  rating,
  revealing,
  error,
  onRate,
  onReveal,
  onOpenCitation,
}: {
  exercise: SprintExerciseView;
  active: boolean;
  rating: boolean;
  revealing: boolean;
  error: string | null;
  onRate: (state: SelfAssessment) => void;
  onReveal: () => void;
  onOpenCitation: (citation: SessionItemCitationDto) => void;
}) {
  const { solution } = exercise;
  return (
    <li
      aria-busy={rating || revealing}
      className="space-y-3 rounded-[var(--radius-card)] border border-border bg-bg-surface p-4"
    >
      <div className="flex flex-wrap items-baseline gap-2 text-sm">
        <h3 id={`sx-${exercise.id}`} className="font-semibold text-fg-primary">
          Esercizio {exercise.n}
        </h3>
        {exercise.origin && (
          <span className="ml-auto text-xs text-fg-secondary">{exercise.origin}</span>
        )}
      </div>
      <div className="text-fg-primary [&_.md-obsidian]:text-[15px]">
        <Markdown source={exercise.question} />
      </div>

      {solution === null ? (
        active && (
          <Button
            type="button"
            size="sm"
            variant="secondary"
            aria-busy={revealing}
            disabled={revealing}
            onClick={onReveal}
            className="max-md:min-h-11"
          >
            {revealing ? 'Carico…' : 'Mostra la soluzione'}
          </Button>
        )
      ) : (
        <div className="space-y-2 rounded-[var(--radius-control)] border border-border bg-bg-inset p-3">
          <p className="text-xs font-medium uppercase tracking-wide text-fg-muted">Soluzione</p>
          <ol
            aria-live="polite"
            aria-relevant="additions"
            className="list-decimal space-y-2 pl-5 text-fg-secondary marker:text-fg-secondary"
          >
            {solution.steps.map((step, i) => (
              <li key={i}>
                <Markdown source={step.text} />
                {step.formula && (
                  <div className="overflow-x-auto">
                    <Markdown source={toInlineMath(step.formula)} />
                  </div>
                )}
              </li>
            ))}
          </ol>
          <CitationChips citations={solution.citations} onOpen={onOpenCitation} />
          {exercise.concepts.length > 0 && (
            <p className="text-xs text-fg-secondary">Concetti: {exercise.concepts.join(' · ')}</p>
          )}
        </div>
      )}

      <Assessment exercise={exercise} active={active} busy={rating} onRate={onRate} />
      {error && (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}
    </li>
  );
}

/**
 * First phase of a sprint lesson: three exam-style exercises to try at once, with the solution one tap
 * away and a three-way self-assessment. The theory only comes after, for what went wrong.
 */
export function SprintExercisesStep({
  view,
  loading,
  loadError,
  active,
  hasDocuments,
  generating,
  generateError,
  ratingId,
  revealingId,
  actionError,
  onGenerate,
  asked,
  onRate,
  onReveal,
  onOpenCitation,
}: {
  view: SprintView | undefined;
  loading: boolean;
  loadError: string | null;
  active: boolean;
  hasDocuments: boolean;
  /** The request that starts the generation is on its way. */
  generating: boolean;
  generateError: string | null;
  ratingId: string | null;
  revealingId: string | null;
  actionError: { id: string; message: string } | null;
  onGenerate: () => void;
  /** Whether the first generation was already asked (kept by the shell, so it survives a remount). */
  asked: MutableRefObject<boolean>;
  onRate: (id: string, state: SelfAssessment) => void;
  onReveal: (id: string) => void;
  onOpenCitation: (citation: SessionItemCitationDto) => void;
}) {
  const exercises = view?.exercises ?? [];
  const job = view?.job ?? null;
  const inFlight = job?.status === 'queued' || job?.status === 'running';
  const failedError =
    generateError ?? (job?.status === 'failed' ? (job.error ?? 'errore sconosciuto') : null);
  const canStart =
    !!view &&
    active &&
    hasDocuments &&
    exercises.length === 0 &&
    !job &&
    !generating &&
    !generateError;

  // Opening the phase asks for the exercises by itself, once (the POST is idempotent).
  useEffect(() => {
    if (!canStart || asked.current) return;
    asked.current = true;
    onGenerate();
  }, [canStart]);

  const rated = view ? ratedCount(view) : 0;
  const fromExams = exercises.some((e) => e.origin);

  let body;
  if (!view) {
    body = loadError ? (
      <p role="alert" className="text-sm text-danger">
        {loadError}
      </p>
    ) : (
      <p role="status" className="text-sm text-fg-secondary">
        {loading ? 'Caricamento…' : ''}
      </p>
    );
  } else if (exercises.length > 0) {
    body = (
      <>
        <ul className="space-y-3">
          {exercises.map((e) => (
            <ExerciseCardSprint
              key={e.id}
              exercise={e}
              active={active}
              rating={ratingId === e.id}
              revealing={revealingId === e.id}
              error={actionError?.id === e.id ? actionError.message : null}
              onRate={(state) => onRate(e.id, state)}
              onReveal={() => onReveal(e.id)}
              onOpenCitation={onOpenCitation}
            />
          ))}
        </ul>
        {rated === 0 && (
          <p className="text-xs text-fg-muted">
            Segna almeno un esercizio per sapere cosa ripassare.
          </p>
        )}
      </>
    );
  } else if (inFlight || generating) {
    body = <LessonSkeleton label="Sto preparando 3 esercizi dal materiale…" />;
  } else if (failedError !== null) {
    body = (
      <LessonError
        what="gli esercizi"
        error={failedError}
        retrying={generating}
        onRetry={onGenerate}
      />
    );
  } else if (!hasDocuments) {
    body = (
      <p className="rounded-[var(--radius-card)] border border-dashed border-border p-6 text-sm text-fg-secondary">
        Nessun documento in questa sessione: scegli un argomento prima di iniziare.
      </p>
    );
  } else if (!active) {
    body = (
      <p className="rounded-[var(--radius-card)] border border-dashed border-border p-6 text-sm text-fg-secondary">
        Gli esercizi di questa lezione non sono stati generati.
      </p>
    );
  } else {
    body = <LessonSkeleton label="Sto preparando 3 esercizi dal materiale…" />;
  }

  return (
    <section
      aria-labelledby="sx-title"
      className="space-y-4 rounded-[var(--radius-card)] border border-border bg-bg-surface p-5 max-md:border-0 max-md:bg-transparent max-md:px-0 md:p-6"
    >
      <div className="space-y-1">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h2
            id="sx-title"
            data-phase-heading
            tabIndex={-1}
            className="text-xl font-semibold text-fg-primary outline-none"
          >
            Prova subito, anche senza saperlo fare
          </h2>
          {exercises.length > 0 && view && (
            <p className="text-xs text-fg-muted">
              {rated} di {exercises.length} segnati
              {view.costEur > 0 ? ` · Costo AI: €${view.costEur.toFixed(4)}` : ''}
            </p>
          )}
        </div>
        {exercises.length > 0 && (
          <p className="text-sm text-fg-secondary">
            {exercises.length} esercizi{' '}
            {fromExams ? 'dai temi d’esame' : 'nello stile d’esame, preparati dal materiale'}. Segna
            come ti è andata: la teoria arriva dopo, solo dove serve.
          </p>
        )}
      </div>
      {body}
    </section>
  );
}
