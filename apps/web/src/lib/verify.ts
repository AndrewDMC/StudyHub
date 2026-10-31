import { randomUUID } from 'node:crypto';
import { and, asc, eq, gt, inArray, ne, sql } from 'drizzle-orm';
import {
  documents,
  jobs,
  lessonBlocks,
  sessionItems,
  studySessions,
  subjects,
  tasks,
  topics,
  type LessonBlock,
  type NewSessionItem,
  type SessionItem,
  type StudySession,
} from '@studyhub/db';
import {
  VERIFY_MIN_ORIGIN_ITEMS,
  VERIFY_TARGET_ITEMS,
  selectVerifyItems,
  verifyVerdict,
  type VerifyCandidate,
} from '@studyhub/core';
import type {
  StartVerifyRequest,
  VerifyItemDto,
  VerifyKeyPointDto,
  VerifyStateDto,
  VerifySummaryDto,
} from '@studyhub/contracts';
import type { Queue } from 'bullmq';
import { SubjectNotFoundError } from './errors';
import { ConflictError, NotFoundError } from './examPrep';
import { lessonReference } from './sessionBriefing';
import { recomputeVerifyMastery, verifyTopicIdOf } from './verifyMastery';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = any;
type TaskRow = typeof tasks.$inferSelect;

const VERIFY_ITEM_KINDS = ['exercise', 'retry_exercise', 'guide_question'] as const;
type VerifyItemKind = (typeof VERIFY_ITEM_KINDS)[number];
const isVerifyKind = (k: string): k is VerifyItemKind =>
  (VERIFY_ITEM_KINDS as readonly string[]).includes(k);

const GENERATION_JOB = 'prepare_session';
/** Without a recorded job, a preparation this old surely finished copying: generation may be asked again. */
const RETRY_AFTER_MS = 30_000;

async function requireVerifySession(
  db: AnyDb,
  slug: string,
  sessionId: string,
): Promise<{ session: StudySession; subject: typeof subjects.$inferSelect }> {
  const [subject] = await db.select().from(subjects).where(eq(subjects.slug, slug));
  if (!subject) throw new SubjectNotFoundError(slug);
  const [row] = await db
    .select()
    .from(studySessions)
    .where(and(eq(studySessions.id, sessionId), eq(studySessions.subjectId, subject.id)));
  if (!row) throw new NotFoundError('Sessione');
  if (row.kind !== 'verify') throw new ConflictError('Questa non è una verifica.');
  return { session: row as StudySession, subject };
}

async function loadTask(db: AnyDb, taskId: string | null): Promise<TaskRow | null> {
  if (!taskId) return null;
  const [row] = await db.select().from(tasks).where(eq(tasks.id, taskId));
  return (row ?? null) as TaskRow | null;
}

// ---------------------------------------------------------------------------------------------
// Preparation: pick the questions from the lessons of the topic, copy them, generate what is missing
// ---------------------------------------------------------------------------------------------

/** Whether the job recorded as the session's latest preparation is still queued or running. */
async function activeJobId(db: AnyDb, jobId: string | null): Promise<string | null> {
  if (!jobId) return null;
  const [row] = await db.select({ status: jobs.status }).from(jobs).where(eq(jobs.id, jobId));
  // No row yet = still waiting in the queue.
  if (!row || row.status === 'queued' || row.status === 'running') return jobId;
  return null;
}

/** Records a `queued` row first (so the page sees "in preparazione" at once), then queues; a failed `add` marks the row `failed`. */
async function enqueueJob(
  db: AnyDb,
  queue: Pick<Queue, 'add'>,
  data: Record<string, unknown>,
  jobId: string,
): Promise<void> {
  try {
    await queue.add(GENERATION_JOB, data, { jobId });
  } catch (err) {
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
}

/**
 * Queues the generation of the questions a verification lacks (`prepare_session`, mode exercises, same
 * budget and cost as a briefing). Idempotent: nothing when enough questions exist, a job is on its
 * way or the session has no documents; the session row is claimed with a compare-and-swap on its
 * latest job id so two concurrent requests cannot both queue one.
 */
async function queueGeneration(
  db: AnyDb,
  queue: Pick<Queue, 'add'>,
  session: StudySession,
  request: Pick<StartVerifyRequest, 'force' | 'model'>,
): Promise<string | null> {
  const [counted] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(sessionItems)
    .where(
      and(
        eq(sessionItems.sessionId, session.id),
        inArray(sessionItems.kind, [...VERIFY_ITEM_KINDS]),
      ),
    );
  const n = Number(counted?.n ?? 0);
  if (n >= VERIFY_MIN_ORIGIN_ITEMS) return null;
  if (session.documentIds.length === 0) return null;

  const [fresh] = await db
    .select({ briefingJobId: studySessions.briefingJobId })
    .from(studySessions)
    .where(eq(studySessions.id, session.id));
  const current: string | null = fresh?.briefingJobId ?? null;
  const running = await activeJobId(db, current);
  if (running) return running;

  const jobId = randomUUID();
  const data = {
    subjectId: session.subjectId,
    sessionId: session.id,
    mode: 'exercises',
    force: request.force,
    exerciseCount: VERIFY_TARGET_ITEMS - n,
    ...(request.model ? { model: request.model } : {}),
  };
  // The row exists before the session points to it: a failed insert claims nothing.
  await db.insert(jobs).values({
    id: jobId,
    type: GENERATION_JOB,
    subjectId: session.subjectId,
    status: 'queued',
    input: data,
  });
  const claimed = await db
    .update(studySessions)
    .set({ briefingJobId: jobId })
    .where(
      and(
        eq(studySessions.id, session.id),
        sql`${studySessions.briefingJobId} is not distinct from ${current}`,
      ),
    )
    .returning({ id: studySessions.id });
  if (claimed.length === 0) {
    // Lost the race: the row was never queued.
    await db.delete(jobs).where(eq(jobs.id, jobId));
    const [now] = await db
      .select({ briefingJobId: studySessions.briefingJobId })
      .from(studySessions)
      .where(eq(studySessions.id, session.id));
    return now?.briefingJobId ?? null;
  }
  await enqueueJob(db, queue, data, jobId);
  return jobId;
}

interface Pool {
  candidate: VerifyCandidate;
  item: SessionItem;
  /** The lesson (or verification) session the item lives in. */
  origin: StudySession;
}

/** The items of the lessons (and of earlier verifications) of the topic, ranked to pick from. */
async function loadPool(
  db: AnyDb,
  session: StudySession,
  topicId: string,
): Promise<{ pool: Pool[]; blocksBySession: Map<string, LessonBlock[]> }> {
  const all: StudySession[] = await db
    .select()
    .from(studySessions)
    .where(and(eq(studySessions.subjectId, session.subjectId), ne(studySessions.id, session.id)));
  const taskIds = all.flatMap((s) => (s.taskId ? [s.taskId] : []));
  const taskRows: { id: string; topicId: string | null }[] = taskIds.length
    ? await db
        .select({ id: tasks.id, topicId: tasks.topicId })
        .from(tasks)
        .where(inArray(tasks.id, taskIds))
    : [];
  const taskTopic = new Map(taskRows.map((t) => [t.id, t.topicId]));
  // A session is about the topic through its task; without a task, through its scope.
  const onTopicViaTask = (s: StudySession) =>
    s.taskId ? taskTopic.get(s.taskId) === topicId : s.topicIds.includes(topicId);
  const relevant = all.filter(
    (s) =>
      (s.kind === 'lesson' || (s.kind === 'verify' && s.verifyPreparedAt !== null)) &&
      (onTopicViaTask(s) || (!s.taskId && s.topicIds.includes(topicId))),
  );
  if (relevant.length === 0) return { pool: [], blocksBySession: new Map() };
  const byId = new Map(relevant.map((s) => [s.id, s]));

  const items: SessionItem[] = await db
    .select()
    .from(sessionItems)
    .where(
      and(
        inArray(sessionItems.sessionId, [...byId.keys()]),
        inArray(sessionItems.kind, [...VERIFY_ITEM_KINDS]),
      ),
    );
  const lessonIds = relevant.filter((s) => s.kind === 'lesson').map((s) => s.id);
  const blocks: LessonBlock[] = lessonIds.length
    ? await db
        .select()
        .from(lessonBlocks)
        .where(inArray(lessonBlocks.sessionId, lessonIds))
        .orderBy(asc(lessonBlocks.orderIndex))
    : [];
  const blocksBySession = new Map<string, LessonBlock[]>();
  for (const b of blocks) {
    const list = blocksBySession.get(b.sessionId) ?? [];
    list.push(b);
    blocksBySession.set(b.sessionId, list);
  }

  // Every appearance of an item in a verification: the copies, and the item itself when it was born there.
  const attemptsOf = new Map<string, { state: SessionItem['state']; at: number }[]>();
  for (const it of items) {
    const origin = byId.get(it.sessionId)!;
    if (origin.kind !== 'verify') continue;
    const key = it.parentItemId ?? it.id;
    const list = attemptsOf.get(key) ?? [];
    list.push({ state: it.state, at: origin.startedAt.getTime() });
    attemptsOf.set(key, list);
  }

  const pool: Pool[] = [];
  for (const it of items) {
    const origin = byId.get(it.sessionId)!;
    // A copy is an attempt of its origin, not a source of its own.
    if (origin.kind === 'verify' && it.parentItemId !== null) continue;
    // Only questions on this topic: an item of another topic (or one of a session spanning several) stays out.
    if (it.topicId !== topicId && !(it.topicId === null && onTopicViaTask(origin))) continue;
    const eligible =
      it.kind === 'guide_question'
        ? it.body.trim() !== '' ||
          it.linkedBlockIds.length > 0 ||
          (blocksBySession.get(origin.id)?.length ?? 0) > 0
        : it.body.trim() !== '';
    if (!eligible) continue;
    const attempts = attemptsOf.get(it.id) ?? [];
    const concluded = attempts
      .filter((a) => a.state === 'correct' || a.state === 'wrong' || a.state === 'unknown')
      .sort((a, b) => b.at - a.at);
    const failed =
      concluded.length > 0
        ? concluded[0]!.state !== 'correct'
        : origin.kind === 'lesson' && (it.state === 'wrong' || it.state === 'unknown');
    pool.push({
      item: it,
      origin,
      candidate: {
        id: it.id,
        parentItemId: it.parentItemId,
        failed,
        lastUsedAt: attempts.length > 0 ? Math.max(...attempts.map((a) => a.at)) : null,
        originAt: origin.startedAt.getTime(),
        orderIndex: it.orderIndex,
      },
    });
  }
  return { pool, blocksBySession };
}

/** The lesson blocks a copied question points to: its own, else those citing the same page, else the first. */
function linkedBlocksFor(item: SessionItem, blocks: LessonBlock[]): LessonBlock[] {
  if (item.linkedBlockIds.length > 0) {
    const linked = blocks.filter((b) => item.linkedBlockIds.includes(b.id));
    if (linked.length > 0) return linked;
  }
  const cited = blocks.filter((b) =>
    b.citations.some((bc) =>
      item.citations.some((ic) => ic.docId === bc.docId && ic.page === bc.page),
    ),
  );
  if (cited.length > 0) return cited;
  return blocks.slice(0, 1);
}

async function copyItems(db: AnyDb, session: StudySession, topicId: string): Promise<number> {
  const { pool, blocksBySession } = await loadPool(db, session, topicId);
  const picked = selectVerifyItems(
    pool.map((p) => p.candidate),
    VERIFY_TARGET_ITEMS,
  );
  const poolById = new Map(pool.map((p) => [p.candidate.id, p]));
  const rows: NewSessionItem[] = picked.map((c, i) => {
    const { item, origin } = poolById.get(c.id)!;
    // A question born in an earlier verification has no blocks of its own: it keeps the ones it pointed to.
    const originBlocks = blocksBySession.get(origin.id) ?? [];
    const linkedIds =
      origin.kind === 'lesson'
        ? linkedBlocksFor(item, originBlocks).map((b) => b.id)
        : item.linkedBlockIds;
    const linked = originBlocks.filter((b) => linkedIds.includes(b.id));
    // Self-contained: a guide question has no answer of its own, the lesson it came from is the reference.
    const body = item.body.trim() !== '' ? item.body : lessonReference(linked);
    const citations =
      item.citations.length > 0 ? item.citations : linked.flatMap((b) => b.citations).slice(0, 1);
    return {
      id: randomUUID(),
      sessionId: session.id,
      kind: item.kind,
      orderIndex: i,
      title: item.title,
      body,
      difficulty: item.difficulty,
      citations,
      topicId: item.topicId ?? topicId,
      state: 'open' as const,
      linkedBlockIds: linkedIds,
      concepts: item.concepts,
      solutionSteps: item.solutionSteps,
      parentItemId: item.id,
    };
  });
  if (rows.length > 0) {
    await db.insert(sessionItems).values(rows);
    // The key point cites documents of the lessons: they belong to the verification's scope too.
    const blockIds = new Set(rows.flatMap((r) => r.linkedBlockIds ?? []));
    const cited = [
      ...rows.flatMap((r) => (r.citations ?? []).map((c) => c.docId)),
      ...[...blocksBySession.values()]
        .flat()
        .filter((b) => blockIds.has(b.id))
        .flatMap((b) => b.citations.map((c) => c.docId)),
    ];
    const documentIds = [...new Set([...session.documentIds, ...cited])];
    if (documentIds.length !== session.documentIds.length) {
      await db.update(studySessions).set({ documentIds }).where(eq(studySessions.id, session.id));
      session.documentIds = documentIds;
    }
  }
  return rows.length;
}

/**
 * Prepares a verification: stores the topic's mastery at the start, picks 2-3 questions from the
 * lessons of the topic and copies them in, then queues the generation of new ones if fewer than 2
 * came from the lessons. Synchronous and idempotent: the session row is claimed once
 * (`verify_prepared_at`), so a second call neither copies again nor queues a second job; only a
 * missing generation (failed, never queued) is tried again.
 */
export async function prepareVerifySession(
  db: AnyDb,
  queue: Pick<Queue, 'add'> | undefined,
  session: StudySession,
  options: Partial<Pick<StartVerifyRequest, 'force' | 'model'>> & {
    swallowQueueErrors?: boolean;
    /** `POST .../verify`: also tries a generation that was never queued or that failed. */
    retryGeneration?: boolean;
  } = {},
): Promise<void> {
  const topicId = await verifyTopicIdOf(db, session);
  let masteryBefore: number | null = null;
  if (topicId) {
    const [t] = await db
      .select({ mastery: topics.mastery })
      .from(topics)
      .where(eq(topics.id, topicId));
    masteryBefore = t?.mastery ?? null;
  }

  const claimed = await db
    .update(studySessions)
    .set({ verifyPreparedAt: new Date(), masteryBefore })
    .where(and(eq(studySessions.id, session.id), sql`${studySessions.verifyPreparedAt} is null`))
    .returning({ id: studySessions.id });
  const won = claimed.length > 0;
  if (won && topicId) {
    try {
      await copyItems(db, session, topicId);
    } catch (err) {
      // Release the claim: the questions were not copied.
      await db
        .update(studySessions)
        .set({ verifyPreparedAt: null, masteryBefore: null })
        .where(eq(studySessions.id, session.id));
      throw err;
    }
  }

  if (!queue || session.status === 'ended') return;
  // Only the call that picked the questions generates the missing ones (a concurrent call sees them half copied);
  // an explicit retry may too, once the previous attempt is over.
  if (!won && !(options.retryGeneration && (await generationRetryAllowed(db, session)))) return;
  try {
    await queueGeneration(db, queue, session, {
      force: options.force ?? false,
      ...(options.model ? { model: options.model } : {}),
    });
  } catch (err) {
    // The job row is already `failed`: the page shows it with "Riprova".
    if (!options.swallowQueueErrors) throw err;
  }
}

/** A retry is fine when the last job is over (failed, cancelled, done) or none was ever queued and the preparation is old. */
async function generationRetryAllowed(db: AnyDb, session: StudySession): Promise<boolean> {
  const [fresh] = await db
    .select({
      briefingJobId: studySessions.briefingJobId,
      verifyPreparedAt: studySessions.verifyPreparedAt,
    })
    .from(studySessions)
    .where(eq(studySessions.id, session.id));
  if (!fresh?.verifyPreparedAt) return false;
  if (fresh.briefingJobId) return (await activeJobId(db, fresh.briefingJobId)) === null;
  return Date.now() - fresh.verifyPreparedAt.getTime() > RETRY_AFTER_MS;
}

/** `POST .../verify`: tries again to prepare the questions (e.g. after a failed generation). */
export async function startVerify(
  db: AnyDb,
  queue: Pick<Queue, 'add'>,
  slug: string,
  sessionId: string,
  request: StartVerifyRequest,
): Promise<{ jobId: string | null }> {
  const { session } = await requireVerifySession(db, slug, sessionId);
  if (session.status === 'ended') throw new ConflictError('La sessione è già terminata.');
  if (session.documentIds.length === 0) {
    throw new ConflictError(
      'La sessione non ha documenti: scegli un argomento o collega i documenti agli argomenti.',
    );
  }
  await prepareVerifySession(db, queue, session, { ...request, retryGeneration: true });
  const [fresh] = await db
    .select({ briefingJobId: studySessions.briefingJobId })
    .from(studySessions)
    .where(eq(studySessions.id, session.id));
  return { jobId: await activeJobId(db, fresh?.briefingJobId ?? null) };
}

// ---------------------------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------------------------

function daysOffsetOf(taskKey: string | undefined): 3 | 7 | null {
  const m = /^rev:.+:(\d+)$/.exec(taskKey ?? '');
  if (!m) return null;
  const n = Number(m[1]);
  return n === 2 ? 3 : n === 3 ? 7 : null;
}

async function nextVerifyDate(db: AnyDb, task: TaskRow | null): Promise<string | null> {
  if (!task) return null;
  const sameTopic = task.topicId
    ? eq(tasks.topicId, task.topicId)
    : task.topicKey
      ? eq(tasks.topicKey, task.topicKey)
      : null;
  if (!sameTopic) return null;
  const rows: { date: string }[] = await db
    .select({ date: tasks.date })
    .from(tasks)
    .where(
      and(
        eq(tasks.planId, task.planId),
        eq(tasks.kind, 'verify'),
        sameTopic,
        gt(tasks.date, task.date),
        inArray(tasks.status, ['todo', 'doing']),
      ),
    );
  return rows.map((r) => r.date).sort()[0] ?? null;
}

/** Everything the verification page shows. The reference answer and the key point stay out until an item has an outcome. */
export async function getVerifyState(
  db: AnyDb,
  slug: string,
  sessionId: string,
): Promise<VerifyStateDto> {
  const { session, subject } = await requireVerifySession(db, slug, sessionId);
  const task = await loadTask(db, session.taskId);
  const topicId = await verifyTopicIdOf(db, session);
  const [topic] = topicId
    ? await db
        .select({ name: topics.name, mastery: topics.mastery })
        .from(topics)
        .where(eq(topics.id, topicId))
    : [];

  const rows: SessionItem[] = await db
    .select()
    .from(sessionItems)
    .where(
      and(
        eq(sessionItems.sessionId, session.id),
        inArray(sessionItems.kind, [...VERIFY_ITEM_KINDS]),
      ),
    )
    .orderBy(asc(sessionItems.orderIndex), asc(sessionItems.createdAt), asc(sessionItems.id));

  const blockIds = [...new Set(rows.flatMap((r) => r.linkedBlockIds))];
  const blockRows: LessonBlock[] = blockIds.length
    ? await db.select().from(lessonBlocks).where(inArray(lessonBlocks.id, blockIds))
    : [];
  const blockById = new Map(blockRows.map((b) => [b.id, b]));

  const docIds = [
    ...new Set([
      ...rows.flatMap((r) => r.citations.map((c) => c.docId)),
      ...blockRows.flatMap((b) => b.citations.map((c) => c.docId)),
    ]),
  ];
  const docRows: { id: string; originalName: string }[] = docIds.length
    ? await db
        .select({ id: documents.id, originalName: documents.originalName })
        .from(documents)
        .where(inArray(documents.id, docIds))
    : [];
  const docName = new Map(docRows.map((d) => [d.id, d.originalName]));

  // The lesson a question comes from: its source item -> session -> task title.
  const parentIds = rows.flatMap((r) => (r.parentItemId ? [r.parentItemId] : []));
  const parents: { id: string; sessionId: string }[] = parentIds.length
    ? await db
        .select({ id: sessionItems.id, sessionId: sessionItems.sessionId })
        .from(sessionItems)
        .where(inArray(sessionItems.id, parentIds))
    : [];
  const parentSessions: { id: string; taskId: string | null }[] = parents.length
    ? await db
        .select({ id: studySessions.id, taskId: studySessions.taskId })
        .from(studySessions)
        .where(inArray(studySessions.id, [...new Set(parents.map((p) => p.sessionId))]))
    : [];
  const originTaskIds = parentSessions.flatMap((s) => (s.taskId ? [s.taskId] : []));
  const originTasks: { id: string; title: string }[] = originTaskIds.length
    ? await db
        .select({ id: tasks.id, title: tasks.title })
        .from(tasks)
        .where(inArray(tasks.id, originTaskIds))
    : [];
  const titleOfTask = new Map(originTasks.map((t) => [t.id, t.title]));
  const taskOfSession = new Map(parentSessions.map((s) => [s.id, s.taskId]));
  const sessionOfItem = new Map(parents.map((p) => [p.id, p.sessionId]));
  const lessonTitleOf = (r: SessionItem): string | null => {
    const sid = r.parentItemId ? sessionOfItem.get(r.parentItemId) : undefined;
    const tid = sid ? taskOfSession.get(sid) : undefined;
    return (tid ? titleOfTask.get(tid) : undefined) ?? null;
  };

  const firstBlock = (r: SessionItem): LessonBlock | undefined =>
    r.linkedBlockIds.map((id) => blockById.get(id)).find((b) => b !== undefined);

  const keyPointOf = (r: SessionItem): VerifyKeyPointDto => {
    const block = firstBlock(r);
    const cite = block?.citations[0] ?? r.citations[0];
    return {
      title: block?.title ?? r.concepts[0] ?? 'Risposta di riferimento',
      body: block?.body ?? r.body,
      citation: cite
        ? {
            docId: cite.docId,
            documentName: docName.get(cite.docId) ?? 'Documento',
            page: cite.page,
            quote: cite.quote,
          }
        : null,
    };
  };

  const items = rows.map((r): VerifyItemDto => {
    const graded = r.feedback && 'score' in r.feedback ? r.feedback : null;
    const verdict = verifyVerdict(r.state, graded ? graded.score : null);
    const state =
      r.state === 'correct' || r.state === 'wrong' || r.state === 'unknown' ? r.state : 'open';
    return {
      id: r.id,
      kind: r.kind as VerifyItemKind,
      orderIndex: r.orderIndex,
      question: r.title,
      state,
      studentAnswer: r.answer,
      feedback:
        graded && (verdict === 'correct' || verdict === 'partial' || verdict === 'wrong')
          ? { verdict, text: graded.feedback }
          : null,
      keyPoint: state === 'wrong' || state === 'unknown' ? keyPointOf(r) : null,
      originLessonTitle: lessonTitleOf(r),
    };
  });

  let summary: VerifySummaryDto | null = null;
  const [job] = session.briefingJobId
    ? await db.select().from(jobs).where(eq(jobs.id, session.briefingJobId))
    : [];
  // While new questions are still being written the verification is not over.
  const generating = session.briefingJobId
    ? !job || job.status === 'queued' || job.status === 'running'
    : false;
  if (!generating && items.length > 0 && items.every((i) => i.state !== 'open')) {
    summary = {
      correct: items.filter((i) => i.state === 'correct').length,
      total: items.length,
      unstable: rows
        .filter((r) => r.state !== 'correct')
        .map((r) => firstBlock(r)?.title ?? r.title),
      nextVerifyDate: await nextVerifyDate(db, task),
      masteryBefore: session.masteryBefore ?? null,
      masteryNow: topic?.mastery ?? null,
    };
  }

  const [cost] = await db
    .select({ eur: sql<number>`coalesce(sum((${jobs.cost}->>'eur')::float8), 0)` })
    .from(jobs)
    .where(
      and(
        inArray(jobs.type, ['prepare_session', 'session_grade']),
        eq(jobs.status, 'succeeded'),
        sql`${jobs.input}->>'sessionId' = ${session.id}`,
      ),
    );

  return {
    prepared: session.verifyPreparedAt !== null,
    ended: session.status === 'ended',
    subjectName: subject.name,
    topicName: topic?.name ?? null,
    daysOffset: daysOffsetOf(task?.taskKey),
    items,
    job: session.briefingJobId
      ? {
          id: session.briefingJobId,
          status: job?.status ?? 'queued',
          error: (job?.error as { message?: string } | null)?.message ?? null,
        }
      : null,
    summary,
    costEur: Number(cost?.eur ?? 0),
  };
}

// ---------------------------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------------------------

function assertOpenVerification(session: StudySession) {
  if (session.status === 'ended') throw new ConflictError('La sessione è già terminata.');
  if (session.verifyPreparedAt === null) {
    throw new ConflictError('Questa verifica non ha domande preparate.');
  }
}

/** "Non me lo ricordo": the item is `unknown`, no AI involved; idempotent, but an answered item stays as it is. */
export async function markVerifyItemUnknown(
  db: AnyDb,
  slug: string,
  sessionId: string,
  itemId: string,
): Promise<VerifyStateDto> {
  const { session } = await requireVerifySession(db, slug, sessionId);
  assertOpenVerification(session);
  const [item] = await db
    .select()
    .from(sessionItems)
    .where(and(eq(sessionItems.id, itemId), eq(sessionItems.sessionId, session.id)));
  if (!item || !isVerifyKind(item.kind)) throw new NotFoundError('Elemento');
  if (item.state === 'correct' || item.state === 'wrong') {
    throw new ConflictError('Hai già risposto a questa domanda.');
  }
  if (item.state !== 'unknown') {
    const updated = await db
      .update(sessionItems)
      .set({ state: 'unknown', feedback: null })
      .where(and(eq(sessionItems.id, item.id), eq(sessionItems.state, 'open')))
      .returning({ id: sessionItems.id });
    if (updated.length > 0) await recomputeVerifyMastery(db, session);
  }
  return getVerifyState(db, slug, sessionId);
}

/** "Rifalla": the questions that were not right start over (state, answer and correction cleared) in the same session. */
export async function retryVerify(
  db: AnyDb,
  slug: string,
  sessionId: string,
): Promise<VerifyStateDto> {
  const { session } = await requireVerifySession(db, slug, sessionId);
  assertOpenVerification(session);
  const reset = await db
    .update(sessionItems)
    .set({ state: 'open', answer: null, feedback: null, solutionRevealed: false })
    .where(
      and(
        eq(sessionItems.sessionId, session.id),
        inArray(sessionItems.kind, [...VERIFY_ITEM_KINDS]),
        inArray(sessionItems.state, ['wrong', 'unknown']),
      ),
    )
    .returning({ id: sessionItems.id });
  if (reset.length > 0) await recomputeVerifyMastery(db, session);
  return getVerifyState(db, slug, sessionId);
}
