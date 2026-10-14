'use client';

import Link from 'next/link';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Check } from 'lucide-react';
import { StartTaskButton } from '../StartTaskButton';
import { MobileSection, SectionEmpty, SectionError, SkeletonRows } from './SectionState';
import { TASK_KIND_LABELS, currentTasks, markTaskDone, todayIso, useTodayTasks } from './queries';

function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

const primaryStart =
  'flex min-h-11 items-center rounded-[var(--radius-control)] bg-accent px-4 text-sm font-semibold text-bg-base disabled:opacity-60';
const secondaryStart =
  'flex min-h-11 items-center rounded-[var(--radius-control)] border border-border-strong px-4 text-sm font-medium text-fg-primary disabled:opacity-60';

/** "Oggi · {durata}": today's plan tasks, tick-off and start. */
export function TodayTasksSection({ slug }: { slug: string }) {
  const queryClient = useQueryClient();
  const query = useTodayTasks(slug);
  const done = useMutation({
    mutationFn: (taskId: string) => markTaskDone(slug, taskId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['daily-tasks', slug] }),
  });

  const all = query.data ?? [];
  const today = todayIso();
  const overdue = all.filter(
    (t) => t.date < today && t.status !== 'done' && t.status !== 'skipped' && t.status !== 'moved',
  );
  const tasks = currentTasks(all).filter((t) => t.status !== 'skipped' && t.status !== 'moved');
  const totalMinutes = tasks.reduce((sum, t) => sum + t.minutes, 0);
  const firstOpenId = tasks.find((t) => t.status !== 'done')?.id;

  return (
    <MobileSection
      title={totalMinutes > 0 ? `Oggi · ${formatDuration(totalMinutes)}` : 'Oggi'}
      busy={query.isLoading}
      action={
        <Link
          href={`/materie/${slug}/piano`}
          className="flex min-h-11 items-center text-[13px] text-fg-secondary underline-offset-2 hover:underline"
        >
          Apri il piano
        </Link>
      }
    >
      {query.isLoading ? (
        <SkeletonRows count={2} />
      ) : query.isError ? (
        <SectionError
          message={(query.error as Error).message}
          onRetry={() => void query.refetch()}
        />
      ) : (
        <div className="space-y-2">
          {overdue.length > 0 && (
            <Link
              href={`/materie/${slug}/piano`}
              className="flex min-h-11 items-center rounded-[var(--radius-card)] border border-warn bg-bg-surface px-3 text-[13px] text-warn"
            >
              {overdue.length} task scadute — gestiscile nel piano
            </Link>
          )}
          {tasks.length === 0 ? (
            <SectionEmpty>
              Nessuna task per oggi.
              <Link
                href={`/materie/${slug}/piano`}
                className="mx-auto flex min-h-11 items-center justify-center text-fg-secondary underline"
              >
                Genera o apri il piano
              </Link>
            </SectionEmpty>
          ) : (
            <ul className="space-y-2">
              {tasks.map((task) => {
                const isDone = task.status === 'done';
                return (
                  <li
                    key={task.id}
                    className="flex items-center gap-1 rounded-[var(--radius-card)] border border-border bg-bg-surface pr-3"
                  >
                    <button
                      type="button"
                      role="checkbox"
                      aria-checked={isDone}
                      aria-label={`Segna come fatta: ${task.title}`}
                      disabled={isDone || done.isPending}
                      onClick={() => done.mutate(task.id)}
                      className="flex h-11 w-11 shrink-0 items-center justify-center"
                    >
                      <span
                        aria-hidden="true"
                        className={`flex h-[22px] w-[22px] items-center justify-center rounded-[6px] border-[1.5px] ${
                          isDone ? 'border-ok bg-ok text-bg-base' : 'border-border-strong'
                        }`}
                      >
                        {isDone && <Check className="h-3.5 w-3.5" />}
                      </span>
                    </button>
                    <div className="min-w-0 flex-1 py-2">
                      <p
                        className={`text-[15px] ${
                          isDone ? 'text-fg-muted line-through' : 'text-fg-primary'
                        }`}
                      >
                        {task.title}
                      </p>
                      <p className="font-mono text-xs text-fg-muted">
                        {task.minutes} min · {TASK_KIND_LABELS[task.kind]}
                        {isDone && ' · fatto'}
                      </p>
                    </div>
                    {!isDone && (
                      <StartTaskButton
                        subjectSlug={slug}
                        taskId={task.id}
                        kind={task.kind}
                        className={task.id === firstOpenId ? primaryStart : secondaryStart}
                      />
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          {done.isError && (
            <p role="alert" className="text-xs text-danger">
              {(done.error as Error).message}
            </p>
          )}
        </div>
      )}
    </MobileSection>
  );
}
