'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import type { CalendarRangeDto } from '@studyhub/contracts';
import { SUBJECT_COLOR_HEX } from '@/lib/subjectColors';

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}
// Client-safe date helpers, deliberately not imported from @studyhub/core: its
// main barrel pulls in node:fs-using modules that break the browser bundle
// (docs/fasi/F0-fondamenta.md "Stato" — the same reason @studyhub/core/browser exists).
function toIso(d: Date): string {
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}
function fromIso(s: string): Date {
  return new Date(`${s}T00:00:00.000Z`);
}
function addDaysIso(s: string, days: number): string {
  const d = fromIso(s);
  d.setUTCDate(d.getUTCDate() + days);
  return toIso(d);
}
function weekdayOf(s: string): number {
  return fromIso(s).getUTCDay(); // 0 = Sunday
}

const WEEKDAY_LABELS = ['Dom', 'Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab'];
const MONTH_LABELS = [
  'Gennaio',
  'Febbraio',
  'Marzo',
  'Aprile',
  'Maggio',
  'Giugno',
  'Luglio',
  'Agosto',
  'Settembre',
  'Ottobre',
  'Novembre',
  'Dicembre',
];
const KIND_LABELS: Record<CalendarRangeDto['tasks'][number]['kind'], string> = {
  read: 'Lettura',
  flashcards: 'Flashcard',
  schema: 'Schema',
  simulation: 'Simulazione',
  drill: 'Drill',
  rest: 'Riposo',
  review: 'Ripasso',
};

async function fetchRange(start: string, end: string): Promise<CalendarRangeDto> {
  const res = await fetch(`/api/calendar?start=${start}&end=${end}`);
  const body = await res.json();
  if (!res.ok) throw new Error(body.error?.message ?? 'Impossibile caricare il calendario');
  return body as CalendarRangeDto;
}

async function moveTask(subjectSlug: string, taskId: string, date: string) {
  const res = await fetch(`/api/subjects/${subjectSlug}/plan/tasks/${taskId}/move`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ date }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error?.message ?? 'Spostamento fallito');
  }
}

function DayAgenda({
  date,
  dayTasks,
  dayExams,
  onMove,
}: {
  date: string;
  dayTasks: CalendarRangeDto['tasks'];
  dayExams: CalendarRangeDto['exams'];
  onMove: (subjectSlug: string, taskId: string, date: string) => void;
}) {
  const [moveTarget, setMoveTarget] = useState<Record<string, string>>({});

  if (dayTasks.length === 0 && dayExams.length === 0) {
    return <p className="text-sm text-fg-muted">Nessuna task o esame — {date}.</p>;
  }

  return (
    <div className="space-y-2">
      {dayExams.map((exam) => (
        <div
          key={exam.id}
          className="flex items-center gap-2 rounded-[var(--radius-control)] border px-3 py-2 text-sm"
          style={{ borderColor: SUBJECT_COLOR_HEX[exam.subjectColor] }}
        >
          <span
            className="h-2 w-2 shrink-0 rounded-full"
            style={{ backgroundColor: SUBJECT_COLOR_HEX[exam.subjectColor] }}
          />
          <span className="font-medium text-fg-primary">Esame — {exam.title}</span>
          <span className="text-xs text-fg-muted">{exam.subjectName}</span>
        </div>
      ))}
      {dayTasks.map((task) => (
        <div
          key={task.id}
          className="flex items-start justify-between gap-3 rounded-[var(--radius-control)] border border-border bg-bg-surface px-3 py-2"
        >
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-fg-muted">
              <span
                className="h-1.5 w-1.5 rounded-full"
                style={{ backgroundColor: SUBJECT_COLOR_HEX[task.subjectColor] }}
              />
              {task.subjectName} · {KIND_LABELS[task.kind]} · {task.minutes} min
            </p>
            <Link
              href={`/materie/${task.subjectSlug}/piano`}
              className="truncate text-sm font-medium text-fg-primary hover:underline"
            >
              {task.title}
            </Link>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <input
              type="date"
              value={moveTarget[task.id] ?? task.date}
              onChange={(e) => setMoveTarget((prev) => ({ ...prev, [task.id]: e.target.value }))}
              className="rounded-[var(--radius-control)] border border-border bg-bg-inset px-1.5 py-1 text-xs text-fg-primary"
            />
            <button
              type="button"
              onClick={() => onMove(task.subjectSlug, task.id, moveTarget[task.id] ?? task.date)}
              className="rounded-[var(--radius-control)] border border-border px-2 py-1 text-[11px] text-fg-secondary hover:text-fg-primary"
            >
              Sposta
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Cross-subject month calendar (docs/fasi/F6-planner-calendario.md "Scope").
 * **Not built in this slice** (see F6 "Stato"): pointer drag&drop (moves go
 * through the date field below, not dragging a card), week/agenda views,
 * blackout-date editing, ICS export/import.
 */
export function CalendarClient() {
  const queryClient = useQueryClient();
  const todayIso = toIso(new Date());
  const [cursor, setCursor] = useState(() => {
    const d = fromIso(todayIso);
    return { year: d.getUTCFullYear(), month: d.getUTCMonth() };
  });
  const [selectedDay, setSelectedDay] = useState(todayIso);

  const firstOfMonth = `${cursor.year}-${pad2(cursor.month + 1)}-01`;
  const gridStart = addDaysIso(firstOfMonth, -weekdayOf(firstOfMonth));
  const gridEnd = addDaysIso(gridStart, 42);
  const days = useMemo(
    () => Array.from({ length: 42 }, (_, i) => addDaysIso(gridStart, i)),
    [gridStart],
  );

  const rangeQuery = useQuery({
    queryKey: ['calendar', gridStart, gridEnd],
    queryFn: () => fetchRange(gridStart, gridEnd),
  });

  const move = useMutation({
    mutationFn: ({
      subjectSlug,
      taskId,
      date,
    }: {
      subjectSlug: string;
      taskId: string;
      date: string;
    }) => moveTask(subjectSlug, taskId, date),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['calendar'] }),
  });

  const tasksByDay = new Map<string, CalendarRangeDto['tasks']>();
  const examsByDay = new Map<string, CalendarRangeDto['exams']>();
  for (const t of rangeQuery.data?.tasks ?? [])
    tasksByDay.set(t.date, [...(tasksByDay.get(t.date) ?? []), t]);
  for (const e of rangeQuery.data?.exams ?? []) {
    const d = e.date.slice(0, 10);
    examsByDay.set(d, [...(examsByDay.get(d) ?? []), e]);
  }

  const subjectsInRange = new Map<string, string>(); // slug -> color
  for (const t of rangeQuery.data?.tasks ?? [])
    subjectsInRange.set(t.subjectSlug, `${t.subjectName}\u0000${t.subjectColor}`);

  const shiftMonth = (delta: number) => {
    const next = new Date(Date.UTC(cursor.year, cursor.month + delta, 1));
    setCursor({ year: next.getUTCFullYear(), month: next.getUTCMonth() });
  };

  return (
    <div className="mx-auto max-w-5xl p-6">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h1 className="text-xl font-semibold tracking-[-0.02em]">Calendario</h1>
        <div className="flex items-center gap-2 text-sm">
          <button
            type="button"
            onClick={() => shiftMonth(-1)}
            className="rounded-[var(--radius-control)] border border-border px-2 py-1 text-fg-secondary hover:text-fg-primary"
          >
            ←
          </button>
          <span className="w-36 text-center font-medium text-fg-primary">
            {MONTH_LABELS[cursor.month]} {cursor.year}
          </span>
          <button
            type="button"
            onClick={() => shiftMonth(1)}
            className="rounded-[var(--radius-control)] border border-border px-2 py-1 text-fg-secondary hover:text-fg-primary"
          >
            →
          </button>
          <button
            type="button"
            onClick={() => {
              const d = fromIso(todayIso);
              setCursor({ year: d.getUTCFullYear(), month: d.getUTCMonth() });
              setSelectedDay(todayIso);
            }}
            className="rounded-[var(--radius-control)] border border-border px-2 py-1 text-xs text-fg-secondary hover:text-fg-primary"
          >
            Oggi
          </button>
        </div>
      </div>

      {subjectsInRange.size > 0 && (
        <div className="mb-3 flex flex-wrap gap-3 text-xs text-fg-secondary">
          {[...subjectsInRange.entries()].map(([slug, meta]) => {
            const [name, color] = meta.split('\u0000');
            return (
              <span key={slug} className="flex items-center gap-1.5">
                <span
                  className="h-2 w-2 rounded-full"
                  style={{
                    backgroundColor: SUBJECT_COLOR_HEX[color as keyof typeof SUBJECT_COLOR_HEX],
                  }}
                />
                {name}
              </span>
            );
          })}
        </div>
      )}

      {rangeQuery.isLoading && <p className="text-sm text-fg-muted">Caricamento…</p>}
      {rangeQuery.isError && (
        <p role="alert" className="text-sm text-danger">
          {(rangeQuery.error as Error).message}
        </p>
      )}
      {move.isError && (
        <p role="alert" className="mb-2 text-xs text-danger">
          {(move.error as Error).message}
        </p>
      )}

      <div className="grid grid-cols-7 gap-1 text-center text-[11px] text-fg-muted">
        {WEEKDAY_LABELS.map((l) => (
          <div key={l} className="py-1">
            {l}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {days.map((date) => {
          const inMonth = fromIso(date).getUTCMonth() === cursor.month;
          const dayTasks = tasksByDay.get(date) ?? [];
          const dayExams = examsByDay.get(date) ?? [];
          const minutes = dayTasks.reduce((s, t) => s + t.minutes, 0);
          const subjectDots = [...new Set(dayTasks.map((t) => t.subjectColor))];
          const isSelected = date === selectedDay;
          const isToday = date === todayIso;
          return (
            <button
              key={date}
              type="button"
              onClick={() => setSelectedDay(date)}
              className={`flex h-16 flex-col items-start gap-1 rounded-[var(--radius-control)] border p-1.5 text-left transition-colors duration-120 ${
                isSelected
                  ? 'border-accent bg-bg-raised'
                  : 'border-border bg-bg-surface hover:bg-bg-raised'
              } ${inMonth ? '' : 'opacity-40'}`}
            >
              <span
                className={`font-mono text-[11px] tabular-nums ${isToday ? 'font-bold text-accent' : 'text-fg-secondary'}`}
              >
                {Number(date.slice(8, 10))}
              </span>
              <div className="flex flex-wrap gap-0.5">
                {subjectDots.map((c) => (
                  <span
                    key={c}
                    className="h-1.5 w-1.5 rounded-full"
                    style={{ backgroundColor: SUBJECT_COLOR_HEX[c] }}
                  />
                ))}
                {dayExams.length > 0 && <span className="text-[10px]">🎯</span>}
              </div>
              {minutes > 0 && (
                <span className="font-mono text-[10px] text-fg-muted">{minutes}′</span>
              )}
            </button>
          );
        })}
      </div>

      <div className="mt-5">
        <p className="mb-2 font-mono text-xs tabular-nums text-fg-muted">{selectedDay}</p>
        <DayAgenda
          date={selectedDay}
          dayTasks={tasksByDay.get(selectedDay) ?? []}
          dayExams={examsByDay.get(selectedDay) ?? []}
          onMove={(subjectSlug, taskId, date) => move.mutate({ subjectSlug, taskId, date })}
        />
      </div>
    </div>
  );
}
