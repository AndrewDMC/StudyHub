'use client';

import type { PlanDto } from '@studyhub/contracts';
import { ICON_BTN } from '@/components/flashcards/shared/styles';
import { BTN_GHOST, FOCUS } from '@/components/subject-tabs/styles';
import {
  dayOfMonth,
  formatLoad,
  loadRatio,
  shortDate,
  stripPartSuffix,
  taskMeta,
  taskTone,
  taskTypeLabel,
  weekdayShort,
  weekWindow,
  type TypeTone,
} from './planModel';

const BAR: Record<TypeTone, string> = {
  accent: 'border-l-accent',
  info: 'border-l-info',
  ok: 'border-l-ok',
  warn: 'border-l-warn',
  neutral: 'border-l-border-strong',
};
const TEXT: Record<TypeTone, string> = {
  accent: 'text-accent',
  info: 'text-info',
  ok: 'text-ok',
  warn: 'text-warn',
  neutral: 'text-fg-secondary',
};
const SWATCH: Record<TypeTone, string> = {
  accent: 'bg-accent',
  info: 'bg-info',
  ok: 'bg-ok',
  warn: 'bg-warn',
  neutral: 'bg-border-strong',
};

const LEGEND: { tone: TypeTone; label: string }[] = [
  { tone: 'accent', label: 'Lezione standard' },
  { tone: 'info', label: 'Lezione sprint' },
  { tone: 'ok', label: 'Verifica e flashcard' },
  { tone: 'warn', label: 'Simulazione' },
];

/** Seven days of the plan, one cell per day; a cell selects the day shown in the detail below. */
export function WeekGrid({
  plan,
  today,
  offset,
  onOffset,
  selected,
  onSelect,
}: {
  plan: PlanDto;
  today: string;
  offset: number;
  onOffset: (next: number) => void;
  selected: string;
  onSelect: (date: string) => void;
}) {
  const win = weekWindow(plan, today, offset);
  const loadByDate = new Map(plan.loadPerDay.map((d) => [d.date, d]));
  return (
    <section aria-labelledby="settimana" data-testid="plan-week" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="settimana" className="text-base font-semibold text-fg-primary">
          {win.hasToday ? 'Questa settimana' : `Settimana dal ${shortDate(win.dates[0]!)}`}
        </h2>
        <div className="flex items-center gap-2">
          <button
            type="button"
            aria-label="Settimana precedente"
            disabled={!win.canPrev}
            onClick={() => onOffset(offset - 1)}
            className={`${ICON_BTN} disabled:opacity-40`}
          >
            ‹
          </button>
          <span className="text-[13px] text-fg-secondary">
            {shortDate(win.dates[0]!)} – {shortDate(win.dates[6]!)}
          </span>
          <button
            type="button"
            aria-label="Settimana successiva"
            disabled={!win.canNext}
            onClick={() => onOffset(offset + 1)}
            className={`${ICON_BTN} disabled:opacity-40`}
          >
            ›
          </button>
          {!win.hasToday && (
            <button type="button" onClick={() => onOffset(0)} className={BTN_GHOST}>
              Oggi
            </button>
          )}
        </div>
      </div>
      <div className="overflow-x-auto">
        <div className="grid min-w-[1000px] grid-cols-7 gap-2">
          {win.dates.map((date) => {
            const load = loadByDate.get(date);
            const tasks = plan.tasks.filter((t) => t.date === date);
            const isToday = date === today;
            const over = !!load && load.planned > load.available;
            const rest = !!load && load.available === 0;
            return (
              <button
                key={date}
                type="button"
                aria-pressed={date === selected}
                aria-label={`${weekdayShort(date)} ${shortDate(date)}, ${tasks.length} attività, ${formatLoad(load)}`}
                onClick={() => onSelect(date)}
                className={`flex min-h-[360px] flex-col items-stretch justify-start gap-1.5 rounded-lg border p-2.5 text-left ${FOCUS} ${
                  isToday ? 'border-accent/40 bg-bg-surface' : 'border-border bg-bg-inset'
                } ${date === selected ? 'ring-1 ring-accent' : ''}`}
              >
                <span className="flex items-baseline justify-between">
                  <span className="text-[13px] font-semibold text-fg-primary">
                    {isToday ? 'Oggi' : weekdayShort(date)}
                  </span>
                  <span className="text-xs text-fg-secondary">
                    {isToday
                      ? `${weekdayShort(date).toLowerCase()} ${dayOfMonth(date)}`
                      : dayOfMonth(date)}
                  </span>
                </span>
                <span
                  aria-hidden="true"
                  className="block h-1 overflow-hidden rounded-full bg-border"
                >
                  <span
                    className={`block h-full rounded-full ${over ? 'bg-danger' : isToday ? 'bg-accent' : 'bg-border-strong'}`}
                    style={{ width: `${Math.round(loadRatio(load) * 100)}%` }}
                  />
                </span>
                <span className="font-mono text-[11px] text-fg-secondary">{formatLoad(load)}</span>
                {tasks.length === 0 ? (
                  <span className="text-xs text-fg-muted">
                    {rest ? 'Riposo' : 'Nessuna attività'}
                  </span>
                ) : (
                  tasks.map((t) => {
                    const tone = taskTone(t);
                    const closed = t.status === 'done' || t.status === 'skipped';
                    return (
                      <span
                        key={t.id}
                        className={`flex flex-col gap-1 rounded-[var(--radius-control)] border border-l-[3px] border-border bg-bg-base/40 p-2 ${BAR[tone]}`}
                      >
                        <span
                          className={`text-[11px] font-medium uppercase tracking-[0.04em] ${TEXT[tone]}`}
                        >
                          {taskTypeLabel(t)}
                        </span>
                        <span
                          className={`text-[13px] font-medium leading-snug ${closed ? 'text-fg-secondary line-through' : 'text-fg-primary'}`}
                        >
                          {t.kind === 'lesson' ? stripPartSuffix(t.title) : t.title}
                        </span>
                        <span className="text-[11px] text-fg-secondary">{taskMeta(t)}</span>
                      </span>
                    );
                  })
                )}
              </button>
            );
          })}
        </div>
      </div>
      <ul aria-label="Legenda" className="flex flex-wrap gap-x-5 gap-y-2 text-xs text-fg-secondary">
        {LEGEND.map((l) => (
          <li key={l.label} className="flex items-center gap-1.5">
            <span aria-hidden="true" className={`size-2.5 rounded-sm ${SWATCH[l.tone]}`} />
            {l.label}
          </li>
        ))}
      </ul>
    </section>
  );
}
