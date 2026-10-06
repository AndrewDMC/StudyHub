import { and, eq } from 'drizzle-orm';
import { attemptItemResults, simulationAttempts, simulationItems } from '@studyhub/db';
import { estimateCostEur, resolveProvider, type AiProvider, resolveModel } from '@studyhub/ai';
import type { GradeItemSecondOpinionJobInput } from '@studyhub/contracts';
import { checkBudget } from '../generation/shared.js';
import { reconcileWithRubric } from './gradeAttempt.js';

const MODEL_ROUTING_SECOND_OPINION = 'claude-opus-5-5'; // docs/fasi/F5 "Rischi": "modello superiore"

export interface GradeItemSecondOpinionResult {
  attemptId: string;
  itemId: string;
  awarded: number;
  max: number;
  costEur: number;
  usage: { inputTokens: number; outputTokens: number };
}

/**
 * `grade_item_second_opinion` (docs/fasi/F5-esami-simulazioni.md "Rischi": "possibilità di
 * chiedere una seconda opinione con modello superiore su singolo item"). Re-grades one already-
 * graded item with a stronger model and stores it *alongside* the original on the same
 * `attempt_item_results` row (`second_opinion_*` columns) — it never overwrites the first grade,
 * since the two can legitimately disagree and both are useful to see.
 */
export async function processGradeItemSecondOpinion(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  input: GradeItemSecondOpinionJobInput,
  provider: AiProvider = resolveProvider(),
): Promise<GradeItemSecondOpinionResult> {
  const [attempt] = await db
    .select()
    .from(simulationAttempts)
    .where(eq(simulationAttempts.id, input.attemptId));
  if (!attempt) throw new Error(`attempt not found: ${input.attemptId}`);
  if (attempt.status !== 'graded') {
    throw new Error('Il tentativo non è ancora corretto: nessun voto di base da confrontare.');
  }

  const [item] = await db
    .select()
    .from(simulationItems)
    .where(
      and(
        eq(simulationItems.id, input.itemId),
        eq(simulationItems.simulationId, attempt.simulationId),
      ),
    );
  if (!item) throw new Error(`Esercizio non trovato in questo tentativo: ${input.itemId}`);

  const [existing] = await db
    .select()
    .from(attemptItemResults)
    .where(
      and(eq(attemptItemResults.attemptId, attempt.id), eq(attemptItemResults.itemId, item.id)),
    );
  if (!existing) throw new Error(`Nessuna correzione esistente per questo esercizio: ${item.id}`);

  const model = input.model ?? resolveModel(MODEL_ROUTING_SECOND_OPINION);
  const answer = attempt.answers[item.id] ?? '';
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
        topicName: null,
      },
      answer,
    },
    model,
  );
  const costEur = estimateCostEur(
    result.model,
    result.usage.inputTokens,
    result.usage.outputTokens,
  );
  await checkBudget(db, costEur, input.force);

  const criteria = reconcileWithRubric(item, result.data.criteria);
  const awarded = Math.round(criteria.reduce((s, c) => s + c.awarded, 0) * 100) / 100;
  const missing = answer.trim() ? result.data.missing : item.expectedPoints;

  await db
    .update(attemptItemResults)
    .set({
      secondOpinionModel: result.model,
      secondOpinionAwarded: awarded,
      secondOpinionCriteria: criteria,
      secondOpinionMissing: missing,
      secondOpinionAt: new Date(),
    })
    .where(eq(attemptItemResults.id, existing.id));

  return {
    attemptId: attempt.id,
    itemId: item.id,
    awarded,
    max: item.points,
    costEur,
    usage: result.usage,
  };
}
