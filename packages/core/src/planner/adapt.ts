import { addDays, type IsoDate } from './dates.js';
import { MIN_CHUNK_MINUTES } from './schedule.js';
import type { PlannedTask } from './types.js';

/**
 * Keeping a plan alive after the user touches it — all deterministic, no AI
 * (docs/fasi/F6 "Decisioni": spostare una task dev'essere istantaneo e gratuito).
 */

export interface PlanWindow {
  /** Minutes available per study day (already net of other subjects and blocking events). */
  capacity: Map<IsoDate, number>;
  /** Exam day: the last two days before it take no new content. */
  targetDate: IsoDate;
  /** topicKey -> prerequisite topicKeys. */
  prerequisites: Map<string, string[]>;
}

export interface Violation {
  date: IsoDate | null;
  taskKey: string | null;
  message: string;
}

type TaskLike = Pick<
  PlannedTask,
  'key' | 'date' | 'kind' | 'topicKey' | 'minutes' | 'pinned' | 'title'
>;

function lastTwo(targetDate: IsoDate): Set<IsoDate> {
  return new Set([addDays(targetDate, -1), addDays(targetDate, -2)]);
}

function readSeq(key: string): number {
  return Number(key.split(':').at(-1));
}

/**
 * Hard constraints of docs/04-planner.md §4, checked on any task set — used
 * after a move and, live, on the draft under review ("se le tue modifiche
 * rendono il piano infattibile, lo vedi mentre lo modifichi").
 */
export function validatePlan(tasks: TaskLike[], window: PlanWindow): Violation[] {
  const out: Violation[] = [];
  const load = new Map<IsoDate, number>();
  for (const t of tasks) load.set(t.date, (load.get(t.date) ?? 0) + t.minutes);

  for (const [date, minutes] of load) {
    const cap = window.capacity.get(date);
    if (cap === undefined) {
      out.push({ date, taskKey: null, message: `Il ${date} è fuori dal periodo del piano.` });
    } else if (minutes > cap) {
      const pinnedOnly = tasks.filter((t) => t.date === date).every((t) => t.pinned);
      out.push({
        date,
        taskKey: null,
        message: `Il ${date} prevede ${minutes} min su ${cap} disponibili${pinnedOnly ? ' (solo task bloccate)' : ''}.`,
      });
    }
  }

  const noNewContent = lastTwo(window.targetDate);
  for (const t of tasks) {
    if (t.kind === 'read' && noNewContent.has(t.date)) {
      out.push({
        date: t.date,
        taskKey: t.key,
        message: `"${t.title}": negli ultimi 2 giorni niente contenuti nuovi.`,
      });
    }
  }

  // Reading order within a topic, revisits after the reading, prerequisites before dependants.
  const reads = new Map<string, TaskLike[]>();
  for (const t of tasks) {
    if (t.kind === 'read' && t.topicKey)
      reads.set(t.topicKey, [...(reads.get(t.topicKey) ?? []), t]);
  }
  const finishedOn = new Map<string, IsoDate>();
  const startedOn = new Map<string, IsoDate>();
  for (const [topic, list] of reads) {
    const bySeq = [...list].sort((a, b) => readSeq(a.key) - readSeq(b.key));
    for (let i = 1; i < bySeq.length; i += 1) {
      if (bySeq[i]!.date < bySeq[i - 1]!.date) {
        out.push({
          date: bySeq[i]!.date,
          taskKey: bySeq[i]!.key,
          message: `"${bySeq[i]!.title}" viene prima della sessione precedente sullo stesso argomento.`,
        });
      }
    }
    finishedOn.set(
      topic,
      bySeq
        .map((t) => t.date)
        .sort()
        .at(-1)!,
    );
    startedOn.set(topic, bySeq.map((t) => t.date).sort()[0]!);
  }
  for (const t of tasks) {
    if (
      (t.kind === 'flashcards' || t.kind === 'review') &&
      t.topicKey &&
      finishedOn.has(t.topicKey)
    ) {
      if (t.date <= finishedOn.get(t.topicKey)!) {
        out.push({
          date: t.date,
          taskKey: t.key,
          message: `"${t.title}" arriva prima di aver finito di studiare l'argomento.`,
        });
      }
    }
  }
  for (const [topic, prereqs] of window.prerequisites) {
    const start = startedOn.get(topic);
    if (!start) continue;
    for (const p of prereqs) {
      const done = finishedOn.get(p);
      if (done && start <= done) {
        out.push({
          date: start,
          taskKey: null,
          message: `Un argomento inizia prima che il suo prerequisito sia finito.`,
        });
      }
    }
  }
  return out;
}

export type MoveResult<T extends TaskLike> =
  | { ok: true; tasks: T[]; displaced: { key: string; from: IsoDate; to: IsoDate }[] }
  | { ok: false; reason: string };

/**
 * Moves one task to another day and repairs locally: if the target day
 * overflows, the day's other movable tasks (not pinned, not the one just
 * moved) are pushed to the next day with room, latest-keyed first. If the
 * result would break any hard constraint, the move is refused with the
 * reason and nothing changes — never a silently broken plan.
 */
export function moveTask<T extends TaskLike>(
  tasks: T[],
  key: string,
  newDate: IsoDate,
  window: PlanWindow,
): MoveResult<T> {
  const task = tasks.find((t) => t.key === key);
  if (!task) return { ok: false, reason: 'Task non trovata nel piano.' };
  if (!window.capacity.has(newDate))
    return { ok: false, reason: `Il ${newDate} è fuori dal periodo del piano.` };
  if ((window.capacity.get(newDate) ?? 0) === 0)
    return { ok: false, reason: `Il ${newDate} non ha tempo disponibile.` };

  const next = tasks.map((t) => ({ ...t }));
  const moved = next.find((t) => t.key === key)!;
  moved.date = newDate;
  moved.pinned = true; // the user placed it: later recalculations must not move it back

  const displaced: { key: string; from: IsoDate; to: IsoDate }[] = [];
  const days = [...window.capacity.keys()].sort();
  const noNewContent = lastTwo(window.targetDate);
  const loadOf = (d: IsoDate) =>
    next.filter((t) => t.date === d).reduce((s, t) => s + t.minutes, 0);

  let guard = next.length * days.length;
  for (let i = days.indexOf(newDate); i >= 0 && i < days.length && guard > 0; guard -= 1) {
    const day = days[i]!;
    if (loadOf(day) <= (window.capacity.get(day) ?? 0)) {
      i += 1;
      if (displaced.length === 0) break; // nothing was pushed: the cascade never started
      continue;
    }
    const movable = next
      .filter((t) => t.date === day && !t.pinned && t.key !== key)
      .sort((a, b) => b.key.localeCompare(a.key));
    const victim = movable[0];
    if (!victim)
      return {
        ok: false,
        reason: `Il ${day} non ha abbastanza tempo e le altre task sono bloccate.`,
      };
    const target = days
      .slice(i + 1)
      .find(
        (d) =>
          (window.capacity.get(d) ?? 0) - loadOf(d) >=
            Math.min(victim.minutes, MIN_CHUNK_MINUTES) &&
          (window.capacity.get(d) ?? 0) - loadOf(d) >= victim.minutes &&
          !(victim.kind === 'read' && noNewContent.has(d)),
      );
    if (!target)
      return {
        ok: false,
        reason: `Non c'è spazio per ricollocare "${victim.title}" senza violare i vincoli.`,
      };
    displaced.push({ key: victim.key, from: day, to: target });
    victim.date = target;
  }

  const violations = validatePlan(next, window).filter((v) => {
    // Pre-existing problems unrelated to this move don't block it.
    const before = validatePlan(tasks, window);
    return !before.some((b) => b.message === v.message);
  });
  if (violations.length > 0) return { ok: false, reason: violations[0]!.message };
  return { ok: true, tasks: next, displaced };
}

export type TaskStatus = 'proposed' | 'todo' | 'doing' | 'done' | 'skipped' | 'moved';

export interface DriftReport {
  overdueKeys: string[];
  missedDays: IsoDate[];
  shouldRecalculate: boolean;
  reason: string | null;
}

/**
 * "Salto 3 giorni: al rientro il sistema propone un ricalcolo, non una lista
 * di 30 task arretrate" (docs/fasi/F6). Looks at the last 7 days.
 */
export function detectDrift(
  tasks: (Pick<PlannedTask, 'key' | 'date'> & { status: TaskStatus })[],
  today: IsoDate,
): DriftReport {
  const since = addDays(today, -7);
  const past = tasks.filter((t) => t.date < today && t.date >= since);
  const overdueKeys = past
    .filter((t) => t.status === 'todo' || t.status === 'doing')
    .map((t) => t.key);

  const byDay = new Map<IsoDate, (typeof past)[number][]>();
  for (const t of past) byDay.set(t.date, [...(byDay.get(t.date) ?? []), t]);
  const missedDays = [...byDay.entries()]
    .filter(([, list]) => list.every((t) => t.status !== 'done'))
    .map(([d]) => d)
    .sort();

  const missedShare = past.length === 0 ? 0 : overdueKeys.length / past.length;
  const shouldRecalculate = missedDays.length >= 2 || missedShare >= 0.3;
  const reason = !shouldRecalculate
    ? null
    : missedDays.length >= 2
      ? `${missedDays.length} giorni saltati`
      : `${Math.round(missedShare * 100)}% delle task dell'ultima settimana non svolte`;
  return { overdueKeys, missedDays, shouldRecalculate, reason };
}

export interface DiffRow {
  change: 'added' | 'removed' | 'moved' | 'resized';
  key: string;
  title: string;
  topicKey: string | null;
  from: IsoDate | null;
  to: IsoDate | null;
  reason: string;
}

export interface PlanDiff {
  rows: DiffRow[];
  unchanged: number;
  /** One readable line per topic, e.g. "+2 sessioni Termodinamica (01-13, 01-15)". */
  summary: string[];
}

/**
 * The recalculation is approved as a *diff*, not as 40 tasks to re-read
 * (docs/04-planner.md §9.5). Pinned tasks never appear; every row carries
 * the reason for the recalculation.
 */
export function diffPlans(
  active: TaskLike[],
  draft: TaskLike[],
  reason: string,
  topicNames: Map<string, string> = new Map(),
): PlanDiff {
  const a = new Map(active.filter((t) => !t.pinned).map((t) => [t.key, t]));
  const d = new Map(draft.filter((t) => !t.pinned).map((t) => [t.key, t]));
  const rows: DiffRow[] = [];
  let unchanged = 0;

  for (const [key, t] of d) {
    const old = a.get(key);
    if (!old)
      rows.push({
        change: 'added',
        key,
        title: t.title,
        topicKey: t.topicKey,
        from: null,
        to: t.date,
        reason,
      });
    else if (old.date !== t.date)
      rows.push({
        change: 'moved',
        key,
        title: t.title,
        topicKey: t.topicKey,
        from: old.date,
        to: t.date,
        reason,
      });
    else if (old.minutes !== t.minutes) {
      rows.push({
        change: 'resized',
        key,
        title: t.title,
        topicKey: t.topicKey,
        from: old.date,
        to: t.date,
        reason: `${old.minutes} → ${t.minutes} min — ${reason}`,
      });
    } else unchanged += 1;
  }
  for (const [key, t] of a) {
    if (!d.has(key))
      rows.push({
        change: 'removed',
        key,
        title: t.title,
        topicKey: t.topicKey,
        from: t.date,
        to: null,
        reason,
      });
  }
  rows.sort(
    (x, y) =>
      (x.to ?? x.from ?? '').localeCompare(y.to ?? y.from ?? '') || x.key.localeCompare(y.key),
  );

  const summary: string[] = [];
  const topics = [...new Set(rows.map((r) => r.topicKey ?? '—'))].sort();
  for (const topic of topics) {
    const name = topicNames.get(topic) ?? (topic === '—' ? 'Generale' : topic);
    const mine = rows.filter((r) => (r.topicKey ?? '—') === topic);
    const added = mine.filter((r) => r.change === 'added');
    const removed = mine.filter((r) => r.change === 'removed');
    const moved = mine.filter((r) => r.change === 'moved');
    const dates = (list: DiffRow[], pick: 'from' | 'to') =>
      list.map((r) => (r[pick] ?? '').slice(5)).join(', ');
    if (added.length)
      summary.push(`+${added.length} sessioni ${name} (${dates(added, 'to')}) — ${reason}`);
    if (removed.length)
      summary.push(`−${removed.length} sessioni ${name} (${dates(removed, 'from')}) — ${reason}`);
    if (moved.length) summary.push(`~${moved.length} spostate ${name} — ${reason}`);
  }
  summary.push(`=${unchanged} task invariate`);
  return { rows, unchanged, summary };
}
