import type { DocumentDto, Intensity, PlanDto, TaskDto, TopicDto } from '@studyhub/contracts';
import { formatExamDuration } from '@/components/subject-tabs/format';
import { taskMethod, type LessonMethodChoice } from '@/lib/taskMethod';

/** Pure view-models of the desktop plan page (no React): easy to test, no invented numbers. */

export const KIND_LABELS: Record<TaskDto['kind'], string> = {
  read: 'Lettura',
  lesson: 'Lezione',
  verify: 'Verifica',
  flashcards: 'Flashcard',
  schema: 'Schema',
  simulation: 'Simulazione',
  drill: 'Drill',
  rest: 'Riposo',
  review: 'Ripasso',
};

const WEEKDAYS_SHORT = ['Dom', 'Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab'];
const WEEKDAYS_LONG = [
  'Domenica',
  'Lunedì',
  'Martedì',
  'Mercoledì',
  'Giovedì',
  'Venerdì',
  'Sabato',
];
const MONTHS_SHORT = [
  'gen',
  'feb',
  'mar',
  'apr',
  'mag',
  'giu',
  'lug',
  'ago',
  'set',
  'ott',
  'nov',
  'dic',
];
const MONTHS_LONG = [
  'gennaio',
  'febbraio',
  'marzo',
  'aprile',
  'maggio',
  'giugno',
  'luglio',
  'agosto',
  'settembre',
  'ottobre',
  'novembre',
  'dicembre',
];

function parseIso(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}

export function addDaysIso(iso: string, days: number): string {
  const d = parseIso(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** "29 ott" */
export function shortDate(iso: string): string {
  const d = parseIso(iso);
  return `${d.getUTCDate()} ${MONTHS_SHORT[d.getUTCMonth()]}`;
}

/** "Giovedì 29 ottobre" */
export function longDate(iso: string): string {
  const d = parseIso(iso);
  return `${WEEKDAYS_LONG[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS_LONG[d.getUTCMonth()]}`;
}

export function weekdayShort(iso: string): string {
  return WEEKDAYS_SHORT[parseIso(iso).getUTCDay()]!;
}

export function dayOfMonth(iso: string): number {
  return parseIso(iso).getUTCDate();
}

/** "Lezione · parte 1 di 2" -> "Lezione". */
export function stripPartSuffix(title: string): string {
  return title.replace(/\s+·\s+parte\s+\d+\s+di\s+\d+\s*$/i, '');
}

/**
 * The 7 days shown by the week grid: they start today (or the plan's first day when today is outside
 * the plan) and move by whole weeks. The arrows stop at the plan's edges.
 */
function weekBase(plan: Pick<PlanDto, 'startDate' | 'targetDate'>, today: string): string {
  if (today > plan.targetDate) return addDaysIso(plan.targetDate, -6); // plan over: open the last week
  return today >= plan.startDate ? today : plan.startDate;
}

/** Today as `YYYY-MM-DD` (UTC, same convention as the rest of the app). */
export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Open tasks (todo/doing) dated before today: the "in ritardo" ones, oldest first. */
export function lateTasks(plan: Pick<PlanDto, 'tasks'>, today: string): TaskDto[] {
  return plan.tasks
    .filter((t) => t.date < today && (t.status === 'todo' || t.status === 'doing'))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** Offset (in weeks) of the window that contains `date`. */
export function weekOffsetFor(
  plan: Pick<PlanDto, 'startDate' | 'targetDate'>,
  today: string,
  date: string,
): number {
  const base = parseIso(weekBase(plan, today)).getTime();
  const days = Math.round((parseIso(date).getTime() - base) / 86_400_000);
  return Math.floor(days / 7);
}

export function weekWindow(
  plan: Pick<PlanDto, 'startDate' | 'targetDate'>,
  today: string,
  offsetWeeks: number,
): { dates: string[]; hasToday: boolean; canPrev: boolean; canNext: boolean } {
  const base = weekBase(plan, today);
  const first = addDaysIso(base, offsetWeeks * 7);
  const dates = Array.from({ length: 7 }, (_, i) => addDaysIso(first, i));
  return {
    dates,
    hasToday: dates.includes(today),
    canPrev: first > plan.startDate,
    canNext: dates[6]! < plan.targetDate,
  };
}

/** "2 h 10 min" -> "2 h 10" (the grid cell has little room). */
function compactDuration(min: number): string {
  return formatExamDuration(min).replace(/ min$/, '');
}

export function formatLoad(load: { planned: number; available: number } | undefined): string {
  if (!load) return '—';
  if (load.available === 0) return 'riposo';
  return `${compactDuration(load.planned)} / ${compactDuration(load.available)}`;
}

export function loadRatio(load: { planned: number; available: number } | undefined): number {
  if (!load || load.available <= 0) return 0;
  return Math.min(1, load.planned / load.available);
}

/** 3 or 7 days after the lesson, from the key of a review task (`rev:<topic>:02|03`). */
export function verifyOffset(task: Pick<TaskDto, 'kind' | 'taskKey'>): 3 | 7 | null {
  if (task.kind !== 'verify') return null;
  const m = /^rev:.+:(\d+)$/.exec(task.taskKey);
  if (!m) return null;
  const n = Number(m[1]);
  return n === 2 ? 3 : n === 3 ? 7 : null;
}

export type TypeTone = 'accent' | 'info' | 'ok' | 'warn' | 'neutral';

/** Colour family of a task in the week grid: standard lesson, sprint lesson, verify/flashcards, simulation. */
export function taskTone(task: Pick<TaskDto, 'kind' | 'payload'>): TypeTone {
  switch (task.kind) {
    case 'lesson':
      return taskMethod(task) === 'sprint' ? 'info' : 'accent';
    case 'verify':
    case 'flashcards':
    case 'review':
      return 'ok';
    case 'simulation':
      return 'warn';
    default:
      return 'neutral';
  }
}

export function taskTypeLabel(task: Pick<TaskDto, 'kind' | 'payload'>): string {
  if (task.kind === 'lesson' && taskMethod(task) === 'sprint') return 'Lezione · sprint';
  return KIND_LABELS[task.kind];
}

/** First material of the task as "pag. 112–131", or null. */
export function pagesLabel(task: Pick<TaskDto, 'payload'>): string | null {
  const m = task.payload.material?.[0];
  if (!m) return null;
  return m.pageFrom === m.pageTo ? `pag. ${m.pageFrom}` : `pag. ${m.pageFrom}–${m.pageTo}`;
}

/** Meta line of a task in the week grid: minutes, pages, part, verify offset, done/skipped. */
export function taskMeta(task: TaskDto): string {
  const parts: string[] = [`${task.minutes} min`];
  if (task.kind === 'lesson') {
    const pages = pagesLabel(task);
    if (pages) parts.push(pages);
    if (task.payload.part) parts.push(`${task.payload.part.n} di ${task.payload.part.of}`);
  }
  const offset = verifyOffset(task);
  if (offset) parts.push(`+${offset} g`);
  if (task.status === 'done') parts.push('Fatta');
  if (task.status === 'skipped') parts.push('Saltata');
  return parts.join(' · ');
}

/** Name of a plan unit: a topic, a document used as a topic, or a generic fallback. */
export function topicName(
  key: string,
  topics: Pick<TopicDto, 'id' | 'name'>[],
  documents: Pick<DocumentDto, 'id' | 'originalName'>[],
): string {
  return (
    topics.find((t) => t.id === key)?.name ??
    documents.find((d) => d.id === key)?.originalName ??
    'un argomento'
  );
}

export type PlanTopicEntry = {
  key: string;
  name: string;
  /** Lessons in the plan (moved ones excluded). */
  total: number;
  done: number;
  /** `fuori` for the topics left out of the plan. */
  method: LessonMethodChoice | 'misto' | 'fuori';
  /** Open lessons sorted by date. */
  openDates: string[];
  /** Sprint lessons the student chose (not the planner) in a non-sprint plan. */
  userSprint: boolean;
};

/**
 * Topics in study order: the planner's order (date of the first lesson, then task key), then the topics
 * left out, in the order of `excludedTopicKeys`.
 */
export function planTopicOrder(plan: PlanDto, nameOf: (key: string) => string): PlanTopicEntry[] {
  const lessons = plan.tasks.filter(
    (t) => t.kind === 'lesson' && t.status !== 'moved' && t.topicKey,
  );
  const byTopic = new Map<string, TaskDto[]>();
  for (const t of lessons) byTopic.set(t.topicKey!, [...(byTopic.get(t.topicKey!) ?? []), t]);
  const sprintKeys = new Set(plan.feasibility.sprintLessonKeys);
  const entries = [...byTopic.entries()].map(([key, tasks]) => {
    const sorted = [...tasks].sort(
      (a, b) => a.date.localeCompare(b.date) || a.taskKey.localeCompare(b.taskKey),
    );
    const methods = new Set(sorted.map((t) => taskMethod(t)));
    // Only `done` counts as done; a skipped lesson is neither done nor still to do.
    const open = sorted.filter((t) => t.status !== 'done' && t.status !== 'skipped');
    const doneCount = sorted.filter((t) => t.status === 'done').length;
    const entry: PlanTopicEntry = {
      key,
      name: nameOf(key) === 'un argomento' ? stripPartSuffix(sorted[0]!.title) : nameOf(key),
      total: sorted.length,
      done: doneCount,
      method: methods.size > 1 ? 'misto' : sorted[0] ? taskMethod(sorted[0]) : 'standard',
      openDates: open.map((t) => t.date),
      userSprint:
        plan.prefs.intensity !== 'sprint' &&
        sorted.some((t) => taskMethod(t) === 'sprint' && !sprintKeys.has(t.taskKey)),
    };
    return { entry, firstDate: sorted[0]!.date, firstKey: sorted[0]!.taskKey };
  });
  entries.sort(
    (a, b) => a.firstDate.localeCompare(b.firstDate) || a.firstKey.localeCompare(b.firstKey),
  );
  const out = entries.map((e) => e.entry);
  for (const key of plan.feasibility.excludedTopicKeys) {
    if (out.some((e) => e.key === key)) continue;
    out.push({
      key,
      name: nameOf(key),
      total: 0,
      done: 0,
      method: 'fuori',
      openDates: [],
      userSprint: false,
    });
  }
  return out;
}

/** "oggi, ven" / "domani" / "12 nov": when the open lessons of a topic are. */
export function whenLabel(dates: string[], today: string): string {
  if (dates.length === 0) return 'fatto';
  const label = (d: string) => {
    if (d === today) return 'oggi';
    if (d === addDaysIso(today, 1)) return 'domani';
    if (d > today && d <= addDaysIso(today, 7)) return weekdayShort(d).toLowerCase();
    return shortDate(d);
  };
  const shown = dates.slice(0, 2).map(label).join(', ');
  return dates.length > 2 ? `${shown}…` : shown;
}

export type FitTone = 'ok' | 'warn' | 'danger';
export type FitModel = {
  tone: FitTone;
  title: string;
  text: string;
  /** Sprint lessons the planner chose (titles), standard lessons count, excluded names. */
  standardLessons: number;
  sprintTitles: string[];
  excludedNames: string[];
  /** Whether to offer the actions ("Aggiungi disponibilità"...). */
  hasProblem: boolean;
};

function nameList(names: string[], max: number): string {
  if (names.length <= max) return names.join(', ');
  return `${names.slice(0, max).join(', ')} e altre ${names.length - max}`;
}

/** The "Cosa entra" card: what fits in standard, what went sprint, what stays out (by name). */
export function fitModel(plan: PlanDto, nameOf: (key: string) => string): FitModel {
  const f = plan.feasibility;
  const lessons = plan.tasks.filter((t) => t.kind === 'lesson' && t.status !== 'moved');
  const sprintKeys = new Set(f.sprintLessonKeys);
  const sprintTitles = lessons
    .filter((t) => sprintKeys.has(t.taskKey) && taskMethod(t) === 'sprint')
    .map((t) => stripPartSuffix(t.title));
  const excludedNames = f.excludedTopicKeys.map(nameOf);
  const standardLessons = lessons.filter((t) => taskMethod(t) === 'standard').length;
  const k = sprintTitles.length;
  const sprintSentence =
    k > 0
      ? `${k === 1 ? '1 lezione passata' : `${k} lezioni passate`} a sprint perché il tempo non basta per tutto in standard: ${nameList(sprintTitles, 3)}.`
      : '';

  if (excludedNames.length > 0) {
    const out =
      excludedNames.length === 1
        ? `Resta fuori: ${excludedNames[0]}.`
        : `Restano fuori: ${nameList(excludedNames, 3)}.`;
    const missing =
      f.shortfallMinutes > 0 ? ` Mancano circa ${formatExamDuration(f.shortfallMinutes)}.` : '';
    return {
      tone: 'danger',
      title: 'Qualcosa resta fuori dal piano',
      text: `${sprintSentence ? `${sprintSentence} ` : ''}${out}${missing}`,
      standardLessons,
      sprintTitles,
      excludedNames,
      hasProblem: true,
    };
  }
  if (!f.feasible) {
    return {
      tone: 'danger',
      title: 'Il tempo non basta',
      text: `${sprintSentence ? `${sprintSentence} ` : ''}Mancano circa ${formatExamDuration(f.shortfallMinutes)} su ${formatExamDuration(f.requiredMinutes)} richiesti.`,
      standardLessons,
      sprintTitles,
      excludedNames,
      hasProblem: true,
    };
  }
  if (k > 0) {
    return {
      tone: 'warn',
      title: 'Il piano entra, con qualche scelta',
      text: sprintSentence,
      standardLessons,
      sprintTitles,
      excludedNames,
      hasProblem: true,
    };
  }
  const topicCount = new Set(lessons.map((t) => t.topicKey).filter(Boolean)).size;
  const sprintCount = lessons.length - standardLessons;
  const how =
    sprintCount === 0
      ? 'standard'
      : standardLessons === 0
        ? 'sprint'
        : `standard e sprint (${standardLessons} e ${sprintCount})`;
  const topics = topicCount === 1 ? '1 argomento su 1' : `${topicCount} argomenti su ${topicCount}`;
  return {
    tone: 'ok',
    title: 'Entra tutto',
    text:
      topicCount > 0
        ? `Tutte le lezioni sono in ${how}: ${topics} nel piano, senza accorciare nessuna lezione.`
        : 'Il piano non ha ancora lezioni.',
    standardLessons,
    sprintTitles,
    excludedNames,
    hasProblem: false,
  };
}

/** Same 75 / 90 / 100 % as `INTENSITY_FACTOR` in packages/core/src/planner/schedule.ts (display only). */
export const INTENSITY_INFO: Record<
  Intensity,
  { label: string; capacity: string; title: string; description: string; sprint: boolean }
> = {
  sostenibile: {
    label: 'Sostenibile',
    capacity: 'Usa il 75% del tempo che hai indicato.',
    title: 'Lezioni standard, più distribuite',
    description:
      'Stesso metodo di Standard, con meno lezioni al giorno. Una lezione non viene mai accorciata.',
    sprint: false,
  },
  standard: {
    label: 'Standard',
    capacity: 'Usa il 90% del tempo che hai indicato.',
    title: 'Ogni lezione segue le fasi',
    description:
      'Prima capisci, poi rielabori con parole tue, poi ti metti alla prova. Le flashcard solo per i dettagli tecnici.',
    sprint: false,
  },
  sprint: {
    label: 'Sprint',
    capacity: 'Usa tutto il tempo che hai indicato.',
    title: 'Verticale: esercizi, poi la teoria che serve',
    description:
      'Parti dagli esercizi d’esame, recuperi solo la teoria che ti manca per risolverli, poi riprovi. La copertura segue il peso all’esame.',
    sprint: true,
  },
};

export const INTENSITY_ORDER: Intensity[] = ['sostenibile', 'standard', 'sprint'];
