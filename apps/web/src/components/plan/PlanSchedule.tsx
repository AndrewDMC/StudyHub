'use client';

import { useState } from 'react';
import type { PlanDto, TaskDto } from '@studyhub/contracts';
import type { LessonMethodChoice } from '@/lib/taskMethod';
import { DayDetail } from './DayDetail';
import { lateTasks, weekOffsetFor, weekWindow } from './planModel';
import { BTN_GHOST } from '@/components/subject-tabs/styles';
import { WeekGrid } from './WeekGrid';

/** Week grid + selected-day detail. Mount with `key={plan.id}` so the state resets per plan. */
export function PlanSchedule({
  slug,
  plan,
  today,
  onPin,
  onDelete,
  onStatus,
  onMethod,
}: {
  slug: string;
  plan: PlanDto;
  today: string;
  onPin: (id: string, pinned: boolean) => void;
  onDelete: (id: string) => void;
  onStatus: (id: string, status: 'done' | 'skipped' | 'todo') => void;
  onMethod: (id: string, method: LessonMethodChoice) => Promise<TaskDto>;
}) {
  const [offset, setOffset] = useState(0);
  const [picked, setPicked] = useState<string | null>(null);
  const win = weekWindow(plan, today, offset);
  const late = lateTasks(plan, today);
  const withTasks = new Set(plan.tasks.map((t) => t.date));
  // The picked day if it is in view; else today; else the first day with tasks; else the first day.
  const selected =
    picked && win.dates.includes(picked)
      ? picked
      : win.dates.includes(today)
        ? today
        : (win.dates.find((d) => withTasks.has(d)) ?? win.dates[0]!);
  return (
    <div className="space-y-4">
      {late.length > 0 && (
        <button
          type="button"
          onClick={() => {
            setOffset(weekOffsetFor(plan, today, late[0]!.date));
            setPicked(late[0]!.date);
          }}
          className={`${BTN_GHOST} text-warn`}
        >
          {late.length === 1 ? '1 task in ritardo' : `${late.length} task in ritardo`}
        </button>
      )}
      <WeekGrid
        plan={plan}
        today={today}
        offset={offset}
        onOffset={setOffset}
        selected={selected}
        onSelect={setPicked}
      />
      <DayDetail
        slug={slug}
        plan={plan}
        date={selected}
        today={today}
        onPin={onPin}
        onDelete={onDelete}
        onStatus={onStatus}
        onMethod={onMethod}
      />
    </div>
  );
}
