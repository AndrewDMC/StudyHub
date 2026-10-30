'use client';

import { useState, type ReactNode } from 'react';
import type { CheckLessonBlockResponse, SessionItemCitationDto } from '@studyhub/contracts';
import { Button } from '@/components/ui/button';
import { LessonBlock } from '@/components/lesson/LessonBlock';
import { LessonOutline } from '@/components/lesson/LessonOutline';
import { LessonError, LessonSkeleton } from '@/components/lesson/LessonStatus';
import {
  interruptionText,
  type LessonInterruption,
  type StandardPhase,
  type useLesson,
} from '@/lib/lessonClient';

type Lesson = ReturnType<typeof useLesson>;

/** Every block written and passed: the lesson part is over. */
export function lessonAllDone(
  data: Pick<NonNullable<Lesson['data']>, 'blocks' | 'blockCount'> | undefined,
): boolean {
  if (!data || data.blockCount === null) return false;
  return data.blocks.length >= data.blockCount && data.blocks.every((b) => b.state === 'done');
}

/**
 * Phase "Studia" of a guided lesson (docs/10-planner-lezioni.md §3.2): the lesson block by block, with
 * its index on the left. The shell around it (header, stepper, material and tutor) is `LessonFlow`.
 */
export function LessonStudy({
  lesson,
  active,
  current,
  focusNonce,
  onSelect,
  onOpenCitation,
  onPrefill,
  onGo,
  staged,
}: {
  lesson: Lesson;
  active: boolean;
  /** The block shown (kept by the shell: the header shows "blocco n di N"). */
  current: number;
  /** Bumped by the shell when the student picks a block: the title takes the focus. */
  focusNonce: number;
  onSelect: (index: number, moveFocus: boolean) => void;
  onOpenCitation: (citation: Pick<SessionItemCitationDto, 'docId' | 'page'>) => void;
  /** Pre-fill the tutor box with a question (never sent by itself). */
  onPrefill: (text: string) => void;
  onGo: (phase: StandardPhase) => void;
  /** Inside the five phases: the way on to "Rielabora" is offered. A sprint lesson has no next phase yet. */
  staged: boolean;
}) {
  const [results, setResults] = useState<Record<number, CheckLessonBlockResponse>>({});
  const blocks = lesson.data?.blocks ?? [];
  const blockCount = lesson.data?.blockCount ?? null;
  const block = blocks.find((b) => b.orderIndex === current) ?? null;

  function interrupt(kind: LessonInterruption) {
    if (!block) return;
    onPrefill(interruptionText(kind, block));
  }
  function check(answer: string) {
    if (!block) return;
    const index = block.orderIndex;
    lesson.check.mutate(
      { index, answer },
      { onSuccess: (res) => setResults((r) => ({ ...r, [index]: res })) },
    );
  }
  function retry(index: number) {
    if (index === 0 && blocks.length === 0) lesson.start.mutate({});
    else lesson.regenerate.mutate({ index });
  }

  const job = lesson.job;
  const failedHere = job?.status === 'failed' && job.blockIndex === current ? job : null;
  const regenerating =
    !!block &&
    block.state !== 'locked' &&
    ((lesson.inFlight && job?.blockIndex === block.orderIndex) ||
      (lesson.regenerate.isPending && lesson.regenerate.variables?.index === block.orderIndex));
  const pendingIndex = lesson.inFlight ? (job?.blockIndex ?? null) : null;
  const allDone = lessonAllDone(lesson.data);

  let main: ReactNode;
  if (lesson.query.isLoading || !lesson.data) {
    main = lesson.query.isError ? (
      <p role="alert" className="text-sm text-danger">
        {(lesson.query.error as Error).message}
      </p>
    ) : (
      <p role="status" className="text-sm text-fg-secondary">
        Caricamento…
      </p>
    );
  } else if (blocks.length === 0) {
    const startFailed = lesson.start.isError ? (lesson.start.error as Error).message : null;
    if (job?.status === 'failed' || startFailed) {
      main = (
        <LessonError
          what="la lezione"
          error={startFailed ?? job?.error ?? null}
          retrying={lesson.start.isPending}
          onRetry={() => lesson.start.mutate({})}
        />
      );
    } else if (!active && !lesson.inFlight) {
      main = (
        <p className="rounded-[var(--radius-card)] border border-dashed border-border p-6 text-sm text-fg-secondary">
          Questa lezione non è stata generata.
        </p>
      );
    } else {
      main = <LessonSkeleton label="Sto preparando la lezione dal materiale…" />;
    }
  } else if (!block || block.state === 'locked') {
    main =
      failedHere || (job?.status === 'failed' && lesson.regenerate.isError) ? (
        <LessonError
          what={`il blocco ${current + 1}`}
          error={failedHere?.error ?? null}
          retrying={lesson.regenerate.isPending}
          onRetry={() => retry(current)}
        />
      ) : (
        <LessonSkeleton label="Preparo il blocco successivo…" />
      );
  } else {
    main = (
      <>
        {failedHere && (
          <LessonError
            what={`il blocco ${current + 1}`}
            error={failedHere.error}
            retrying={lesson.regenerate.isPending}
            onRetry={() => retry(current)}
          />
        )}
        <LessonBlock
          key={block.id}
          block={block}
          total={blockCount}
          readOnly={!active}
          checkResult={results[block.orderIndex] ?? null}
          checking={lesson.check.isPending && lesson.check.variables?.index === block.orderIndex}
          checkError={
            lesson.check.isError && lesson.check.variables?.index === block.orderIndex
              ? (lesson.check.error as Error).message
              : null
          }
          regenerating={regenerating}
          isLast={blockCount !== null && block.orderIndex >= blockCount - 1}
          focusNonce={focusNonce}
          onOpenCitation={onOpenCitation}
          onInterrupt={interrupt}
          onCheck={check}
          onNext={() => onSelect(block.orderIndex + 1, true)}
          onRegenerate={() => lesson.regenerate.mutate({ index: block.orderIndex })}
        />
        {lesson.regenerate.isError && (
          <p role="alert" className="text-xs text-danger">
            {(lesson.regenerate.error as Error).message}
          </p>
        )}
      </>
    );
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[14rem_minmax(0,1fr)]">
      <LessonOutline
        blocks={blocks}
        blockCount={blockCount}
        currentIndex={current}
        pendingIndex={pendingIndex}
        onSelect={(i) => onSelect(i, true)}
      />

      <section aria-label="Lezione" className="min-w-0 space-y-3">
        {main}
        {allDone && (
          <section
            aria-labelledby="lesson-finished"
            className="space-y-2 rounded-[var(--radius-card)] border border-ok/40 bg-ok/5 p-4"
          >
            <h2 id="lesson-finished" className="text-base font-semibold text-fg-primary">
              Hai finito la parte Studia
            </h2>
            <ul className="space-y-1 text-sm text-fg-secondary">
              {blocks.map((b) => (
                <li key={b.id}>
                  <span aria-hidden="true" className="mr-1 text-ok">
                    ✓
                  </span>
                  {b.title}
                </li>
              ))}
            </ul>
            {staged && (
              <Button
                type="button"
                size="lg"
                onClick={() => onGo('rework')}
                className="max-md:w-full"
              >
                Passa a Rielabora →
              </Button>
            )}
          </section>
        )}
        {(lesson.data?.costEur ?? 0) > 0 && (
          <p className="text-xs text-fg-muted">Costo AI: €{lesson.data!.costEur.toFixed(4)}</p>
        )}
      </section>
    </div>
  );
}
