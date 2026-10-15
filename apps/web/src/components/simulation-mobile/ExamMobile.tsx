'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useId, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { SimulationSummaryDto } from '@studyhub/contracts';
import { answeredCount, formatPoints } from '@/lib/simulationMobile';
import type { ExamAttemptState } from '@/lib/useExamAttempt';
import { getJson } from '../ExamPrepPanel';
import { ExamFooter } from './ExamFooter';
import { ExamHeader } from './ExamHeader';
import { ExitSheet } from './ExitSheet';
import { ExerciseStrip } from './ExerciseStrip';
import { SubmitSheet } from './SubmitSheet';
import { fieldClass, secondaryButton } from './styles';

const PLACEHOLDERS = {
  open: 'Scrivi qui il procedimento…',
  numeric: 'Scrivi il risultato e il procedimento…',
  proof: 'Scrivi la dimostrazione…',
  mcq: 'Scrivi la risposta scelta…',
} as const;

/** Exam mode below md: one exercise at a time, sticky timer, sheets for exit and hand-in. */
export function ExamMobile({
  subjectSlug: slug,
  simulationId,
  exam,
}: {
  subjectSlug: string;
  simulationId: string;
  exam: ExamAttemptState;
}) {
  const router = useRouter();
  const { attempt, answers, remaining, saveState, error, submitError, isSubmitting, expired } =
    exam;
  const [index, setIndex] = useState(0);
  const [exitOpen, setExitOpen] = useState(false);
  const [submitOpen, setSubmitOpen] = useState(false);
  const exitRef = useRef<HTMLButtonElement>(null);
  const submitRef = useRef<HTMLButtonElement>(null);
  const mainRef = useRef<HTMLElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const firstRender = useRef(true);
  const answerId = useId();

  const sims = useQuery({
    queryKey: ['simulations', slug],
    queryFn: () =>
      getJson<SimulationSummaryDto[]>(`/api/subjects/${slug}/simulations`, 'simulations'),
  });
  const title = sims.data?.find((s) => s.id === simulationId)?.title ?? 'Simulazione';
  const backHref = `/materie/${slug}?tab=simulazioni`;

  useEffect(() => {
    document.documentElement.dataset.fullscreen = '';
    return () => {
      delete document.documentElement.dataset.fullscreen;
    };
  }, []);

  // After changing exercise: back to the top and the heading, so screen readers start on it.
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    mainRef.current?.scrollTo({ top: 0 });
    headingRef.current?.focus({ preventScroll: true });
  }, [index]);

  // The hand-in (user or timer) closes any open sheet.
  useEffect(() => {
    if (isSubmitting && remaining === 0) {
      setSubmitOpen(false);
      setExitOpen(false);
    }
  }, [isSubmitting, remaining]);

  const shell = (children: React.ReactNode) => (
    <div className="flex h-full min-w-0 flex-col bg-bg-base text-fg-primary">{children}</div>
  );

  if (error && !attempt) {
    return shell(
      <>
        <ExamHeader title={title} exitHref={backHref} clock={null} saveText="" saveFailed={false} />
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center text-sm">
          <p role="alert" className="text-danger">
            {error}
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className={`${secondaryButton} min-h-11 max-w-xs`}
          >
            Riprova
          </button>
          <Link href={backHref} className="flex min-h-11 items-center text-fg-secondary underline">
            Torna alla materia
          </Link>
        </div>
      </>,
    );
  }

  if (!attempt) {
    return shell(
      <>
        <ExamHeader title={title} exitHref={backHref} clock={null} saveText="" saveFailed={false} />
        <div
          role="status"
          className="flex flex-1 items-center justify-center text-sm text-fg-muted"
        >
          Preparazione esame…
        </div>
      </>,
    );
  }

  if (attempt.status !== 'in_progress') {
    return shell(
      <>
        <ExamHeader title={title} exitHref={backHref} clock={null} saveText="" saveFailed={false} />
        <div
          role="status"
          className="flex flex-1 items-center justify-center p-6 text-center text-sm text-fg-muted"
        >
          Esame già consegnato. Apro i risultati…
        </div>
      </>,
    );
  }

  const items = attempt.items;
  const item = items[Math.min(index, items.length - 1)]!;
  const itemIndex = items.indexOf(item);
  const locked = expired || remaining === 0 || isSubmitting;
  const saveFailed = saveState === 'error';
  const saveText =
    saveState === 'saving'
      ? 'Salvataggio…'
      : saveState === 'saved'
        ? 'Salvato'
        : saveFailed
          ? (error ?? 'Salvataggio fallito')
          : 'Le risposte si salvano da sole';
  const lockedMessage = expired
    ? "Tempo scaduto: l'esame è stato consegnato. Apro i risultati…"
    : remaining === 0
      ? "Tempo scaduto. Consegno l'esame…"
      : isSubmitting
        ? "Consegno l'esame…"
        : null;

  return shell(
    <>
      <ExamHeader
        title={title}
        exitHref={backHref}
        onExit={() => setExitOpen(true)}
        exitRef={exitRef}
        clock={remaining}
        saveText={saveText}
        saveFailed={saveFailed}
      />
      {saveFailed && !expired && (
        <p role="alert" className="shrink-0 bg-bg-surface px-4 py-2 text-[13px] text-danger">
          Le ultime modifiche potrebbero non essere salvate.
        </p>
      )}
      <ExerciseStrip items={items} answers={answers} index={itemIndex} onSelect={setIndex} />

      <main ref={mainRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        <div className="mb-2 flex items-baseline justify-between gap-3 text-xs text-fg-muted">
          <span>
            Esercizio {item.ord + 1} di {items.length}
          </span>
          <span className="font-mono tabular-nums">
            {formatPoints(item.points)} {item.points === 1 ? 'punto' : 'punti'}
          </span>
        </div>
        <h2
          ref={headingRef}
          tabIndex={-1}
          className="whitespace-pre-wrap break-words text-lg font-semibold leading-snug outline-none"
        >
          {item.prompt}
        </h2>
        {lockedMessage && (
          <p role="status" className="mt-3 text-[13px] text-warn">
            {lockedMessage}
          </p>
        )}
        <label
          htmlFor={`${answerId}-${item.id}`}
          className="mt-4 mb-1 block text-xs text-fg-secondary"
        >
          La tua risposta
        </label>
        <textarea
          id={`${answerId}-${item.id}`}
          value={answers[item.id] ?? ''}
          onChange={(e) => exam.onAnswerChange(item.id, e.target.value)}
          readOnly={locked}
          maxLength={20000}
          placeholder={PLACEHOLDERS[item.kind]}
          className={`${fieldClass} min-h-[220px] resize-none py-2`}
        />
      </main>

      <ExamFooter
        isFirst={itemIndex === 0}
        isLast={itemIndex === items.length - 1}
        disabled={locked && itemIndex === items.length - 1}
        onPrevious={() => setIndex(Math.max(0, itemIndex - 1))}
        onNext={() => setIndex(Math.min(items.length - 1, itemIndex + 1))}
        onSubmit={() => setSubmitOpen(true)}
        submitRef={submitRef}
      />

      <ExitSheet
        open={exitOpen}
        onOpenChange={setExitOpen}
        onExit={async () => {
          if (!(await exam.flush())) return false;
          router.push(backHref);
          return true;
        }}
        returnFocusRef={exitRef}
      />
      <SubmitSheet
        open={submitOpen}
        onOpenChange={setSubmitOpen}
        answered={answeredCount(items, answers)}
        total={items.length}
        isSubmitting={isSubmitting}
        error={submitError}
        onSubmit={() => void exam.submit()}
        returnFocusRef={submitRef}
      />
    </>,
  );
}
