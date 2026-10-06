import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { jobs, type JobCost } from '@studyhub/db';
import {
  ClassifyDocumentTypeJobInputSchema,
  DistillHandwritingProfileJobInputSchema,
  EmbedChunksJobInputSchema,
  ExtractExamProfileJobInputSchema,
  ExtractTextJobInputSchema,
  ExtractTopicsJobInputSchema,
  GenerateFlashcardsJobInputSchema,
  GeneratePlanJobInputSchema,
  GenerateSchemaJobInputSchema,
  GenerateSimulationJobInputSchema,
  GenerateSummaryJobInputSchema,
  GradeAttemptJobInputSchema,
  GradeItemSecondOpinionJobInputSchema,
  JobTypeSchema,
  PingJobInputSchema,
  PrepareSessionJobInputSchema,
  ReconcileJobInputSchema,
  TranscribeSchemaJobInputSchema,
  type JobType,
} from '@studyhub/contracts';
import { processPing } from './processors/ping.js';
import { reconcileSubjects } from './processors/reconcile.js';
import { processExtractText } from './processors/extractText.js';
import { processEmbedChunks } from './processors/embedChunks.js';
import { processClassifyDocumentType } from './processors/classifyDocumentType.js';
import { processTranscribeSchema } from './processors/transcribeSchema.js';
import { processDistillHandwritingProfile } from './processors/distillHandwritingProfile.js';
import { processExtractTopics } from './processors/generation/extractTopics.js';
import { processGenerateFlashcards } from './processors/generation/generateFlashcards.js';
import { processGenerateSchema } from './processors/generation/generateSchema.js';
import { processPrepareSession } from './processors/generation/prepareSession.js';
import { processGenerateSummary } from './processors/generation/generateSummary.js';
import { processExtractExamProfile } from './processors/exam/extractExamProfile.js';
import { processGenerateSimulation } from './processors/exam/generateSimulation.js';
import { processGradeAttempt } from './processors/exam/gradeAttempt.js';
import { processGradeItemSecondOpinion } from './processors/exam/gradeItemSecondOpinion.js';
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
    case 'embed_chunks':
      return processEmbedChunks(db, EmbedChunksJobInputSchema.parse(data));
    case 'classify_document_type':
      return processClassifyDocumentType(db, ClassifyDocumentTypeJobInputSchema.parse(data));
    case 'transcribe_schema':
      return processTranscribeSchema(db, dataRoot, TranscribeSchemaJobInputSchema.parse(data));
    case 'distill_handwriting_profile':
      return processDistillHandwritingProfile(
        db,
        dataRoot,
        DistillHandwritingProfileJobInputSchema.parse(data),
      );
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
    case 'grade_item_second_opinion':
      return processGradeItemSecondOpinion(db, GradeItemSecondOpinionJobInputSchema.parse(data));
    case 'generate_plan':
      return processGeneratePlan(db, GeneratePlanJobInputSchema.parse(data));
    case 'extract_topics':
      return processExtractTopics(db, dataRoot, ExtractTopicsJobInputSchema.parse(data));
    case 'prepare_session':
      return processPrepareSession(db, PrepareSessionJobInputSchema.parse(data));
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

  const base = { id: job.id ?? randomUUID(), type, input: job.data ?? {}, status };
  const subjectId = extractSubjectId(job.data);
  if (subjectId === null) {
    await db.insert(jobs).values(base);
    return;
  }
  try {
    await db.insert(jobs).values({ ...base, subjectId });
  } catch {
    // `subjectId` doesn't reference a real subject (foreign key violation — e.g. a job enqueued
    // for a subject deleted in the meantime). The processor is what should report that clearly
    // ("subject not found", per every processor's own check) — still create the row so the job
    // stays trackable by id, just without attribution, instead of losing it to an unhandled
    // constraint error before dispatch even runs.
    await db.insert(jobs).values(base);
  }
}

/**
 * Most job input schemas carry a `subjectId` directly (see `packages/contracts`) — reading it
 * here is what lets `jobs.subject_id` (and everything that joins on it: the Dashboard's
 * "Attività", `/admin`'s job list) actually attribute a job to a subject instead of showing
 * `null` for every job that has one. `reconcile` (no single subject), `ping`, `extract_text`
 * (`documentId` only), `grade_attempt` and `grade_item_second_opinion` (`attemptId`/`itemId` only)
 * genuinely have none to give without a DB lookup this function isn't meant to do — those stay
 * unattributed, correctly.
 */
function extractSubjectId(data: unknown): string | null {
  if (typeof data !== 'object' || data === null) return null;
  const subjectId = (data as { subjectId?: unknown }).subjectId;
  return typeof subjectId === 'string' ? subjectId : null;
}
