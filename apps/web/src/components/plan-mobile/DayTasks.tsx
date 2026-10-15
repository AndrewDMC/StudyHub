'use client';

import type { MutableRefObject } from 'react';
import type { PlanDto, TaskDto } from '@studyhub/contracts';
import { formatDayTitle, formatDuration } from '@/lib/planMobile';
import { cardClass } from '../simulation-mobile/styles';
import { SectionEmpty } from '../subject-mobile/SectionState';
import { TaskRow } from './TaskRow';

/** Title, total and tasks of the selected day. */
export function DayTasks({
  slug,
  plan,
  day,
  today,
  subjectHex,
  busy,
  triggerRef,
  onOpenTask,
  onDone,
  onPin,
}: {
  slug: string;
  plan: PlanDto;
  day: string;
  today: string;
  subjectHex: string | undefined;
  busy: boolean;
  /** Receives the row that opened the sheet, for the focus return. */
  triggerRef: MutableRefObject<HTMLElement | null>;
  onOpenTask: (taskId: string) => void;
  onDone: (taskId: string) => void;
  onPin: (task: TaskDto) => void;
}) {
  const tasks = plan.tasks.filter((t) => t.date === day && t.status !== 'moved');
  const minutes = tasks
    .filter((t) => t.kind !== 'rest' && t.status !== 'skipped')
    .reduce((sum, t) => sum + t.minutes, 0);
  const load = plan.loadPerDay.find((d) => d.date === day);
  const over = load ? load.planned > load.available : false;
  const isDraft = plan.status === 'draft';
  const firstOpenId =
    day === today ? tasks.find((t) => t.status === 'todo' || t.status === 'doing')?.id : undefined;

  return (
    <section aria-labelledby="plan-day-title" className="min-w-0">
      <div className="mb-2 flex min-h-11 items-center justify-between gap-3">
        <h2 id="plan-day-title" className="text-base font-semibold">
          {formatDayTitle(day, today)}
        </h2>
        <div className="shrink-0 text-right">
          <p className="font-mono text-[15px] font-semibold tabular-nums">
            {formatDuration(minutes)}
          </p>
          {load && (
            <p
              className={`font-mono text-[13px] tabular-nums ${over ? 'text-warn' : 'text-fg-secondary'}`}
            >
              {load.planned}/{load.available} min{over ? ' · oltre il tempo disponibile' : ''}
            </p>
          )}
        </div>
      </div>
      {tasks.length === 0 ? (
        <SectionEmpty>Giorno libero — nessuna task.</SectionEmpty>
      ) : (
        <ul className={`${cardClass} overflow-hidden`}>
          {tasks.map((task) => (
            <TaskRow
              key={task.id}
              slug={slug}
              task={task}
              isDraft={isDraft}
              today={today}
              primary={task.id === firstOpenId}
              subjectHex={subjectHex}
              busy={busy}
              onOpen={(trigger) => {
                triggerRef.current = trigger;
                onOpenTask(task.id);
              }}
              onDone={() => onDone(task.id)}
              onPin={() => onPin(task)}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
