import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import {
  documents,
  jobs,
  lessonBlocks,
  studySessions,
  subjects,
  type LessonBlock,
  type StudySession,
} from '@studyhub/db';
import { estimateCostEur, resolveModel, type AiProvider } from '@studyhub/ai';
import type {
  CheckLessonBlockRequest,
  CheckLessonBlockResponse,
  GenerateLessonBlockJobInput,
  LessonBlockDto,
  LessonDto,
  RegenerateLessonBlockRequest,
} from '@studyhub/contracts';
import type { Queue } from 'bullmq';
import { SubjectNotFoundError } from './errors';
import { ConflictError, NotFoundError } from './examPrep';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = any;

const GENERATE_JOB = 'generate_lesson_block';
/** Same ledger type the exercise correction uses, so check costs show up in /admin. */
const GRADE_JOB = 'session_grade';
/** Grading tier of docs/03-ai-e-worker.md §4. */
export const LESSON_CHECK_DEFAULT_MODEL = 'claude-sonnet-5-5';

/** Score bars of the check answer: `ok` ≥ 0.75, `partial` ≥ 0.4, else `wrong`. */
export const CHECK_OK_RATIO = 0.75;
export const CHECK_PARTIAL_RATIO = 0.4;

export function verdictForScore(score: number): 'ok' | 'partial' | 'wrong' {
  if (score >= CHECK_OK_RATIO) return 'ok';
  if (score >= CHECK_PARTIAL_RATIO) return 'partial';
  return 'wrong';
}

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

async function documentNames(db: AnyDb, rows: LessonBlock[]): Promise<Map<string, string>> {
  const docIds = [...new Set(rows.flatMap((r) => r.citations.map((c) => c.docId)))];
  if (docIds.length === 0) return new Map();
  const docRows: { id: string; originalName: string }[] = await db
    .select({ id: documents.id, originalName: documents.originalName })
    .from(documents)
    .where(inArray(documents.id, docIds));
  return new Map(docRows.map((d) => [d.id, d.originalName]));
}

/** `checkAnswer` stays hidden until the student has answered (the block is `done`). */
function toBlockDto(row: LessonBlock, names: Map<string, string>): LessonBlockDto {
  return {
    id: row.id,
    orderIndex: row.orderIndex,
    title: row.title,
    body: row.body,
    formula: row.formula,
    exampleSteps: row.exampleSteps,
    trap: row.trap,
    checkQuestion: row.checkQuestion,
    checkAnswer: row.state === 'done' ? row.checkAnswer : null,
    citations: row.citations.map((c) => ({
      docId: c.docId,
      documentName: names.get(c.docId) ?? 'Documento',
      page: c.page,
      quote: c.quote,
    })),
    state: row.state,
    studentAnswer: row.studentAnswer,
  };
}

/** The model chosen when the lesson was started (input of its first generation job), reused by later blocks. */
async function lessonModel(db: AnyDb, sessionId: string): Promise<string | undefined> {
  const [first] = await db
    .select({ input: jobs.input })
    .from(jobs)
    .where(and(eq(jobs.type, GENERATE_JOB), sql`${jobs.input}->>'sessionId' = ${sessionId}`))
    .orderBy(asc(jobs.createdAt))
    .limit(1);
  const model = (first?.input as { model?: unknown } | null)?.model;
  return typeof model === 'string' ? model : undefined;
}

/** A queued/running generation job for this block of this session, if any. */
async function findPendingJob(
  db: AnyDb,
  sessionId: string,
  blockIndex: number,
): Promise<{ id: string } | null> {
  const [row] = await db
    .select({ id: jobs.id })
    .from(jobs)
    .where(
      and(
        eq(jobs.type, GENERATE_JOB),
        inArray(jobs.status, ['queued', 'running']),
        sql`${jobs.input}->>'sessionId' = ${sessionId}`,
        sql`(${jobs.input}->>'blockIndex')::int = ${blockIndex}`,
      ),
    );
  return row ?? null;
}

/**
 * The sprint focus (concept and exercise) a block was queued with: the newest job of that block
 * that carries one. A sprint block is regenerated or retried with the same focus.
 */
async function sprintFocus(
  db: AnyDb,
  sessionId: string,
  blockIndex: number,
): Promise<GenerateLessonBlockJobInput['focus'] | null> {
  const [row] = await db
    .select({ input: jobs.input })
    .from(jobs)
    .where(
      and(
        eq(jobs.type, GENERATE_JOB),
        sql`${jobs.input}->>'sessionId' = ${sessionId}`,
        sql`(${jobs.input}->>'blockIndex')::int = ${blockIndex}`,
        sql`${jobs.input}->'focus' is not null`,
      ),
    )
    .orderBy(desc(jobs.createdAt))
    .limit(1);
  const focus = (row?.input as { focus?: GenerateLessonBlockJobInput['focus'] } | undefined)?.focus;
  return focus ?? null;
}

/**
 * Queues the generation of one block: records a `queued` job row first (so the page sees "in
 * preparazione" at once; the worker finds the row and updates it) and then puts it on the queue.
 * Returns null when there is nothing to do (the block exists, or a job for it is already pending).
 */
async function enqueueBlock(
  db: AnyDb,
  queue: Pick<Queue, 'add'>,
  session: StudySession,
  blockIndex: number,
  options: {
    regenerate?: boolean;
    hint?: GenerateLessonBlockJobInput['hint'];
    model?: string | undefined;
    force?: boolean;
  } = {},
): Promise<string | null> {
  if (!options.regenerate) {
    const [existing] = await db
      .select({ id: lessonBlocks.id })
      .from(lessonBlocks)
      .where(and(eq(lessonBlocks.sessionId, session.id), eq(lessonBlocks.orderIndex, blockIndex)));
    if (existing) return null;
  }
  if (await findPendingJob(db, session.id, blockIndex)) return null;

  // A sprint block explains one concept: without its focus there is nothing to generate (the
  // standard one-block-ahead chain does not apply). A sprint from before the phases is standard-like.
  const focus = session.method === 'sprint' ? await sprintFocus(db, session.id, blockIndex) : null;
  if (session.method === 'sprint' && session.phase !== 'understand' && !focus) return null;

  const model = options.model ?? (await lessonModel(db, session.id));
  const jobId = randomUUID();
  const data = {
    subjectId: session.subjectId,
    sessionId: session.id,
    blockIndex,
    regenerate: options.regenerate ?? false,
    force: options.force ?? false,
    ...(options.hint ? { hint: options.hint } : {}),
    ...(model ? { model } : {}),
    ...(focus ? { focus } : {}),
  };
  await db.insert(jobs).values({
    id: jobId,
    type: GENERATE_JOB,
    subjectId: session.subjectId,
    status: 'queued',
    input: data,
  });
  try {
    await queue.add(GENERATE_JOB, data, { jobId });
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
  return jobId;
}

function blockIndexOf(job: { input: unknown }): number {
  return Number((job.input as { blockIndex?: number } | null)?.blockIndex ?? 0);
}

/** True when a later job for the same block exists (the failure was retried). */
function hasNewerJob(recent: (typeof jobs.$inferSelect)[], job: typeof jobs.$inferSelect): boolean {
  return recent.some(
    (j) => j.id !== job.id && j.createdAt > job.createdAt && blockIndexOf(j) === blockIndexOf(job),
  );
}

/** The blocks generated so far, the last generation job (for "in preparazione" / the error) and what the lesson cost. */
export async function getLesson(db: AnyDb, slug: string, sessionId: string): Promise<LessonDto> {
  const session = await requireSession(db, slug, sessionId);
  const rows: LessonBlock[] = await db
    .select()
    .from(lessonBlocks)
    .where(eq(lessonBlocks.sessionId, session.id))
    .orderBy(asc(lessonBlocks.orderIndex));
  const names = await documentNames(db, rows);

  const recent: (typeof jobs.$inferSelect)[] = await db
    .select()
    .from(jobs)
    .where(and(eq(jobs.type, GENERATE_JOB), sql`${jobs.input}->>'sessionId' = ${session.id}`))
    .orderBy(desc(jobs.createdAt));
  const existing = new Set(rows.map((r) => r.orderIndex));
  // A failed job for a block that still does not exist (and was not retried) matters more than
  // the latest success.
  const last =
    recent.find(
      (j) => j.status === 'failed' && !existing.has(blockIndexOf(j)) && !hasNewerJob(recent, j),
    ) ?? recent[0];
  const [cost] = await db
    .select({ eur: sql<number>`coalesce(sum((${jobs.cost}->>'eur')::float8), 0)` })
    .from(jobs)
    .where(
      and(
        inArray(jobs.type, [GENERATE_JOB, GRADE_JOB]),
        eq(jobs.status, 'succeeded'),
        sql`${jobs.input}->>'sessionId' = ${session.id}`,
      ),
    );

  return {
    blocks: rows.map((r) => toBlockDto(r, names)),
    blockCount: session.blockCount ?? null,
    job: last
      ? {
          id: last.id,
          blockIndex: blockIndexOf(last),
          status: last.status,
          error: (last.error as { message?: string } | null)?.message ?? null,
        }
      : null,
    costEur: Number(cost?.eur ?? 0),
  };
}

/** Queues block 0 if the lesson has none yet and nothing is in flight (idempotent). */
export async function startLesson(
  db: AnyDb,
  queue: Pick<Queue, 'add'>,
  slug: string,
  sessionId: string,
  request: { model?: string | undefined; force?: boolean | undefined } = {},
): Promise<{ jobId: string | null }> {
  const session = await requireSession(db, slug, sessionId);
  if (session.status === 'ended') throw new ConflictError('La sessione è già terminata.');
  if (session.kind !== 'lesson') throw new ConflictError('Solo una lezione ha dei blocchi.');
  if (session.method === 'sprint' && session.phase !== 'understand') {
    throw new ConflictError('In una lezione sprint la teoria si genera dagli esercizi.');
  }
  if (session.documentIds.length === 0) {
    throw new ConflictError(
      'La sessione non ha documenti: scegli un argomento o collega i documenti agli argomenti.',
    );
  }
  const jobId = await enqueueBlock(db, queue, session, 0, {
    model: request.model,
    force: request.force ?? false,
  });
  return { jobId };
}

async function loadBlock(db: AnyDb, sessionId: string, blockIndex: number): Promise<LessonBlock> {
  const [row] = await db
    .select()
    .from(lessonBlocks)
    .where(and(eq(lessonBlocks.sessionId, sessionId), eq(lessonBlocks.orderIndex, blockIndex)));
  if (!row) throw new NotFoundError('Blocco');
  return row as LessonBlock;
}

/**
 * Answers the check question of block `n` (one sentence). Graded against the stored expected
 * answer with the same grader as the session exercises; whatever the verdict, the block is done
 * and the next one opens. The one after it is queued so it is ready by the time it is needed.
 */
export async function checkLessonBlock(
  db: AnyDb,
  provider: AiProvider,
  queue: Pick<Queue, 'add'>,
  slug: string,
  sessionId: string,
  blockIndex: number,
  request: CheckLessonBlockRequest,
  options: { model?: string | undefined } = {},
): Promise<CheckLessonBlockResponse> {
  const session = await requireSession(db, slug, sessionId);
  if (session.status === 'ended') throw new ConflictError('La sessione è già terminata.');
  const block = await loadBlock(db, session.id, blockIndex);
  if (block.state === 'locked') {
    throw new ConflictError('Rispondi prima alla domanda del blocco precedente.');
  }
  if (block.state === 'done') throw new ConflictError('Hai già risposto a questo blocco.');
  if (!block.checkQuestion || !block.checkAnswer) {
    throw new ConflictError('Questo blocco non ha una domanda di controllo.');
  }

  // Claim the block first: a double submit loses here and is never graded twice.
  const [claimed] = await db
    .update(lessonBlocks)
    .set({ state: 'done', studentAnswer: request.answer, updatedAt: new Date() })
    .where(and(eq(lessonBlocks.id, block.id), eq(lessonBlocks.state, 'open')))
    .returning();
  if (!claimed) throw new ConflictError('Hai già risposto a questo blocco.');

  const citation = block.citations[0] ?? {
    docId: session.documentIds[0] ?? '',
    page: 1,
    quote: '',
  };
  const model = options.model ?? resolveModel(LESSON_CHECK_DEFAULT_MODEL);
  let result: Awaited<ReturnType<AiProvider['gradeAnswer']>>;
  try {
    result = await provider.gradeAnswer(
      {
        item: {
          prompt: block.checkQuestion,
          kind: 'open',
          points: 1,
          expectedPoints: [block.checkAnswer],
          rubric: [{ criterion: 'Risposta corretta e completa', points: 1 }],
          solution: block.checkAnswer,
          sourceRef: citation,
          topicName: null,
        },
        answer: request.answer,
      },
      model,
    );
  } catch (err) {
    // Grading failed: give the block back so the student can try again.
    await db
      .update(lessonBlocks)
      .set({ state: 'open', studentAnswer: block.studentAnswer, updatedAt: new Date() })
      .where(eq(lessonBlocks.id, block.id));
    throw err;
  }
  const score = Math.min(1, Math.max(0, result.data.criteria[0]?.awarded ?? 0));
  const verdict = verdictForScore(score);
  const feedback = result.data.criteria[0]?.feedback ?? 'Nessun feedback dal correttore.';
  const updated = claimed as LessonBlock;

  await db.insert(jobs).values({
    id: randomUUID(),
    type: GRADE_JOB,
    subjectId: session.subjectId,
    status: 'succeeded',
    input: { sessionId: session.id, blockId: block.id },
    cost: {
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      eur: estimateCostEur(result.model, result.usage.inputTokens, result.usage.outputTokens),
    },
    progressPct: 100,
    finishedAt: new Date(),
  });

  // Whatever the verdict, the next block opens.
  let next: LessonBlock | null = null;
  const [nextRow] = await db
    .select()
    .from(lessonBlocks)
    .where(
      and(eq(lessonBlocks.sessionId, session.id), eq(lessonBlocks.orderIndex, blockIndex + 1)),
    );
  if (nextRow) {
    if (nextRow.state === 'locked') {
      const [opened] = await db
        .update(lessonBlocks)
        .set({ state: 'open', updatedAt: new Date() })
        .where(eq(lessonBlocks.id, nextRow.id))
        .returning();
      next = opened as LessonBlock;
    } else {
      next = nextRow as LessonBlock;
    }
  }

  // Keep one block ahead: the next (if its job never ran) and the one after it.
  const total = session.blockCount;
  if (total !== null) {
    for (const index of [blockIndex + 1, blockIndex + 2]) {
      if (index < total) await enqueueBlock(db, queue, session, index);
    }
    await db
      .update(studySessions)
      .set({ blockIndex: Math.min(blockIndex + 1, total - 1) })
      .where(eq(studySessions.id, session.id));
  }

  const names = await documentNames(db, [updated, ...(next ? [next] : [])]);
  return {
    block: toBlockDto(updated as LessonBlock, names),
    verdict,
    feedback,
    nextBlock: next ? toBlockDto(next, names) : null,
  };
}

/** "Rispiegamelo in un altro modo": the block stays as it is until the new one replaces it (same id and index). */
export async function regenerateLessonBlock(
  db: AnyDb,
  queue: Pick<Queue, 'add'>,
  slug: string,
  sessionId: string,
  blockIndex: number,
  request: RegenerateLessonBlockRequest,
): Promise<{ jobId: string }> {
  const session = await requireSession(db, slug, sessionId);
  if (session.status === 'ended') throw new ConflictError('La sessione è già terminata.');
  const [block] = await db
    .select()
    .from(lessonBlocks)
    .where(and(eq(lessonBlocks.sessionId, session.id), eq(lessonBlocks.orderIndex, blockIndex)));
  let jobId: string | null;
  if (block) {
    if (block.state === 'locked') throw new ConflictError('Questo blocco non è ancora aperto.');
    if (block.state === 'done') throw new ConflictError('Hai già risposto a questo blocco.');
    jobId = await enqueueBlock(db, queue, session, blockIndex, {
      regenerate: true,
      ...(request.hint ? { hint: request.hint } : {}),
      model: request.model,
    });
  } else {
    // The block was never created (its job failed): retry a plain generation, once it is its turn.
    if (session.blockCount !== null && blockIndex >= session.blockCount) {
      throw new NotFoundError('Blocco');
    }
    if (blockIndex > 0) {
      const [previous] = await db
        .select({ state: lessonBlocks.state })
        .from(lessonBlocks)
        .where(
          and(eq(lessonBlocks.sessionId, session.id), eq(lessonBlocks.orderIndex, blockIndex - 1)),
        );
      if (!previous) throw new NotFoundError('Blocco');
      if (previous.state !== 'done') {
        throw new ConflictError('Rispondi prima alla domanda del blocco precedente.');
      }
    }
    jobId = await enqueueBlock(db, queue, session, blockIndex, { model: request.model });
  }
  if (!jobId) throw new ConflictError('Una generazione di questo blocco è già in corso.');
  return { jobId };
}
