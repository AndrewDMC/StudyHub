import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { jobs, type JobCost } from '@studyhub/db';
import {
  ExtractExamProfileJobInputSchema,
  ExtractTextJobInputSchema,
  ExtractTopicsJobInputSchema,
  GenerateFlashcardsJobInputSchema,
  GeneratePlanJobInputSchema,
  GenerateSchemaJobInputSchema,
  GenerateSimulationJobInputSchema,
  GenerateSummaryJobInputSchema,
  GradeAttemptJobInputSchema,
  JobTypeSchema,
  PingJobInputSchema,
  ReconcileJobInputSchema,
  type JobType,
} from '@studyhub/contracts';
import { processPing } from './processors/ping.js';
import { reconcileSubjects } from './processors/reconcile.js';
import { processExtractText } from './processors/extractText.js';
import { processExtractTopics } from './processors/generation/extractTopics.js';
import { processGenerateFlashcards } from './processors/generation/generateFlashcards.js';
import { processGenerateSchema } from './processors/generation/generateSchema.js';
import { processGenerateSummary } from './processors/generation/generateSummary.js';
import { processExtractExamProfile } from './processors/exam/extractExamProfile.js';
import { processGenerateSimulation } from './processors/exam/generateSimulation.js';
import { processGradeAttempt } from './processors/exam/gradeAttempt.js';
import { processGeneratePlan } from './processors/planner/generatePlan.js';
import { logger } from './logger.js';

export interface RunnableJob {
  id: string;
  name: string;
  data: unknown;
}

interface GenerationBookkeeping {
  jobKey?: string;
  costEur?: number;
  usage?: { inputTokens: number; outputTokens: number };
}

/**
 * Executes one job's business logic and keeps the `jobs` table (the UI/CLI's
 * window into job state, docs/01-architettura.md §6) in sync: queued ->
 * running -> succeeded|failed. Framework-agnostic — takes a plain
 * `{id, name, data}` so it can be driven by a real BullMQ `Job` or, in
 * tests, a bare object, without needing a live Redis connection.
 */
export async function runJob(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  dataRoot: string,
  job: RunnableJob,
): Promise<unknown> {
  const jobTypeResult = JobTypeSchema.safeParse(job.name);
  if (!jobTypeResult.success) {
    throw new Error(`unknown job type: ${job.name}`);
  }
  const type: JobType = jobTypeResult.data;

  await upsertJobRow(db, job, type, 'running');

  try {
    const output = await dispatch(db, dataRoot, type, job.data);
    const { jobKey, costEur, usage } = output as GenerationBookkeeping;
    const cost: JobCost | undefined =
      typeof costEur === 'number' && usage
        ? { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, eur: costEur }
        : undefined;

    await db
      .update(jobs)
      .set({
        status: 'succeeded',
        output: output ?? {},
        progressPct: 100,
        finishedAt: new Date(),
        ...(jobKey ? { jobKey } : {}),
        ...(cost ? { cost } : {}),
      })
      .where(eq(jobs.id, job.id));
    return output;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ jobId: job.id, type, err: message }, 'job failed');
    await db
      .update(jobs)
      .set({
        status: 'failed',
        error: { code: 'job_failed', message, retryable: true },
        finishedAt: new Date(),
      })
      .where(eq(jobs.id, job.id));
    throw err;
  }
}

async function dispatch(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  dataRoot: string,
  type: JobType,
  data: unknown,
): Promise<unknown> {
  switch (type) {
    case 'ping':
      return processPing(PingJobInputSchema.parse(data ?? {}));
    case 'reconcile':
      return reconcileSubjects(db, dataRoot, ReconcileJobInputSchema.parse(data ?? {}));
    case 'extract_text':
      return processExtractText(db, dataRoot, ExtractTextJobInputSchema.parse(data));
    case 'generate_flashcards':
      return processGenerateFlashcards(db, dataRoot, GenerateFlashcardsJobInputSchema.parse(data));
    case 'generate_schema':
      return processGenerateSchema(db, dataRoot, GenerateSchemaJobInputSchema.parse(data));
    case 'generate_summary':
      return processGenerateSummary(db, dataRoot, GenerateSummaryJobInputSchema.parse(data));
    case 'extract_exam_profile':
      return processExtractExamProfile(db, dataRoot, ExtractExamProfileJobInputSchema.parse(data));
    case 'generate_simulation':
      return processGenerateSimulation(db, dataRoot, GenerateSimulationJobInputSchema.parse(data));
    case 'grade_attempt':
      return processGradeAttempt(db, dataRoot, GradeAttemptJobInputSchema.parse(data));
    case 'generate_plan':
      return processGeneratePlan(db, GeneratePlanJobInputSchema.parse(data));
    case 'extract_topics':
      return processExtractTopics(db, dataRoot, ExtractTopicsJobInputSchema.parse(data));
    default: {
      const exhaustive: never = type;
      throw new Error(`unhandled job type: ${exhaustive}`);
    }
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function upsertJobRow(
  db: any,
  job: RunnableJob,
  type: JobType,
  status: 'running',
): Promise<void> {
  const [existing] = await db.select().from(jobs).where(eq(jobs.id, job.id));
  if (existing) {
    await db.update(jobs).set({ status }).where(eq(jobs.id, job.id));
    return;
  }
  await db.insert(jobs).values({
    id: job.id ?? randomUUID(),
    type,
    input: job.data ?? {},
    status,
  });
}
