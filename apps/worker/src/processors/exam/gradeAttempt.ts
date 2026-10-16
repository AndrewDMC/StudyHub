import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import {
  attemptItemResults,
  recomputeTopicMastery,
  simulationAttempts,
  simulationItems,
  type GradedCriterionData,
  type SimulationItemRow,
} from '@studyhub/db';
import { estimateCostEur, resolveProvider, type AiProvider, resolveModel } from '@studyhub/ai';
import { isPassing } from '@studyhub/core';
import type { GradeAttemptJobInput } from '@studyhub/contracts';
import { checkBudget } from '../generation/shared.js';
import {
  composeAnswer,
  findSimulationSubjectSlug,
  transcribeAnswerPhotos,
} from './answerPhotos.js';

const MODEL_ROUTING_GRADE = 'claude-sonnet-5-5'; // docs/03 §4: simulation_grade

export interface GradeAttemptResult {
  attemptId: string;
  totalAwarded: number;
  totalMax: number;
  weakTopics: string[];
  /** Items whose topic is weak — the UI offers a drill/cards on these (docs/fasi/F5 Correzione). */
  weakItemIds: string[];
  alreadyGraded: boolean;
  /** Photos of handwritten answers that could not be read: the item was graded on its typed text only. */
  warnings: string[];
  costEur: number;
  usage: { inputTokens: number; outputTokens: number };
}

/**
 * Rebuilds the per-criterion grade from the item's *own* rubric, index by
 * index, taking only `awarded` and `feedback` from the model and clamping
 * `awarded` to the rubric max. A grader that invents criteria, inflates a
 * max, or is talked into "10/10" by the answer can't push the score past
 * what the rubric allows.
 */
export function reconcileWithRubric(
  item: Pick<SimulationItemRow, 'rubric'>,
  modelCriteria: { awarded: number; feedback: string }[],
): GradedCriterionData[] {
  return item.rubric.map((r, i) => {
    const m = modelCriteria[i];
    const awarded = Math.min(r.points, Math.max(0, m?.awarded ?? 0));
    return {
      criterion: r.criterion,
      awarded: Math.round(awarded * 100) / 100,
      max: r.points,
      feedback: m?.feedback ?? 'Nessun feedback dal correttore per questo criterio.',
    };
  });
}

/**
 * `grade_attempt` (docs/fasi/F5 Correzione): formative, per criterion, always
 * citing the material to re-study — the item's own `sourceRef` is attached
 * here, not asked of the model. Updates mastery for the topics involved.
 */
export async function processGradeAttempt(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  dataRoot: string,
  input: GradeAttemptJobInput,
  provider: AiProvider = resolveProvider(),
): Promise<GradeAttemptResult> {
  const [attempt] = await db
    .select()
    .from(simulationAttempts)
    .where(eq(simulationAttempts.id, input.attemptId));
  if (!attempt) throw new Error(`attempt not found: ${input.attemptId}`);

  const zero = { warnings: [], costEur: 0, usage: { inputTokens: 0, outputTokens: 0 } };
  if (attempt.status === 'graded') {
    return {
      attemptId: attempt.id,
      totalAwarded: attempt.totalAwarded ?? 0,
      totalMax: attempt.totalMax ?? 0,
      weakTopics: attempt.weakTopics ?? [],
      weakItemIds: [],
      alreadyGraded: true,
      ...zero,
    };
  }
  if (attempt.status !== 'submitted') {
    throw new Error(
      'Il tentativo non è ancora stato consegnato: non si corregge un esame in corso.',
    );
  }

  const items: SimulationItemRow[] = await db
    .select()
    .from(simulationItems)
    .where(eq(simulationItems.simulationId, attempt.simulationId))
    .orderBy(simulationItems.ord);

  const model = input.model ?? resolveModel(MODEL_ROUTING_GRADE);
  const usage = { inputTokens: 0, outputTokens: 0 };
  let costEur = 0;

  // Handwritten answers: photos attached to the attempt are transcribed (vision) and appended to the
  // typed text, so the grader (and `GradePromptInput`) only ever deal with text.
  const subjectSlug = await findSimulationSubjectSlug(db, attempt.simulationId);
  const photos = subjectSlug
    ? await transcribeAnswerPhotos(
        db,
        dataRoot,
        subjectSlug,
        attempt.id,
        new Set(items.map((i) => i.id)),
        provider,
      )
    : null;
  if (photos) {
    usage.inputTokens += photos.usage.inputTokens;
    usage.outputTokens += photos.usage.outputTokens;
    costEur += photos.costEur;
  }

  const graded = [];
  for (const item of items) {
    const answer = composeAnswer(attempt.answers[item.id] ?? '', photos?.byItem.get(item.id));
    const result = await provider.gradeAnswer(
      {
        item: {
          prompt: item.prompt,
          kind: item.kind,
          points: item.points,
          expectedPoints: item.expectedPoints,
          rubric: item.rubric,
          solution: item.solution,
          sourceRef: item.sourceRef,
          // Not used by the grading prompt (docs/03 §3.4) — topic tagging only
          // matters at generation time, already persisted on the item row.
          topicName: null,
        },
        answer,
      },
      model,
    );
    usage.inputTokens += result.usage.inputTokens;
    usage.outputTokens += result.usage.outputTokens;
    costEur += estimateCostEur(result.model, result.usage.inputTokens, result.usage.outputTokens);

    const criteria = reconcileWithRubric(item, result.data.criteria);
    const awarded = Math.round(criteria.reduce((s, c) => s + c.awarded, 0) * 100) / 100;
    graded.push({
      item,
      criteria,
      awarded,
      missing: answer.trim() ? result.data.missing : item.expectedPoints,
    });
  }

  // Grades are computed in memory first: a budget stop leaves nothing half-written.
  await checkBudget(db, costEur, input.force);

  for (const g of graded) {
    await db.insert(attemptItemResults).values({
      id: randomUUID(),
      attemptId: attempt.id,
      itemId: g.item.id,
      awarded: g.awarded,
      max: g.item.points,
      criteria: g.criteria,
      missing: g.missing,
      sourceRef: g.item.sourceRef,
    });
  }

  const totalAwarded = Math.round(graded.reduce((s, g) => s + g.awarded, 0) * 100) / 100;
  const totalMax = Math.round(items.reduce((s, i) => s + i.points, 0) * 100) / 100;
  const weakItems = graded.filter(
    // Weak = not passing, with the same bar the UI verdict uses (PASS_RATIO in @studyhub/core).
    (g) => g.item.points > 0 && !isPassing(g.awarded / g.item.points),
  );
  const weakTopics = [
    ...new Set(weakItems.map((g) => g.item.topicId).filter((t): t is string => !!t)),
  ];

  await db
    .update(simulationAttempts)
    .set({ status: 'graded', gradedAt: new Date(), totalAwarded, totalMax, weakTopics })
    .where(eq(simulationAttempts.id, attempt.id));

  const touchedTopics = [...new Set(items.map((i) => i.topicId).filter((t): t is string => !!t))];
  for (const topicId of touchedTopics) {
    await recomputeTopicMastery(db, topicId);
  }

  return {
    attemptId: attempt.id,
    totalAwarded,
    totalMax,
    weakTopics,
    weakItemIds: weakItems.map((g) => g.item.id),
    alreadyGraded: false,
    warnings: photos?.warnings ?? [],
    costEur,
    usage,
  };
}
