import { randomUUID } from 'node:crypto';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { jobs, sessionItems, studySessions, subjects, type StudySession } from '@studyhub/db';
import {
  ExplanationFeedbackDtoSchema,
  type ExplanationDto,
  type ExplanationStateDto,
  type SubmitExplanationRequest,
} from '@studyhub/contracts';
import type { Queue } from 'bullmq';
import { SubjectNotFoundError } from './errors';
import { ConflictError, InvalidRequestError, NotFoundError } from './examPrep';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = any;

const EXPLAIN_JOB = 'explain_feedback';

async function requireSession(db: AnyDb, slug: string, sessionId: string): Promise<StudySession> {
  const [subject] = await db.select().from(subjects).where(eq(subjects.slug, slug));
  if (!subject) throw new SubjectNotFoundError(slug);
  const [row] = await db
    .select()
    .from(studySessions)
    .where(and(eq(studySessions.id, sessionId), eq(studySessions.subjectId, subject.id)));
  if (!row) throw new NotFoundError('Sessione');
  return row as StudySession;
}

/** The newest explanation of the session (the one the student sees), if any. */
async function latestItem(db: AnyDb, sessionId: string) {
  const [row] = await db
    .select()
    .from(sessionItems)
    .where(and(eq(sessionItems.sessionId, sessionId), eq(sessionItems.kind, 'explanation')))
    .orderBy(desc(sessionItems.orderIndex), desc(sessionItems.createdAt))
    .limit(1);
  return row as typeof sessionItems.$inferSelect | undefined;
}

/**
 * The latest explanation with its feedback (`null` until the job has finished) and the state of the
 * job that compares it with the material, so the page can show "in attesa" or the error.
 */
export async function getExplanation(
  db: AnyDb,
  slug: string,
  sessionId: string,
): Promise<ExplanationStateDto> {
  const session = await requireSession(db, slug, sessionId);
  const item = await latestItem(db, session.id);
  if (!item) return { latest: null, job: null };

  // The feedback column is shared with exercise corrections: only this shape counts here.
  const parsed = ExplanationFeedbackDtoSchema.safeParse(item.feedback);
  const latest: ExplanationDto = {
    id: item.id,
    text: item.body,
    createdAt: item.createdAt.toISOString(),
    feedback: parsed.success ? parsed.data : null,
  };

  const [row] = await db
    .select()
    .from(jobs)
    .where(and(eq(jobs.type, EXPLAIN_JOB), sql`${jobs.input}->>'itemId' = ${item.id}`))
    .orderBy(desc(jobs.createdAt))
    .limit(1);
  return {
    latest,
    job: row
      ? {
          id: row.id,
          status: row.status,
          error: (row.error as { message?: string } | null)?.message ?? null,
        }
      : null,
  };
}

/**
 * "Spiega con parole tue": stores the text as a new `explanation` item (rewriting adds another, the
 * newest is the one shown) and queues `explain_feedback`. A queued job row is recorded first so the
 * page sees "in attesa" at once.
 */
export async function submitExplanation(
  db: AnyDb,
  queue: Pick<Queue, 'add'>,
  slug: string,
  sessionId: string,
  request: SubmitExplanationRequest,
): Promise<{ itemId: string; jobId: string }> {
  const session = await requireSession(db, slug, sessionId);
  if (session.status === 'ended') throw new ConflictError('La sessione è già terminata.');
  if (session.phase === null) {
    throw new InvalidRequestError('Questa sessione non ha fasi: non nasce da una lezione.');
  }

  // One correction at a time: a second submit while the first is still running would race on the order.
  const [pending] = await db
    .select({ id: jobs.id })
    .from(jobs)
    .where(
      and(
        eq(jobs.type, EXPLAIN_JOB),
        inArray(jobs.status, ['queued', 'running']),
        sql`${jobs.input}->>'sessionId' = ${session.id}`,
      ),
    )
    .limit(1);
  if (pending) throw new ConflictError('Sto già correggendo la spiegazione precedente.');

  const previous = await latestItem(db, session.id);
  const itemId = randomUUID();
  await db.insert(sessionItems).values({
    id: itemId,
    sessionId: session.id,
    kind: 'explanation',
    orderIndex: previous ? previous.orderIndex + 1 : 0,
    title: 'Spiegazione con parole tue',
    body: request.text,
  });

  const jobId = randomUUID();
  const data = {
    subjectId: session.subjectId,
    sessionId: session.id,
    itemId,
    force: false,
    ...(request.model ? { model: request.model } : {}),
  };
  await db.insert(jobs).values({
    id: jobId,
    type: EXPLAIN_JOB,
    subjectId: session.subjectId,
    status: 'queued',
    input: data,
  });
  try {
    await queue.add(EXPLAIN_JOB, data, { jobId });
  } catch (err) {
    // Never leave a `queued` row nobody will pick up: the page would wait forever.
    await db
      .update(jobs)
      .set({
        status: 'failed',
        error: { message: err instanceof Error ? err.message : 'Impossibile accodare il job.' },
        finishedAt: new Date(),
      })
      .where(eq(jobs.id, jobId));
    throw err;
  }
  return { itemId, jobId };
}
