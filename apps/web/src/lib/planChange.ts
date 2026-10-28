import { randomUUID } from 'node:crypto';
import { asc, eq } from 'drizzle-orm';
import { jobs, subjects, topics } from '@studyhub/db';
import { estimateCostEur, resolveModel, type AiProvider } from '@studyhub/ai';
import { applyPlanChange } from '@studyhub/core';
import type { PlanChangeProposalDto, ProposePlanChangeRequest } from '@studyhub/contracts';
import { getCurrentPlan, listPlans } from './plan';
import { NotFoundError } from './examPrep';
import { CHAT_DEFAULT_MODEL } from './sessionChat';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = any;

/**
 * "Modifica piano": the student's request in their own words → the inputs of a new draft. The model only
 * proposes parameter changes; `applyPlanChange` validates them, and nothing is generated until the student
 * confirms the returned `request` (which goes through the normal draft → review → commit flow).
 */
export async function proposePlanChange(
  db: AnyDb,
  slug: string,
  body: ProposePlanChangeRequest,
  provider: AiProvider,
  today: string,
): Promise<PlanChangeProposalDto> {
  const plan = body.planId
    ? ((await listPlans(db, slug)).find((p) => p.id === body.planId) ?? null)
    : await getCurrentPlan(db, slug);
  if (!plan) throw new NotFoundError('Piano da modificare');
  const [subject] = await db
    .select({ name: subjects.name })
    .from(subjects)
    .where(eq(subjects.id, plan.subjectId));

  const subjectTopics: { id: string; name: string }[] = await db
    .select({ id: topics.id, name: topics.name })
    .from(topics)
    .where(eq(topics.subjectId, plan.subjectId))
    .orderBy(asc(topics.name));
  // Plans don't store their scope: the topics their tasks cover stand for it.
  const planned = new Set(plan.tasks.flatMap((t) => (t.topicId ? [t.topicId] : [])));
  const allTopicIds = subjectTopics.map((t) => t.id);
  const scoped =
    planned.size > 0 && allTopicIds.some((id) => !planned.has(id))
      ? allTopicIds.filter((id) => planned.has(id))
      : undefined;

  const model = resolveModel(CHAT_DEFAULT_MODEL);
  const result = await provider.interpretPlanChange(
    {
      subjectName: (subject?.name as string | undefined) ?? slug,
      today,
      targetDate: plan.targetDate,
      perWeekday: plan.availability.perWeekday,
      blackoutDates: plan.availability.blackoutDates,
      intensity: plan.prefs.intensity,
      sessionLength: plan.prefs.sessionLength,
      simulationCount: plan.prefs.simulationCount,
      topics: subjectTopics.map((t) => ({
        id: t.id,
        name: t.name,
        included: !scoped || scoped.includes(t.id),
      })),
      instruction: body.instruction,
    },
    model,
  );

  const { inputs, rejected } = applyPlanChange(
    {
      targetDate: plan.targetDate,
      availability: plan.availability,
      prefs: plan.prefs,
      topicIds: scoped,
    },
    result.data,
    { today, allTopicIds },
  );

  const eur = estimateCostEur(result.model, result.usage.inputTokens, result.usage.outputTokens);
  // Same ledger as every other AI call, so it shows up in /admin and the monthly cost.
  await db.insert(jobs).values({
    id: randomUUID(),
    type: 'plan_change',
    subjectId: plan.subjectId,
    status: 'succeeded',
    input: { planId: plan.id, instruction: body.instruction },
    cost: { inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens, eur },
    progressPct: 100,
    finishedAt: new Date(),
  });

  return {
    request: {
      // A new draft always starts today: what was already studied is not planned again.
      startDate: today,
      targetDate: inputs.targetDate,
      ...(plan.examId ? { examId: plan.examId } : {}),
      ...(inputs.topicIds ? { topicIds: inputs.topicIds } : {}),
      availability: inputs.availability,
      prefs: inputs.prefs,
      force: false,
    },
    changes: result.data.changes,
    notApplied: [...result.data.notUnderstood, ...rejected],
    costEur: eur,
  };
}
