import { addDays, diffDays, eachDay, weekday, type IsoDate } from './dates.js';
import { sliceMaterial } from './split.js';
import type {
  DayLoad,
  Feasibility,
  Intensity,
  LessonMethod,
  MaterialRef,
  PlanResult,
  PlannedTask,
  PlannerInput,
  PlannerLesson,
  PlannerTopic,
  Strategy,
} from './types.js';

/**
 * Fase B — deterministic scheduling (docs/04-planner.md §4, docs/10-planner-lezioni.md §4.2).
 * Pure: no I/O, no clock, no AI — rerunning it after the user moves a task is instant and free
 * (docs/fasi/F6 "Decisioni": "il re-schedule non chiama l'LLM").
 *
 * Greedy, day by day, in this order of precedence:
 *   1. pinned tasks (the user's decisions)        — consumed first
 *   2. FSRS reviews due that day                  — "precedenza assoluta"
 *   3. simulations at ~60/85/95% of the timeline  — can't be split
 *   4. spaced revisits (+1 flashcards, +3 and +7 verify), due first, then carried over
 *   5. new lessons, in prerequisite order, hard/easy interleaved,
 *      ≤2 new topics per day (lifted when time is short), never in the last 2 days
 * A lesson is atomic and never shortened: when the time is short the method changes (sprint) or
 * the topic is left out, never the duration. Every placement checks the day's remaining minutes,
 * so a day is never overbooked by the planner. A lesson longer than any day is split by content into
 * parts that fit; only an indivisible one goes on the roomiest day, with a warning.
 */

/** Share of the stated availability actually planned, by intensity (docs/04 §2 prefs). */
export const INTENSITY_FACTOR: Record<Intensity, number> = {
  sostenibile: 0.75,
  standard: 0.9,
  sprint: 1,
};
/** Smallest study block worth scheduling — also the floor of a lesson estimate. */
export const MIN_CHUNK_MINUTES = 15;
const MAX_NEW_TOPICS_PER_DAY = 2;
const REVISIT_OFFSETS_DAYS = [1, 3, 7];
const SIMULATION_POSITIONS = [0.6, 0.85, 0.95];
const FINAL_REVIEW_MINUTES = 60;
/** Fixed length of the +3 / +7 day verifications. */
export const VERIFY_MINUTES = 15;
/** Sprint length of a topic that doesn't say its own, relative to the standard one. */
const DEFAULT_SPRINT_RATIO = 0.7;

export function buildCapacity(input: PlannerInput): Map<IsoDate, number> {
  const factor = INTENSITY_FACTOR[input.prefs.intensity];
  const blackout = new Set(input.availability.blackoutDates);
  const capacity = new Map<IsoDate, number>();
  for (const day of eachDay(input.startDate, input.targetDate)) {
    const base = Math.floor((input.availability.perWeekday[weekday(day)] ?? 0) * factor);
    const busy = input.busyMinutesByDate?.[day] ?? 0;
    capacity.set(day, blackout.has(day) ? 0 : Math.max(0, base - busy));
  }
  return capacity;
}

/** The lessons of a topic: its own, or a single one standing for the whole topic. */
export function topicLessons(topic: PlannerTopic): PlannerLesson[] {
  if (topic.lessons && topic.lessons.length > 0) return topic.lessons;
  return [
    {
      title: topic.name,
      material: topic.material,
      standardMinutes: topic.estimatedMinutes,
      sprintMinutes: Math.round(DEFAULT_SPRINT_RATIO * topic.estimatedMinutes),
    },
  ];
}

/**
 * Estimated length of a lesson with the given method: already partly mastered material needs a
 * lighter pass. It is the estimate of the lesson, not a compression — rounded to 5, never below 15.
 */
export function lessonMinutes(
  lesson: PlannerLesson,
  method: LessonMethod,
  mastery: number | null,
): number {
  const base = method === 'sprint' ? lesson.sprintMinutes : lesson.standardMinutes;
  const factor = 1 - 0.5 * Math.min(1, Math.max(0, mastery ?? 0));
  return Math.max(MIN_CHUNK_MINUTES, Math.round((base * factor) / 5) * 5);
}

function revisitMinutes(learn: number, sessionLength: number): number {
  return Math.min(sessionLength, Math.max(MIN_CHUNK_MINUTES, Math.round(learn * 0.25)));
}

function pad(n: number): string {
  return String(n).padStart(3, '0');
}

export function totalPages(material: MaterialRef[]): number {
  return material.reduce((s, m) => s + (m.pageTo - m.pageFrom + 1), 0);
}

function describePages(material: MaterialRef[]): string {
  return material
    .map((m) => (m.pageFrom === m.pageTo ? `p. ${m.pageFrom}` : `pp. ${m.pageFrom}–${m.pageTo}`))
    .join(', ');
}

/**
 * Prerequisite order (Kahn), picking among ready topics by priority
 * (exam weight × mastery gap), alternating hard and easy for interleaving.
 * A cycle is broken by dropping its edges — with a warning, not a crash.
 */
function orderTopics(topics: PlannerTopic[], warnings: string[]): PlannerTopic[] {
  const byKey = new Map(topics.map((t) => [t.key, t]));
  const prereqs = new Map(
    topics.map((t) => [t.key, new Set(t.prerequisites.filter((p) => byKey.has(p)))]),
  );
  const priority = (t: PlannerTopic) => t.examWeight * (1 - (t.mastery ?? 0));
  const ordered: PlannerTopic[] = [];
  const done = new Set<string>();
  let wantHard = true;

  while (ordered.length < topics.length) {
    let ready = topics.filter(
      (t) => !done.has(t.key) && [...prereqs.get(t.key)!].every((p) => done.has(p)),
    );
    if (ready.length === 0) {
      const stuck = topics.filter((t) => !done.has(t.key));
      warnings.push(
        `Prerequisiti circolari fra: ${stuck.map((t) => t.name).join(', ')} — ignorati per poter pianificare.`,
      );
      for (const t of stuck) prereqs.set(t.key, new Set());
      ready = stuck;
    }
    ready.sort(
      (a, b) =>
        (wantHard ? b.difficulty - a.difficulty : a.difficulty - b.difficulty) ||
        priority(b) - priority(a) ||
        a.key.localeCompare(b.key),
    );
    const next = ready[0]!;
    ordered.push(next);
    done.add(next.key);
    wantHard = !wantHard;
  }
  return ordered;
}

function simulationDayIndexes(dayCount: number, requested: number | 'auto'): number[] {
  const count =
    requested === 'auto'
      ? dayCount >= 10
        ? 3
        : dayCount >= 5
          ? 2
          : dayCount >= 2
            ? 1
            : 0
      : Math.max(0, requested);
  return SIMULATION_POSITIONS.slice(0, Math.min(count, SIMULATION_POSITIONS.length)).map((f) =>
    Math.min(dayCount - 1, Math.floor(f * dayCount)),
  );
}

interface PendingRevisit {
  topic: PlannerTopic;
  n: number;
  due: IsoDate;
  minutes: number;
}

/** One atomic lesson, ready to be placed. */
interface LessonUnit {
  key: string;
  title: string;
  minutes: number;
  material: MaterialRef[];
  n: number;
  of: number;
}

interface TopicState {
  units: LessonUnit[];
  /** Index of the next lesson to place. */
  next: number;
  total: number;
  finishedOn: IsoDate | null;
}

interface RunConfig {
  /** Topics whose lessons are all switched to sprint to make the plan fit. */
  sprintTopics: Set<string>;
  /** Topics left out of the plan. */
  excluded: Set<string>;
  /** Cap of new topics per day: lifted when time is short. */
  cap: boolean;
}

interface RunOutput {
  result: PlanResult;
  /** Included topics whose lessons did not all find a place. */
  unscheduled: string[];
  /** Most free minutes on any day that takes new content: the longest lesson that can be placed. */
  bestRoom: number;
}

function methodOf(input: PlannerInput, config: RunConfig, topic: PlannerTopic): LessonMethod {
  return input.prefs.intensity === 'sprint' || config.sprintTopics.has(topic.key)
    ? 'sprint'
    : 'standard';
}

/**
 * The lessons of a topic as atomic units. A lesson longer than `maxMinutes` (the roomiest day) is
 * split by content — page ranges of its material, never by minutes — into the fewest parts that
 * fit, and the parts of the whole topic are renumbered. A lesson that cannot be split (no pages to
 * divide) stays whole.
 */
function buildUnits(
  topic: PlannerTopic,
  method: LessonMethod,
  maxMinutes = Infinity,
): LessonUnit[] {
  const parts: { title: string; minutes: number; material: MaterialRef[] }[] = [];
  for (const l of topicLessons(topic)) {
    const minutes = lessonMinutes(l, method, topic.mastery);
    const material = l.material.length > 0 ? l.material : topic.material;
    parts.push(...splitLesson(l.title, minutes, material, maxMinutes));
  }
  return parts.map((p, i) => ({
    key: `lesson:${topic.key}:${pad(i + 1)}`,
    title: parts.length > 1 ? `${p.title} · parte ${i + 1} di ${parts.length}` : p.title,
    minutes: p.minutes,
    material: p.material,
    n: i + 1,
    of: parts.length,
  }));
}

function splitLesson(
  title: string,
  minutes: number,
  material: MaterialRef[],
  maxMinutes: number,
): { title: string; minutes: number; material: MaterialRef[] }[] {
  const whole = [{ title, minutes, material }];
  if (minutes <= maxMinutes || maxMinutes <= 0) return whole;
  const pages = totalPages(material);
  for (let k = Math.max(2, Math.ceil(minutes / maxMinutes)); k <= pages; k += 1) {
    const parts = Array.from({ length: k }, (_, i) => {
      // Even split of the pages: parts differ by at most one page.
      const from = Math.floor((i * pages) / k);
      const to = Math.floor(((i + 1) * pages) / k);
      return {
        title,
        minutes: Math.max(MIN_CHUNK_MINUTES, Math.round((minutes * (to - from)) / pages / 5) * 5),
        material: sliceMaterial(material, from, to),
      };
    });
    if (parts.every((p) => p.minutes <= maxMinutes)) return parts;
  }
  return whole;
}

function names(list: string[]): string {
  return list.map((n) => `"${n}"`).join(', ');
}

/**
 * Always returns a plan. A lesson is never shortened. When the time is short, in this order and
 * stopping as soon as everything fits: the cap on new topics per day is lifted; the topics with
 * the lowest exam weight switch to sprint, one at a time (all their lessons); the topics with the
 * lowest exam weight are left out, one at a time. Sprint lessons and left-out topics are named in
 * the feasibility and the warnings, and a plan with left-out topics is flagged infeasible, with the
 * strategies, so the student knows.
 */
export function schedulePlan(input: PlannerInput): PlanResult {
  const config: RunConfig = { sprintTopics: new Set(), excluded: new Set(), cap: true };
  let out = run(input, config);
  if (out.unscheduled.length === 0) return out.result;

  const availableMinutes = out.result.feasibility.availableMinutes;
  config.cap = false;
  out = run(input, config);
  if (out.unscheduled.length === 0 || availableMinutes <= 0) return out.result;

  const byWeight = input.topics
    .filter((t) => t.material.length > 0)
    .sort((a, b) => a.examWeight - b.examWeight || a.key.localeCompare(b.key));

  if (input.prefs.intensity !== 'sprint') {
    for (const t of byWeight) {
      if (config.sprintTopics.has(t.key)) continue;
      config.sprintTopics.add(t.key);
      out = run(input, config);
      if (out.unscheduled.length === 0) return out.result;
    }
  }
  for (const t of byWeight) {
    config.excluded.add(t.key);
    out = run(input, config);
    if (out.unscheduled.length === 0) return out.result;
  }
  return out.result;
}

function run(input: PlannerInput, config: RunConfig): RunOutput {
  const warnings: string[] = [];
  const days = eachDay(input.startDate, input.targetDate);
  const capacity = buildCapacity(input);
  // Said out loud: other subjects' tasks and imported events are hard constraints, so a day they fill is lost here.
  const declaredDays = days.filter(
    (d) =>
      (input.availability.perWeekday[weekday(d)] ?? 0) > 0 &&
      !input.availability.blackoutDates.includes(d),
  );
  const takenDays = declaredDays.filter((d) => (capacity.get(d) ?? 0) === 0).length;
  if (takenDays > 0) {
    warnings.push(
      `${takenDays} giorni su ${declaredDays.length} con ore disponibili sono interamente occupati da task di altre materie o da eventi del calendario: non c'è tempo libero per questa materia.`,
    );
  }
  const remaining = new Map(capacity);
  const tasks: PlannedTask[] = [];
  const lastTwo = new Set(days.slice(-2));
  const { sessionLength } = input.prefs;

  const place = (task: PlannedTask) => {
    tasks.push(task);
    remaining.set(task.date, (remaining.get(task.date) ?? 0) - task.minutes);
  };

  // 1. Pinned tasks: the user's decisions, kept exactly as they are.
  for (const p of input.pinned ?? []) {
    place({ ...p, pinned: true });
    if ((remaining.get(p.date) ?? 0) < 0) {
      warnings.push(`Il ${p.date} le task bloccate superano i minuti disponibili.`);
    }
  }

  // 2. FSRS reviews due: first claim on each day's time.
  let requiredReview = 0;
  for (const day of days) {
    const due = input.dueCardsByDate?.[day] ?? 0;
    if (due <= 0) continue;
    const need = Math.ceil(due * input.prefs.reviewMinutesPerCard);
    requiredReview += need;
    const minutes = Math.min(need, Math.max(0, remaining.get(day) ?? 0));
    if (minutes <= 0) continue;
    place({
      key: `fsrs:${day}`,
      date: day,
      kind: 'review',
      topicKey: null,
      topicId: null,
      minutes,
      title: `Ripasso flashcard in scadenza (${due} card)`,
      description: 'Le card in scadenza hanno la precedenza: il debito di ripasso non si rimanda.',
      payload: { action: 'review_session' },
      pinned: false,
      origin: 'planner',
    });
    if (minutes < need)
      warnings.push(`Il ${day} non c'è tempo per tutte le ${due} card in scadenza.`);
  }

  // 3. Simulations at ~60/85/95% of the way (never split; nearest day with room otherwise).
  const simIndexes =
    days.length > 0 ? simulationDayIndexes(days.length, input.prefs.simulationCount) : [];
  const simMinutes = input.prefs.simulationMinutes;
  let simN = 0;
  for (const idx of simIndexes) {
    simN += 1;
    const candidates = days
      .map((d, i) => ({ d, dist: Math.abs(i - idx), later: i > idx }))
      .sort((a, b) => a.dist - b.dist || Number(a.later) - Number(b.later));
    const slot = candidates.find(
      (c) =>
        (remaining.get(c.d) ?? 0) >= simMinutes &&
        !tasks.some((t) => t.date === c.d && t.kind === 'simulation'),
    );
    if (!slot) {
      warnings.push(`Simulazione ${simN}: nessun giorno con ${simMinutes} minuti liberi.`);
      continue;
    }
    place({
      key: `sim:${pad(simN)}`,
      date: slot.d,
      kind: 'simulation',
      topicKey: null,
      topicId: null,
      minutes: simMinutes,
      title: `Simulazione d'esame ${simN}`,
      description:
        simN === 1
          ? "La prima simulazione arriva presto: serve a calibrare l'autovalutazione."
          : 'Simulazione a tempo, poi correzione formativa.',
      payload: { action: 'simulation' },
      pinned: false,
      origin: 'planner',
    });
  }

  // 4 + 5. Revisits and new lessons, day by day.
  const eligible: PlannerTopic[] = [];
  for (const t of input.topics) {
    if (t.material.length === 0) {
      warnings.push(
        `"${t.name}": nessun materiale collegato, nessuna task creata (una task senza materiale non è eseguibile).`,
      );
    } else {
      eligible.push(t);
    }
  }
  if (input.topics.length === 0)
    warnings.push('Nessun materiale da pianificare: carica documenti o crea argomenti.');

  const fullOrder = orderTopics(eligible, warnings);
  const order = fullOrder.filter((t) => !config.excluded.has(t.key));
  // The roomiest day bounds a lesson: a longer one is split by content, or — if it cannot be — goes on that day anyway.
  const baseRoom = new Map<IsoDate, number>();
  for (const d of days) if (!lastTwo.has(d)) baseRoom.set(d, remaining.get(d) ?? 0);
  const bestRoom = Math.max(0, ...baseRoom.values());

  const state = new Map<string, TopicState>();
  for (const t of order) {
    const units = buildUnits(t, methodOf(input, config, t), bestRoom > 0 ? bestRoom : Infinity);
    state.set(t.key, {
      units,
      next: 0,
      total: units.reduce((sum, u) => sum + u.minutes, 0),
      finishedOn: null,
    });
  }

  const pending: PendingRevisit[] = [];
  const maxNewPerDay = config.cap ? MAX_NEW_TOPICS_PER_DAY : Infinity;

  for (const day of days) {
    // 4. Spaced revisits whose date has come (oldest first), carried over if they don't fit.
    pending.sort(
      (a, b) => a.due.localeCompare(b.due) || a.topic.key.localeCompare(b.topic.key) || a.n - b.n,
    );
    for (const r of [...pending]) {
      if (r.due > day) continue;
      if ((remaining.get(day) ?? 0) < r.minutes) continue;
      pending.splice(pending.indexOf(r), 1);
      const first = r.n === 1;
      place({
        key: `rev:${r.topic.key}:${pad(r.n)}`,
        date: day,
        kind: first ? 'flashcards' : 'verify',
        topicKey: r.topic.key,
        topicId: r.topic.topicId,
        minutes: r.minutes,
        title: first ? `Flashcard su ${r.topic.name}` : `Verifica · ${r.topic.name}`,
        description: first
          ? `Genera le flashcard dal materiale appena studiato (${describePages(r.topic.material)}) e ripassale.`
          : 'Verifica a materiale chiuso: richiama a memoria prima di rileggere.',
        payload: first
          ? { action: 'generate_flashcards', material: r.topic.material, topicId: r.topic.topicId }
          : { action: 'verify', topicId: r.topic.topicId, material: r.topic.material },
        pinned: false,
        origin: 'planner',
      });
    }

    // 5. New lessons — never in the last two days.
    if (lastTwo.has(day)) continue;
    let startedToday = 0;
    for (;;) {
      const room = remaining.get(day) ?? 0;
      const next = order.find((t) => {
        const s = state.get(t.key)!;
        const unit = s.units[s.next];
        if (!unit) return false;
        if (s.next === 0 && startedToday >= maxNewPerDay) return false;
        // Same day is fine: `order` is prerequisite-first, so the prerequisite's last lesson comes earlier that day.
        const ready = t.prerequisites.every((p) => {
          const ps = state.get(p);
          return !ps || (ps.finishedOn !== null && ps.finishedOn <= day);
        });
        if (!ready) return false;
        const oversized = unit.minutes > bestRoom && bestRoom > 0;
        return unit.minutes <= room || (oversized && baseRoom.get(day) === bestRoom);
      });
      if (!next) break;
      const s = state.get(next.key)!;
      const unit = s.units[s.next]!;
      if (s.next === 0) startedToday += 1;
      if (unit.minutes > room) {
        warnings.push(
          `La lezione "${unit.title}" (${unit.minutes} min) è più lunga di ogni giornata disponibile e non si può dividere: la metto il ${day}, il giorno con più tempo libero, ma supera i minuti previsti.`,
        );
      }
      const method = methodOf(input, config, next);
      place({
        key: unit.key,
        date: day,
        kind: 'lesson',
        topicKey: next.key,
        topicId: next.topicId,
        minutes: unit.minutes,
        title: unit.title,
        description: `Lezione ${method} su ${next.name} (${describePages(unit.material)}, ${unit.minutes} min).`,
        payload: {
          action: 'lesson',
          method,
          ...(unit.of > 1 ? { part: { n: unit.n, of: unit.of } } : {}),
          material: unit.material,
          topicId: next.topicId,
        },
        pinned: false,
        origin: 'planner',
      });
      s.next += 1;
      if (s.next >= s.units.length) {
        s.finishedOn = day;
        REVISIT_OFFSETS_DAYS.forEach((offset, i) =>
          pending.push({
            topic: next,
            n: i + 1,
            due: addDays(day, offset),
            minutes: i === 0 ? revisitMinutes(s.total, sessionLength) : VERIFY_MINUTES,
          }),
        );
      }
    }
  }

  // Taper: a general review on each of the last two days, if there's room.
  for (const day of days.slice(-2)) {
    const minutes = Math.min(FINAL_REVIEW_MINUTES, Math.max(0, remaining.get(day) ?? 0));
    if (minutes < MIN_CHUNK_MINUTES || eligible.length === 0) continue;
    place({
      key: `final:${day}`,
      date: day,
      kind: 'review',
      topicKey: null,
      topicId: null,
      minutes,
      title: 'Ripasso generale',
      description: 'Ultimi giorni: solo ripasso e richiamo attivo, nessun contenuto nuovo.',
      payload: { action: 'review_session' },
      pinned: false,
      origin: 'planner',
    });
  }

  if (pending.length > 0) {
    warnings.push(`${pending.length} ripassi a intervallo non trovano posto prima dell'esame.`);
  }

  // Feasibility.
  const unscheduled = order
    .filter((t) => state.get(t.key)!.next < state.get(t.key)!.units.length)
    .map((t) => t.key);
  // Anything that found no place is left out too (e.g. no capacity at all): said, not hidden.
  const excludedAll = fullOrder
    .filter((t) => config.excluded.has(t.key) || unscheduled.includes(t.key))
    .sort((a, b) => a.examWeight - b.examWeight || a.key.localeCompare(b.key));
  const excludedKeys = excludedAll.map((t) => t.key);

  const sprintLessonKeys =
    input.prefs.intensity === 'sprint'
      ? []
      : fullOrder
          .filter((t) => config.sprintTopics.has(t.key) && !excludedKeys.includes(t.key))
          .flatMap((t) => state.get(t.key)!.units.map((u) => u.key));
  if (sprintLessonKeys.length > 0) {
    const titles = fullOrder
      .filter((t) => config.sprintTopics.has(t.key) && !excludedKeys.includes(t.key))
      .flatMap((t) => state.get(t.key)!.units.map((u) => u.title));
    warnings.push(
      `Tempo insufficiente per tutto in versione standard: ${titles.length === 1 ? 'la lezione' : 'le lezioni'} ${names(titles)} ${titles.length === 1 ? 'passa' : 'passano'} a sprint (esercizi, poi la teoria che serve).`,
    );
  }
  if (excludedKeys.length > 0) {
    warnings.push(
      `Tempo insufficiente: ${excludedAll.length === 1 ? "l'argomento" : 'gli argomenti'} ${names(excludedAll.map((t) => t.name))} ${excludedAll.length === 1 ? 'resta fuori' : 'restano fuori'} dal piano${excludedAll.every((t) => config.excluded.has(t.key)) ? " (peso d'esame più basso)" : ''}.`,
    );
  }

  const sumStandard = (t: PlannerTopic) =>
    buildUnits(t, 'standard').reduce((s, u) => s + u.minutes, 0);
  const learnFull = fullOrder.reduce((s, t) => s + sumStandard(t), 0);
  const revisitTotal = fullOrder.reduce(
    (s, t) =>
      s +
      revisitMinutes(sumStandard(t), sessionLength) +
      (REVISIT_OFFSETS_DAYS.length - 1) * VERIFY_MINUTES,
    0,
  );
  const availableMinutes = [...capacity.values()].reduce((s, v) => s + v, 0);
  const requiredMinutes =
    learnFull + revisitTotal + simIndexes.length * simMinutes + requiredReview;
  const feasible = excludedKeys.length === 0 && (days.length > 0 || fullOrder.length === 0);
  const leftOutMinutes = excludedAll.reduce(
    (s, t) => s + buildUnits(t, 'sprint').reduce((m, u) => m + u.minutes, 0),
    0,
  );
  const shortfallMinutes = feasible
    ? 0
    : days.length === 0
      ? requiredMinutes
      : Math.max(leftOutMinutes, requiredMinutes - availableMinutes);

  const sprintTotal = fullOrder.reduce(
    (s, t) => s + buildUnits(t, 'sprint').reduce((m, u) => m + u.minutes, 0),
    0,
  );
  const feasibility: Feasibility = {
    feasible,
    requiredMinutes,
    availableMinutes,
    shortfallMinutes,
    unscheduledTopicKeys: excludedKeys,
    sprintLessonKeys,
    excludedTopicKeys: excludedKeys,
    strategies: feasible
      ? []
      : strategies(
          input,
          fullOrder,
          learnFull === 0 ? 0 : sprintTotal / learnFull,
          shortfallMinutes,
          availableMinutes,
          days.length,
        ),
  };

  tasks.sort((a, b) => a.date.localeCompare(b.date) || a.key.localeCompare(b.key));
  renumberSimulations(tasks);
  return {
    result: { tasks, loadPerDay: computeLoadPerDay(capacity, tasks), feasibility, warnings },
    unscheduled,
    bestRoom,
  };
}

/**
 * A simulation displaced to an earlier day (its target day was full) could
 * end up before the previous one; keys and titles follow calendar order so
 * "Simulazione 2" always comes after "Simulazione 1". Expects `tasks` sorted by date.
 */
function renumberSimulations(tasks: PlannedTask[]): void {
  const sims = tasks.filter((t) => t.kind === 'simulation' && t.origin === 'planner' && !t.pinned);
  sims.forEach((t, i) => {
    t.key = `sim:${pad(i + 1)}`;
    t.title = `Simulazione d'esame ${i + 1}`;
    t.description =
      i === 0
        ? "La prima simulazione arriva presto: serve a calibrare l'autovalutazione."
        : 'Simulazione a tempo, poi correzione formativa.';
  });
}

export function computeLoadPerDay(
  capacity: Map<IsoDate, number>,
  tasks: Pick<PlannedTask, 'date' | 'minutes'>[],
): DayLoad[] {
  const planned = new Map<IsoDate, number>();
  for (const t of tasks) planned.set(t.date, (planned.get(t.date) ?? 0) + t.minutes);
  return [...capacity.entries()].map(([date, available]) => ({
    date,
    available,
    planned: planned.get(date) ?? 0,
  }));
}

/** docs/04-planner.md §3: "se il tempo non basta … propone tre strategie". */
function strategies(
  input: PlannerInput,
  order: PlannerTopic[],
  sprintShare: number,
  shortfall: number,
  availableMinutes: number,
  dayCount: number,
): Strategy[] {
  const byWeight = [...order].sort(
    (a, b) => b.examWeight - a.examWeight || a.key.localeCompare(b.key),
  );
  const totalWeight = byWeight.reduce((s, t) => s + t.examWeight, 0) || 1;
  const focus: PlannerTopic[] = [];
  let acc = 0;
  for (const t of byWeight) {
    if (acc / totalWeight >= 0.8) break;
    focus.push(t);
    acc += t.examWeight;
  }

  const factor = INTENSITY_FACTOR[input.prefs.intensity];
  const weeklyMinutes = input.availability.perWeekday.reduce((s, m) => s + m, 0) * factor;
  const avgDaily = dayCount > 0 ? availableMinutes / dayCount : weeklyMinutes / 7;
  const extraDays = avgDaily > 0 ? Math.ceil(shortfall / avgDaily) : null;
  const newDate = extraDays !== null ? addDays(input.targetDate, extraDays) : null;
  const daysToExam = diffDays(input.startDate, input.targetDate);

  return [
    {
      id: 'copertura_superficiale',
      label: 'Copertura completa, più superficiale',
      description: `Tutti gli argomenti in versione sprint (esercizi, poi la teoria che serve), circa il ${Math.round(sprintShare * 100)}% del tempo della lezione standard.`,
    },
    {
      id: 'focus_80',
      label: "Focus sull'80% del peso d'esame",
      description: `Concentrati su ${focus.length} argomenti: ${focus.map((t) => t.name).join(', ') || '—'}.`,
    },
    {
      id: 'estendi_data',
      label: 'Sposta la data',
      description:
        newDate === null
          ? weeklyMinutes > 0
            ? 'Tutto il tempo che indichi è già occupato da altre materie o impegni: libera dei giorni o sposta le loro task.'
            : 'Nessuna disponibilità settimanale indicata: aggiungi ore di studio per poter stimare una data.'
          : `Servono circa ${extraDays} giorni in più${daysToExam <= 0 ? ' (la data è già passata o è oggi)' : ''}: data suggerita ${newDate}.`,
    },
  ];
}
