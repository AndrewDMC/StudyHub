import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import {
  documents,
  jobs,
  lessonBlocks,
  sessionItems,
  studySessions,
  subjects,
  type SessionItem,
  type StudySession,
} from '@studyhub/db';
import {
  normalizeConcept,
  type SprintConceptDto,
  type SprintDto,
  type SprintExerciseDto,
  type SprintTheoryState,
  type StartSprintRequest,
  type StartSprintTheoryRequest,
  type StartSprintTheoryResponse,
} from '@studyhub/contracts';
import type { Queue } from 'bullmq';
import { SubjectNotFoundError } from './errors';
import { ConflictError, NotFoundError } from './examPrep';
import { toItemDto } from './sessionBriefing';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = any;

const EXERCISES_JOB = 'generate_sprint_exercises';
const BLOCK_JOB = 'generate_lesson_block';
/** Same ledger type the exercise correction uses, so check and correction costs show up in /admin. */
const COST_JOB_TYPES = [EXERCISES_JOB, BLOCK_JOB, 'session_grade'];

async function requireSprintSession(
  db: AnyDb,
  slug: string,
  sessionId: string,
): Promise<StudySession> {
  const [subject] = await db.select().from(subjects).where(eq(subjects.slug, slug));
  if (!subject) throw new SubjectNotFoundError(slug);
  const [row] = await db
    .select()
    .from(studySessions)
    .where(and(eq(studySessions.id, sessionId), eq(studySessions.subjectId, subject.id)));
  if (!row) throw new NotFoundError('Sessione');
  const session = row as StudySession;
  // A sprint started before the sprint phases existed is still the plain guided lesson.
  if (session.method !== 'sprint' || session.phase === 'understand') {
    throw new ConflictError('Questa non è una lezione sprint.');
  }
  return session;
}

interface FocusJob {
  id: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
  blockIndex: number;
  concept: string;
  error: string | null;
  createdAt: Date;
  model: string | undefined;
}

/** Every block-generation job of the session that carries a sprint focus, newest first. */
async function focusJobs(db: AnyDb, sessionId: string): Promise<FocusJob[]> {
  const rows: (typeof jobs.$inferSelect)[] = await db
    .select()
    .from(jobs)
    .where(
      and(
        eq(jobs.type, BLOCK_JOB),
        sql`${jobs.input}->>'sessionId' = ${sessionId}`,
        sql`${jobs.input}->'focus' is not null`,
      ),
    )
    .orderBy(desc(jobs.createdAt));
  return rows.map((r) => {
    const input = (r.input ?? {}) as {
      blockIndex?: number;
      focus?: { concept?: string };
      model?: string;
    };
    return {
      id: r.id,
      status: r.status,
      blockIndex: Number(input.blockIndex ?? 0),
      concept: input.focus?.concept ?? '',
      error: (r.error as { message?: string } | null)?.message ?? null,
      createdAt: r.createdAt,
      model: input.model,
    };
  });
}

/** The exercises the theory is for: marked wrong or "non so", in order. */
function failedExercises(exercises: SessionItem[]): SessionItem[] {
  return exercises.filter((e) => e.state === 'wrong' || e.state === 'unknown');
}

/** Concepts of the failed exercises: deduplicated by normalised title, in the order of the exercises. */
function neededConcepts(
  exercises: SessionItem[],
): { key: string; title: string; exerciseIds: string[]; firstExercise: string }[] {
  const out = new Map<
    string,
    { key: string; title: string; exerciseIds: string[]; firstExercise: string }
  >();
  for (const e of failedExercises(exercises)) {
    for (const title of e.concepts) {
      const key = normalizeConcept(title);
      if (key === '') continue;
      const known = out.get(key);
      if (known) {
        if (!known.exerciseIds.includes(e.id)) known.exerciseIds.push(e.id);
      } else {
        out.set(key, { key, title, exerciseIds: [e.id], firstExercise: e.title });
      }
    }
  }
  return [...out.values()];
}

/**
 * The whole state of a sprint lesson: exercises (solution hidden until self-assessed or asked for),
 * the retries to do, the theory concepts of the exercises marked wrong, the generation job and the
 * cost. The theory blocks themselves come from `getLesson` (same table as the guided lesson).
 */
export async function getSprint(db: AnyDb, slug: string, sessionId: string): Promise<SprintDto> {
  const session = await requireSprintSession(db, slug, sessionId);
  const rows: SessionItem[] = await db
    .select()
    .from(sessionItems)
    .where(
      and(
        eq(sessionItems.sessionId, session.id),
        inArray(sessionItems.kind, ['exercise', 'retry_exercise']),
      ),
    )
    .orderBy(asc(sessionItems.orderIndex));
  const exercises = rows.filter((r) => r.kind === 'exercise');
  const retries = rows.filter((r) => r.kind === 'retry_exercise');

  const docIds = [...new Set(rows.flatMap((r) => r.citations.map((c) => c.docId)))];
  const docRows: { id: string; originalName: string }[] = docIds.length
    ? await db
        .select({ id: documents.id, originalName: documents.originalName })
        .from(documents)
        .where(inArray(documents.id, docIds))
    : [];
  const names = new Map(docRows.map((d) => [d.id, d.originalName]));

  const retryOf = new Map(retries.map((r) => [r.parentItemId, r]));
  const failed = failedExercises(exercises);
  const shownRetries =
    failed.length > 0
      ? failed.flatMap((e) => (retryOf.get(e.id) ? [retryOf.get(e.id)!] : []))
      : retries.slice(0, 1);

  const theory = await theoryState(db, session, exercises);

  const [job] = session.briefingJobId
    ? await db.select().from(jobs).where(eq(jobs.id, session.briefingJobId))
    : [];
  const [cost] = await db
    .select({ eur: sql<number>`coalesce(sum((${jobs.cost}->>'eur')::float8), 0)` })
    .from(jobs)
    .where(
      and(
        inArray(jobs.type, COST_JOB_TYPES),
        eq(jobs.status, 'succeeded'),
        sql`${jobs.input}->>'sessionId' = ${session.id}`,
      ),
    );

  return {
    exercises: exercises.map((e): SprintExerciseDto => ({
      ...toItemDto(e, names),
      retryId: retryOf.get(e.id)?.id ?? null,
    })),
    retries: shownRetries.map((r) => toItemDto(r, names)),
    theory,
    job: session.briefingJobId
      ? {
          id: session.briefingJobId,
          // No row yet = still waiting in the queue: the worker creates it when it picks the job up.
          status: job?.status ?? 'queued',
          error: (job?.error as { message?: string } | null)?.message ?? null,
        }
      : null,
    costEur: Number(cost?.eur ?? 0),
  };
}

async function theoryState(
  db: AnyDb,
  session: StudySession,
  exercises: SessionItem[],
): Promise<SprintDto['theory']> {
  const needed = neededConcepts(exercises);
  const blocks: { id: string; orderIndex: number; concept: string | null }[] = await db
    .select({
      id: lessonBlocks.id,
      orderIndex: lessonBlocks.orderIndex,
      concept: lessonBlocks.concept,
    })
    .from(lessonBlocks)
    .where(eq(lessonBlocks.sessionId, session.id));
  const blockOfConcept = new Map(
    blocks.flatMap((b) => (b.concept ? [[b.concept, b.id] as const] : [])),
  );
  const concepts: SprintConceptDto[] = needed.map((c) => ({
    title: c.title,
    exerciseIds: c.exerciseIds,
    blockId: blockOfConcept.get(c.key) ?? null,
  }));

  let state: SprintTheoryState;
  let error: string | null = null;
  if (exercises.length > 0 && exercises.every((e) => e.state === 'correct')) {
    state = 'empty';
  } else if (concepts.length === 0) {
    state = 'idle';
  } else if (concepts.every((c) => c.blockId !== null)) {
    state = 'ready';
  } else {
    const existing = new Set(blocks.map((b) => b.orderIndex));
    const missing = new Set(needed.filter((n) => !blockOfConcept.has(n.key)).map((n) => n.key));
    const recent = (await focusJobs(db, session.id)).filter(
      (j) => !existing.has(j.blockIndex) && missing.has(normalizeConcept(j.concept)),
    );
    // The newest job of each block index decides: a failure that was retried does not count.
    const latestPerIndex = new Map<number, FocusJob>();
    for (const j of recent)
      if (!latestPerIndex.has(j.blockIndex)) latestPerIndex.set(j.blockIndex, j);
    const latest = [...latestPerIndex.values()];
    if (latest.some((j) => j.status === 'queued' || j.status === 'running')) {
      state = 'generating';
    } else {
      const failedJob = latest.find((j) => j.status === 'failed');
      if (failedJob) {
        state = 'failed';
        error = failedJob.error;
      } else {
        state = 'idle';
      }
    }
  }
  return { state, concepts, error };
}

/** Records a `queued` job row first (so the page sees "in preparazione" at once) and then queues it. */
async function enqueueJob(
  db: AnyDb,
  queue: Pick<Queue, 'add'>,
  session: StudySession,
  type: string,
  data: Record<string, unknown>,
  jobId: string = randomUUID(),
): Promise<string> {
  await db.insert(jobs).values({
    id: jobId,
    type,
    subjectId: session.subjectId,
    status: 'queued',
    input: data,
  });
  try {
    await queue.add(type, data, { jobId });
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

/** Whether the job recorded as the session's latest preparation is still queued or running. */
async function activeJobId(db: AnyDb, jobId: string | null): Promise<string | null> {
  if (!jobId) return null;
  const [row] = await db.select({ status: jobs.status }).from(jobs).where(eq(jobs.id, jobId));
  // No row yet = still waiting in the queue.
  if (!row || row.status === 'queued' || row.status === 'running') return jobId;
  return null;
}

/**
 * Generates the exercises of a sprint lesson (one job, one cost). Idempotent: when they exist, or a
 * generation is already on its way, nothing new is queued (`jobId` is the running job, or `null`).
 * The session row is claimed with a compare-and-swap on its latest job id, so two concurrent
 * requests cannot both queue one.
 */
export async function startSprint(
  db: AnyDb,
  queue: Pick<Queue, 'add'>,
  slug: string,
  sessionId: string,
  request: StartSprintRequest,
): Promise<{ jobId: string | null }> {
  const session = await requireSprintSession(db, slug, sessionId);
  if (session.status === 'ended') throw new ConflictError('La sessione è già terminata.');
  if (session.documentIds.length === 0) {
    throw new ConflictError(
      'La sessione non ha documenti: scegli un argomento o collega i documenti agli argomenti.',
    );
  }

  const [existing] = await db
    .select({ id: sessionItems.id })
    .from(sessionItems)
    .where(and(eq(sessionItems.sessionId, session.id), eq(sessionItems.kind, 'exercise')))
    .limit(1);
  if (existing) return { jobId: null };

  const running = await activeJobId(db, session.briefingJobId);
  if (running) return { jobId: running };

  const jobId = randomUUID();
  const claimed = await db
    .update(studySessions)
    .set({ briefingJobId: jobId })
    .where(
      and(
        eq(studySessions.id, session.id),
        sql`${studySessions.briefingJobId} is not distinct from ${session.briefingJobId}`,
      ),
    )
    .returning({ id: studySessions.id });
  if (claimed.length === 0) {
    // Someone else queued it between our read and the claim.
    const [fresh] = await db
      .select({ briefingJobId: studySessions.briefingJobId })
      .from(studySessions)
      .where(eq(studySessions.id, session.id));
    return { jobId: fresh?.briefingJobId ?? null };
  }

  await enqueueJob(
    db,
    queue,
    session,
    EXERCISES_JOB,
    {
      subjectId: session.subjectId,
      sessionId: session.id,
      force: request.force,
      ...(request.model ? { model: request.model } : {}),
    },
    jobId,
  );
  return { jobId };
}

/**
 * "Teoria": queues the blocks of the concepts of the exercises marked wrong or "non so". Concepts
 * are deduplicated by normalised title and each gets a block index (the first free ones, appended
 * after the blocks that exist); `generate_lesson_block` runs with a `focus`. Idempotent: a concept
 * that already has a block, or a job on its way, is left alone, and the exercises' `linkedBlockIds`
 * are brought up to date with the blocks that exist. The worker links the blocks it creates.
 */
export async function startSprintTheory(
  db: AnyDb,
  queue: Pick<Queue, 'add'>,
  slug: string,
  sessionId: string,
  request: StartSprintTheoryRequest,
): Promise<StartSprintTheoryResponse> {
  const session = await requireSprintSession(db, slug, sessionId);
  if (session.status === 'ended') throw new ConflictError('La sessione è già terminata.');

  const exercises: SessionItem[] = await db
    .select()
    .from(sessionItems)
    .where(and(eq(sessionItems.sessionId, session.id), eq(sessionItems.kind, 'exercise')))
    .orderBy(asc(sessionItems.orderIndex));
  if (exercises.length === 0) throw new ConflictError('Genera prima gli esercizi.');

  const needed = neededConcepts(exercises);
  const blocks: { id: string; orderIndex: number; concept: string | null }[] = await db
    .select({
      id: lessonBlocks.id,
      orderIndex: lessonBlocks.orderIndex,
      concept: lessonBlocks.concept,
    })
    .from(lessonBlocks)
    .where(eq(lessonBlocks.sessionId, session.id));
  const blockOfConcept = new Map(
    blocks.flatMap((b) => (b.concept ? [[b.concept, b] as const] : [])),
  );
  const existingIndexes = new Set(blocks.map((b) => b.orderIndex));

  // Where each concept already lives: in a block, or in the newest job queued for it.
  const recent = await focusJobs(db, session.id);
  const indexOfConcept = new Map<string, number>();
  for (const b of blocks) if (b.concept) indexOfConcept.set(b.concept, b.orderIndex);
  const latestPerIndex = new Map<number, FocusJob>();
  for (const j of recent)
    if (!latestPerIndex.has(j.blockIndex)) latestPerIndex.set(j.blockIndex, j);
  for (const j of latestPerIndex.values()) {
    const key = normalizeConcept(j.concept);
    if (key !== '' && !indexOfConcept.has(key)) indexOfConcept.set(key, j.blockIndex);
  }

  const knownMax = Math.max(-1, ...indexOfConcept.values(), ...existingIndexes);
  const base = Math.max(session.blockCount ?? 0, knownMax + 1);
  const fresh = needed.filter((c) => !indexOfConcept.has(c.key));
  fresh.forEach((c, i) => indexOfConcept.set(c.key, base + i));

  let blockCount = session.blockCount ?? 0;
  if (fresh.length > 0) {
    // Claim the new indexes: a concurrent request that read the same count loses and does nothing.
    const claimed = await db
      .update(studySessions)
      .set({ blockCount: base + fresh.length })
      .where(
        and(
          eq(studySessions.id, session.id),
          sql`${studySessions.blockCount} is not distinct from ${session.blockCount}`,
        ),
      )
      .returning({ id: studySessions.id });
    if (claimed.length === 0) {
      const [now] = await db
        .select({ blockCount: studySessions.blockCount })
        .from(studySessions)
        .where(eq(studySessions.id, session.id));
      return { jobIds: [], blockCount: now?.blockCount ?? 0 };
    }
    blockCount = base + fresh.length;
  }

  const model = request.model ?? recent.find((j) => j.model !== undefined)?.model ?? undefined;
  const jobIds: string[] = [];
  for (const c of needed) {
    const index = indexOfConcept.get(c.key)!;
    if (blockOfConcept.has(c.key) || existingIndexes.has(index)) continue;
    const latest = latestPerIndex.get(index);
    // A job on its way is enough; a failed or cancelled one is tried again.
    if (latest && (latest.status === 'queued' || latest.status === 'running')) continue;
    if (latest) {
      // Claim the retry: of two concurrent requests only the one that marks the dead job as
      // retried queues the new one.
      const claimed = await db
        .update(jobs)
        .set({ input: sql`${jobs.input} || '{"retried": true}'::jsonb` })
        .where(
          and(
            eq(jobs.id, latest.id),
            inArray(jobs.status, ['failed', 'cancelled']),
            sql`not (${jobs.input} ? 'retried')`,
          ),
        )
        .returning({ id: jobs.id });
      if (claimed.length === 0) continue;
    }
    jobIds.push(
      await enqueueJob(db, queue, session, BLOCK_JOB, {
        subjectId: session.subjectId,
        sessionId: session.id,
        blockIndex: index,
        regenerate: false,
        force: request.force,
        focus: { concept: c.title, exercise: c.firstExercise },
        ...(model ? { model } : {}),
      }),
    );
  }

  // Exercises whose concepts already have a block point at it (the worker links the new ones).
  for (const e of failedExercises(exercises)) {
    const linked = new Set(e.linkedBlockIds);
    for (const title of e.concepts) {
      const block = blockOfConcept.get(normalizeConcept(title));
      if (block) linked.add(block.id);
    }
    if (linked.size !== e.linkedBlockIds.length) {
      await db
        .update(sessionItems)
        .set({ linkedBlockIds: [...linked] })
        .where(eq(sessionItems.id, e.id));
    }
  }

  return { jobIds, blockCount };
}
