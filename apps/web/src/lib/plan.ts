import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { and, eq, inArray } from 'drizzle-orm';
import {
  buildPlanningUnits,
  exams,
  heuristicPlannerTopics,
  loadBusyMinutesByDate,
  loadEligibleDocs,
  loadTimeFactor,
  recomputeTopicMastery,
  studyPlans,
  subjects,
  tasks,
  type StudyPlan,
  type Task,
} from '@studyhub/db';
import {
  applyBulkAction,
  buildCapacity,
  computeLoadPerDay,
  detectDrift,
  diffPlans,
  addDays,
  applyTimeFactor,
  describeTimeFactor,
  eachDay,
  moveTask as coreMoveTask,
  resolveSubjectSubpath,
  schedulePlan,
  weekday,
  type PlannerInput,
} from '@studyhub/core';
import type {
  BulkPlanActionRequest,
  CreateManualTaskRequest,
  DriftReportDto,
  GeneratePlanRequest,
  PlanDiffDto,
  PlanDto,
  PlanPreviewDto,
  TaskDto,
  UpdateTaskRequest,
} from '@studyhub/contracts';
import type { Queue } from 'bullmq';
import { SubjectNotFoundError } from './errors';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = any;

export class PlanNotFoundError extends Error {
  constructor(id: string) {
    super(`Piano non trovato: ${id}`);
    this.name = 'PlanNotFoundError';
  }
}

export class NoDraftPlanError extends Error {
  constructor() {
    super('Nessuna bozza di piano: genera prima un piano dal wizard.');
    this.name = 'NoDraftPlanError';
  }
}

export class TaskNotFoundError extends Error {
  constructor(id: string) {
    super(`Task non trovata: ${id}`);
    this.name = 'TaskNotFoundError';
  }
}

export class MoveRefusedError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = 'MoveRefusedError';
  }
}

export class ExamNotFoundError extends Error {
  constructor(id: string) {
    super(`Esame non trovato: ${id}`);
    this.name = 'ExamNotFoundError';
  }
}

async function requireSubject(db: AnyDb, subjectSlug: string) {
  const [subject] = await db.select().from(subjects).where(eq(subjects.slug, subjectSlug));
  if (!subject) throw new SubjectNotFoundError(subjectSlug);
  return subject;
}

function toTaskDto(row: Task): TaskDto {
  return {
    id: row.id,
    planId: row.planId,
    taskKey: row.taskKey,
    date: row.date,
    kind: row.kind,
    topicKey: row.topicKey,
    topicId: row.topicId,
    minutes: row.minutes,
    title: row.title,
    description: row.description,
    payload: row.payload,
    pinned: row.pinned,
    origin: row.origin,
    status: row.status,
  };
}

/** `loadPerDay` is derived, not stored — capacity depends only on the plan's own window/prefs (see `moveTaskInPlan` for the cross-subject-busy caveat). */
function toPlanDto(plan: StudyPlan, taskRows: Task[]): PlanDto {
  const capacity = buildCapacity({
    startDate: plan.startDate,
    targetDate: plan.targetDate,
    availability: plan.availability,
    topics: [],
    prefs: plan.prefs,
  } as PlannerInput);
  return {
    id: plan.id,
    subjectId: plan.subjectId,
    examId: plan.examId,
    status: plan.status,
    startDate: plan.startDate,
    targetDate: plan.targetDate,
    availability: plan.availability,
    prefs: plan.prefs,
    feasibility: plan.feasibility,
    warnings: plan.warnings,
    loadPerDay: computeLoadPerDay(capacity, taskRows),
    tasks: taskRows.map(toTaskDto),
    createdAt: plan.createdAt.toISOString(),
    committedAt: plan.committedAt ? plan.committedAt.toISOString() : null,
  };
}

async function loadPlanByStatus(
  db: AnyDb,
  subjectId: string,
  status: StudyPlan['status'],
): Promise<PlanDto | null> {
  const [plan] = await db
    .select()
    .from(studyPlans)
    .where(and(eq(studyPlans.subjectId, subjectId), eq(studyPlans.status, status)));
  if (!plan) return null;
  const taskRows: Task[] = await db.select().from(tasks).where(eq(tasks.planId, plan.id));
  return toPlanDto(plan, taskRows);
}

/** Draft if one exists (wizard/review flow), otherwise the active plan — what the review/calendar screens ask for by default. */
export async function getCurrentPlan(db: AnyDb, subjectSlug: string): Promise<PlanDto | null> {
  const subject = await requireSubject(db, subjectSlug);
  return (
    (await loadPlanByStatus(db, subject.id, 'draft')) ??
    (await loadPlanByStatus(db, subject.id, 'active'))
  );
}

export async function getActivePlan(db: AnyDb, subjectSlug: string): Promise<PlanDto | null> {
  const subject = await requireSubject(db, subjectSlug);
  return loadPlanByStatus(db, subject.id, 'active');
}

/** Enqueues `generate_plan` (Fase A+B); returns the BullMQ job id the caller polls via `jobs`. */
export async function enqueueGeneratePlan(
  db: AnyDb,
  queue: Pick<Queue, 'add'>,
  subjectSlug: string,
  input: GeneratePlanRequest,
): Promise<{ jobId: string }> {
  const subject = await requireSubject(db, subjectSlug);
  if (input.examId) {
    const [exam] = await db
      .select({ id: exams.id })
      .from(exams)
      .where(and(eq(exams.id, input.examId), eq(exams.subjectId, subject.id)));
    if (!exam) throw new ExamNotFoundError(input.examId);
  }
  const jobId = randomUUID();
  await queue.add('generate_plan', { ...input, subjectId: subject.id }, { jobId });
  return { jobId };
}

/**
 * The wizard's free pre-flight (docs/fasi/F6): Fase B on a page-based estimate, no model call, no
 * writes. Answers "is there enough time?" *before* the user spends the Fase A call, with the same
 * `feasibility` (and the 3 strategies) the generated draft would carry. FSRS reviews are left out
 * (the real job adds them), so the required minutes here are a lower bound.
 */
export async function getPlanPreview(
  db: AnyDb,
  subjectSlug: string,
  input: GeneratePlanRequest,
): Promise<PlanPreviewDto> {
  const subject = await requireSubject(db, subjectSlug);
  const units = await buildPlanningUnits(db, subject.id, await loadEligibleDocs(db, subject.id));
  const busyMinutesByDate = await loadBusyMinutesByDate(db, subject.id);
  const timeFactor = await loadTimeFactor(db);

  const plannerInput: PlannerInput = {
    startDate: input.startDate,
    targetDate: input.targetDate,
    availability: input.availability,
    topics: applyTimeFactor(heuristicPlannerTopics(units), timeFactor.factor),
    prefs: input.prefs,
    busyMinutesByDate,
    pinned: [],
  };
  const result = schedulePlan(plannerInput);

  // Weeks start on Monday; a partial first/last week is reported as it is.
  const weeks = new Map<string, { available: number; planned: number }>();
  for (const d of result.loadPerDay) {
    const start = addDays(d.date, -((weekday(d.date) + 6) % 7));
    const w = weeks.get(start) ?? { available: 0, planned: 0 };
    w.available += d.available;
    w.planned += d.planned;
    weeks.set(start, w);
  }
  const windowDays = new Set(eachDay(input.startDate, input.targetDate));
  const busyMinutes = Object.entries(busyMinutesByDate)
    .filter(([date]) => windowDays.has(date))
    .reduce((sum, [, minutes]) => sum + minutes, 0);

  return {
    estimate: 'heuristic',
    topicCount: units.length,
    taskCount: result.tasks.length,
    feasibility: result.feasibility,
    warnings: result.warnings,
    loadPerWeek: [...weeks.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([weekStart, w]) => ({ weekStart, ...w })),
    busyMinutes,
    timeFactor: {
      factor: timeFactor.factor,
      sampleCount: timeFactor.sampleCount,
      note: describeTimeFactor(timeFactor),
    },
  };
}

/**
 * Single transaction, idempotent on `planId` (docs/04-planner.md §9.3): the
 * previous active plan (if any) becomes `superseded`, this plan's tasks flip
 * `proposed -> todo`, and a snapshot is written to `plans/<planId>.json` —
 * disk stays the source of truth (docs/01-architettura.md §1 "Ordine di verità").
 * Re-posting a commit for an already-active plan is a no-op, not an error.
 * **Not implemented in this slice**: ICS feed invalidation (docs/fasi/F6
 * "Stato" — no ICS export exists yet) and `starts_at`/`ends_at` time-slot
 * assignment (tasks carry a date, not a time of day, in this slice).
 */
export async function commitPlan(
  db: AnyDb,
  dataRoot: string,
  subjectSlug: string,
  planId: string,
): Promise<PlanDto> {
  const subject = await requireSubject(db, subjectSlug);
  const [plan] = await db
    .select()
    .from(studyPlans)
    .where(and(eq(studyPlans.id, planId), eq(studyPlans.subjectId, subject.id)));
  if (!plan) throw new PlanNotFoundError(planId);

  if (plan.status === 'active') {
    const taskRows: Task[] = await db.select().from(tasks).where(eq(tasks.planId, plan.id));
    return toPlanDto(plan, taskRows); // idempotent: already committed
  }
  if (plan.status === 'superseded') {
    throw new PlanNotFoundError(planId); // a superseded plan can never be (re)committed
  }

  await db.transaction(async (tx: AnyDb) => {
    await tx
      .update(studyPlans)
      .set({ status: 'superseded' })
      .where(and(eq(studyPlans.subjectId, subject.id), eq(studyPlans.status, 'active')));
    await tx
      .update(studyPlans)
      .set({ status: 'active', committedAt: new Date() })
      .where(eq(studyPlans.id, planId));
    await tx
      .update(tasks)
      .set({ status: 'todo', updatedAt: new Date() })
      .where(and(eq(tasks.planId, planId), eq(tasks.status, 'proposed')));
  });

  const [committed] = await db.select().from(studyPlans).where(eq(studyPlans.id, planId));
  const taskRows: Task[] = await db.select().from(tasks).where(eq(tasks.planId, planId));

  const dir = resolveSubjectSubpath(subject.slug, ['plans'], dataRoot);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    join(dir, `${planId}.json`),
    JSON.stringify(
      { plan: committed, tasks: taskRows, committedAt: new Date().toISOString() },
      null,
      2,
    ),
    'utf-8',
  );

  return toPlanDto(committed, taskRows);
}

async function requireTask(db: AnyDb, subjectId: string, taskId: string): Promise<Task> {
  const [row] = await db
    .select()
    .from(tasks)
    .where(and(eq(tasks.id, taskId), eq(tasks.subjectId, subjectId)));
  if (!row) throw new TaskNotFoundError(taskId);
  return row;
}

/** Edits a draft task in place (docs/04-planner.md §9.2: title/description/minutes/`pin`). Not for status transitions — see `setTaskStatus`. */
export async function updateDraftTask(
  db: AnyDb,
  subjectSlug: string,
  taskId: string,
  request: UpdateTaskRequest,
): Promise<TaskDto> {
  const subject = await requireSubject(db, subjectSlug);
  const row = await requireTask(db, subject.id, taskId);
  if (row.status !== 'proposed')
    throw new Error('Solo le task in bozza sono modificabili prima del commit.');

  const patch: Partial<Task> = { updatedAt: new Date() };
  if (request.title !== undefined) patch.title = request.title;
  if (request.description !== undefined) patch.description = request.description;
  if (request.minutes !== undefined) patch.minutes = request.minutes;
  if (request.pinned !== undefined) patch.pinned = request.pinned;

  const [updated] = await db.update(tasks).set(patch).where(eq(tasks.id, taskId)).returning();
  return toTaskDto(updated);
}

export async function deleteDraftTask(
  db: AnyDb,
  subjectSlug: string,
  taskId: string,
): Promise<void> {
  const subject = await requireSubject(db, subjectSlug);
  const row = await requireTask(db, subject.id, taskId);
  if (row.status !== 'proposed') throw new Error('Solo le task in bozza possono essere eliminate.');
  await db.delete(tasks).where(eq(tasks.id, taskId));
}

/** "Aggiungi una task manuale — non tutto nasce dall'AI" (docs/04-planner.md §9.2). Requires an existing draft. */
export async function createManualTask(
  db: AnyDb,
  subjectSlug: string,
  request: CreateManualTaskRequest,
): Promise<TaskDto> {
  const subject = await requireSubject(db, subjectSlug);
  const [plan] = await db
    .select()
    .from(studyPlans)
    .where(and(eq(studyPlans.subjectId, subject.id), eq(studyPlans.status, 'draft')));
  if (!plan) throw new NoDraftPlanError();

  const id = randomUUID();
  await db.insert(tasks).values({
    id,
    subjectId: subject.id,
    planId: plan.id,
    taskKey: `manual:${id}`,
    date: request.date,
    kind: request.kind,
    topicId: request.topicId ?? null,
    minutes: request.minutes,
    title: request.title,
    description: request.description,
    payload: { action: 'manual', topicId: request.topicId ?? null },
    origin: 'manual',
    status: 'proposed',
  });
  const [row] = await db.select().from(tasks).where(eq(tasks.id, id));
  return toTaskDto(row);
}

/**
 * Moves one task (draft or already-committed) to another day, cascading
 * displaced same-day tasks — `packages/core/src/planner/adapt.ts::moveTask`,
 * pure and instant, no AI call (docs/fasi/F6 "Decisioni"). **Caveat of this
 * slice**: capacity is recomputed from the plan's own availability only —
 * it does not re-subtract other subjects' busy minutes (only accounted for
 * once, at generation time) or enforce topic prerequisites (not persisted
 * after Fase A) — see docs/fasi/F6-planner-calendario.md "Stato".
 */
/** Loads the target task's plan + sibling tasks + capacity — the fixed setup `moveTaskInPlan` and `reabsorbTaskInPlan` both need before calling into `coreMoveTask`. */
async function loadMoveContext(db: AnyDb, subject: { id: string }, taskId: string) {
  const target = await requireTask(db, subject.id, taskId);
  const [plan] = await db.select().from(studyPlans).where(eq(studyPlans.id, target.planId));
  if (!plan || plan.status === 'superseded') throw new PlanNotFoundError(target.planId);

  const planTasks: Task[] = await db.select().from(tasks).where(eq(tasks.planId, plan.id));
  const capacity = buildCapacity({
    startDate: plan.startDate,
    targetDate: plan.targetDate,
    availability: plan.availability,
    topics: [],
    prefs: plan.prefs,
  } as PlannerInput);
  const taskLikes = planTasks.map((t) => ({
    key: t.taskKey,
    date: t.date,
    kind: t.kind,
    topicKey: t.topicKey,
    minutes: t.minutes,
    pinned: t.pinned,
    title: t.title,
  }));

  return { target, plan, planTasks, capacity, taskLikes };
}

/** Persists a successful `coreMoveTask` result (the moved task plus any displaced siblings) and returns the refreshed plan. */
async function applyMoveResult(
  db: AnyDb,
  plan: StudyPlan,
  planTasks: Task[],
  result: Extract<ReturnType<typeof coreMoveTask>, { ok: true }>,
): Promise<PlanDto> {
  const byKey = new Map(planTasks.map((t) => [t.taskKey, t]));
  for (const t of result.tasks) {
    const original = byKey.get(t.key);
    if (!original) continue;
    if (original.date === t.date && original.pinned === t.pinned) continue;
    await db
      .update(tasks)
      .set({ date: t.date, pinned: t.pinned, updatedAt: new Date() })
      .where(eq(tasks.id, original.id));
  }

  const taskRows: Task[] = await db.select().from(tasks).where(eq(tasks.planId, plan.id));
  return toPlanDto(plan, taskRows);
}

export async function moveTaskInPlan(
  db: AnyDb,
  subjectSlug: string,
  taskId: string,
  newDate: string,
): Promise<PlanDto> {
  const subject = await requireSubject(db, subjectSlug);
  const { target, plan, planTasks, capacity, taskLikes } = await loadMoveContext(
    db,
    subject,
    taskId,
  );
  const result = coreMoveTask(taskLikes, target.taskKey, newDate, {
    capacity,
    targetDate: plan.targetDate,
    prerequisites: new Map(),
  });
  if (!result.ok) throw new MoveRefusedError(result.reason);
  return applyMoveResult(db, plan, planTasks, result);
}

/**
 * Bulk action on the current draft ("sposta di N giorni", "riduci il carico", "escludi argomento";
 * docs/fasi/F6). Same pure engine as a single move (`applyBulkAction`): pinned tasks stay put and a
 * change that would break a hard constraint is refused whole (`MoveRefusedError`), nothing written.
 * Capacity is net of other subjects' tasks and imported events, like at generation time.
 */
export async function applyBulkToDraft(
  db: AnyDb,
  subjectSlug: string,
  action: BulkPlanActionRequest,
): Promise<PlanDto> {
  const subject = await requireSubject(db, subjectSlug);
  const [plan] = await db
    .select()
    .from(studyPlans)
    .where(and(eq(studyPlans.subjectId, subject.id), eq(studyPlans.status, 'draft')));
  if (!plan) throw new NoDraftPlanError();

  const planTasks: Task[] = await db.select().from(tasks).where(eq(tasks.planId, plan.id));
  const capacity = buildCapacity({
    startDate: plan.startDate,
    targetDate: plan.targetDate,
    availability: plan.availability,
    topics: [],
    prefs: plan.prefs,
    busyMinutesByDate: await loadBusyMinutesByDate(db, subject.id),
  } as PlannerInput);
  const result = applyBulkAction(
    planTasks.map((t) => ({
      key: t.taskKey,
      date: t.date,
      kind: t.kind,
      topicKey: t.topicKey,
      minutes: t.minutes,
      pinned: t.pinned,
      title: t.title,
    })),
    action,
    { capacity, targetDate: plan.targetDate, prerequisites: new Map() },
  );
  if (!result.ok) throw new MoveRefusedError(result.reason);

  const byKey = new Map(planTasks.map((t) => [t.taskKey, t]));
  const now = new Date();
  for (const t of result.tasks) {
    const original = byKey.get(t.key);
    if (!original || (original.date === t.date && original.minutes === t.minutes)) continue;
    await db
      .update(tasks)
      .set({ date: t.date, minutes: t.minutes, updatedAt: now })
      .where(eq(tasks.id, original.id));
  }
  const removedIds = result.removedKeys.map((k) => byKey.get(k)!.id);
  if (removedIds.length > 0) await db.delete(tasks).where(inArray(tasks.id, removedIds));

  const taskRows: Task[] = await db.select().from(tasks).where(eq(tasks.planId, plan.id));
  return toPlanDto(plan, taskRows);
}

/**
 * "Debito" — _riassorbi nel piano_ (docs/fasi/F6-planner-calendario.md "Decisioni": an overdue task
 * doesn't just pile up — rimanda/riassorbi/archivia). Unlike `moveTaskInPlan` (a date the user
 * picked), this tries each day from `today` onward and takes the first one `coreMoveTask` accepts
 * — the algorithm picks the slot, not the user.
 */
export async function reabsorbTaskInPlan(
  db: AnyDb,
  subjectSlug: string,
  taskId: string,
  today: string,
): Promise<PlanDto> {
  const subject = await requireSubject(db, subjectSlug);
  const { target, plan, planTasks, capacity, taskLikes } = await loadMoveContext(
    db,
    subject,
    taskId,
  );
  const candidateDays = [...capacity.keys()].filter((d) => d >= today).sort();

  for (const day of candidateDays) {
    const result = coreMoveTask(taskLikes, target.taskKey, day, {
      capacity,
      targetDate: plan.targetDate,
      prerequisites: new Map(),
    });
    if (result.ok) return applyMoveResult(db, plan, planTasks, result);
  }
  throw new MoveRefusedError(
    'Nessun giorno del piano ha spazio libero per riassorbire questa task.',
  );
}

/** Daily Task widget (docs/fasi/F7-dashboard-polish.md "Oggi"): today's actionable tasks from the *active* plan. Overdue `todo`/`doing` tasks from the last 7 days are included as debt — see docs/fasi/F6 "Stato" for the full "Debito" UI this doesn't build yet. */
export async function getDailyTasks(
  db: AnyDb,
  subjectSlug: string,
  today: string,
): Promise<TaskDto[]> {
  const subject = await requireSubject(db, subjectSlug);
  const [plan] = await db
    .select()
    .from(studyPlans)
    .where(and(eq(studyPlans.subjectId, subject.id), eq(studyPlans.status, 'active')));
  if (!plan) return [];
  const rows: Task[] = await db
    .select()
    .from(tasks)
    .where(and(eq(tasks.planId, plan.id), inArray(tasks.status, ['todo', 'doing'])));
  return rows.filter((r) => r.date <= today).map(toTaskDto);
}

export async function setTaskStatus(
  db: AnyDb,
  subjectSlug: string,
  taskId: string,
  status: 'todo' | 'doing' | 'done' | 'skipped',
): Promise<TaskDto> {
  const subject = await requireSubject(db, subjectSlug);
  const row = await requireTask(db, subject.id, taskId);
  if (row.status === 'proposed')
    throw new Error('Una task in bozza non è ancora nel calendario: commit il piano prima.');
  const [updated] = await db
    .update(tasks)
    .set({ status, updatedAt: new Date() })
    .where(eq(tasks.id, taskId))
    .returning();

  // Coverage (docs/02-filesystem-e-dati.md §5) is driven by material actually
  // read, not scheduled — a completed reading session is the only signal for
  // it, so mastery only needs a nudge here, not on every status change.
  if (status === 'done' && updated.kind === 'read' && updated.topicId) {
    await recomputeTopicMastery(db, updated.topicId);
  }

  return toTaskDto(updated);
}

/**
 * "Si approva il diff, non il piano" (docs/04-planner.md §9.5): compares the
 * active plan's tasks against the current draft (a regeneration). `null`
 * when there is no draft to compare — nothing to approve yet.
 */
export async function getPlanDiff(
  db: AnyDb,
  subjectSlug: string,
  reason = 'Piano rigenerato',
): Promise<PlanDiffDto | null> {
  const subject = await requireSubject(db, subjectSlug);
  const active = await loadPlanByStatus(db, subject.id, 'active');
  const draft = await loadPlanByStatus(db, subject.id, 'draft');
  if (!draft) return null;
  const topicNames = new Map<string, string>();
  const toTaskLike = (t: TaskDto) => ({
    key: t.taskKey,
    date: t.date,
    kind: t.kind,
    topicKey: t.topicKey,
    minutes: t.minutes,
    pinned: t.pinned,
    title: t.title,
  });
  return diffPlans(
    (active?.tasks ?? []).map(toTaskLike),
    draft.tasks.map(toTaskLike),
    reason,
    topicNames,
  );
}

/**
 * "Al rientro il sistema propone un ricalcolo" (docs/04-planner.md,
 * docs/fasi/F6-planner-calendario.md "Stato": `detectDrift` existed but
 * nothing called it). `null` when there's no active plan to drift from —
 * not "no drift", there's simply nothing to check yet.
 */
export async function getPlanDrift(
  db: AnyDb,
  subjectSlug: string,
  today: string,
): Promise<DriftReportDto | null> {
  const subject = await requireSubject(db, subjectSlug);
  const active = await loadPlanByStatus(db, subject.id, 'active');
  if (!active) return null;
  return detectDrift(
    active.tasks.map((t) => ({ key: t.taskKey, date: t.date, status: t.status })),
    today,
  );
}

/** Discards the current draft without committing (docs/04-planner.md §9.6: "rifiuto il diff, il piano attivo resta identico"). */
export async function discardDraft(db: AnyDb, subjectSlug: string): Promise<void> {
  const subject = await requireSubject(db, subjectSlug);
  await db
    .delete(studyPlans)
    .where(and(eq(studyPlans.subjectId, subject.id), eq(studyPlans.status, 'draft')));
}
