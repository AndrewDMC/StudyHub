'use client';

import { useState } from 'react';
import type { TaskDto } from '@studyhub/contracts';
import {
  canSwitchMethod,
  lessonMetaLabel,
  runMethodSwitch,
  otherMethod,
  switchMethodLabel,
  taskMethod,
  type LessonMethodChoice,
} from '@/lib/taskMethod';
import { TaskFlashcardsPanel } from '../task-flashcards/TaskFlashcardsSection';
import { cardCountLabel } from '../task-flashcards/taskFlashcardsModel';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../ui/dialog';
import { KIND_LABELS } from './planModel';

export function TaskRow({
  slug,
  task,
  isDraft,
  onPin,
  onDelete,
  onStatus,
  onMethod,
}: {
  slug: string;
  task: TaskDto;
  isDraft: boolean;
  onPin: (id: string, pinned: boolean) => void;
  onDelete: (id: string) => void;
  onStatus: (id: string, status: 'done' | 'skipped' | 'todo') => void;
  /** Switches a lesson between standard and sprint; resolves with the updated task. */
  onMethod: (id: string, method: LessonMethodChoice) => Promise<TaskDto>;
}) {
  const [cardsOpen, setCardsOpen] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [methodError, setMethodError] = useState<string | null>(null);
  const [methodNote, setMethodNote] = useState('');
  const method = taskMethod(task);
  const switchable = canSwitchMethod(task);
  async function switchMethod() {
    const next = otherMethod(method);
    setSwitching(true);
    setMethodError(null);
    const result = await runMethodSwitch(() => onMethod(task.id, next), next);
    setMethodNote(result.note);
    setMethodError(result.error);
    setSwitching(false);
  }
  const hasCards = task.kind !== 'rest';
  const pill =
    'rounded-full border border-border px-2 py-0.5 text-xs text-fg-secondary hover:text-fg-primary max-md:min-h-11';
  return (
    <li className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2 rounded-[var(--radius-control)] border border-border bg-bg-surface px-3 py-2">
      <div className="min-w-0 flex-1 basis-56">
        <div className="flex items-center gap-2">
          <p className="text-xs uppercase tracking-wide text-fg-muted">
            {task.kind === 'lesson'
              ? lessonMetaLabel(task)
              : `${KIND_LABELS[task.kind]} · ${task.minutes} min`}
            {task.pinned ? ' · fissata' : ''}
          </p>
          {hasCards && task.flashcardCount > 0 && (
            <button
              type="button"
              aria-haspopup="dialog"
              aria-label={`${task.flashcardCount} flashcard attaccate a ${task.title}: apri`}
              onClick={() => setCardsOpen(true)}
              className={pill}
            >
              <span data-testid="task-card-badge">{cardCountLabel(task.flashcardCount)}</span>
            </button>
          )}
        </div>
        <p className="text-sm font-medium text-fg-primary md:truncate">{task.title}</p>
        {task.description && (
          <p className="text-xs text-fg-secondary md:truncate">{task.description}</p>
        )}
      </div>
      <div className="flex shrink-0 gap-1.5 max-md:[&>button]:min-h-11 max-md:[&>button]:px-3">
        {hasCards && (
          <button
            type="button"
            aria-haspopup="dialog"
            data-testid="task-flashcards-open"
            onClick={() => setCardsOpen(true)}
            className="rounded-[var(--radius-control)] border border-border px-2 py-1 text-[11px] text-fg-secondary hover:text-fg-primary"
          >
            Flashcard{task.flashcardCount > 0 ? ` (${task.flashcardCount})` : ''}
          </button>
        )}
        {switchable && (
          <button
            type="button"
            disabled={switching}
            aria-busy={switching}
            aria-label={`${switchMethodLabel(method)}: ${task.title}`}
            onClick={() => void switchMethod()}
            className="rounded-[var(--radius-control)] border border-border px-2 py-1 text-[11px] text-fg-secondary hover:text-fg-primary"
          >
            {switching ? 'Cambio…' : switchMethodLabel(method)}
          </button>
        )}
        {isDraft ? (
          <>
            <button
              type="button"
              onClick={() => onPin(task.id, !task.pinned)}
              className="rounded-[var(--radius-control)] border border-border px-2 py-1 text-[11px] text-fg-secondary hover:text-fg-primary"
            >
              {task.pinned ? 'Sblocca' : 'Fissa'}
            </button>
            <button
              type="button"
              onClick={() => onDelete(task.id)}
              className="rounded-[var(--radius-control)] border border-danger px-2 py-1 text-[11px] text-danger"
            >
              Elimina
            </button>
          </>
        ) : task.status === 'done' || task.status === 'skipped' ? (
          <>
            <span className="self-center text-[11px] text-fg-muted">
              {task.status === 'done' ? 'Fatta' : 'Saltata'}
            </span>
            {/* Back to "da fare" (e.g. marked done by mistake). */}
            <button
              type="button"
              onClick={() => onStatus(task.id, 'todo')}
              className="rounded-[var(--radius-control)] border border-border px-2 py-1 text-[11px] text-fg-secondary hover:text-fg-primary"
            >
              Riapri
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={() => onStatus(task.id, 'done')}
              className="rounded-[var(--radius-control)] border border-ok px-2 py-1 text-[11px] text-ok"
            >
              Fatta
            </button>
            <button
              type="button"
              onClick={() => onStatus(task.id, 'skipped')}
              className="rounded-[var(--radius-control)] border border-border px-2 py-1 text-[11px] text-fg-muted"
            >
              Salta
            </button>
          </>
        )}
      </div>
      {task.kind === 'lesson' && (
        <p role="status" aria-live="polite" className="sr-only">
          {methodNote}
        </p>
      )}
      {methodError && (
        <p role="alert" className="basis-full text-xs text-danger">
          {methodError}
        </p>
      )}
      {hasCards && (
        <Dialog open={cardsOpen} onOpenChange={setCardsOpen}>
          <DialogContent className="max-w-xl">
            <DialogHeader>
              <DialogTitle>{task.title}</DialogTitle>
              <DialogDescription>
                {KIND_LABELS[task.kind]} · {task.minutes} min · {task.date}
              </DialogDescription>
            </DialogHeader>
            {cardsOpen && <TaskFlashcardsPanel slug={slug} task={task} variant="desktop" />}
          </DialogContent>
        </Dialog>
      )}
    </li>
  );
}
