'use client';

import { useEffect, useRef } from 'react';
import type { TaskDto } from '@studyhub/contracts';
import { dayParts, formatDayTitle } from '@/lib/planMobile';
import { kindBar } from './kindStyle';

function dayLabel(iso: string, today: string, count: number, late: boolean): string {
  const title = iso === today ? 'Oggi' : formatDayTitle(iso, today);
  return `${title}, ${count === 0 ? 'giorno libero' : `${count} task`}${late ? ', in ritardo' : ''}`;
}

/** Horizontal strip with every day of the plan window; the selected one drives the task list. */
export function DayStrip({
  days,
  tasksByDay,
  selected,
  onSelect,
  today,
  lateDays,
  subjectHex,
}: {
  days: string[];
  tasksByDay: Map<string, TaskDto[]>;
  selected: string | null;
  onSelect: (iso: string) => void;
  today: string;
  /** Days with open overdue tasks. */
  lateDays: Set<string>;
  subjectHex: string | undefined;
}) {
  const selectedRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    selectedRef.current?.scrollIntoView({
      inline: 'center',
      block: 'nearest',
      behavior: reduce ? 'auto' : 'smooth',
    });
  }, [selected]);

  return (
    <div
      role="group"
      aria-label="Giorni del piano"
      className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1 [scrollbar-width:none]"
    >
      {days.map((iso) => {
        const visible = (tasksByDay.get(iso) ?? []).filter((t) => t.status !== 'moved');
        const first = visible.find((t) => t.kind !== 'rest');
        const bar = first ? kindBar(first.kind, subjectHex) : null;
        const { weekday, day } = dayParts(iso);
        const active = iso === selected;
        const late = lateDays.has(iso);
        return (
          <button
            key={iso}
            ref={active ? selectedRef : undefined}
            type="button"
            aria-pressed={active}
            aria-current={iso === today ? 'date' : undefined}
            aria-label={dayLabel(iso, today, visible.length, late)}
            onClick={() => onSelect(iso)}
            className={`relative flex min-h-[68px] min-w-11 shrink-0 flex-col items-center justify-center gap-0.5 rounded-[var(--radius-control)] border px-2 ${
              active
                ? 'border-accent bg-accent-subtle text-fg-primary'
                : 'border-border bg-bg-surface text-fg-secondary'
            }`}
          >
            <span aria-hidden="true" className="text-xs uppercase">
              {weekday}
            </span>
            <span aria-hidden="true" className="font-mono text-base font-semibold tabular-nums">
              {day}
            </span>
            <span
              aria-hidden="true"
              className={`size-1.5 rounded-full ${bar ? bar.className : 'bg-transparent'}`}
              style={bar?.style}
            />
            {late && (
              <span
                aria-hidden="true"
                className="absolute right-1 top-1 size-1.5 rounded-full bg-danger"
              />
            )}
          </button>
        );
      })}
    </div>
  );
}
