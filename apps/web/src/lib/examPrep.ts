import { randomUUID } from 'node:crypto';
import { and, desc, eq, inArray } from 'drizzle-orm';
import {
  artifacts,
  attemptItemResults,
  examProfiles,
  simulationAttempts,
  simulationItems,
  simulations,
  subjects,
  type ExamProfileRow,
  type SimulationAttempt,
  type SimulationItemRow,
} from '@studyhub/db';
import { isExpired, remainingSeconds } from '@studyhub/core';
import type {
  AttemptDto,
  AttemptItemResultDto,
  ExamProfileDto,
  GenerateSimulationJobInput,
  SimulationSummaryDto,
  UpdateExamProfileRequest,
} from '@studyhub/contracts';
import type { Queue } from 'bullmq';
import { SubjectNotFoundError } from './errors';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = any;
type JobQueue = Pick<Queue, 'add'>;

export class NotFoundError extends Error {
  constructor(what: string) {
    super(`${what} non trovato`);
    this.name = 'NotFoundError';
  }
}

/** A request that is valid but not in the current state (e.g. saving answers after the deadline). */
export class ConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConflictError';
  }
}

async function requireSubject(db: AnyDb, subjectSlug: string) {
  const [subject] = await db.select().from(subjects).where(eq(subjects.slug, subjectSlug));
  if (!subject) throw new SubjectNotFoundError(subjectSlug);
  return subject;
}

function profileToDto(row: ExamProfileRow): ExamProfileDto {
  return {
    id: row.id,
    subjectId: row.subjectId,
    sourceDocIds: row.sourceDocIds,
    profile: row.profile,
    edited: row.edited,
    model: row.model,
    promptVersion: row.promptVersion,
    updatedAt: row.updatedAt.toISOString(),
  };
}

// ---------------------------------------------------------------- profile

export async function getExamProfile(
  db: AnyDb,
  subjectSlug: string,
): Promise<ExamProfileDto | null> {
  const subject = await requireSubject(db, subjectSlug);
  const [row] = await db.select().from(examProfiles).where(eq(examProfiles.subjectId, subject.id));
  return row ? profileToDto(row) : null;
}

/** The user owns the profile after extraction: an edit sets `edited`, which re-extraction respects. */
export async function updateExamProfile(
  db: AnyDb,
  subjectSlug: string,
  profile: UpdateExamProfileRequest,
): Promise<ExamProfileDto> {
  const subject = await requireSubject(db, subjectSlug);
  const [row] = await db
    .update(examProfiles)
    .set({ profile, edited: true, updatedAt: new Date() })
    .where(eq(examProfiles.subjectId, subject.id))
    .returning();
  if (!row) throw new NotFoundError("Profilo d'esame");
  return profileToDto(row);
}

export async function enqueueExamProfileExtraction(
  db: AnyDb,
  queue: JobQueue,
  subjectSlug: string,
  options: { overwriteEdited?: boolean } = {},
): Promise<{ jobId: string }> {
  const subject = await requireSubject(db, subjectSlug);
  const jobId = randomUUID();
  await queue.add(
    'extract_exam_profile',
    { subjectId: subject.id, overwriteEdited: options.overwriteEdited ?? false },
    { jobId },
  );
  return { jobId };
}

// ------------------------------------------------------------ simulations

export async function enqueueSimulation(
  db: AnyDb,
  queue: JobQueue,
  subjectSlug: string,
  input: Omit<GenerateSimulationJobInput, 'subjectId'>,
): Promise<{ jobId: string }> {
  const subject = await requireSubject(db, subjectSlug);
  const jobId = randomUUID();
  await queue.add('generate_simulation', { ...input, subjectId: subject.id }, { jobId });
  return { jobId };
}

/** Simulations with their history (docs/fasi/F5: "storico simulazioni con trend"). */
export async function listSimulations(
  db: AnyDb,
  subjectSlug: string,
): Promise<SimulationSummaryDto[]> {
  const subject = await requireSubject(db, subjectSlug);
  const rows: { a: typeof artifacts.$inferSelect; s: typeof simulations.$inferSelect }[] = await db
    .select({ a: artifacts, s: simulations })
    .from(artifacts)
    .innerJoin(simulations, eq(simulations.artifactId, artifacts.id))
    .where(eq(artifacts.subjectId, subject.id))
    .orderBy(desc(artifacts.createdAt));
  if (rows.length === 0) return [];

  const ids = rows.map((r) => r.a.id);
  const items: { simulationId: string }[] = await db
    .select({ simulationId: simulationItems.simulationId })
    .from(simulationItems)
    .where(inArray(simulationItems.simulationId, ids));
  const attempts: SimulationAttempt[] = await db
    .select()
    .from(simulationAttempts)
    .where(inArray(simulationAttempts.simulationId, ids))
    .orderBy(desc(simulationAttempts.startedAt));

  return rows.map(({ a, s }) => {
    const mine = attempts.filter((t) => t.simulationId === a.id);
    const lastGraded = mine.find((t) => t.status === 'graded' && (t.totalMax ?? 0) > 0);
    return {
      id: a.id,
      title: a.title,
      mode: s.mode,
      topicId: s.topicId,
      timeBudgetMin: s.timeBudgetMin,
      totalPoints: s.totalPoints,
      itemCount: items.filter((i) => i.simulationId === a.id).length,
      createdAt: a.createdAt.toISOString(),
      lastScoreRatio: lastGraded
        ? (lastGraded.totalAwarded ?? 0) / (lastGraded.totalMax ?? 1)
        : null,
      attemptCount: mine.length,
    };
  });
}

// ---------------------------------------------------------------- attempts

async function loadItems(db: AnyDb, simulationId: string): Promise<SimulationItemRow[]> {
  return db
    .select()
    .from(simulationItems)
    .where(eq(simulationItems.simulationId, simulationId))
    .orderBy(simulationItems.ord);
}

async function requireAttempt(
  db: AnyDb,
  subjectSlug: string,
  attemptId: string,
): Promise<SimulationAttempt> {
  const subject = await requireSubject(db, subjectSlug);
  const [row] = await db
    .select({ t: simulationAttempts })
    .from(simulationAttempts)
    .innerJoin(artifacts, eq(artifacts.id, simulationAttempts.simulationId))
    .where(and(eq(simulationAttempts.id, attemptId), eq(artifacts.subjectId, subject.id)));
  if (!row) throw new NotFoundError('Tentativo');
  return row.t;
}

function attemptToDto(
  attempt: SimulationAttempt,
  items: SimulationItemRow[],
  now: Date,
): AttemptDto {
  return {
    id: attempt.id,
    simulationId: attempt.simulationId,
    status: attempt.status,
    startedAt: attempt.startedAt.toISOString(),
    durationMin: attempt.durationMin,
    remainingSeconds:
      attempt.status === 'in_progress'
        ? remainingSeconds(attempt.startedAt, attempt.durationMin, now)
        : 0,
    answers: attempt.answers,
    // Exam mode shows prompt + points only: "niente aiuti AI durante" (docs/fasi/F5).
    items: items.map((i) => ({
      id: i.id,
      ord: i.ord,
      prompt: i.prompt,
      kind: i.kind,
      points: i.points,
    })),
    totalAwarded: attempt.totalAwarded,
    totalMax: attempt.totalMax,
    weakTopics: attempt.weakTopics,
  };
}

/**
 * Deadline enforcement lives on the server: an in-progress attempt past its
 * time is submitted as-is (answers saved so far) and queued for grading —
 * whether the tab was open, closed, or reopened hours later.
 */
async function expireIfDue(
  db: AnyDb,
  queue: JobQueue,
  attempt: SimulationAttempt,
  now: Date,
): Promise<SimulationAttempt> {
  if (attempt.status !== 'in_progress' || !isExpired(attempt.startedAt, attempt.durationMin, now))
    return attempt;
  const deadline = new Date(attempt.startedAt.getTime() + attempt.durationMin * 60_000);
  const [updated] = await db
    .update(simulationAttempts)
    .set({ status: 'submitted', submittedAt: deadline })
    .where(and(eq(simulationAttempts.id, attempt.id), eq(simulationAttempts.status, 'in_progress')))
    .returning();
  if (updated) {
    await queue.add('grade_attempt', { attemptId: attempt.id }, { jobId: randomUUID() });
    return updated;
  }
  const [fresh] = await db
    .select()
    .from(simulationAttempts)
    .where(eq(simulationAttempts.id, attempt.id));
  return fresh;
}

/** Starts an attempt — or resumes the one already in progress for this simulation. */
export async function startOrResumeAttempt(
  db: AnyDb,
  queue: JobQueue,
  subjectSlug: string,
  simulationId: string,
  now: Date = new Date(),
): Promise<AttemptDto> {
  const subject = await requireSubject(db, subjectSlug);
  const [sim] = await db
    .select({ s: simulations })
    .from(simulations)
    .innerJoin(artifacts, eq(artifacts.id, simulations.artifactId))
    .where(and(eq(simulations.artifactId, simulationId), eq(artifacts.subjectId, subject.id)));
  if (!sim) throw new NotFoundError('Simulazione');

  const items = await loadItems(db, simulationId);
  const [open] = await db
    .select()
    .from(simulationAttempts)
    .where(
      and(
        eq(simulationAttempts.simulationId, simulationId),
        eq(simulationAttempts.status, 'in_progress'),
      ),
    );
  if (open) {
    const checked = await expireIfDue(db, queue, open, now);
    if (checked.status === 'in_progress') return attemptToDto(checked, items, now);
  }

  const [created] = await db
    .insert(simulationAttempts)
    .values({ id: randomUUID(), simulationId, durationMin: sim.s.timeBudgetMin, startedAt: now })
    .returning();
  return attemptToDto(created, items, now);
}

export async function getAttempt(
  db: AnyDb,
  queue: JobQueue,
  subjectSlug: string,
  attemptId: string,
  now: Date = new Date(),
): Promise<AttemptDto> {
  const attempt = await expireIfDue(
    db,
    queue,
    await requireAttempt(db, subjectSlug, attemptId),
    now,
  );
  return attemptToDto(attempt, await loadItems(db, attempt.simulationId), now);
}

/** Autosave: merges answers into the stored ones. Rejected once the attempt is no longer in progress. */
export async function saveAnswers(
  db: AnyDb,
  queue: JobQueue,
  subjectSlug: string,
  attemptId: string,
  answers: Record<string, string>,
  now: Date = new Date(),
): Promise<AttemptDto> {
  const attempt = await expireIfDue(
    db,
    queue,
    await requireAttempt(db, subjectSlug, attemptId),
    now,
  );
  if (attempt.status !== 'in_progress') {
    throw new ConflictError(
      'Tempo scaduto o esame già consegnato: le risposte non sono più modificabili.',
    );
  }
  const items = await loadItems(db, attempt.simulationId);
  const validIds = new Set(items.map((i) => i.id));
  const unknown = Object.keys(answers).filter((id) => !validIds.has(id));
  if (unknown.length > 0)
    throw new ConflictError(
      `Esercizi non appartenenti a questa simulazione: ${unknown.join(', ')}`,
    );

  const [updated] = await db
    .update(simulationAttempts)
    .set({ answers: { ...attempt.answers, ...answers } })
    .where(eq(simulationAttempts.id, attemptId))
    .returning();
  return attemptToDto(updated, items, now);
}

export async function submitAttempt(
  db: AnyDb,
  queue: JobQueue,
  subjectSlug: string,
  attemptId: string,
  now: Date = new Date(),
): Promise<AttemptDto> {
  const attempt = await expireIfDue(
    db,
    queue,
    await requireAttempt(db, subjectSlug, attemptId),
    now,
  );
  const items = await loadItems(db, attempt.simulationId);
  if (attempt.status !== 'in_progress') return attemptToDto(attempt, items, now); // already submitted: no-op

  const [updated] = await db
    .update(simulationAttempts)
    .set({ status: 'submitted', submittedAt: now })
    .where(and(eq(simulationAttempts.id, attemptId), eq(simulationAttempts.status, 'in_progress')))
    .returning();
  if (updated) await queue.add('grade_attempt', { attemptId }, { jobId: randomUUID() });
  return attemptToDto(updated ?? attempt, items, now);
}

/** Formative results (docs/fasi/F5 Correzione) — only once graded; solutions are revealed here. */
export async function getAttemptResults(
  db: AnyDb,
  subjectSlug: string,
  attemptId: string,
): Promise<AttemptItemResultDto[]> {
  const attempt = await requireAttempt(db, subjectSlug, attemptId);
  if (attempt.status !== 'graded') return [];
  const items = await loadItems(db, attempt.simulationId);
  const results: (typeof attemptItemResults.$inferSelect)[] = await db
    .select()
    .from(attemptItemResults)
    .where(eq(attemptItemResults.attemptId, attemptId));

  return items.flatMap((item) => {
    const r = results.find((x) => x.itemId === item.id);
    if (!r) return [];
    return [
      {
        itemId: item.id,
        ord: item.ord,
        prompt: item.prompt,
        answer: attempt.answers[item.id] ?? '',
        awarded: r.awarded,
        max: r.max,
        criteria: r.criteria,
        missing: r.missing,
        solution: item.solution,
        sourceRef: r.sourceRef,
        secondOpinion:
          r.secondOpinionModel && r.secondOpinionAt
            ? {
                model: r.secondOpinionModel,
                awarded: r.secondOpinionAwarded ?? 0,
                criteria: r.secondOpinionCriteria ?? [],
                missing: r.secondOpinionMissing ?? [],
                at: r.secondOpinionAt.toISOString(),
              }
            : null,
      },
    ];
  });
}

/**
 * "Seconda opinione con modello superiore su singolo item" (docs/fasi/F5-esami-simulazioni.md
 * "Rischi"). Only on an already-graded item — nothing to compare a second opinion against
 * otherwise.
 */
export async function enqueueSecondOpinion(
  db: AnyDb,
  queue: JobQueue,
  subjectSlug: string,
  attemptId: string,
  itemId: string,
): Promise<{ jobId: string }> {
  const attempt = await requireAttempt(db, subjectSlug, attemptId);
  if (attempt.status !== 'graded') {
    throw new ConflictError('Il tentativo non è ancora corretto: nessun voto di base da confrontare.');
  }
  const [item] = await db
    .select({ id: simulationItems.id })
    .from(simulationItems)
    .where(and(eq(simulationItems.id, itemId), eq(simulationItems.simulationId, attempt.simulationId)));
  if (!item) throw new NotFoundError('Esercizio');

  const jobId = randomUUID();
  await queue.add('grade_item_second_opinion', { attemptId, itemId }, { jobId });
  return { jobId };
}
