import type { Intensity, PlanDto, TaskDto } from '@studyhub/contracts';

export const KIND_LABELS: Record<TaskDto['kind'], string> = {
  read: 'Lettura',
  flashcards: 'Flashcard',
  schema: 'Schema',
  simulation: 'Simulazione',
  drill: 'Drill',
  rest: 'Riposo',
  review: 'Ripasso',
};

export const INTENSITY_LABELS: Record<Intensity, string> = {
  sprint: 'Sprint',
  standard: 'Standard',
  sostenibile: 'Sostenibile',
};

export const INTENSITY_ORDER: readonly Intensity[] = ['sprint', 'standard', 'sostenibile'];

export type KindColor = 'accent' | 'subject' | 'warn' | 'danger' | 'info' | 'muted';

/** Colour family of a task kind; `subject` is the subject's identity colour (not a global token). */
export function kindColor(kind: TaskDto['kind']): KindColor {
  switch (kind) {
    case 'read':
    case 'schema':
      return 'accent';
    case 'flashcards':
      return 'subject';
    case 'drill':
      return 'warn';
    case 'simulation':
      return 'danger';
    case 'review':
      return 'info';
    case 'rest':
      return 'muted';
  }
}

/** Tasks that count towards the progress: everything but rest days and moved leftovers. */
export function planProgress(tasks: TaskDto[]): { total: number; done: number } {
  const counted = tasks.filter((t) => t.kind !== 'rest' && t.status !== 'moved');
  return { total: counted.length, done: counted.filter((t) => t.status === 'done').length };
}

/** Open tasks of the (active) plan flagged by the drift report, oldest first (`today` = ISO date). */
export function overdueTasks(
  plan: PlanDto | null,
  overdueKeys: string[],
  today: string,
): TaskDto[] {
  if (!plan || plan.status !== 'active') return [];
  const keys = new Set(overdueKeys);
  return plan.tasks
    .filter(
      (t) =>
        keys.has(t.taskKey) &&
        // The report spans every active plan and only the last 7 days; task keys repeat across plans.
        t.date < today &&
        t.date >= addDaysIso(today, -7) &&
        t.status !== 'done' &&
        t.status !== 'skipped' &&
        t.status !== 'moved',
    )
    .sort((a, b) => a.date.localeCompare(b.date));
}

function parseIso(iso: string): Date {
  return new Date(`${iso}T00:00:00Z`);
}

export function addDaysIso(iso: string, n: number): string {
  const d = parseIso(iso);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Every date from the first to the last task (free days included). */
export function dayRange(tasks: Pick<TaskDto, 'date'>[]): string[] {
  if (tasks.length === 0) return [];
  const dates = tasks.map((t) => t.date).sort();
  const last = dates[dates.length - 1]!;
  const days: string[] = [];
  for (let d = dates[0]!; d <= last; d = addDaysIso(d, 1)) days.push(d);
  return days;
}

/** Today if in range, else the first day after today, else the last day. */
export function defaultDay(days: string[], today: string): string | null {
  if (days.length === 0) return null;
  if (days.includes(today)) return today;
  return days.find((d) => d >= today) ?? days[days.length - 1]!;
}

/** Mean of the weekdays with time available, rounded to 5 minutes (0 when none). */
export function averageMinutes(perWeekday: number[]): number {
  const active = perWeekday.filter((m) => m > 0);
  if (active.length === 0) return 0;
  const mean = active.reduce((a, b) => a + b, 0) / active.length;
  return Math.round(mean / 5) * 5;
}

/** Rescales the weekdays with time so that their mean becomes `targetAvg`; zero days stay zero. */
export function scaleAvailability(perWeekday: number[], targetAvg: number): number[] {
  const active = perWeekday.filter((m) => m > 0);
  if (active.length === 0) return perWeekday.slice();
  const exactMean = active.reduce((a, b) => a + b, 0) / active.length;
  const factor = targetAvg / exactMean;
  return perWeekday.map((m) => {
    if (m <= 0) return 0;
    const scaled = Math.round((m * factor) / 5) * 5;
    return Math.min(1440, Math.max(5, scaled));
  });
}

/**
 * Topics that can be excluded (same extraction as the desktop bulk bar). `openCount` is the
 * number of tasks the exclusion touches: todo/doing on an active plan, not-moved on a draft.
 */
export function excludableTopics(
  plan: PlanDto | null,
): { key: string; label: string; openCount: number }[] {
  if (!plan) return [];
  const active = plan.status === 'active';
  const counts = new Map<string, number>();
  for (const t of plan.tasks) {
    if (!t.topicKey) continue;
    const touched = active ? t.status === 'todo' || t.status === 'doing' : t.status !== 'moved';
    counts.set(t.topicKey, (counts.get(t.topicKey) ?? 0) + (touched ? 1 : 0));
  }
  const map = new Map<string, string>();
  for (const t of plan.tasks) {
    if (t.kind !== 'read' || !t.topicKey) continue;
    if (!map.has(t.topicKey)) map.set(t.topicKey, t.title.replace(/^Studia /, '').split(' — ')[0]!);
  }
  return [...map]
    .map(([key, label]) => ({ key, label, openCount: counts.get(key) ?? 0 }))
    .filter((t) => !active || t.openCount > 0);
}

/** 130 -> "2h 10m", 120 -> "2h", 45 -> "45m", 0 -> "—". */
export function formatDuration(min: number): string {
  if (min <= 0) return '—';
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** "Oggi" or "Giovedì 23 febbraio". */
export function formatDayTitle(iso: string, today: string): string {
  if (iso === today) return 'Oggi';
  return capitalize(
    parseIso(iso).toLocaleDateString('it-IT', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      timeZone: 'UTC',
    }),
  );
}

/** "Fino al 12 febbraio" (the year is added when it is not the current one). */
export function formatUntil(iso: string, currentYear = new Date().getUTCFullYear()): string {
  const d = parseIso(iso);
  const withYear = d.getUTCFullYear() !== currentYear;
  const text = d.toLocaleDateString('it-IT', {
    day: 'numeric',
    month: 'long',
    ...(withYear ? { year: 'numeric' as const } : {}),
    timeZone: 'UTC',
  });
  return `Fino al ${text}`;
}

/** Short weekday ("mer") and day of the month for the day strip. */
export function dayParts(iso: string): { weekday: string; day: number } {
  const d = parseIso(iso);
  return {
    weekday: d.toLocaleDateString('it-IT', { weekday: 'short', timeZone: 'UTC' }).replace('.', ''),
    day: d.getUTCDate(),
  };
}
