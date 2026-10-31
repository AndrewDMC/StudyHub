'use client';

import { useEffect, useState, type MutableRefObject } from 'react';
import type {
  CheckLessonBlockResponse,
  LessonBlockDto,
  SessionItemCitationDto,
} from '@studyhub/contracts';
import { Button } from '@/components/ui/button';
import { LessonBlock } from '@/components/lesson/LessonBlock';
import { OutlineRow } from '@/components/lesson/LessonOutline';
import { LessonError, LessonSkeleton } from '@/components/lesson/LessonStatus';
import {
  conceptsWithoutBlock,
  interruptionText,
  ratedCount,
  theoryIsEmpty,
  type LessonInterruption,
  type SprintConceptView,
  type SprintExerciseView,
  type SprintPhase,
  type SprintView,
  type useLesson,
} from '@/lib/lessonClient';
import { cn } from '@/lib/utils';

type Lesson = ReturnType<typeof useLesson>;

const GROUP_TONE = {
  correct: { label: 'giusto', mark: '✓', tone: 'text-ok' },
  wrong: { label: 'sbagliato', mark: '✕', tone: 'text-danger' },
  unknown: { label: 'non sapevo partire', mark: '?', tone: 'text-warn' },
} as const;

/** The concepts of one exercise, and for each whether this exercise is the one that shows its block. */
export function conceptsOfExercise(
  exercise: Pick<SprintExerciseView, 'id'>,
  view: Pick<SprintView, 'exercises' | 'theory'>,
): { concept: SprintConceptView; owner: boolean }[] {
  return view.theory.concepts
    .filter((c) => c.exerciseIds.includes(exercise.id))
    .map((concept) => {
      const first = view.exercises.find((e) => concept.exerciseIds.includes(e.id));
      return { concept, owner: first?.id === exercise.id };
    });
}

function firstLine(text: string): string {
  return (text.split('\n').find((l) => l.trim() !== '') ?? '').replace(/[#*_`$]/g, '').trim();
}

/** Index of the sprint theory: one group per exercise, with the blocks of the concepts it needs. */
export function SprintTheoryIndex({
  view,
  blocks,
  currentIndex,
  onSelect,
  onGoExercises,
}: {
  view: SprintView;
  blocks: LessonBlockDto[];
  currentIndex: number;
  onSelect: (index: number) => void;
  onGoExercises: () => void;
}) {
  const byId = new Map(blocks.map((b) => [b.id, b]));
  return (
    <nav aria-label="Teoria per esercizio" className="min-w-0">
      <ol className="flex gap-3 overflow-x-auto lg:flex-col lg:overflow-visible">
        {view.exercises.map((e) => {
          const tone = e.selfAssessment ? GROUP_TONE[e.selfAssessment] : null;
          const concepts = conceptsOfExercise(e, view);
          const failed = e.selfAssessment === 'wrong' || e.selfAssessment === 'unknown';
          return (
            <li key={e.id} className="min-w-[10rem] space-y-1 lg:min-w-0">
              <section aria-labelledby={`sth-${e.id}`} className="space-y-1">
                <h3 id={`sth-${e.id}`} className="text-xs font-medium text-fg-primary">
                  Esercizio {e.n}
                  {' · '}
                  {tone ? (
                    <span className={tone.tone}>
                      <span aria-hidden="true">{tone.mark} </span>
                      {tone.label}
                    </span>
                  ) : (
                    <span className="text-fg-muted">non ancora segnato</span>
                  )}
                </h3>
                <p className="line-clamp-2 text-xs text-fg-secondary">{firstLine(e.question)}</p>
                {!tone && (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={onGoExercises}
                    className="max-md:min-h-11"
                  >
                    Vai all&apos;esercizio
                  </Button>
                )}
                {e.selfAssessment === 'correct' && (
                  <p className="text-xs text-fg-secondary">Nessuna teoria da recuperare.</p>
                )}
                {failed && (
                  <>
                    {e.concepts.length > 0 && (
                      <p className="text-xs text-fg-secondary">
                        Ti sei bloccato su: {e.concepts.join(', ')}.
                      </p>
                    )}
                    <ul className="space-y-0.5">
                      {concepts.map(({ concept, owner }) => {
                        const block = concept.blockId ? byId.get(concept.blockId) : undefined;
                        if (!owner) {
                          return (
                            <li key={concept.title}>
                              {block ? (
                                <button
                                  type="button"
                                  onClick={() => onSelect(block.orderIndex)}
                                  className="min-h-11 w-full rounded-[var(--radius-control)] px-2 text-left text-xs text-fg-secondary outline-none hover:bg-bg-raised focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
                                >
                                  Già nel blocco {block.orderIndex + 1}: {block.title}
                                </button>
                              ) : (
                                <p className="px-2 text-xs text-fg-secondary">
                                  Già nel blocco di «{concept.title}»
                                </p>
                              )}
                            </li>
                          );
                        }
                        const selectable = !!block && block.state !== 'locked';
                        const state = block?.state ?? 'locked';
                        const subtitle = !block
                          ? 'In preparazione…'
                          : state === 'done'
                            ? 'Fatto'
                            : selectable
                              ? 'Da fare'
                              : `Si sblocca dopo il blocco ${block.orderIndex}`;
                        return (
                          <li key={concept.title}>
                            <OutlineRow
                              number={(block?.orderIndex ?? 0) + 1}
                              title={block ? block.title : concept.title}
                              subtitle={subtitle}
                              state={state}
                              selectable={selectable}
                              current={!!block && block.orderIndex === currentIndex}
                              written={!!block}
                              onSelect={() => block && onSelect(block.orderIndex)}
                            />
                          </li>
                        );
                      })}
                    </ul>
                  </>
                )}
              </section>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/**
 * Second phase of a sprint lesson: only the theory the failed exercises need, as the same blocks of
 * a guided lesson (with the check question that opens the next one). All right: nothing to review.
 */
export function SprintTheoryStep({
  view,
  loading,
  loadError,
  lesson,
  active,
  current,
  focusNonce,
  generating,
  generateError,
  onGenerate,
  asked,
  onSelect,
  onOpenCitation,
  onPrefill,
  onGo,
}: {
  view: SprintView | undefined;
  loading: boolean;
  loadError: string | null;
  lesson: Lesson;
  active: boolean;
  /** The block shown (kept by the shell: the header shows "blocco n di N"). */
  current: number;
  focusNonce: number;
  /** The request that asks for the blocks is on its way. */
  generating: boolean;
  generateError: string | null;
  onGenerate: () => void;
  /** The set of concepts already asked for (kept by the shell, so it survives a remount). */
  asked: MutableRefObject<string>;
  onSelect: (index: number, moveFocus: boolean) => void;
  onOpenCitation: (citation: Pick<SessionItemCitationDto, 'docId' | 'page'>) => void;
  onPrefill: (text: string) => void;
  onGo: (phase: SprintPhase) => void;
}) {
  const [results, setResults] = useState<Record<number, CheckLessonBlockResponse>>({});
  const blocks = lesson.data?.blocks ?? [];
  const block = blocks.find((b) => b.orderIndex === current) ?? null;
  const missing = view ? conceptsWithoutBlock(view) : [];
  const theoryState = view?.theory.state ?? 'idle';
  const wrote = theoryState === 'generating' || generating;

  // Entering the phase asks for the blocks of the concepts that have none, once for each set of them
  // (the POST is idempotent: it only queues what is new).
  const signature = missing.map((c) => c.title).join('|');
  useEffect(() => {
    if (!active || !signature || asked.current === signature) return;
    if (theoryState === 'generating' || theoryState === 'failed' || generateError) return;
    asked.current = signature;
    onGenerate();
  }, [active, signature, theoryState, generateError]);

  function interrupt(kind: LessonInterruption) {
    if (block) onPrefill(interruptionText(kind, block));
  }
  function check(answer: string) {
    if (!block) return;
    const index = block.orderIndex;
    lesson.check.mutate(
      { index, answer },
      { onSuccess: (res) => setResults((r) => ({ ...r, [index]: res })) },
    );
  }

  const head = (
    <div className="space-y-1">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2
          id="st-title"
          data-phase-heading
          tabIndex={-1}
          className="text-xl font-semibold text-fg-primary outline-none"
        >
          La teoria che ti serve, esercizio per esercizio
        </h2>
        {view && view.costEur > 0 && (
          <p className="text-xs text-fg-muted">Costo AI: €{view.costEur.toFixed(4)}</p>
        )}
      </div>
      <p className="text-sm text-fg-secondary">
        Solo i punti che servivano agli esercizi andati male. Il resto del capitolo puoi saltarlo.
      </p>
    </div>
  );
  const shell =
    'space-y-4 rounded-[var(--radius-card)] border border-border bg-bg-surface p-5 md:p-6';

  if (!view) {
    return (
      <section aria-labelledby="st-title" className={shell}>
        {head}
        {loadError ? (
          <p role="alert" className="text-sm text-danger">
            {loadError}
          </p>
        ) : (
          <p role="status" className="text-sm text-fg-secondary">
            {loading ? 'Caricamento…' : ''}
          </p>
        )}
      </section>
    );
  }

  if (ratedCount(view) === 0) {
    return (
      <section aria-labelledby="st-title" className={shell}>
        {head}
        <div className="space-y-3 rounded-[var(--radius-card)] border border-dashed border-border p-5">
          <p className="text-sm text-fg-secondary">
            Segna come ti è andata negli esercizi: la teoria arriva solo dove serve.
          </p>
          <Button type="button" variant="secondary" onClick={() => onGo('exercises')}>
            Vai agli esercizi
          </Button>
        </div>
      </section>
    );
  }

  if (theoryIsEmpty(view)) {
    const unrated = view.exercises.length - ratedCount(view);
    return (
      <section aria-labelledby="st-title" className={shell}>
        {head}
        <div className="space-y-3 rounded-[var(--radius-card)] border border-ok/40 bg-ok/5 p-4">
          <h3 className="text-base font-semibold text-fg-primary">Nessuna teoria da rivedere</h3>
          <p className="text-sm text-fg-secondary">
            Hai sistemato tutti gli esercizi: passa alla riprova per fissare i passaggi.
          </p>
          <Button type="button" size="lg" onClick={() => onGo('retry')} className="max-md:w-full">
            Riprova su esercizi simili →
          </Button>
          {unrated > 0 && (
            <p className="text-xs text-fg-muted">
              {unrated}{' '}
              {unrated === 1
                ? 'esercizio non è ancora segnato'
                : 'esercizi non sono ancora segnati'}
              .
            </p>
          )}
        </div>
      </section>
    );
  }

  const failedHere = theoryState === 'failed' || (!!generateError && missing.length > 0);
  const total = Math.max(lesson.data?.blockCount ?? 0, blocks.length, 1);

  let main;
  if (block && block.state !== 'locked') {
    main = (
      <>
        {failedHere && (
          <LessonError
            what="la teoria"
            error={generateError ?? view.theory.error}
            retrying={generating}
            onRetry={onGenerate}
          />
        )}
        <LessonBlock
          key={block.id}
          block={block}
          total={total}
          readOnly={!active}
          checkResult={results[block.orderIndex] ?? null}
          checking={lesson.check.isPending && lesson.check.variables?.index === block.orderIndex}
          checkError={
            lesson.check.isError && lesson.check.variables?.index === block.orderIndex
              ? (lesson.check.error as Error).message
              : null
          }
          regenerating={
            (lesson.inFlight && lesson.job?.blockIndex === block.orderIndex) ||
            (lesson.regenerate.isPending && lesson.regenerate.variables?.index === block.orderIndex)
          }
          isLast={block.orderIndex >= total - 1}
          focusNonce={focusNonce}
          onOpenCitation={onOpenCitation}
          onInterrupt={interrupt}
          onCheck={check}
          onNext={() => onSelect(block.orderIndex + 1, true)}
          onFinish={() => onGo('retry')}
          finishLabel="Riprova su esercizi simili →"
          onRegenerate={() => lesson.regenerate.mutate({ index: block.orderIndex })}
        />
        {lesson.regenerate.isError && (
          <p role="alert" className="text-xs text-danger">
            {(lesson.regenerate.error as Error).message}
          </p>
        )}
      </>
    );
  } else if (failedHere) {
    main = (
      <LessonError
        what="la teoria"
        error={generateError ?? view.theory.error}
        retrying={generating}
        onRetry={onGenerate}
      />
    );
  } else if (block) {
    main = <LessonSkeleton label="Preparo il blocco successivo…" />;
  } else if (wrote || missing.length > 0) {
    main = <LessonSkeleton label="Sto preparando la teoria che ti serve…" />;
  } else if (!active) {
    main = (
      <p className="rounded-[var(--radius-card)] border border-dashed border-border p-6 text-sm text-fg-secondary">
        La teoria di questa lezione non è stata generata.
      </p>
    );
  } else {
    main = <LessonSkeleton label="Sto preparando la teoria che ti serve…" />;
  }

  return (
    <section aria-labelledby="st-title" className={shell}>
      {head}
      <div className={cn('grid gap-4 lg:grid-cols-[16rem_minmax(0,1fr)]')}>
        <SprintTheoryIndex
          view={view}
          blocks={blocks}
          currentIndex={current}
          onSelect={(i) => onSelect(i, true)}
          onGoExercises={() => onGo('exercises')}
        />
        <div className="min-w-0 space-y-3">{main}</div>
      </div>
    </section>
  );
}
