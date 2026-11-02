import { randomUUID } from 'node:crypto';
import { and, eq, inArray, isNull, lt } from 'drizzle-orm';
import {
  artifacts,
  autoAttachFlashcards,
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
  type Task,
} from '@studyhub/db';
import {
  applyTimeFactor,
  diffDays,
  forecastDueCounts,
  schedulePlan,
  splitTopicIntoLessons,
  type MaterialRef,
  type PlannedTask,
  type PlannerLesson,
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

/** Pages [start, end) (0-based) of the topic's concatenated material, mapped back to real doc pages. */
function sliceMaterial(material: MaterialRef[], start: number, end: number): MaterialRef[] {
  const out: MaterialRef[] = [];
  let offset = 0;
  for (const m of material) {
    const len = m.pageTo - m.pageFrom + 1;
    const lo = Math.max(start, offset);
    const hi = Math.min(end, offset + len);
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

/**
 * The topic's lessons: the AI split when it gave one, else the deterministic page-based split.
 * A lesson points to `{docId, pageFrom, pageTo}` only when `docId` is one of the unit's real documents
 * and the pages are integers, in order and within that document; otherwise it takes its even share of
 * the unit's pages, in order. `factor` is the student's estimate-vs-real bias.
 */
function buildLessons(
  topic: PlannerTopic,
  aiLessons: TopicEstimate['lessons'],
  factor: number,
): PlannerLesson[] {
  if (aiLessons.length === 0) return splitTopicIntoLessons(topic);
  const total = topic.material.reduce((s, m) => s + (m.pageTo - m.pageFrom + 1), 0);
  const n = aiLessons.length;
  const scale = (min: number) => Math.max(1, Math.round(min * factor));
  return aiLessons.map((l, i) => {
    let material: MaterialRef[] = [];
    const doc = l.docId ? topic.material.find((m) => m.docId === l.docId) : undefined;
    if (
      doc &&
      l.pageFrom !== undefined &&
      l.pageTo !== undefined &&
      Number.isInteger(l.pageFrom) &&
      Number.isInteger(l.pageTo) &&
      l.pageFrom >= doc.pageFrom &&
      l.pageTo >= l.pageFrom &&
      l.pageTo <= doc.pageTo
    )
      material = [{ docId: doc.docId, pageFrom: l.pageFrom, pageTo: l.pageTo }];
    if (material.length === 0) {
      material =
        n === 1 || total <= 0
          ? topic.material
          : sliceMaterial(
              topic.material,
              Math.floor((i * total) / n),
              Math.floor(((i + 1) * total) / n),
            );
    }
    if (material.length === 0) material = topic.material;
    return {
      title: l.title.trim() || topic.name,
      material,
      standardMinutes: scale(l.standardMinutes),
      sprintMinutes: scale(l.sprintMinutes),
    };
  });
}

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
  const estimateLessonsByKey = new Map<string, TopicEstimate['lessons']>();
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

    const docNameById = new Map(scopedDocs.map((d) => [d.id, d.originalName]));
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
          documents: u.docs.map((d) => ({
            docId: d.id,
            name: docNameById.get(d.id),
            pages: d.pages,
          })),
        })),
      },
      model,
    );
    usage = result.usage;
    resultModel = result.model;
    promptVersion = result.promptVersion;

    const estByKey = new Map<string, TopicEstimate>(result.data.topics.map((t) => [t.key, t]));
    for (const [key, est] of estByKey) estimateLessonsByKey.set(key, est.lessons ?? []);
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
  plannerTopics = applyTimeFactor(plannerTopics, timeFactor.factor).map((t) => ({
    ...t,
    lessons: buildLessons(t, estimateLessonsByKey.get(t.key) ?? [], timeFactor.factor),
  }));

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

  // Open tasks the student pinned on the plan this draft will replace stay where they are
  // ("Fissa" on an active plan). Their key (`pin:<task id>:<seq>`) is unique and can't collide with a generated one.
  const activeRows: { id: string }[] = await db
    .select({ id: studyPlans.id })
    .from(studyPlans)
    .where(
      and(
        eq(studyPlans.subjectId, input.subjectId),
        eq(studyPlans.status, 'active'),
        input.examId ? eq(studyPlans.examId, input.examId) : isNull(studyPlans.examId),
      ),
    );
  const pinnedRows: Task[] =
    activeRows.length === 0
      ? []
      : await db
          .select()
          .from(tasks)
          .where(
            and(
              inArray(
                tasks.planId,
                activeRows.map((p) => p.id),
              ),
              eq(tasks.pinned, true),
              inArray(tasks.status, ['todo', 'doing']),
            ),
          );
  const pinned: PlannedTask[] = pinnedRows
    .filter((t) => t.date >= input.startDate && t.date < input.targetDate && t.kind !== 'rest')
    .map((t) => ({
      // keeps the original trailing sequence: the move engine reads the order of a topic's sessions from it
      key: `pin:${t.id}:${t.taskKey.split(':').at(-1)}`,
      date: t.date,
      kind: t.kind,
      topicKey: t.topicKey,
      topicId: t.topicId,
      minutes: t.minutes,
      title: t.title,
      description: t.description,
      payload: t.payload,
      pinned: true,
      origin: t.origin,
    }));

  const plannerInput: PlannerInput = {
    startDate: input.startDate,
    targetDate: input.targetDate,
    availability: input.availability,
    topics: plannerTopics,
    prefs: input.prefs,
    dueCardsByDate,
    busyMinutesByDate,
    pinned,
  };
  const result = schedulePlan(plannerInput);

  // A regenerated draft replaces the previous one outright: it never existed
  // outside the review screen (docs/04-planner.md §9.1), so there is nothing
  // to preserve — unlike commit, which supersedes the *active* plan instead.
  const planId = randomUUID();
  // Draft swap, plan, tasks and lesson links commit together: no half-built draft on failure.
  await db.transaction(async (tx: typeof db) => {
    await tx
      .delete(studyPlans)
      .where(and(eq(studyPlans.subjectId, input.subjectId), eq(studyPlans.status, 'draft')));

    await tx.insert(studyPlans).values({
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
      await tx.insert(tasks).values(rows);
    }

    // Lessons: attach the subject's topic-bearing cards to the nearest lesson of each topic
    // ("today" is the day the plan starts from).
    await autoAttachFlashcards(tx, {
      subjectId: input.subjectId,
      planIds: [planId],
      today: input.startDate,
    });
  });

  return {
    planId,
    taskCount: result.tasks.length,
    feasible: result.feasibility.feasible,
    warnings: result.warnings,
    costEur,
    usage,
  };
}
