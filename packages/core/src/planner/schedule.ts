import { addDays, diffDays, eachDay, weekday, type IsoDate } from './dates.js';
import type {
  DayLoad,
  Feasibility,
  Intensity,
  MaterialRef,
  PlanResult,
  PlannedTask,
  PlannerInput,
  PlannerTopic,
  Strategy,
} from './types.js';

/**
 * Fase B — deterministic scheduling (docs/04-planner.md §4). Pure: no I/O,
 * no clock, no AI — rerunning it after the user moves a task is instant and
 * free (docs/fasi/F6 "Decisioni": "il re-schedule non chiama l'LLM").
 *
 * Greedy, day by day, in this order of precedence:
 *   1. pinned tasks (the user's decisions)        — consumed first
 *   2. FSRS reviews due that day                  — "precedenza assoluta"
 *   3. simulations at ~60/85/95% of the timeline  — can't be split
 *   4. spaced revisits (+1, +3, +7 days)          — due first, then carried over
 *   5. new content, in prerequisite order, hard/easy interleaved,
 *      ≤2 new topics per day, never in the last 2 days
 * Hard constraints hold by construction: every placement checks the day's
 * remaining minutes, so no day is ever overbooked by the planner itself.
 */

/** Share of the stated availability actually planned, by intensity (docs/04 §2 prefs). */
export const INTENSITY_FACTOR: Record<Intensity, number> = {
  sostenibile: 0.75,
  standard: 0.9,
  sprint: 1,
};
/** Smallest study block worth scheduling — below this a session is noise. */
export const MIN_CHUNK_MINUTES = 15;
const MAX_NEW_TOPICS_PER_DAY = 2;
const REVISIT_OFFSETS_DAYS = [1, 3, 7];
const SIMULATION_POSITIONS = [0.6, 0.85, 0.95];
const FINAL_REVIEW_MINUTES = 60;

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

export function learningMinutes(topic: PlannerTopic): number {
  // Material already partly mastered needs a lighter first pass (never below one block).
  const factor = 1 - 0.5 * Math.min(1, Math.max(0, topic.mastery ?? 0));
  return Math.max(MIN_CHUNK_MINUTES, Math.round(topic.estimatedMinutes * factor));
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

/**
 * Pages [startPage, endPage) of the topic's material (0-based over the
 * concatenated ranges), mapped back to real page numbers. The caller walks
 * a cumulative cursor, so consecutive sessions are contiguous by
 * construction — recomputing both ends from shares with different rounding
 * repeated a page (p. 43 twice) before.
 */
function sliceMaterial(material: MaterialRef[], startPage: number, endPage: number): MaterialRef[] {
  const out: MaterialRef[] = [];
  let offset = 0;
  for (const m of material) {
    const len = m.pageTo - m.pageFrom + 1;
    const lo = Math.max(startPage, offset);
    const hi = Math.min(endPage, offset + len);
    if (hi > lo)
      out.push({
        docId: m.docId,
        pageFrom: m.pageFrom + (lo - offset),
        pageTo: m.pageFrom + (hi - offset) - 1,
      });
    offset += len;
  }
  return out;
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

export function schedulePlan(input: PlannerInput): PlanResult {
  const warnings: string[] = [];
  const days = eachDay(input.startDate, input.targetDate);
  const capacity = buildCapacity(input);
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

  // 4 + 5. Revisits and new content, day by day.
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

  const order = orderTopics(eligible, warnings);
  const state = new Map(
    order.map((t) => [
      t.key,
      {
        total: learningMinutes(t),
        left: learningMinutes(t),
        sessions: 0,
        finishedOn: null as IsoDate | null,
        pages: totalPages(t.material),
        pagesDone: 0,
      },
    ]),
  );
  const pending: PendingRevisit[] = [];

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
        kind: first ? 'flashcards' : 'review',
        topicKey: r.topic.key,
        topicId: r.topic.topicId,
        minutes: r.minutes,
        title: first ? `Flashcard su ${r.topic.name}` : `Ripasso ${r.n - 1} di ${r.topic.name}`,
        description: first
          ? `Genera le flashcard dal materiale appena studiato (${describePages(r.topic.material)}) e ripassale.`
          : 'Ripasso a intervallo crescente: richiama a memoria prima di rileggere.',
        payload: first
          ? { action: 'generate_flashcards', material: r.topic.material, topicId: r.topic.topicId }
          : { action: 'review_session', topicId: r.topic.topicId },
        pinned: false,
        origin: 'planner',
      });
    }

    // 5. New content — never in the last two days.
    if (lastTwo.has(day)) continue;
    let startedToday = 0;
    for (;;) {
      const room = remaining.get(day) ?? 0;
      if (room < MIN_CHUNK_MINUTES) break;
      const next = order.find((t) => {
        const s = state.get(t.key)!;
        if (s.left <= 0) return false;
        if (s.sessions === 0 && startedToday >= MAX_NEW_TOPICS_PER_DAY) return false;
        return t.prerequisites.every((p) => {
          const ps = state.get(p);
          return !ps || (ps.finishedOn !== null && ps.finishedOn < day);
        });
      });
      if (!next) break;
      const s = state.get(next.key)!;
      const chunk = Math.min(s.left, sessionLength, room);
      if (chunk < MIN_CHUNK_MINUTES && chunk < s.left) break;
      if (s.sessions === 0) startedToday += 1;
      s.sessions += 1;
      const doneAfter = s.total - s.left + chunk;
      const isLast = chunk >= s.left;
      // Proportional end, but at least one new page, never past the end, and all remaining pages on the last session.
      let endPage = isLast
        ? s.pages
        : Math.max(s.pagesDone + 1, Math.round((doneAfter / s.total) * s.pages));
      endPage = Math.min(s.pages, endPage);
      // More sessions than pages: re-use the last page rather than emit an empty, non-actionable task.
      const startPage = Math.min(s.pagesDone, Math.max(0, s.pages - 1));
      const material = sliceMaterial(next.material, startPage, Math.max(endPage, startPage + 1));
      s.pagesDone = Math.max(s.pagesDone, endPage);
      place({
        key: `read:${next.key}:${pad(s.sessions)}`,
        date: day,
        kind: 'read',
        topicKey: next.key,
        topicId: next.topicId,
        minutes: chunk,
        title: `Studia ${next.name} — ${describePages(material)}`,
        description: `Sessione ${s.sessions} di ${next.name} (${chunk} min).`,
        payload: { action: 'read', material, topicId: next.topicId },
        pinned: false,
        origin: 'planner',
      });
      s.left -= chunk;
      if (s.left <= 0) {
        s.finishedOn = day;
        REVISIT_OFFSETS_DAYS.forEach((offset, i) =>
          pending.push({
            topic: next,
            n: i + 1,
            due: addDays(day, offset),
            minutes: revisitMinutes(s.total, sessionLength),
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
  const learnTotal = order.reduce((s, t) => s + state.get(t.key)!.total, 0);
  const learnLeft = order.reduce((s, t) => s + Math.max(0, state.get(t.key)!.left), 0);
  const revisitTotal = order.reduce(
    (s, t) =>
      s + REVISIT_OFFSETS_DAYS.length * revisitMinutes(state.get(t.key)!.total, sessionLength),
    0,
  );
  const availableMinutes = [...capacity.values()].reduce((s, v) => s + v, 0);
  const requiredMinutes =
    learnTotal + revisitTotal + simIndexes.length * simMinutes + requiredReview;
  const unscheduledTopicKeys = order.filter((t) => state.get(t.key)!.left > 0).map((t) => t.key);
  const feasible = unscheduledTopicKeys.length === 0 && (days.length > 0 || learnTotal === 0);
  const shortfallMinutes = days.length === 0 ? requiredMinutes : learnLeft;

  const feasibility: Feasibility = {
    feasible,
    requiredMinutes,
    availableMinutes,
    shortfallMinutes,
    unscheduledTopicKeys,
    strategies: feasible
      ? []
      : strategies(
          input,
          order,
          learnTotal,
          learnLeft,
          shortfallMinutes,
          availableMinutes,
          days.length,
        ),
  };

  tasks.sort((a, b) => a.date.localeCompare(b.date) || a.key.localeCompare(b.key));
  renumberSimulations(tasks);
  return { tasks, loadPerDay: computeLoadPerDay(capacity, tasks), feasibility, warnings };
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
  learnTotal: number,
  learnLeft: number,
  shortfall: number,
  availableMinutes: number,
  dayCount: number,
): Strategy[] {
  const coveredShare = learnTotal === 0 ? 0 : Math.max(0, (learnTotal - learnLeft) / learnTotal);

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
      description: `Tutti gli argomenti, con circa il ${Math.round(coveredShare * 100)}% del tempo previsto per ciascuno.`,
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
          ? 'Nessuna disponibilità settimanale indicata: aggiungi ore di studio per poter stimare una data.'
          : `Servono circa ${extraDays} giorni in più${daysToExam <= 0 ? ' (la data è già passata o è oggi)' : ''}: data suggerita ${newDate}.`,
    },
  ];
}
