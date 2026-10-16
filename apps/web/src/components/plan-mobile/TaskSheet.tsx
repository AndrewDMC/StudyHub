'use client';

import { useEffect, useState, type RefObject } from 'react';
import type { PlanDto, TaskDto } from '@studyhub/contracts';
import { KIND_LABELS, addDaysIso, formatDayTitle } from '@/lib/planMobile';
import { primaryButton, secondaryButton } from '../simulation-mobile/styles';
import { BottomSheet } from '../subject-mobile/BottomSheet';
import { todayIso } from '../subject-mobile/queries';
import { TaskFlashcardsPanel, type PanelView } from '../task-flashcards/TaskFlashcardsSection';
import type { usePlanMutations } from './usePlanData';

type Mutations = ReturnType<typeof usePlanMutations>;

const dangerButton =
  'flex w-full min-h-12 items-center justify-center rounded-[var(--radius-control)] border border-danger px-4 text-sm font-semibold text-danger disabled:opacity-50';

/** Actions on one task: status (active plan), pin/delete (draft) and a one-day move. */
export function TaskSheet({
  slug,
  task,
  plan,
  onClose,
  returnFocusRef,
  mutations,
}: {
  slug: string;
  task: TaskDto | null;
  plan: PlanDto;
  onClose: () => void;
  returnFocusRef: RefObject<HTMLElement | null>;
  mutations: Mutations;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const taskId = task?.id;
  const [view, setView] = useState<PanelView>('detail');
  useEffect(() => {
    setError(null);
    setView('detail');
  }, [taskId]);

  const run = async (action: () => Promise<unknown>) => {
    setPending(true);
    setError(null);
    try {
      await action();
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPending(false);
    }
  };

  const draft = plan.status === 'draft';
  const today = todayIso();
  const nextDay = task ? addDaysIso(task.date, 1) : '';
  const open = task?.status === 'todo' || task?.status === 'doing';
  const closed = task?.status === 'done' || task?.status === 'skipped';

  return (
    <BottomSheet
      open={task !== null}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      title={task?.title ?? ''}
      description={
        task
          ? `${KIND_LABELS[task.kind]} · ${task.minutes} min · ${formatDayTitle(task.date, today)}`
          : undefined
      }
      returnFocusRef={returnFocusRef}
    >
      {task && (
        <div className="mt-3 flex flex-col gap-2">
          {view === 'detail' && task.description && (
            <p className="whitespace-pre-wrap break-words text-sm text-fg-secondary">
              {task.description}
            </p>
          )}
          {task.kind !== 'rest' && (
            <div className="my-1">
              <TaskFlashcardsPanel
                key={task.id}
                slug={slug}
                task={task}
                variant="mobile"
                onViewChange={setView}
              />
            </div>
          )}
          {view === 'detail' && (
            <>
              {!draft && open && task.kind !== 'rest' && (
                <>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() =>
                      void run(() =>
                        mutations.setStatus.mutateAsync({ id: task.id, status: 'done' }),
                      )
                    }
                    className={`${primaryButton} min-h-12 text-sm`}
                  >
                    Segna come fatta
                  </button>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() =>
                      void run(() =>
                        mutations.setStatus.mutateAsync({ id: task.id, status: 'skipped' }),
                      )
                    }
                    className={`${secondaryButton} min-h-12`}
                  >
                    Salta
                  </button>
                </>
              )}
              {!draft && closed && (
                <button
                  type="button"
                  disabled={pending}
                  onClick={() =>
                    void run(() => mutations.setStatus.mutateAsync({ id: task.id, status: 'todo' }))
                  }
                  className={`${secondaryButton} min-h-12`}
                >
                  Riapri
                </button>
              )}
              {draft && task.kind !== 'rest' && (
                <button
                  type="button"
                  disabled={pending}
                  onClick={() =>
                    void run(() => mutations.pin.mutateAsync({ id: task.id, pinned: !task.pinned }))
                  }
                  className={`${secondaryButton} min-h-12`}
                >
                  {task.pinned ? 'Sblocca' : 'Fissa'}
                </button>
              )}
              {(draft || open || task.kind === 'rest') && (
                <button
                  type="button"
                  disabled={pending || nextDay > plan.targetDate}
                  onClick={() =>
                    void run(() => mutations.move.mutateAsync({ id: task.id, date: nextDay }))
                  }
                  className={`${secondaryButton} min-h-12`}
                >
                  Sposta di 1 giorno
                </button>
              )}
              {!draft && open && task.date < today && task.kind !== 'rest' && (
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => void run(() => mutations.reabsorb.mutateAsync([task]))}
                  className={`${secondaryButton} min-h-12`}
                >
                  Riassorbi nel piano
                </button>
              )}
              {draft && (
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => void run(() => mutations.removeTask.mutateAsync(task.id))}
                  className={dangerButton}
                >
                  Elimina task
                </button>
              )}
              {error && (
                <p role="alert" className="text-sm text-danger">
                  {error}
                </p>
              )}
            </>
          )}
        </div>
      )}
    </BottomSheet>
  );
}
