import { randomUUID } from 'node:crypto';
import { and, asc, eq, inArray, notInArray, sql } from 'drizzle-orm';
import {
  chunks,
  documents,
  jobs,
  lessonBlocks,
  sessionItems,
  studySessions,
  subjects,
  tasks,
  type LessonBlock,
  type SessionItem,
  type StudySession,
} from '@studyhub/db';
import {
  BRIEFING_EXERCISES,
  BRIEFING_KEY_POINTS,
  BRIEFING_MORE_EXERCISES,
  EXERCISE_PASS_RATIO,
  selectBriefingChunks,
} from '@studyhub/core';
import { estimateCostEur, estimateTokens, type AiProvider, resolveModel } from '@studyhub/ai';
import type {
  BriefingJobDto,
  EstimateBriefingRequest,
  EstimateBriefingResponse,
  GradeSessionItemRequest,
  SessionBriefingDto,
  SessionBriefingMode,
  SessionItemDto,
  StartBriefingRequest,
  UpdateSessionItemRequest,
} from '@studyhub/contracts';
import type { Queue } from 'bullmq';
import { SubjectNotFoundError } from './errors';
import { ConflictError, NotFoundError } from './examPrep';
import { recomputeVerifyMastery } from './verifyMastery';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = any;

/** Rough output size of a briefing (tokens), for the pre-flight estimate only. */
const OUTPUT_TOKENS_PER_KEY_POINT = 120;
const OUTPUT_TOKENS_PER_EXERCISE = 200;

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

/** A sprint lesson (new phases) keeps its exercises job in `briefingJobId`: it is not a briefing. */
function isSprintLesson(session: StudySession): boolean {
  return session.method === 'sprint' && session.phase !== 'understand';
}

async function loadBriefingJob(db: AnyDb, session: StudySession): Promise<BriefingJobDto | null> {
  if (!session.briefingJobId || isSprintLesson(session)) return null;
  const [row] = await db.select().from(jobs).where(eq(jobs.id, session.briefingJobId));
  // No row yet = still waiting in the queue: the worker creates it when it picks the job up.
  if (!row) {
    return { id: session.briefingJobId, mode: 'all', status: 'queued', error: null };
  }
  const input = (row.input ?? {}) as { mode?: SessionBriefingMode };
  const error = (row.error as { message?: string } | null)?.message ?? null;
  return {
    id: row.id,
    mode: input.mode === 'exercises' ? 'exercises' : 'all',
    status: row.status,
    error,
  };
}

/**
 * A sprint exercise or retry keeps its solution hidden until the student self-assesses (any state but
 * `open`, "non so" included), asks for it, or has an AI correction. The other items always show theirs.
 */
export function isSolutionVisible(row: SessionItem): boolean {
  const sprintItem =
    row.kind === 'retry_exercise' || (row.kind === 'exercise' && row.solutionSteps.length > 0);
  if (!sprintItem) return true;
  return row.solutionRevealed || row.state !== 'open' || row.feedback !== null;
}

export function toItemDto(row: SessionItem, documentNames: Map<string, string>): SessionItemDto {
  const visible = isSolutionVisible(row);
  return {
    id: row.id,
    kind: row.kind,
    orderIndex: row.orderIndex,
    title: row.title,
    body: visible ? row.body : '',
    difficulty: row.difficulty,
    citations: row.citations.map((c) => ({
      docId: c.docId,
      documentName: documentNames.get(c.docId) ?? 'Documento',
      page: c.page,
      quote: c.quote,
    })),
    topicId: row.topicId,
    state: row.state,
    answer: row.answer,
    feedback: row.feedback && 'score' in row.feedback ? row.feedback : null,
    linkedBlockIds: row.linkedBlockIds,
    concepts: row.concepts,
    solutionSteps: visible ? row.solutionSteps : [],
    solutionVisible: visible,
    parentItemId: row.parentItemId,
  };
}

/** The key points and exercises of a session, the state of the last briefing job and what the briefing and the corrections cost. */
export async function getBriefing(
  db: AnyDb,
  slug: string,
  sessionId: string,
): Promise<SessionBriefingDto> {
  const session = await requireSession(db, slug, sessionId);
  const rows: SessionItem[] = await db
    .select()
    .from(sessionItems)
    // The student's own explanations (phase "Rielabora") have their own route and feedback shape;
    // the retries of a sprint lesson are served with the rest of it (`getSprint`).
    .where(
      and(
        eq(sessionItems.sessionId, session.id),
        notInArray(sessionItems.kind, ['explanation', 'retry_exercise']),
      ),
    )
    .orderBy(asc(sessionItems.kind), asc(sessionItems.orderIndex));

  const docIds = [...new Set(rows.flatMap((r) => r.citations.map((c) => c.docId)))];
  const docRows: { id: string; originalName: string }[] = docIds.length
    ? await db
        .select({ id: documents.id, originalName: documents.originalName })
        .from(documents)
        .where(inArray(documents.id, docIds))
    : [];
  const names = new Map(docRows.map((d) => [d.id, d.originalName]));

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
    items: rows.map((r) => toItemDto(r, names)),
    job: await loadBriefingJob(db, session),
    costEur: Number(cost?.eur ?? 0),
  };
}

/** The briefing is only ever generated on request (docs/08-sessione-di-studio.md decision 3). */
export async function startBriefing(
  db: AnyDb,
  queue: Pick<Queue, 'add'>,
  slug: string,
  sessionId: string,
  request: StartBriefingRequest,
): Promise<{ jobId: string }> {
  const session = await requireSession(db, slug, sessionId);
  if (session.status === 'ended') throw new ConflictError('La sessione è già terminata.');
  if (isSprintLesson(session)) {
    throw new ConflictError('In una lezione sprint gli esercizi si generano dalla lezione.');
  }
  if (session.documentIds.length === 0) {
    throw new ConflictError(
      'La sessione non ha documenti: scegli un argomento o collega i documenti agli argomenti.',
    );
  }

  const current = await loadBriefingJob(db, session);
  if (current && (current.status === 'queued' || current.status === 'running')) {
    throw new ConflictError('Una generazione è già in corso.');
  }
  if (request.mode === 'all') {
    const existing = await db
      .select({ id: sessionItems.id })
      .from(sessionItems)
      // Guide questions and explanations are not part of the briefing.
      .where(
        and(
          eq(sessionItems.sessionId, session.id),
          inArray(sessionItems.kind, ['key_point', 'exercise']),
        ),
      )
      .limit(1);
    if (existing.length > 0) {
      throw new ConflictError('Punti chiave ed esercizi sono già stati generati.');
    }
  }

  const jobId = randomUUID();
  await db
    .update(studySessions)
    .set({ briefingJobId: jobId })
    .where(eq(studySessions.id, session.id));
  await queue.add(
    'prepare_session',
    {
      subjectId: session.subjectId,
      sessionId: session.id,
      mode: request.mode,
      force: request.force,
      ...(request.model ? { model: request.model } : {}),
    },
    { jobId },
  );
  return { jobId };
}

/** Pre-flight cost of a briefing (docs/03-ai-e-worker.md §4: always shown before launching). */
export async function estimateBriefing(
  db: AnyDb,
  slug: string,
  sessionId: string,
  request: EstimateBriefingRequest,
): Promise<EstimateBriefingResponse> {
  const session = await requireSession(db, slug, sessionId);

  const [task] = session.taskId
    ? await db.select().from(tasks).where(eq(tasks.id, session.taskId))
    : [];
  const planned = (task?.payload?.material ?? []).map(
    (m: { docId: string; pageFrom: number; pageTo: number }) => m,
  );
  const rows: { docId: string; page: number; text: string }[] = session.documentIds.length
    ? await db
        .select({ docId: chunks.documentId, page: chunks.pageFrom, text: chunks.text })
        .from(chunks)
        .where(inArray(chunks.documentId, session.documentIds))
        .orderBy(chunks.documentId, chunks.ord)
    : [];
  const picked = selectBriefingChunks(rows, planned);

  const inputTokens = picked.reduce((sum, c) => sum + estimateTokens(c.text), 0);
  const outputTokens =
    request.mode === 'all'
      ? BRIEFING_KEY_POINTS * OUTPUT_TOKENS_PER_KEY_POINT +
        BRIEFING_EXERCISES * OUTPUT_TOKENS_PER_EXERCISE
      : BRIEFING_MORE_EXERCISES * OUTPUT_TOKENS_PER_EXERCISE;
  return {
    model: request.model,
    inputTokens,
    outputTokens,
    costEur: estimateCostEur(request.model, inputTokens, outputTokens),
  };
}

const KEY_POINT_STATES = new Set(['open', 'done']);
const EXERCISE_STATES = new Set(['open', 'correct', 'wrong']);
/** A sprint exercise can also be marked "non so da dove partire". */
const SPRINT_EXERCISE_STATES = new Set(['open', 'correct', 'wrong', 'unknown']);

/** Most characters of lesson text handed to the grader as the reference for a guide question. */
export const GUIDE_REFERENCE_MAX_CHARS = 6000;

/** The lesson written so far (block bodies and the answers to their check questions), trimmed to a sane size. */
export function lessonReference(
  blocks: { title: string; body: string; checkAnswer: string | null }[],
): string {
  const text = blocks
    .map((b) => [b.title, b.body, b.checkAnswer ?? ''].filter((p) => p.trim() !== '').join('\n'))
    .filter((t) => t.trim() !== '')
    .join('\n\n');
  return text.length > GUIDE_REFERENCE_MAX_CHARS ? text.slice(0, GUIDE_REFERENCE_MAX_CHARS) : text;
}

/** The model the AI correction uses when the student does not pick one: the grading tier of docs/03 §4. */
export const GRADE_DEFAULT_MODEL = 'claude-sonnet-5-5';

/**
 * "Correggi con l'AI" (docs/08 decision 1, the paid path next to "Mostra la soluzione"). The exercise is
 * graded as a one-criterion item against its own expected solution, reusing the exam grader; the score
 * decides `correct`/`wrong`, which the student can still change by hand afterwards.
 */
export async function gradeSessionItem(
  db: AnyDb,
  provider: AiProvider,
  slug: string,
  sessionId: string,
  itemId: string,
  request: GradeSessionItemRequest,
): Promise<SessionItemDto> {
  const session = await requireSession(db, slug, sessionId);
  if (session.status === 'ended') throw new ConflictError('La sessione è già terminata.');
  const [item] = await db
    .select()
    .from(sessionItems)
    .where(and(eq(sessionItems.id, itemId), eq(sessionItems.sessionId, session.id)));
  if (!item) throw new NotFoundError('Elemento');
  if (
    item.kind !== 'exercise' &&
    item.kind !== 'guide_question' &&
    item.kind !== 'retry_exercise'
  ) {
    throw new ConflictError('Si correggono solo gli esercizi e le domande guida.');
  }
  if (session.kind === 'verify' && session.verifyPreparedAt !== null && item.state !== 'open') {
    throw new ConflictError('Hai già risposto a questa domanda: usa «Rifalla».');
  }
  const answer = (item.answer ?? '').trim();
  if (!answer) throw new ConflictError('Scrivi prima la tua risposta.');

  let expected = item.body;
  let citation = item.citations[0];
  if (item.kind === 'guide_question') {
    // A guide question has no expected answer of its own: the lesson's blocks are the reference.
    const blocks: LessonBlock[] = await db
      .select()
      .from(lessonBlocks)
      .where(eq(lessonBlocks.sessionId, session.id))
      .orderBy(asc(lessonBlocks.orderIndex));
    if (expected.trim() === '') expected = lessonReference(blocks);
    if (expected === '') {
      throw new ConflictError('La lezione non ha ancora contenuti con cui correggere la risposta.');
    }
    citation ??= blocks.flatMap((b) => b.citations)[0] ?? {
      docId: session.documentIds[0] ?? '',
      page: 1,
      quote: '',
    };
  }
  if (!citation) throw new ConflictError('L’esercizio non ha una fonte citata.');

  const model = request.model ?? resolveModel(GRADE_DEFAULT_MODEL);
  const result = await provider.gradeAnswer(
    {
      item: {
        prompt: item.title,
        kind: 'open',
        points: 1,
        expectedPoints: [expected],
        rubric: [{ criterion: 'Risposta corretta e completa', points: 1 }],
        solution: expected,
        sourceRef: citation,
        topicName: null,
      },
      answer,
    },
    model,
  );

  // One criterion, clamped: a grader cannot award more than the rubric allows.
  const score = Math.min(1, Math.max(0, result.data.criteria[0]?.awarded ?? 0));
  const feedback = {
    score: Math.round(score * 100) / 100,
    feedback: result.data.criteria[0]?.feedback ?? 'Nessun feedback dal correttore.',
    missing: result.data.missing,
    model: result.model,
    gradedAt: new Date().toISOString(),
  };

  const [updated] = await db
    .update(sessionItems)
    .set({ feedback, state: score >= EXERCISE_PASS_RATIO ? 'correct' : 'wrong' })
    .where(eq(sessionItems.id, item.id))
    .returning();

  // In a verification the outcome weighs on the topic's mastery at once, so the result shows the new value.
  await recomputeVerifyMastery(db, session);

  // Same ledger as every other AI call, so the correction shows up in /admin and the monthly cost.
  await db.insert(jobs).values({
    id: randomUUID(),
    type: 'session_grade',
    subjectId: session.subjectId,
    status: 'succeeded',
    input: { sessionId: session.id, itemId: item.id },
    cost: {
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      eur: estimateCostEur(result.model, result.usage.inputTokens, result.usage.outputTokens),
    },
    progressPct: 100,
    finishedAt: new Date(),
  });

  return toItemDto(updated, await citationNames(db, updated));
}

/** Checklist state of a key point, or the answer / self-assessment of an exercise. */
export async function updateSessionItem(
  db: AnyDb,
  slug: string,
  sessionId: string,
  itemId: string,
  request: UpdateSessionItemRequest,
): Promise<SessionItemDto> {
  const session = await requireSession(db, slug, sessionId);
  if (session.status === 'ended') throw new ConflictError('La sessione è già terminata.');
  const [item] = await db
    .select()
    .from(sessionItems)
    .where(and(eq(sessionItems.id, itemId), eq(sessionItems.sessionId, session.id)));
  if (!item) throw new NotFoundError('Elemento');

  if (session.kind === 'verify' && session.verifyPreparedAt !== null) {
    // The outcome of a verification question comes from the correction (or "Non me lo ricordo"), not from the student.
    if (request.state !== undefined || request.revealSolution !== undefined) {
      throw new ConflictError('In una verifica l’esito lo decide la correzione.');
    }
    if (request.answer !== undefined && item.state !== 'open') {
      throw new ConflictError('Hai già risposto a questa domanda: usa «Rifalla».');
    }
  }

  if (request.state !== undefined) {
    const allowed =
      item.kind === 'key_point'
        ? KEY_POINT_STATES
        : item.kind === 'exercise' && session.method === 'sprint'
          ? SPRINT_EXERCISE_STATES
          : EXERCISE_STATES;
    if (!allowed.has(request.state)) {
      throw new ConflictError(
        item.kind === 'key_point'
          ? 'Un punto chiave si può solo spuntare o riaprire.'
          : 'Un esercizio è aperto, giusto o sbagliato.',
      );
    }
  }
  if (request.revealSolution !== undefined && !isSprintItem(item)) {
    throw new ConflictError('La soluzione si mostra solo negli esercizi di una lezione sprint.');
  }
  if (item.kind === 'explanation') {
    throw new ConflictError('La spiegazione si invia dalla fase Rielabora.');
  }
  if (
    request.answer !== undefined &&
    item.kind !== 'exercise' &&
    item.kind !== 'guide_question' &&
    item.kind !== 'retry_exercise'
  ) {
    throw new ConflictError('Solo gli esercizi e le domande guida hanno una risposta.');
  }

  const [updated] = await db
    .update(sessionItems)
    .set({
      ...(request.state !== undefined ? { state: request.state } : {}),
      ...(request.answer !== undefined ? { answer: request.answer } : {}),
      ...(request.revealSolution ? { solutionRevealed: true } : {}),
      // A correction belongs to the answer it graded: a changed answer must be corrected again.
      ...(request.answer !== undefined && request.answer !== item.answer ? { feedback: null } : {}),
    })
    .where(eq(sessionItems.id, item.id))
    .returning();

  return toItemDto(updated, await citationNames(db, updated));
}

/** A sprint exercise (it has a step-by-step solution) or a retry. */
function isSprintItem(item: SessionItem): boolean {
  return (
    item.kind === 'retry_exercise' || (item.kind === 'exercise' && item.solutionSteps.length > 0)
  );
}

async function citationNames(db: AnyDb, item: SessionItem): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  const docIds = item.citations.map((c) => c.docId);
  if (docIds.length > 0) {
    const docRows: { id: string; originalName: string }[] = await db
      .select({ id: documents.id, originalName: documents.originalName })
      .from(documents)
      .where(inArray(documents.id, docIds));
    for (const d of docRows) names.set(d.id, d.originalName);
  }
  return names;
}
