import { randomUUID } from 'node:crypto';
import { and, eq, inArray, lt, ne } from 'drizzle-orm';
import {
  artifacts,
  chunks,
  documents,
  exams,
  flashcards,
  resolvePrimaryTopics,
  studyPlans,
  subjects,
  tasks,
  type Flashcard,
  type NewTask,
} from '@studyhub/db';
import {
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
} from '@studyhub/ai';
import type { GeneratePlanJobInput } from '@studyhub/contracts';
import { checkBudget } from '../generation/shared.js';

const MODEL_ROUTING_PLAN = 'claude-opus-5'; // docs/04-planner.md §3: "Fase A — Analisi AI (1 chiamata, opus)"
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

interface PlanningUnit {
  /** A real `topics.id` when the unit is a tagged topic, else the document's own id. */
  key: string;
  topicId: string | null;
  name: string;
  pages: number;
  /** Real `topics.mastery` when the unit is a tagged topic — the first time this Planner ever sees real mastery data. */
  mastery: number | null;
  docs: { id: string; pages: number }[];
}

/**
 * Groups eligible documents into planning units (docs/fasi/F2-materie.md
 * "Stato": `document_topics`, unblocked). A document tagged with more than
 * one topic is assigned to exactly one — its *primary* topic, the tagged
 * topic with the lowest `orderIndex` (ties broken by id) — so it is never
 * double-counted across two units. An untagged document is still its own
 * unit, exactly as before (`PlannerTopic`'s own doc comment: "a document
 * standing in for one") — subjects that haven't tagged anything yet see no
 * change at all.
 */
async function buildPlanningUnits(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  subjectId: string,
  eligibleDocs: { id: string; originalName: string; pages: number }[],
): Promise<PlanningUnit[]> {
  if (eligibleDocs.length === 0) return [];
  const docIds = eligibleDocs.map((d) => d.id);
  const primaryByDoc = await resolvePrimaryTopics(db, subjectId, docIds);

  const units = new Map<string, PlanningUnit>();
  for (const doc of eligibleDocs) {
    const primary = primaryByDoc.get(doc.id) ?? null;
    const unitKey = primary ? primary.topicId : doc.id;

    const existing = units.get(unitKey);
    if (existing) {
      existing.pages += doc.pages;
      existing.docs.push({ id: doc.id, pages: doc.pages });
    } else {
      units.set(unitKey, {
        key: unitKey,
        topicId: primary ? primary.topicId : null,
        name: primary ? primary.topicName : doc.originalName,
        pages: doc.pages,
        mastery: primary ? primary.mastery : null,
        docs: [{ id: doc.id, pages: doc.pages }],
      });
    }
  }
  return [...units.values()];
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

  if (input.examId) {
    const [exam] = await db
      .select({ id: exams.id })
      .from(exams)
      .where(and(eq(exams.id, input.examId), eq(exams.subjectId, input.subjectId)));
    if (!exam) throw new Error(`exam not found for this subject: ${input.examId}`);
  }

  const model = input.model ?? MODEL_ROUTING_PLAN;

  const docRows: { id: string; originalName: string; pages: number | null }[] = await db
    .select({ id: documents.id, originalName: documents.originalName, pages: documents.pages })
    .from(documents)
    .where(and(eq(documents.subjectId, input.subjectId), eq(documents.status, 'parsed')));
  const eligibleDocs = docRows.filter(
    (d): d is { id: string; originalName: string; pages: number } => (d.pages ?? 0) > 0,
  );

  let plannerTopics: PlannerTopic[] = [];
  let usage = { inputTokens: 0, outputTokens: 0 };
  let resultModel = 'none';
  let promptVersion = ESTIMATE_TOPICS_PROMPT_VERSION;

  const units = await buildPlanningUnits(db, input.subjectId, eligibleDocs);

  if (units.length > 0) {
    const docIds = eligibleDocs.map((d) => d.id);
    const chunkRows: { documentId: string; ord: number; text: string }[] = await db
      .select({ documentId: chunks.documentId, ord: chunks.ord, text: chunks.text })
      .from(chunks)
      .where(and(inArray(chunks.documentId, docIds), lt(chunks.ord, EXCERPT_CHUNK_SAMPLE)));

    const excerptByDoc = new Map<string, string>();
    for (const doc of eligibleDocs) {
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
        estimatedMinutes: est?.estimatedMinutes ?? Math.max(20, Math.round(u.pages * 3.5)),
        difficulty: est?.difficulty ?? 3,
        examWeight: est?.examWeight ?? 1 / units.length,
        prerequisites: est?.prerequisites.filter((p) => estByKey.has(p)) ?? [],
        mastery: u.mastery,
        material: u.docs.map((d) => ({ docId: d.id, pageFrom: 1, pageTo: d.pages })),
      };
    });
  }

  const costEur = estimateCostEur(resultModel, usage.inputTokens, usage.outputTokens);
  await checkBudget(db, costEur, input.force);

  // FSRS reviews due in the plan window — "precedenza assoluta" (docs/04-planner.md §4).
  const dayCount = Math.max(0, diffDays(input.startDate, input.targetDate));
  const scheduleRows: Pick<Flashcard, 'dueAt' | 'state'>[] = await db
    .select({ dueAt: flashcards.dueAt, state: flashcards.state })
    .from(flashcards)
    .innerJoin(artifacts, eq(flashcards.deckId, artifacts.id))
    .where(and(eq(artifacts.subjectId, input.subjectId), eq(flashcards.suspended, false)));
  const forecast = forecastDueCounts(
    scheduleRows,
    dayCount,
    new Date(`${input.startDate}T00:00:00.000Z`),
  );
  const dueCardsByDate = Object.fromEntries(forecast.map((f) => [f.date, f.count]));

  // Other subjects' active/in-progress tasks compete for the same daily minutes
  // (docs/04-planner.md §7: "i minuti del giorno sono una risorsa condivisa").
  const busyRows: { date: string; minutes: number }[] = await db
    .select({ date: tasks.date, minutes: tasks.minutes })
    .from(tasks)
    .where(and(ne(tasks.subjectId, input.subjectId), inArray(tasks.status, ['todo', 'doing'])));
  const busyMinutesByDate: Record<string, number> = {};
  for (const row of busyRows)
    busyMinutesByDate[row.date] = (busyMinutesByDate[row.date] ?? 0) + row.minutes;

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
