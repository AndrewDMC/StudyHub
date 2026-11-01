'use client';

import type {
  SessionItemCitationDto,
  SessionItemDto,
  UpdateSessionItemRequest,
} from '@studyhub/contracts';
import { Button } from '@/components/ui/button';
import { ExerciseCard } from '@/components/SessionBriefing';
import { LessonSkeleton } from '@/components/lesson/LessonStatus';
import {
  failedExercises,
  ratedCount,
  retrySet,
  type SprintPhase,
  type SprintView,
} from '@/lib/lessonClient';

/**
 * Third phase of a sprint lesson: the exercises similar to the ones that went wrong (only the first
 * one when everything was right), answered in writing and corrected by the AI.
 */
export function SprintRetryStep({
  view,
  items,
  loading,
  loadError,
  active,
  gradingId,
  gradeError,
  onPatch,
  onGrade,
  onOpenCitation,
  onGoTheory,
  onGo,
}: {
  view: SprintView | undefined;
  /** The retries as returned by the server (the card reads the item itself). */
  items: SessionItemDto[];
  loading: boolean;
  loadError: string | null;
  active: boolean;
  gradingId: string | null;
  gradeError: { id: string; message: string } | null;
  onPatch: (id: string, patch: UpdateSessionItemRequest) => void;
  onGrade: (id: string, answer: string) => void;
  onOpenCitation: (citation: SessionItemCitationDto) => void;
  /** Open the theory, on the first block linked to the exercise when it has one. */
  onGoTheory: (blockId: string | null) => void;
  onGo: (phase: SprintPhase) => void;
}) {
  const set = view ? retrySet(view) : [];
  const failed = view ? failedExercises(view).length : 0;
  const byId = new Map(items.map((i) => [i.id, i]));

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
  } else if (ratedCount(view) === 0) {
    body = (
      <div className="space-y-3 rounded-[var(--radius-card)] border border-dashed border-border p-5">
        <p className="text-sm text-fg-secondary">
          Segna prima come è andata negli esercizi: la riprova è sugli esercizi non riusciti.
        </p>
        <Button type="button" variant="secondary" onClick={() => onGo('exercises')}>
          Vai agli esercizi
        </Button>
      </div>
    );
  } else if (set.length > 0) {
    body = (
      <ul className="space-y-3">
        {set.map((r, k) => {
          const item = byId.get(r.id);
          if (!item) return null;
          const parent = view.exercises.find((e) => e.id === r.forExerciseId);
          const blockId =
            parent?.linkedBlockIds[0] ??
            view.theory.concepts.find(
              (c) => parent && c.exerciseIds.includes(parent.id) && c.blockId,
            )?.blockId ??
            null;
          return (
            <ExerciseCard
              key={r.id}
              item={item}
              index={k}
              variant="retry"
              similarTo={parent?.n}
              active={active}
              grading={gradingId === r.id}
              gradeError={gradeError?.id === r.id ? gradeError.message : null}
              onPatch={(patch) => onPatch(r.id, patch)}
              onGrade={(answer) => onGrade(r.id, answer)}
              onOpenCitation={onOpenCitation}
              onReviewTheory={blockId ? () => onGoTheory(blockId) : undefined}
            />
          );
        })}
      </ul>
    );
  } else if (!active) {
    body = (
      <p className="rounded-[var(--radius-card)] border border-dashed border-border p-6 text-sm text-fg-secondary">
        Non hai fatto la riprova in questa lezione.
      </p>
    );
  } else {
    body = <LessonSkeleton label="Sto preparando gli esercizi di riprova…" />;
  }

  return (
    <section
      aria-labelledby="sr-title"
      className="space-y-4 rounded-[var(--radius-card)] border border-border bg-bg-surface p-5 max-md:border-0 max-md:bg-transparent max-md:px-0 md:p-6"
    >
      <div className="space-y-1">
        <h2
          id="sr-title"
          data-phase-heading
          tabIndex={-1}
          className="text-xl font-semibold text-fg-primary outline-none"
        >
          Riprova
        </h2>
        {view && ratedCount(view) > 0 && (
          <p className="text-sm text-fg-secondary">
            {failed >= 2
              ? 'Esercizi simili a quelli sbagliati, con gli stessi passaggi critici.'
              : failed === 1
                ? 'Un esercizio simile a quello sbagliato, con gli stessi passaggi critici.'
                : 'Era tutto giusto: ecco un esercizio simile al primo, per fissare i passaggi.'}
          </p>
        )}
      </div>
      {body}
    </section>
  );
}
