import { randomUUID } from 'node:crypto';
import { and, eq, inArray } from 'drizzle-orm';
import {
  documents,
  documentTopics,
  sessionItems,
  studySessions,
  subjects,
  tasks,
  topics,
  type StudySession,
} from '@studyhub/db';
import { resolveSessionScope } from '@studyhub/core';
import { SPRINT_PHASES, STANDARD_PHASES } from '@studyhub/contracts';
import type {
  SessionMood,
  StartSessionRequest,
  StudySessionDto,
  UpdateSessionRequest,
} from '@studyhub/contracts';
import { SubjectNotFoundError } from './errors';
import { ConflictError, InvalidRequestError, NotFoundError } from './examPrep';
import { setTaskStatus } from './plan';
import { writeSessionTranscript } from './sessionChat';
import { prepareVerifySession } from './verify';
import type { Queue } from 'bullmq';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = any;
type TaskRow = typeof tasks.$inferSelect;

async function requireSubject(db: AnyDb, slug: string) {
  const [subject] = await db.select().from(subjects).where(eq(subjects.slug, slug));
  if (!subject) throw new SubjectNotFoundError(slug);
  return subject as typeof subjects.$inferSelect;
}

async function requireSession(db: AnyDb, subjectId: string, sessionId: string) {
  const [row] = await db
    .select()
    .from(studySessions)
    .where(and(eq(studySessions.id, sessionId), eq(studySessions.subjectId, subjectId)));
  if (!row) throw new NotFoundError('Sessione');
  return row as StudySession;
}

async function loadTask(db: AnyDb, taskId: string | null): Promise<TaskRow | null> {
  if (!taskId) return null;
  const [row] = await db.select().from(tasks).where(eq(tasks.id, taskId));
  return (row ?? null) as TaskRow | null;
}

async function assertTopicsExist(db: AnyDb, subjectId: string, topicIds: string[]) {
  if (topicIds.length === 0) return;
  const found: { id: string }[] = await db
    .select({ id: topics.id })
    .from(topics)
    .where(and(eq(topics.subjectId, subjectId), inArray(topics.id, topicIds)));
  if (found.length !== new Set(topicIds).size) throw new NotFoundError('Argomento');
}

async function resolveScope(
  db: AnyDb,
  subjectId: string,
  task: TaskRow | null,
  explicitTopicIds: string[] | undefined,
) {
  const docRows: { id: string }[] = await db
    .select({ id: documents.id })
    .from(documents)
    .where(eq(documents.subjectId, subjectId));
  const ids = docRows.map((d) => d.id);
  const links: { documentId: string; topicId: string }[] =
    ids.length === 0
      ? []
      : await db
          .select({ documentId: documentTopics.documentId, topicId: documentTopics.topicId })
          .from(documentTopics)
          .where(inArray(documentTopics.documentId, ids));
  return resolveSessionScope({
    task: task ? { topicId: task.topicId, material: task.payload.material ?? [] } : null,
    explicitTopicIds,
    links,
    knownDocumentIds: new Set(ids),
  });
}

/**
 * How a session starts from its task: a standard `lesson` task opens the guided lesson on "Esplora",
 * a sprint one on "Esercizi"; a `verify` task a verification; free sessions and the other tasks keep
 * the layout without phases.
 */
function sessionShape(
  task: TaskRow | null,
): Pick<typeof studySessions.$inferInsert, 'kind' | 'method' | 'phase'> {
  if (task?.kind === 'lesson') {
    const method = task.payload.method ?? 'standard';
    return { kind: 'lesson', method, phase: method === 'sprint' ? 'exercises' : 'explore' };
  }
  if (task?.kind === 'verify') return { kind: 'verify', method: 'standard', phase: null };
  return { kind: 'lesson', method: 'standard', phase: null };
}

/**
 * "Inizia" on a task (or a free session from topics). Re-opens the task's
 * active session instead of stacking a second one — a refresh or a second
 * click must not fork the student's timer.
 */
export async function startSession(
  db: AnyDb,
  subjectSlug: string,
  request: StartSessionRequest,
  /** Where the generation of missing verification questions is queued; without it none is (tests, CLI). */
  options: { queue?: Pick<Queue, 'add'> } = {},
): Promise<StudySessionDto> {
  const subject = await requireSubject(db, subjectSlug);

  let task: TaskRow | null = null;
  if (request.taskId) {
    const [row] = await db
      .select()
      .from(tasks)
      .where(and(eq(tasks.id, request.taskId), eq(tasks.subjectId, subject.id)));
    if (!row) throw new NotFoundError('Task');
    if (row.status === 'proposed')
      throw new ConflictError(
        'Una task in bozza non è ancora nel calendario: commit il piano prima.',
      );
    task = row as TaskRow;

    const [existing] = await db
      .select()
      .from(studySessions)
      .where(and(eq(studySessions.taskId, task.id), eq(studySessions.status, 'active')));
    if (existing) {
      // A preparation that failed halfway (no questions at all) is picked up again; a prepared verification,
      // or an older one that already holds items, is left as it is.
      if (existing.kind === 'verify' && existing.verifyPreparedAt === null) {
        const [anyItem] = await db
          .select({ id: sessionItems.id })
          .from(sessionItems)
          .where(eq(sessionItems.sessionId, existing.id))
          .limit(1);
        if (!anyItem) {
          await prepareVerifySession(db, options.queue, existing, { swallowQueueErrors: true });
        }
      }
      return toDto(db, existing, task);
    }
  }

  await assertTopicsExist(db, subject.id, request.topicIds ?? []);
  const scope = await resolveScope(db, subject.id, task, request.topicIds);

  const [created] = await db
    .insert(studySessions)
    .values({
      id: randomUUID(),
      subjectId: subject.id,
      taskId: task?.id ?? null,
      topicIds: scope.topicIds,
      documentIds: scope.documentIds,
      ...sessionShape(task),
    })
    .returning();

  // A verification picks its questions now (synchronous, idempotent); only missing ones are generated by a job.
  if (task && created.kind === 'verify') {
    await prepareVerifySession(db, options.queue, created, { swallowQueueErrors: true });
  }

  if (task && task.status === 'todo') await setTaskStatus(db, subjectSlug, task.id, 'doing');
  return toDto(db, created, task);
}

export async function getSession(
  db: AnyDb,
  subjectSlug: string,
  sessionId: string,
): Promise<StudySessionDto> {
  const subject = await requireSubject(db, subjectSlug);
  const row = await requireSession(db, subject.id, sessionId);
  return toDto(db, row, await loadTask(db, row.taskId));
}

/** `activeMs` is monotonic: a stale tab can never shrink the recorded time. */
export async function updateSession(
  db: AnyDb,
  subjectSlug: string,
  sessionId: string,
  request: UpdateSessionRequest,
): Promise<StudySessionDto> {
  const subject = await requireSubject(db, subjectSlug);
  const row = await requireSession(db, subject.id, sessionId);
  if (row.status === 'ended') throw new ConflictError('La sessione è già terminata.');
  const task = await loadTask(db, row.taskId);

  const patch: Partial<StudySession> = {};
  if (request.activeMs !== undefined) patch.activeMs = Math.max(row.activeMs, request.activeMs);
  if (request.pomodoros !== undefined) patch.pomodoros = Math.max(row.pomodoros, request.pomodoros);
  if (request.topicIds !== undefined) {
    await assertTopicsExist(db, subject.id, request.topicIds);
    const scope = await resolveScope(db, subject.id, task, request.topicIds);
    patch.topicIds = scope.topicIds;
    patch.documentIds = scope.documentIds;
  }
  if (request.phase !== undefined) {
    if (row.phase === null) {
      throw new InvalidRequestError('Questa sessione non ha fasi: non nasce da una lezione.');
    }
    // A standard lesson moves among the standard phases, a sprint among the sprint ones (a sprint
    // started before they existed is still on `understand` and may stay there).
    const allowed: readonly string[] =
      row.method === 'sprint'
        ? row.phase === 'understand'
          ? [...SPRINT_PHASES, 'understand']
          : SPRINT_PHASES
        : STANDARD_PHASES;
    if (!allowed.includes(request.phase)) {
      throw new InvalidRequestError(
        row.method === 'sprint'
          ? 'Questa fase non appartiene a una lezione sprint.'
          : 'Questa fase non appartiene a una lezione standard.',
      );
    }
    patch.phase = request.phase;
  }
  if (request.blockIndex !== undefined) patch.blockIndex = request.blockIndex;
  if (Object.keys(patch).length === 0) return toDto(db, row, task);

  const [updated] = await db
    .update(studySessions)
    .set(patch)
    .where(eq(studySessions.id, row.id))
    .returning();
  return toDto(db, updated, task);
}

/** "Termina": closes the session; a linked task that was still open becomes `done`. */
export async function endSession(
  db: AnyDb,
  subjectSlug: string,
  sessionId: string,
  final: {
    activeMs?: number | undefined;
    pomodoros?: number | undefined;
    mood?: SessionMood | undefined;
  } = {},
  /** Where the chat transcript is written; without it no file is produced (tests, CLI). */
  options: { dataRoot?: string } = {},
): Promise<StudySessionDto> {
  const subject = await requireSubject(db, subjectSlug);
  const row = await requireSession(db, subject.id, sessionId);
  const task = await loadTask(db, row.taskId);
  if (row.status === 'ended') return toDto(db, row, task);

  const [updated] = await db
    .update(studySessions)
    .set({
      status: 'ended',
      endedAt: new Date(),
      activeMs: Math.max(row.activeMs, final.activeMs ?? 0),
      pomodoros: Math.max(row.pomodoros, final.pomodoros ?? 0),
      ...(final.mood !== undefined ? { mood: final.mood } : {}),
    })
    .where(eq(studySessions.id, row.id))
    .returning();

  if (task && (task.status === 'todo' || task.status === 'doing')) {
    await setTaskStatus(db, subjectSlug, task.id, 'done');
  }

  let ended: StudySession = updated;
  if (options.dataRoot) {
    // The session is already closed: a failed transcript must not undo that or hide it from the student.
    try {
      const transcriptPath = await writeSessionTranscript(
        db,
        options.dataRoot,
        subjectSlug,
        updated,
      );
      ended = { ...updated, transcriptPath };
    } catch (err) {
      console.error(`[sessions] trascrizione non scritta per ${updated.id}:`, err);
    }
  }
  return toDto(db, ended, await loadTask(db, row.taskId));
}

/** Saves (or clears with `null`) how the session went; only once it is over, since the closing comes after "Termina". */
export async function setSessionMood(
  db: AnyDb,
  subjectSlug: string,
  sessionId: string,
  mood: SessionMood | null,
): Promise<StudySessionDto> {
  const subject = await requireSubject(db, subjectSlug);
  const row = await requireSession(db, subject.id, sessionId);
  if (row.status !== 'ended') throw new ConflictError('Termina prima la sessione.');
  const [updated] = await db
    .update(studySessions)
    .set({ mood })
    .where(eq(studySessions.id, row.id))
    .returning();
  return toDto(db, updated, await loadTask(db, row.taskId));
}

async function toDto(db: AnyDb, row: StudySession, task: TaskRow | null): Promise<StudySessionDto> {
  const topicRows: { id: string; name: string }[] = row.topicIds.length
    ? await db
        .select({ id: topics.id, name: topics.name })
        .from(topics)
        .where(inArray(topics.id, row.topicIds))
    : [];
  const topicById = new Map(topicRows.map((t) => [t.id, t]));

  const docRows: {
    id: string;
    originalName: string;
    pages: number | null;
    mdPath: string | null;
  }[] = row.documentIds.length
    ? await db
        .select({
          id: documents.id,
          originalName: documents.originalName,
          pages: documents.pages,
          mdPath: documents.mdPath,
        })
        .from(documents)
        .where(inArray(documents.id, row.documentIds))
    : [];
  const docById = new Map(docRows.map((d) => [d.id, d]));

  const links: { documentId: string; topicId: string }[] = row.documentIds.length
    ? await db
        .select({ documentId: documentTopics.documentId, topicId: documentTopics.topicId })
        .from(documentTopics)
        .where(inArray(documentTopics.documentId, row.documentIds))
    : [];

  const material = task?.payload.material ?? [];
  const sessionTopics = new Set(row.topicIds);

  return {
    id: row.id,
    subjectId: row.subjectId,
    taskId: row.taskId,
    taskTitle: task?.title ?? null,
    taskMinutes: task?.minutes ?? null,
    status: row.status,
    topics: row.topicIds.flatMap((id) => {
      const t = topicById.get(id);
      return t ? [t] : [];
    }),
    // Keep the resolved order: task material first, then the rest of the topics.
    documents: row.documentIds.flatMap((id) => {
      const d = docById.get(id);
      if (!d) return [];
      const ranges = material.filter((m) => m.docId === id);
      return [
        {
          id: d.id,
          name: d.originalName,
          pages: d.pages,
          highlighted: ranges.length > 0,
          pageRanges: ranges.map((m) => ({ pageFrom: m.pageFrom, pageTo: m.pageTo })),
          topicIds: links
            .filter((l) => l.documentId === id && sessionTopics.has(l.topicId))
            .map((l) => l.topicId),
          hasContent: d.mdPath !== null,
        },
      ];
    }),
    activeMs: row.activeMs,
    pomodoros: row.pomodoros,
    startedAt: row.startedAt.toISOString(),
    endedAt: row.endedAt ? row.endedAt.toISOString() : null,
    transcriptPath: row.transcriptPath,
    flashcardDeckId: row.flashcardDeckId,
    drillId: row.drillId,
    mood: row.mood ?? null,
    kind: row.kind,
    method: row.method,
    phase: row.phase,
    blockIndex: row.blockIndex,
  };
}
