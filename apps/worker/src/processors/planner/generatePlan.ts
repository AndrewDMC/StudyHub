import { randomUUID } from 'node:crypto';
import { and, eq, inArray, lt } from 'drizzle-orm';
import {
  artifacts,
  chunks,
  buildPlanningUnits,
  exams,
  flashcards,
  heuristicMinutes,
  filterUnitsByScope,
  loadBusyMinutesByDate,
  loadEligibleDocs,
  loadTimeFactor,
  studyPlans,
  subjects,
  tasks,
  type Flashcard,
  type NewTask,
} from '@studyhub/db';
import {
  applyTimeFactor,
  diffDays,
  forecastDueCounts,
  schedulePlan,
  type PlannerInput,
  type PlannerTopic,
} from '@studyhub/core';
import {
  resolveProvider,
  estimateCostEur,
  truncate,
  ESTIMATE_TOPICS_PROMPT_VERSION,
  type AiProvider,
  type TopicEstimate,
  resolveModel,
} from '@studyhub/ai';
import type { GeneratePlanJobInput } from '@studyhub/contracts';
import { checkBudget } from '../generation/shared.js';

const MODEL_ROUTING_PLAN = 'claude-opus-5-5'; // docs/04-planner.md §3: "Fase A — Analisi AI (1 chiamata, opus)"
const EXCERPT_MAX_CHARS = 2000;
const EXCERPT_CHUNK_SAMPLE = 3; // first N chunks per document, not the whole text — keeps the call cheap

export interface GeneratePlanResult {
  planId: string;
  taskCount: number;
  feasible: boolean;
  warnings: string[];
  costEur: number;
  usage: { inputTokens: number; outputTokens: number };
}

/**
 * `generate_plan` (docs/04-planner.md §1-5): Fase A (AI estimate) + Fase B
 * (pure scheduling) in one job, producing a fresh `draft` study_plans row
 * with `proposed` tasks — invisible to the rest of the app until committed
 * (`apps/web/src/lib/plan.ts::commitPlan`, docs/04 §9.1).
 */
export async function processGeneratePlan(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  input: GeneratePlanJobInput,
  provider: AiProvider = resolveProvider(),
): Promise<GeneratePlanResult> {
  const [subject] = await db.select().from(subjects).where(eq(subjects.id, input.subjectId));
  if (!subject) throw new Error(`subject not found: ${input.subjectId}`);

  // The student's description of the exam/partial: what they typed in the wizard, else what the exam already says.
  let notes = input.notes?.trim() || undefined;
  if (input.examId) {
    const [exam] = await db
      .select({ id: exams.id, description: exams.description })
      .from(exams)
      .where(and(eq(exams.id, input.examId), eq(exams.subjectId, input.subjectId)));
    if (!exam) throw new Error(`exam not found for this subject: ${input.examId}`);
    notes ??= exam.description?.trim() || undefined;
  }

  const model = input.model ?? resolveModel(MODEL_ROUTING_PLAN);

  const eligibleDocs = await loadEligibleDocs(db, input.subjectId);

  let plannerTopics: PlannerTopic[] = [];
  let usage = { inputTokens: 0, outputTokens: 0 };
  let resultModel = 'none';
  let promptVersion = ESTIMATE_TOPICS_PROMPT_VERSION;

  const units = filterUnitsByScope(
    await buildPlanningUnits(db, input.subjectId, eligibleDocs),
    input.topicIds,
  );

  if (units.length > 0) {
    const unitDocIds = new Set(units.flatMap((u) => u.docs.map((d) => d.id)));
    const scopedDocs = eligibleDocs.filter((d) => unitDocIds.has(d.id));
    const docIds = scopedDocs.map((d) => d.id);
    const chunkRows: { documentId: string; ord: number; text: string }[] = await db
      .select({ documentId: chunks.documentId, ord: chunks.ord, text: chunks.text })
      .from(chunks)
      .where(and(inArray(chunks.documentId, docIds), lt(chunks.ord, EXCERPT_CHUNK_SAMPLE)));

    const excerptByDoc = new Map<string, string>();
    for (const doc of scopedDocs) {
      const parts = chunkRows
        .filter((c) => c.documentId === doc.id)
        .sort((a, b) => a.ord - b.ord)
        .map((c) => c.text);
      excerptByDoc.set(doc.id, parts.join(' '));
    }
    const excerptByUnit = new Map<string, string>();
    for (const unit of units) {
      excerptByUnit.set(
        unit.key,
        truncate(unit.docs.map((d) => excerptByDoc.get(d.id) ?? '').join(' '), EXCERPT_MAX_CHARS),
      );
    }

    const result = await provider.estimateTopics(
      {
        subjectName: subject.name,
        ...(notes ? { notes } : {}),
        units: units.map((u) => ({
          key: u.key,
          name: u.name,
          excerpt: excerptByUnit.get(u.key) ?? '',
          pages: u.pages,
        })),
      },
      model,
    );
    usage = result.usage;
    resultModel = result.model;
    promptVersion = result.promptVersion;

    const estByKey = new Map<string, TopicEstimate>(result.data.topics.map((t) => [t.key, t]));
    plannerTopics = units.map((u) => {
      const est = estByKey.get(u.key);
      return {
        key: u.key,
        topicId: u.topicId,
        name: u.name,
        estimatedMinutes: est?.estimatedMinutes ?? heuristicMinutes(u.pages),
        difficulty: est?.difficulty ?? 3,
        examWeight: est?.examWeight ?? 1 / units.length,
        prerequisites: est?.prerequisites.filter((p) => estByKey.has(p)) ?? [],
        mastery: u.mastery,
        material: u.docs.map((d) => ({ docId: d.id, pageFrom: 1, pageTo: d.pages })),
      };
    });
  }

  // The student's own estimate-vs-real bias (docs/06-miglioramenti.md #7): 1 until enough sessions say otherwise.
  const timeFactor = await loadTimeFactor(db);
  plannerTopics = applyTimeFactor(plannerTopics, timeFactor.factor);

  const costEur = estimateCostEur(resultModel, usage.inputTokens, usage.outputTokens);
  await checkBudget(db, costEur, input.force);

  // FSRS reviews due in the plan window — "precedenza assoluta" (docs/04-planner.md §4).
  const dayCount = Math.max(0, diffDays(input.startDate, input.targetDate));
  const allScheduleRows: Pick<Flashcard, 'dueAt' | 'state' | 'topicId'>[] = await db
    .select({ dueAt: flashcards.dueAt, state: flashcards.state, topicId: flashcards.topicId })
    .from(flashcards)
    .innerJoin(artifacts, eq(flashcards.deckId, artifacts.id))
    .where(and(eq(artifacts.subjectId, input.subjectId), eq(flashcards.suspended, false)));
  // A partial only reviews the cards of its own topics.
  const scope = input.topicIds ? new Set(input.topicIds) : null;
  const scheduleRows = scope
    ? allScheduleRows.filter((c) => c.topicId !== null && scope.has(c.topicId))
    : allScheduleRows;
  const forecast = forecastDueCounts(
    scheduleRows,
    dayCount,
    new Date(`${input.startDate}T00:00:00.000Z`),
  );
  const dueCardsByDate = Object.fromEntries(forecast.map((f) => [f.date, f.count]));

  // Other subjects' active tasks and imported calendar events compete for the same daily
  // minutes (docs/04-planner.md §7, §9.4).
  const busyMinutesByDate = await loadBusyMinutesByDate(db, input.subjectId, input.examId);

  const plannerInput: PlannerInput = {
    startDate: input.startDate,
    targetDate: input.targetDate,
    availability: input.availability,
    topics: plannerTopics,
    prefs: input.prefs,
    dueCardsByDate,
    busyMinutesByDate,
    pinned: [],
  };
  const result = schedulePlan(plannerInput);

  // A regenerated draft replaces the previous one outright: it never existed
  // outside the review screen (docs/04-planner.md §9.1), so there is nothing
  // to preserve — unlike commit, which supersedes the *active* plan instead.
  await db
    .delete(studyPlans)
    .where(and(eq(studyPlans.subjectId, input.subjectId), eq(studyPlans.status, 'draft')));

  const planId = randomUUID();
  await db.insert(studyPlans).values({
    id: planId,
    subjectId: input.subjectId,
    examId: input.examId ?? null,
    startDate: input.startDate,
    targetDate: input.targetDate,
    availability: input.availability,
    prefs: input.prefs,
    feasibility: result.feasibility,
    warnings: result.warnings,
    model: resultModel,
    promptVersion,
    timeFactor: timeFactor.factor,
  });

  if (result.tasks.length > 0) {
    const rows: NewTask[] = result.tasks.map((t) => ({
      id: randomUUID(),
      subjectId: input.subjectId,
      planId,
      taskKey: t.key,
      date: t.date,
      kind: t.kind,
      topicKey: t.topicKey,
      topicId: t.topicId,
      minutes: t.minutes,
      title: t.title,
      description: t.description,
      payload: t.payload,
      pinned: t.pinned,
      origin: t.origin,
      status: 'proposed',
    }));
    await db.insert(tasks).values(rows);
  }

  return {
    planId,
    taskCount: result.tasks.length,
    feasible: result.feasibility.feasible,
    warnings: result.warnings,
    costEur,
    usage,
  };
}
