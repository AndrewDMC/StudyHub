import { desc, eq } from 'drizzle-orm';
import { subjects, studyPlans, tasks, type Database } from '@studyhub/db';
import { resolveProvider } from '@studyhub/ai';
import { processGeneratePlan, type GeneratePlanResult } from '@studyhub/worker/lib';
import type { GeneratePlanJobInput, Intensity } from '@studyhub/contracts';

export class SubjectNotFoundCliError extends Error {
  constructor(slug: string) {
    super(`Materia non trovata: ${slug}`);
    this.name = 'SubjectNotFoundCliError';
  }
}

export interface GeneratePlanCliInput {
  subjectSlug: string;
  startDate: string;
  targetDate: string;
  /** Minutes per weekday, index 0 = Sunday … 6 = Saturday — same convention as the wizard. */
  weekly: number[];
  blackoutDates?: string[];
  sessionLength?: number;
  intensity?: Intensity;
  examId?: string;
  force?: boolean;
}

/**
 * `studyhub plan generate` (docs/fasi/F6-planner-calendario.md "Stato":
 * "CLI insegue la UI quando serve"). Calls the worker's job processor
 * in-process, the same "apps/cli è lo stesso codice del worker invocato
 * one-shot" pattern as `reconcile` — no Redis/BullMQ needed to generate a
 * plan from a terminal. Always produces a fresh `draft`; committing it is a
 * separate step, not yet exposed here (see docs/fasi/F6-planner-calendario.md).
 */
export async function generatePlanCli(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  input: GeneratePlanCliInput,
): Promise<GeneratePlanResult> {
  const [subject] = await db
    .select({ id: subjects.id })
    .from(subjects)
    .where(eq(subjects.slug, input.subjectSlug));
  if (!subject) throw new SubjectNotFoundCliError(input.subjectSlug);

  const jobInput: GeneratePlanJobInput = {
    subjectId: subject.id,
    ...(input.examId !== undefined ? { examId: input.examId } : {}),
    startDate: input.startDate,
    targetDate: input.targetDate,
    availability: { perWeekday: input.weekly, blackoutDates: input.blackoutDates ?? [] },
    prefs: {
      sessionLength: input.sessionLength ?? 50,
      intensity: input.intensity ?? 'standard',
      simulationCount: 'auto',
      simulationMinutes: 90,
      reviewMinutesPerCard: 0.5,
    },
    force: input.force ?? false,
  };
  return processGeneratePlan(db, jobInput, resolveProvider());
}

export interface PlanSummaryRow {
  id: string;
  status: string;
  startDate: string;
  targetDate: string;
  taskCount: number;
}

/** `studyhub plan ls <subjectSlug>` — draft/active/superseded plans, newest first. */
export async function listPlansCli(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  subjectSlug: string,
): Promise<PlanSummaryRow[]> {
  const [subject] = await db
    .select({ id: subjects.id })
    .from(subjects)
    .where(eq(subjects.slug, subjectSlug));
  if (!subject) throw new SubjectNotFoundCliError(subjectSlug);

  const plans = await db
    .select()
    .from(studyPlans)
    .where(eq(studyPlans.subjectId, subject.id))
    .orderBy(desc(studyPlans.createdAt));
  const rows: PlanSummaryRow[] = [];
  for (const plan of plans) {
    const planTasks: { id: string }[] = await db
      .select({ id: tasks.id })
      .from(tasks)
      .where(eq(tasks.planId, plan.id));
    rows.push({
      id: plan.id,
      status: plan.status,
      startDate: plan.startDate,
      targetDate: plan.targetDate,
      taskCount: planTasks.length,
    });
  }
  return rows;
}

export type { Database };
