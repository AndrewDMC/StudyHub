'use client';

import type { PlanDto, TaskDto } from '@studyhub/contracts';
import type { LessonMethodChoice } from '@/lib/taskMethod';
import { formatLoad, longDate } from './planModel';
import { TaskRow } from './TaskRow';

/** The tasks of the selected day, with the full set of row actions. */
export function DayDetail({
  slug,
  plan,
  date,
  today,
  onPin,
  onDelete,
  onStatus,
  onMethod,
}: {
  slug: string;
  plan: PlanDto;
  date: string;
  today: string;
  onPin: (id: string, pinned: boolean) => void;
  onDelete: (id: string) => void;
  onStatus: (id: string, status: 'done' | 'skipped' | 'todo') => void;
  onMethod: (id: string, method: LessonMethodChoice) => Promise<TaskDto>;
}) {
  const tasks = plan.tasks.filter((t) => t.date === date);
  const load = plan.loadPerDay.find((d) => d.date === date);
  return (
    <section aria-labelledby="giorno-titolo" data-testid="plan-day-detail" className="space-y-2">
      <div className="flex items-baseline justify-between gap-3">
        <h3 id="giorno-titolo" className="text-sm font-semibold text-fg-primary">
          {date === today ? 'Oggi · ' : ''}
          {longDate(date)}
        </h3>
        <span className="font-mono text-xs tabular-nums text-fg-secondary">{formatLoad(load)}</span>
      </div>
      {tasks.length === 0 ? (
        <p className="text-sm text-fg-muted">Nessuna attività in questo giorno.</p>
      ) : (
        <ul className="space-y-1.5">
          {tasks.map((task) => (
            <TaskRow
              key={task.id}
              slug={slug}
              task={task}
              isDraft={plan.status === 'draft'}
              onPin={onPin}
              onDelete={onDelete}
              onStatus={onStatus}
              onMethod={onMethod}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
