import type {
  DocumentDto,
  DriftReportDto,
  ExamDto,
  GapDto,
  PlanDto,
  SimulationSummaryDto,
  SubjectOverviewDto,
  TaskDto,
  TopicDto,
} from '@studyhub/contracts';
import { taskMethod, type LessonMethodChoice } from '@/lib/taskMethod';
import { formatExamDuration } from '@/components/subject-tabs/format';
import { pagesLabel as pagesOf, topicName, verifyOffset } from '@/components/plan/planModel';

export { todayIso } from '@/components/plan/planModel';

/**
 * Pure models behind the Panoramica tab: everything the cards show is derived here from the
 * DTOs the app already fetches, so it can be tested without a DOM. Client-safe: types only
 * from `@studyhub/contracts`.
 */

// ---------------------------------------------------------------------------------------------
// Small text helpers

function parseDay(iso: string): Date {
  return new Date(`${iso.slice(0, 10)}T12:00:00`);
}

/** "gio 30 ott" */
export function formatDayLong(iso: string): string {
  return parseDay(iso).toLocaleDateString('it-IT', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
}

/** "30 ott" */
export function formatDayShort(iso: string): string {
  return parseDay(iso).toLocaleDateString('it-IT', { day: 'numeric', month: 'short' });
}

export function plural(n: number, one: string, many: string): string {
  return n === 1 ? `1 ${one}` : `${n} ${many}`;
}

/** "parte 1 di 2 · Appunti.pdf · pag. 1–10 · circa 25 min" (absent parts are skipped). */
export function lessonMeta(task: TaskDto, documents: DocumentDto[]): string {
  const parts: string[] = [];
  if (task.payload.part) parts.push(`parte ${task.payload.part.n} di ${task.payload.part.of}`);
  const first = task.payload.material?.[0];
  const pages = pagesOf(task);
  if (pages) {
    const name = documents.find((d) => d.id === first?.docId)?.originalName;
    const more =
      (task.payload.material?.length ?? 0) > 1
        ? ` e altri ${task.payload.material!.length - 1}`
        : '';
    parts.push(`${name ? `${name} · ` : ''}${pages}${more}`);
  }
  parts.push(`circa ${task.minutes} min`);
  return parts.join(' · ');
}

// ---------------------------------------------------------------------------------------------
// Plans

export function pickActivePlan(
  plans: PlanDto[],
  nextExamId: string | null | undefined,
  today: string,
): PlanDto | null {
  const active = plans.filter((p) => p.status === 'active');
  if (active.length === 0) return null;
  if (nextExamId) {
    const byExam = active.find((p) => p.examId === nextExamId);
    if (byExam) return byExam;
  }
  const upcoming = active
    .filter((p) => p.targetDate >= today)
    .sort((a, b) => a.targetDate.localeCompare(b.targetDate));
  return upcoming[0] ?? active[0]!;
}

export function pickDraftPlan(plans: PlanDto[]): PlanDto | null {
  return plans.find((p) => p.status === 'draft') ?? null;
}

const HERO_KINDS: ReadonlySet<TaskDto['kind']> = new Set(['lesson', 'verify', 'flashcards']);
const KIND_RANK: Record<string, number> = { lesson: 0, verify: 1, flashcards: 2 };

const isOpen = (t: TaskDto) => t.status === 'todo' || t.status === 'doing';

/**
 * Candidates for "Lezione di oggi": what is open today plus a started task that is overdue (it can
 * still be resumed). The task in progress comes first, then lessons, verifies, flashcards.
 */
export function heroOrder(tasks: TaskDto[], today: string): TaskDto[] {
  return tasks
    .filter((t) => HERO_KINDS.has(t.kind))
    .filter((t) => (t.date === today && isOpen(t)) || (t.date < today && t.status === 'doing'))
    .sort((a, b) => {
      const doing = Number(b.status === 'doing') - Number(a.status === 'doing');
      if (doing !== 0) return doing;
      const rank = (KIND_RANK[a.kind] ?? 9) - (KIND_RANK[b.kind] ?? 9);
      if (rank !== 0) return rank;
      return a.date.localeCompare(b.date) || a.taskKey.localeCompare(b.taskKey);
    });
}

/** Open tasks of today that are not lessons/verifies/flashcards (reading, schemas, drills, simulations…). */
export function otherActivities(tasks: TaskDto[], today: string): TaskDto[] {
  return tasks
    .filter((t) => !HERO_KINDS.has(t.kind) && t.kind !== 'rest')
    .filter((t) => t.date === today && isOpen(t))
    .sort((a, b) => a.taskKey.localeCompare(b.taskKey));
}

export type TodayState = 'lesson' | 'next' | 'rest' | 'idle' | 'done' | 'no-plan' | 'draft';

export interface TodayModel {
  state: TodayState;
  /** Candidates of today (hero first); for `next`/`rest` it holds the next lesson only. */
  candidates: TaskDto[];
  /** Open tasks of today other than lessons, verifies and flashcards. */
  others: TaskDto[];
  summary: { lessons: number; minutes: number };
  nextDate: string | null;
}

/**
 * `idle`: no lesson left in the plan but other tasks are open today or overdue, so the plan is not
 * "finished". `done` only when nothing at all is open.
 */
export function buildTodayModel(
  todayTasks: TaskDto[],
  plans: PlanDto[],
  plan: PlanDto | null,
  today: string,
): TodayModel {
  const candidates = heroOrder(todayTasks, today);
  const others = otherActivities(todayTasks, today);
  const lessons = candidates.filter((t) => t.kind === 'lesson');
  const summary = {
    lessons: lessons.length,
    minutes: lessons.reduce((s, t) => s + t.minutes, 0),
  };
  const base = { others, summary };
  if (candidates.length > 0) return { state: 'lesson', candidates, nextDate: null, ...base };
  if (!plan) {
    const draft = pickDraftPlan(plans);
    return { state: draft ? 'draft' : 'no-plan', candidates: [], nextDate: null, ...base };
  }
  const next = plan.tasks
    .filter((t) => t.kind === 'lesson' && t.status === 'todo' && t.date !== today)
    .sort((a, b) => a.date.localeCompare(b.date) || a.taskKey.localeCompare(b.taskKey))[0];
  if (!next) {
    const anyOpenLesson = plan.tasks.some((t) => t.kind === 'lesson' && isOpen(t));
    const overdue = todayTasks.some((t) => t.date < today && isOpen(t));
    const open = anyOpenLesson || overdue || others.length > 0;
    return { state: open ? 'idle' : 'done', candidates: [], nextDate: null, ...base };
  }
  const load = plan.loadPerDay.find((d) => d.date === today);
  return {
    state: load && load.available === 0 ? 'rest' : 'next',
    candidates: [next],
    nextDate: next.date,
    ...base,
  };
}

// ---------------------------------------------------------------------------------------------
// Ricordo

export interface RecallVerify {
  task: TaskDto;
  offset: 3 | 7 | null;
  today: boolean;
}

export function recallVerifies(plan: PlanDto | null, today: string): RecallVerify[] {
  if (!plan) return [];
  const limit = new Date(`${today}T12:00:00`);
  limit.setDate(limit.getDate() + 7);
  const max = `${limit.getFullYear()}-${String(limit.getMonth() + 1).padStart(2, '0')}-${String(limit.getDate()).padStart(2, '0')}`;
  return plan.tasks
    .filter((t) => t.kind === 'verify' && (t.status === 'todo' || t.status === 'doing'))
    .filter((t) => t.date >= today && t.date <= max)
    .sort((a, b) => a.date.localeCompare(b.date) || a.taskKey.localeCompare(b.taskKey))
    .slice(0, 3)
    .map((task) => ({ task, offset: verifyOffset(task), today: task.date <= today }));
}

// ---------------------------------------------------------------------------------------------
// Verso lo scritto

type LessonGroup = { key: string; lessons: TaskDto[] };

function lessonGroups(plan: PlanDto | null): LessonGroup[] {
  if (!plan) return [];
  const map = new Map<string, TaskDto[]>();
  for (const t of plan.tasks) {
    if (t.kind !== 'lesson' || t.status === 'moved') continue;
    const key = t.topicKey ?? t.topicId ?? t.id;
    const list = map.get(key) ?? [];
    list.push(t);
    map.set(key, list);
  }
  const groups = [...map.entries()].map(([key, lessons]) => ({
    key,
    lessons: lessons.sort(
      (a, b) => a.date.localeCompare(b.date) || a.taskKey.localeCompare(b.taskKey),
    ),
  }));
  return groups.sort(
    (a, b) =>
      a.lessons[0]!.date.localeCompare(b.lessons[0]!.date) ||
      a.lessons[0]!.taskKey.localeCompare(b.lessons[0]!.taskKey),
  );
}

export interface ProgressCounts {
  studied: number;
  inProgress: number;
  todo: number;
  out: number;
  lessonsDone: number;
  lessonsTotal: number;
}

export function progressCounts(plan: PlanDto | null): ProgressCounts {
  const groups = lessonGroups(plan);
  const inPlan = new Set(groups.map((g) => g.key));
  const counts: ProgressCounts = {
    studied: 0,
    inProgress: 0,
    todo: 0,
    out: (plan?.feasibility.excludedTopicKeys ?? []).filter((k) => !inPlan.has(k)).length,
    lessonsDone: 0,
    lessonsTotal: 0,
  };
  for (const g of groups) {
    const done = g.lessons.filter((t) => t.status === 'done').length;
    const started = g.lessons.some((t) => t.status === 'done' || t.status === 'doing');
    counts.lessonsDone += done;
    counts.lessonsTotal += g.lessons.length;
    // Studied only when every lesson is `done`: a skipped one does not count as studied.
    if (done === g.lessons.length) counts.studied += 1;
    else if (started) counts.inProgress += 1;
    else counts.todo += 1;
  }
  return counts;
}

export function examHeading(kind: ExamDto['kind'] | undefined): string {
  switch (kind) {
    case 'scritto':
      return 'Verso lo scritto';
    case 'orale':
      return "Verso l'orale";
    case 'parziale':
      return 'Verso il parziale';
    case 'progetto':
      return 'Verso il progetto';
    default:
      return "Verso l'esame";
  }
}

export function lastSimulation(sims: SimulationSummaryDto[]): SimulationSummaryDto | null {
  return (
    sims
      .filter((s) => s.lastGradedAt !== null && s.lastScoreRatio !== null)
      .sort((a, b) => (b.lastGradedAt ?? '').localeCompare(a.lastGradedAt ?? ''))[0] ?? null
  );
}

export function nextSimulationTask(plan: PlanDto | null): TaskDto | null {
  if (!plan) return null;
  return (
    plan.tasks
      .filter((t) => t.kind === 'simulation' && (t.status === 'todo' || t.status === 'doing'))
      .sort((a, b) => a.date.localeCompare(b.date))[0] ?? null
  );
}

// ---------------------------------------------------------------------------------------------
// Argomenti

export type TopicPlanKind =
  'studied' | 'in_progress' | 'today' | 'late' | 'from' | 'out' | 'skipped' | 'unplanned';

export interface TopicRow {
  key: string;
  topicId: string | null;
  name: string;
  mastery: number | null;
  kind: TopicPlanKind;
  /** Second line under the name: "2 lezioni · fatte", "1 di 2 fatte"… */
  progress: string;
  /** Text next to the dot of the "Nel piano" column. */
  planLabel: string;
  method: LessonMethodChoice | 'mixed' | null;
  /** Next open lesson that can be started today or earlier. */
  startable: TaskDto | null;
}

function lessonsProgress(total: number, done: number): string {
  if (total === 0) return 'nessuna lezione';
  if (done === total) return total === 1 ? '1 lezione · fatta' : `${total} lezioni · fatte`;
  if (done === 0) return total === 1 ? '1 lezione' : `${total} lezioni`;
  return `${done} di ${total} fatte`;
}

export function topicRows(
  plan: PlanDto | null,
  topics: TopicDto[],
  documents: DocumentDto[],
  today: string,
): TopicRow[] {
  const byId = new Map(topics.map((t) => [t.id, t]));
  const groups = lessonGroups(plan);
  const inPlan = new Set(groups.map((g) => g.key));
  const excluded = (plan?.feasibility.excludedTopicKeys ?? []).filter((k) => !inPlan.has(k));
  const rows: TopicRow[] = [];

  for (const g of groups) {
    const topic = byId.get(g.key);
    const done = g.lessons.filter((t) => t.status === 'done').length;
    const open = g.lessons.filter((t) => t.status === 'todo' || t.status === 'doing');
    const started = g.lessons.some((t) => t.status === 'done' || t.status === 'doing');
    const verify = plan?.tasks
      .filter(
        (t) =>
          t.kind === 'verify' &&
          (t.topicKey ?? t.topicId) === g.key &&
          (t.status === 'todo' || t.status === 'doing'),
      )
      .sort((a, b) => a.date.localeCompare(b.date))[0];
    const todayLesson = open.find((t) => t.date === today);
    const first = open[0];
    let kind: TopicPlanKind;
    let planLabel: string;
    if (done === g.lessons.length) {
      kind = 'studied';
      planLabel = 'Studiato';
      if (verify) {
        planLabel +=
          verify.date <= today
            ? ' · verifica oggi'
            : ` · verifica il ${formatDayShort(verify.date)}`;
      }
    } else if (started) {
      kind = 'in_progress';
      planLabel = 'In corso';
      if (todayLesson?.payload.part) planLabel += ` · oggi parte ${todayLesson.payload.part.n}`;
    } else if (!first) {
      kind = 'skipped';
      planLabel = 'Saltato';
    } else if (todayLesson) {
      kind = 'today';
      planLabel = 'Oggi';
    } else if (first.date < today) {
      kind = 'late';
      planLabel = 'In ritardo';
    } else {
      kind = 'from';
      planLabel = `Dal ${formatDayShort(first.date)}`;
    }
    const methods = new Set(g.lessons.map((t) => taskMethod(t)));
    rows.push({
      key: g.key,
      topicId: topic?.id ?? null,
      name:
        topic?.name ?? documents.find((d) => d.id === g.key)?.originalName ?? g.lessons[0]!.title,
      mastery: topic?.mastery ?? null,
      kind,
      progress: lessonsProgress(g.lessons.length, done),
      planLabel,
      method:
        methods.size > 1 ? 'mixed' : (([...methods][0] as LessonMethodChoice | undefined) ?? null),
      startable: open.find((t) => t.date <= today) ?? null,
    });
  }

  for (const key of excluded) {
    const topic = byId.get(key);
    rows.push({
      key,
      topicId: topic?.id ?? null,
      name: topicName(key, topics, documents),
      mastery: topic?.mastery ?? null,
      kind: 'out',
      progress: 'nessuna lezione',
      planLabel: 'Fuori dal piano',
      method: null,
      startable: null,
    });
  }

  const used = new Set([...inPlan, ...excluded]);
  for (const topic of [...topics].sort((a, b) => a.orderIndex - b.orderIndex)) {
    if (used.has(topic.id)) continue;
    rows.push({
      key: topic.id,
      topicId: topic.id,
      name: topic.name,
      mastery: topic.mastery,
      kind: 'unplanned',
      progress: 'nessuna lezione',
      planLabel: 'Non nel piano',
      method: null,
      startable: null,
    });
  }
  return rows;
}

export function masteryTone(mastery: number): 'ok' | 'warn' | 'danger' {
  return mastery >= 0.7 ? 'ok' : mastery >= 0.4 ? 'warn' : 'danger';
}

// ---------------------------------------------------------------------------------------------
// Da sistemare

export type FixTone = 'warn' | 'danger' | 'info';

export interface FixRow {
  id: string;
  tone: FixTone;
  title: string;
  detail: string;
  action: { label: string; href: string };
}

function nameList(names: string[]): string {
  const shown = names.slice(0, 3).join(', ');
  return names.length > 3 ? `${shown} e altri ${names.length - 3}` : shown;
}

function gapNames(gaps: GapDto[], kind: GapDto['kind']): string[] {
  return gaps.filter((g) => g.kind === kind).map((g) => g.topicName);
}

export function fixRows(input: {
  slug: string;
  overview: SubjectOverviewDto;
  plan: PlanDto | null;
  drift: DriftReportDto | null | undefined;
  topics: TopicDto[];
  documents: DocumentDto[];
}): FixRow[] {
  const { slug, overview, plan, drift, topics, documents } = input;
  const base = `/materie/${slug}`;
  const rows: FixRow[] = [];

  if (drift?.shouldRecalculate) {
    rows.push({
      id: 'drift',
      tone: 'warn',
      title: 'Il piano è indietro',
      detail: drift.reason ?? '',
      action: { label: 'Rigenera il piano', href: `${base}/piano` },
    });
  }

  const excludedKeys = plan?.feasibility.excludedTopicKeys ?? [];
  if (plan && excludedKeys.length > 0) {
    const names = excludedKeys.map((k) => topicName(k, topics, documents));
    const sprint = plan.feasibility.sprintLessonKeys.length;
    rows.push({
      id: 'excluded',
      tone: 'danger',
      title:
        names.length === 1
          ? `${names[0]} resta fuori dal piano`
          : `${nameList(names)} restano fuori dal piano`,
      detail:
        `Il tempo non basta: mancano circa ${formatExamDuration(plan.feasibility.shortfallMinutes)}.` +
        (sprint > 0
          ? ` ${plural(sprint, 'lezione è già passata', 'lezioni sono già passate')} a sprint.`
          : ''),
      action: { label: 'Apri il piano', href: `${base}/piano` },
    });
  }

  const noDocs = gapNames(overview.gaps, 'topic_without_documents');
  if (noDocs.length > 0) {
    rows.push({
      id: 'no-docs',
      tone: 'warn',
      title: plural(noDocs.length, 'argomento senza documenti', 'argomenti senza documenti'),
      detail: `${nameList(noDocs)}. Non entrano in nessuna lezione finché non carichi del materiale.`,
      action: { label: 'Vai agli appunti', href: `${base}?tab=appunti` },
    });
  }

  if (overview.untaggedDocumentCount > 0) {
    rows.push({
      id: 'untagged',
      tone: 'warn',
      title: plural(
        overview.untaggedDocumentCount,
        'documento senza argomento',
        'documenti senza argomento',
      ),
      detail: 'Non entrano in nessuna lezione finché non li assegni.',
      // The old "tag" action already points at the tab of the first untagged document's type.
      action: {
        label: 'Assegna',
        href:
          overview.suggestedActions.find((a) => a.kind === 'tag')?.href ?? `${base}?tab=appunti`,
      },
    });
  }

  for (const action of overview.suggestedActions.filter((a) => a.kind === 'verify')) {
    rows.push({
      id: `verify-${action.href}`,
      tone: 'warn',
      title: action.description,
      detail: '',
      action: { label: 'Controlla', href: action.href },
    });
  }

  const noCards = gapNames(overview.gaps, 'topic_without_flashcards');
  if (noCards.length > 0) {
    rows.push({
      id: 'no-cards',
      tone: 'info',
      title: plural(noCards.length, 'argomento senza flashcard', 'argomenti senza flashcard'),
      detail: nameList(noCards),
      action: { label: 'Apri le lacune', href: `${base}?tab=lacune` },
    });
  }

  const low = gapNames(overview.gaps, 'low_mastery');
  if (low.length > 0) {
    rows.push({
      id: 'low',
      tone: 'warn',
      title: plural(low.length, 'argomento da rinforzare', 'argomenti da rinforzare'),
      detail: nameList(low),
      action: { label: 'Apri le lacune', href: `${base}?tab=lacune` },
    });
  }
  return rows;
}

// ---------------------------------------------------------------------------------------------
// Mobile additions (Panoramica below md)

/** Colour family of the dot in front of a topic row (the label next to it carries the meaning). */
export function topicDotTone(kind: TopicPlanKind): 'ok' | 'accent' | 'neutral' | 'danger' {
  switch (kind) {
    case 'studied':
      return 'ok';
    case 'in_progress':
    case 'today':
    case 'late':
      return 'accent';
    case 'out':
    case 'skipped':
      return 'danger';
    default:
      return 'neutral';
  }
}

/** "4 studiati · 1 in corso · 3 da fare · 1 fuori": the four counts in words (zeros are left out). */
export function statusCountsLabel(counts: ProgressCounts): string {
  const parts: string[] = [];
  if (counts.studied > 0) parts.push(`${counts.studied} studiati`);
  if (counts.inProgress > 0) parts.push(`${counts.inProgress} in corso`);
  if (counts.todo > 0) parts.push(`${counts.todo} da fare`);
  if (counts.out > 0) parts.push(`${counts.out} fuori`);
  return parts.join(' · ');
}
