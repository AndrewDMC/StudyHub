import { randomUUID } from 'node:crypto';
import {
  and,
  desc,
  eq,
  gt,
  gte,
  ilike,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  not,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import {
  artifacts,
  documents,
  exams,
  flashcards,
  recomputeTopicMastery,
  reviews,
  studyPlans,
  subjects,
  taskFlashcards,
  tasks,
  topics,
  type Flashcard,
  type ReviewPrevSchedule,
} from '@studyhub/db';
import {
  REVIEW_ESTIMATE_MAX_ELAPSED_MS,
  REVIEW_ESTIMATE_SAMPLE,
  averageMsPerCard,
  estimateReviewMinutes,
  newCardSchedule,
  previewIntervals,
  scheduleReview,
  toIsoDate,
  type FlashcardSchedule,
  type FsrsCardState,
  type FsrsRating,
  type SubjectColor,
} from '@studyhub/core';
import { DEFAULT_NEW_LIMIT } from '@studyhub/contracts';
import type {
  FlashcardDto,
  FlashcardPageDto,
  RatingIntervals,
  ReviewOverviewDto,
  ReviewOverviewTopicDto,
  ReviewQueueItemDto,
  SubmitReviewResponse,
} from '@studyhub/contracts';
import { SubjectNotFoundError } from './errors';
import { InvalidRequestError, NotFoundError } from './examPrep';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = any;

export class FlashcardNotFoundError extends Error {
  constructor(id: string) {
    super(`Flashcard non trovata: ${id}`);
    this.name = 'FlashcardNotFoundError';
  }
}

export function toDto(row: Flashcard): FlashcardDto {
  return {
    id: row.id,
    deckId: row.deckId,
    topicId: row.topicId,
    type: row.type,
    front: row.front,
    back: row.back,
    hint: row.hint,
    sourceRef: row.sourceRef,
    state: row.state,
    suspended: row.suspended,
    tags: row.tags,
    flaggedAt: row.flaggedAt ? row.flaggedAt.toISOString() : null,
    dueAt: row.dueAt && !row.suspended && row.state !== 'new' ? row.dueAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    reps: row.reps,
    lapses: row.lapses,
  };
}

function toSchedule(row: Flashcard): FlashcardSchedule {
  return {
    stability: row.stability,
    difficulty: row.difficulty,
    dueAt: row.dueAt,
    lastReviewAt: row.lastReviewAt,
    reps: row.reps,
    lapses: row.lapses,
    state: row.state,
  };
}

async function requireSubject(db: AnyDb, subjectSlug: string) {
  const [subject] = await db.select().from(subjects).where(eq(subjects.slug, subjectSlug));
  if (!subject) throw new SubjectNotFoundError(subjectSlug);
  return subject;
}

/** Default number of never-seen cards per queue, per subject: see `DEFAULT_NEW_LIMIT` in contracts. */
export { DEFAULT_NEW_LIMIT };

/** End of the UTC day `now` falls in: the same day boundary as the Dashboard (`/api/dashboard`). */
export function endOfDay(now: Date): Date {
  return new Date(`${now.toISOString().slice(0, 10)}T23:59:59.999Z`);
}

/**
 * Cards that can be reviewed at all: in an approved deck (a `draft` deck is still waiting for the
 * F3 review queue, F4 "Rischi"), not suspended and not flagged as low quality (flagged cards stay
 * in the deck but never reach the queue). The caller joins `artifacts`.
 */
export function reviewableConditions(): SQL[] {
  return [
    eq(artifacts.status, 'approved'),
    eq(flashcards.suspended, false),
    isNull(flashcards.flaggedAt),
  ];
}

/**
 * The one "due" rule (docs/09-ripasso-mobile.md §B1), shared by the review queues, the Ripasso
 * overview and the Dashboard counts: a new card; a review card due by the end of today, since its
 * intervals are whole days; a (re)learning card due by `now`, since its steps are minutes and must
 * not come straight back in the same session.
 */
export function dueCardConditions(now: Date): SQL {
  return or(
    eq(flashcards.state, 'new'),
    and(eq(flashcards.state, 'review'), lte(flashcards.dueAt, endOfDay(now))),
    and(inArray(flashcards.state, ['learning', 'relearning']), lte(flashcards.dueAt, now)),
  )!;
}

/**
 * A task covering the card, attached (`task_flashcards`) or by topic, that is "treated": done in an
 * active or superseded plan of the subject (a regenerated plan drops the done tasks), or today's
 * to-do lesson of the active plan. `onlyToday` keeps just the latter.
 */
function coveringTask(today: string, onlyToday: boolean): SQL {
  const treated = onlyToday
    ? sql`(${studyPlans.status} = 'active' and ${tasks.date} = ${today} and ${tasks.status} in ('todo', 'doing'))`
    : sql`((${tasks.status} = 'done' and ${studyPlans.status} in ('active', 'superseded'))
      or (${studyPlans.status} = 'active' and ${tasks.date} = ${today} and ${tasks.status} in ('todo', 'doing')))`;
  return sql`(exists (
    select 1 from ${taskFlashcards}
    inner join ${tasks} on ${tasks.id} = ${taskFlashcards.taskId}
    inner join ${studyPlans} on ${studyPlans.id} = ${tasks.planId}
    where ${taskFlashcards.flashcardId} = ${flashcards.id}
      and ${studyPlans.subjectId} = ${artifacts.subjectId} and ${treated}
  ) or exists (
    select 1 from ${tasks}
    inner join ${studyPlans} on ${studyPlans.id} = ${tasks.planId}
    where ${tasks.topicId} = ${flashcards.topicId}
      and ${studyPlans.subjectId} = ${artifacts.subjectId}
      and ${tasks.kind} not in ('rest', 'simulation') and ${treated}
  ))`;
}

/**
 * "Only treated topics" rule: in a subject with an active plan a new card enters the review only
 * if its lesson (attached task, or a task on its topic) is done or scheduled today. Cards already
 * started and subjects without an active plan are unaffected. The caller joins `artifacts`;
 * `today` is the ISO day of the `now` the queue is built for.
 */
export function treatedCardCondition(now: Date): SQL {
  const today = toIsoDate(now);
  return sql`(${flashcards.state} <> 'new'
    or not exists (select 1 from ${studyPlans} where ${studyPlans.subjectId} = ${artifacts.subjectId} and ${studyPlans.status} = 'active')
    or ${coveringTask(today, false)})`;
}

/** The card belongs to a lesson of today (to-do), to put it before the other new cards. */
function todayLessonCondition(now: Date): SQL {
  return sql`(case when ${flashcards.state} = 'new' then ${coveringTask(toIsoDate(now), true)} else false end)`;
}

export interface ReviewScope {
  /** Omitted = every active (non-archived) subject. */
  subjectSlug?: string | undefined;
  /** Omitted = every topic; null = only cards without a topic. */
  topicId?: string | null | undefined;
  /** A plan task (lesson): its attached cards, due or not. Wins over `topicId`. */
  taskId?: string | undefined;
  /** Only the cards of this deck. */
  deckId?: string | undefined;
}

interface QueueRow {
  f: Flashcard;
  subjectId: string;
  subjectSlug: string;
  subjectName: string;
  subjectColor: string;
  topicName: string | null;
  /** New cards of today's lessons go first (only set by `loadDueRows`). */
  todayLesson?: boolean;
}

/**
 * Picks one subject's queue out of its due cards: (re)learning and review cards by due date, most
 * overdue first, then at most `newLimit` new cards, oldest first.
 */
function pickForSubject<T extends { f: Flashcard; todayLesson?: boolean }>(
  rows: T[],
  newLimit: number,
): T[] {
  const seen = rows.filter((r) => r.f.state !== 'new');
  seen.sort((a, b) => (a.f.dueAt?.getTime() ?? 0) - (b.f.dueAt?.getTime() ?? 0));
  const fresh = rows.filter((r) => r.f.state === 'new');
  // Stable: today's lessons first, the rest keeps its order.
  fresh.sort((a, b) => Number(!!b.todayLesson) - Number(!!a.todayLesson));
  return [...seen, ...fresh.slice(0, newLimit)];
}

function groupBySubject<T extends { subjectId: string }>(rows: T[]): T[][] {
  const groups = new Map<string, T[]>();
  for (const r of rows) {
    const list = groups.get(r.subjectId);
    if (list) list.push(r);
    else groups.set(r.subjectId, [r]);
  }
  return [...groups.values()];
}

/** Round-robin across subjects, so ten cards from "all subjects" are not ten from the first one. */
function interleave<T>(lists: T[][]): T[] {
  const total = lists.reduce((s, l) => s + l.length, 0);
  const out: T[] = [];
  for (let i = 0; out.length < total; i += 1) {
    for (const list of lists) if (i < list.length) out.push(list[i]!);
  }
  return out;
}

async function loadDueRows(db: AnyDb, scope: ReviewScope, now: Date): Promise<QueueRow[]> {
  const conditions = [...reviewableConditions(), dueCardConditions(now), treatedCardCondition(now)];
  if (scope.subjectSlug) {
    // An explicit subject is reviewable even when archived (the per-subject page still works).
    const subject = await requireSubject(db, scope.subjectSlug);
    conditions.push(eq(artifacts.subjectId, subject.id));
  } else {
    conditions.push(isNull(subjects.archivedAt));
  }
  if (scope.topicId === null) conditions.push(isNull(flashcards.topicId));
  else if (scope.topicId) conditions.push(eq(flashcards.topicId, scope.topicId));
  if (scope.deckId) conditions.push(eq(flashcards.deckId, scope.deckId));

  return db
    .select({
      f: flashcards,
      subjectId: subjects.id,
      subjectSlug: subjects.slug,
      subjectName: subjects.name,
      subjectColor: subjects.color,
      topicName: topics.name,
      todayLesson: sql<boolean>`${todayLessonCondition(now)}`,
    })
    .from(flashcards)
    .innerJoin(artifacts, eq(flashcards.deckId, artifacts.id))
    .innerJoin(subjects, eq(artifacts.subjectId, subjects.id))
    .leftJoin(topics, eq(flashcards.topicId, topics.id))
    .where(and(...conditions))
    .orderBy(subjects.sortOrder, subjects.name, flashcards.createdAt, flashcards.id);
}

/**
 * Lesson queue: every reviewable card attached to the task (see `task_flashcards`), due or not.
 * Due cards come first (learning/review by due date, then new ones), then the rest by due date.
 */
async function loadTaskQueueRows(db: AnyDb, scope: ReviewScope, now: Date): Promise<QueueRow[]> {
  const conditions = [...reviewableConditions(), eq(taskFlashcards.taskId, scope.taskId!)];
  if (scope.subjectSlug) {
    const subject = await requireSubject(db, scope.subjectSlug);
    conditions.push(eq(artifacts.subjectId, subject.id));
  }
  const rows: QueueRow[] = await db
    .select({
      f: flashcards,
      subjectId: subjects.id,
      subjectSlug: subjects.slug,
      subjectName: subjects.name,
      subjectColor: subjects.color,
      topicName: topics.name,
    })
    .from(taskFlashcards)
    .innerJoin(flashcards, eq(taskFlashcards.flashcardId, flashcards.id))
    .innerJoin(artifacts, eq(flashcards.deckId, artifacts.id))
    .innerJoin(subjects, eq(artifacts.subjectId, subjects.id))
    .leftJoin(topics, eq(flashcards.topicId, topics.id))
    .where(and(...conditions))
    .orderBy(taskFlashcards.createdAt, flashcards.createdAt, flashcards.id);

  const dueAt = (r: QueueRow) => r.f.dueAt?.getTime() ?? 0;
  const isDue = (r: QueueRow) => {
    if (r.f.state === 'new') return true;
    const due = r.f.dueAt?.getTime() ?? 0;
    return r.f.state === 'review' ? due <= endOfDay(now).getTime() : due <= now.getTime();
  };
  const due = rows.filter(isDue);
  const seenDue = due.filter((r) => r.f.state !== 'new').sort((a, b) => dueAt(a) - dueAt(b));
  const newDue = due.filter((r) => r.f.state === 'new');
  const rest = rows.filter((r) => !isDue(r)).sort((a, b) => dueAt(a) - dueAt(b));
  return [...seenDue, ...newDue, ...rest];
}

async function buildQueue(
  db: AnyDb,
  scope: ReviewScope,
  cap: number,
  newLimit: number,
  now: Date,
): Promise<QueueRow[]> {
  const rows = await loadDueRows(db, scope, now);
  const perSubject = groupBySubject(rows).map((list) => pickForSubject(list, newLimit));
  return interleave(perSubject).slice(0, cap);
}

export interface ReviewQueueOptions {
  cap?: number | undefined;
  newLimit?: number | undefined;
  topicId?: string | undefined;
  now?: Date | undefined;
}

/**
 * Daily review queue (docs/fasi/F4-flashcard.md): "coda giornaliera con cap
 * configurabile e mix new/review; modalità solo argomento X". Review cards
 * (overdue first) fill the queue up to `cap`, with at most `newLimit` new
 * cards mixed in.
 */
export async function getReviewQueue(
  db: AnyDb,
  subjectSlug: string,
  options: ReviewQueueOptions = {},
): Promise<FlashcardDto[]> {
  const queue = await buildQueue(
    db,
    { subjectSlug, topicId: options.topicId },
    options.cap ?? 50,
    options.newLimit ?? DEFAULT_NEW_LIMIT,
    options.now ?? new Date(),
  );
  return queue.map((r) => toDto(r.f));
}

function toIntervals(schedule: FlashcardSchedule, now: Date): RatingIntervals {
  const p = previewIntervals(schedule, now);
  return { 1: p[1], 2: p[2], 3: p[3], 4: p[4] };
}

/**
 * Ripasso rapido queue (docs/09-ripasso-mobile.md §B2): one subject, one topic, or every active
 * subject interleaved. Each item carries its subject and topic for the card header, and the
 * interval each rating would give, for the buttons.
 */
export async function getQuickReviewQueue(
  db: AnyDb,
  scope: ReviewScope,
  options: { n?: number | undefined; now?: Date | undefined } = {},
): Promise<ReviewQueueItemDto[]> {
  const now = options.now ?? new Date();
  const cap = options.n ?? 500;
  const queue = scope.taskId
    ? (await loadTaskQueueRows(db, scope, now)).slice(0, cap)
    : await buildQueue(db, scope, cap, DEFAULT_NEW_LIMIT, now);
  return queue.map((r) => ({
    ...toDto(r.f),
    subjectSlug: r.subjectSlug,
    subjectName: r.subjectName,
    subjectColor: r.subjectColor as SubjectColor,
    topicName: r.topicName,
    intervals: toIntervals(toSchedule(r.f), now),
  }));
}

/**
 * Home of the Ripasso rapido (docs/09-ripasso-mobile.md §B2): every active subject with its due
 * count, next exam and topics. Each count is exactly what starting that row returns with "Tutte":
 * a subject or topic queue applies `newLimit` on its own, so topic counts can add up to more than
 * their subject's when it has many new cards.
 */
export async function getReviewOverview(
  db: AnyDb,
  now: Date = new Date(),
  options: { subjectSlug?: string | undefined } = {},
): Promise<ReviewOverviewDto> {
  // One explicit subject is always included, even archived (like its own queue); otherwise only
  // the active ones.
  const live = options.subjectSlug
    ? eq(subjects.slug, options.subjectSlug)
    : isNull(subjects.archivedAt);
  const [subjectRows, topicRows, dueRows, countRows, examRows, [next], recentReviews] =
    await Promise.all([
      db
        .select({
          id: subjects.id,
          slug: subjects.slug,
          name: subjects.name,
          color: subjects.color,
        })
        .from(subjects)
        .where(live)
        .orderBy(subjects.sortOrder, subjects.name),
      db
        .select({
          id: topics.id,
          subjectId: topics.subjectId,
          name: topics.name,
          mastery: topics.mastery,
        })
        .from(topics)
        .innerJoin(subjects, eq(topics.subjectId, subjects.id))
        .where(live)
        .orderBy(topics.orderIndex, topics.name),
      loadDueRows(db, options.subjectSlug ? { subjectSlug: options.subjectSlug } : {}, now),
      db
        .select({
          subjectId: artifacts.subjectId,
          topicId: flashcards.topicId,
          count: sql<number>`count(*)::int`,
        })
        .from(flashcards)
        .innerJoin(artifacts, eq(flashcards.deckId, artifacts.id))
        .innerJoin(subjects, eq(artifacts.subjectId, subjects.id))
        .where(and(...reviewableConditions(), live))
        .groupBy(artifacts.subjectId, flashcards.topicId),
      db
        .select({ subjectId: exams.subjectId, title: exams.title, date: exams.date })
        .from(exams)
        .where(and(eq(exams.status, 'scheduled'), gte(exams.date, startOfDay(now))))
        .orderBy(exams.date),
      db
        .select({ at: sql<Date | string | null>`min(${flashcards.dueAt})` })
        .from(flashcards)
        .innerJoin(artifacts, eq(flashcards.deckId, artifacts.id))
        .innerJoin(subjects, eq(artifacts.subjectId, subjects.id))
        .where(and(...reviewableConditions(), live, not(dueCardConditions(now)))),
      // Real response times, to estimate the minutes: latest reviews, outliers (forgotten tab) left out.
      db
        .select({ elapsedMs: reviews.elapsedMs })
        .from(reviews)
        .where(
          and(gt(reviews.elapsedMs, 0), lte(reviews.elapsedMs, REVIEW_ESTIMATE_MAX_ELAPSED_MS)),
        )
        .orderBy(desc(reviews.reviewedAt))
        .limit(REVIEW_ESTIMATE_SAMPLE),
    ]);
  const avgMs = averageMsPerCard(
    (recentReviews as { elapsedMs: number }[]).map((r) => r.elapsedMs),
  );

  const key = (subjectId: string, topicId: string | null) => `${subjectId}|${topicId ?? ''}`;
  const cardCounts = new Map<string, number>();
  for (const r of countRows as { subjectId: string; topicId: string | null; count: number }[]) {
    cardCounts.set(key(r.subjectId, r.topicId), Number(r.count));
  }
  const dueBySubject = new Map(groupBySubject(dueRows).map((l) => [l[0]!.subjectId, l]));
  const firstExam = new Map<string, { title: string; date: Date }>();
  for (const e of examRows as { subjectId: string; title: string; date: Date }[]) {
    if (!firstExam.has(e.subjectId)) firstExam.set(e.subjectId, e);
  }

  const subjectsOut = (
    subjectRows as { id: string; slug: string; name: string; color: string }[]
  ).map((s) => {
    const due = dueBySubject.get(s.id) ?? [];
    const dueInTopic = (topicId: string | null) =>
      pickForSubject(
        due.filter((r) => r.f.topicId === topicId),
        DEFAULT_NEW_LIMIT,
      ).length;
    const ownTopics = (
      topicRows as { id: string; subjectId: string; name: string; mastery: number | null }[]
    ).filter((t) => t.subjectId === s.id);
    const topicsOut: ReviewOverviewTopicDto[] = ownTopics.map((t) => ({
      id: t.id,
      name: t.name,
      mastery: t.mastery,
      due: dueInTopic(t.id),
      cardCount: cardCounts.get(key(s.id, t.id)) ?? 0,
    }));
    const untagged = cardCounts.get(key(s.id, null)) ?? 0;
    if (untagged > 0) {
      topicsOut.push({
        id: null,
        name: 'Senza argomento',
        mastery: null,
        due: dueInTopic(null),
        cardCount: untagged,
      });
    }
    const exam = firstExam.get(s.id);
    const picked = pickForSubject(due, DEFAULT_NEW_LIMIT);
    const subjectDue = picked.length;
    const subjectNew = picked.filter((r) => r.f.state === 'new').length;
    return {
      slug: s.slug,
      name: s.name,
      color: s.color as SubjectColor,
      nextExam: exam ? { title: exam.title, date: exam.date.toISOString() } : null,
      due: subjectDue,
      dueCount: subjectDue - subjectNew,
      newCount: subjectNew,
      estimatedMinutes: estimateReviewMinutes(subjectDue, avgMs),
      cardCount: topicsOut.reduce((sum, t) => sum + t.cardCount, 0),
      topics: topicsOut,
    };
  });

  const totalDue = subjectsOut.reduce((sum, s) => sum + s.due, 0);
  return {
    totalDue,
    estimatedMinutes: estimateReviewMinutes(totalDue, avgMs),
    avgMsPerCard: avgMs,
    totalCards: subjectsOut.reduce((sum, s) => sum + s.cardCount, 0),
    nextDueAt: next?.at ? new Date(next.at).toISOString() : null,
    subjects: subjectsOut,
  };
}

function startOfDay(now: Date): Date {
  return new Date(`${now.toISOString().slice(0, 10)}T00:00:00.000Z`);
}

export interface SubmitReviewInput {
  rating: FsrsRating;
  elapsedMs: number;
  confidence?: 1 | 2 | 3 | undefined;
}

/**
 * Applies one FSRS review (docs/fasi/F4-flashcard.md): updates the card's
 * schedule and records a `reviews` row (rating + response time — dataset
 * for future FSRS parameter optimization and the Planner's difficulty
 * signal).
 */
export async function submitReview(
  db: AnyDb,
  subjectSlug: string,
  cardId: string,
  input: SubmitReviewInput,
  now: Date = new Date(),
): Promise<SubmitReviewResponse> {
  const subject = await requireSubject(db, subjectSlug);
  const [row] = await db
    .select({ f: flashcards })
    .from(flashcards)
    .innerJoin(artifacts, eq(flashcards.deckId, artifacts.id))
    .where(and(eq(flashcards.id, cardId), eq(artifacts.subjectId, subject.id)));
  if (!row) throw new FlashcardNotFoundError(cardId);
  const card: Flashcard = row.f;

  const currentSchedule =
    card.reps === 0 && card.state === 'new' ? newCardSchedule() : toSchedule(card);
  const result = scheduleReview(currentSchedule, input.rating, now);

  const [updated] = await db
    .update(flashcards)
    .set(scheduleColumns(result.schedule))
    .where(eq(flashcards.id, cardId))
    .returning();

  const reviewId = randomUUID();
  await db.insert(reviews).values({
    id: reviewId,
    flashcardId: cardId,
    rating: input.rating,
    elapsedMs: input.elapsedMs,
    reviewedAt: now,
    confidence: input.confidence ?? null,
    prevStability: result.prevStability,
    newStability: result.newStability,
    prevSchedule: toStoredSchedule(toSchedule(card)),
  });

  // Every review shifts this card's retrievability, and the topic's mastery
  // (docs/02-filesystem-e-dati.md §5) is an average over it — not just after
  // simulation grading (docs/fasi/F5-esami-simulazioni.md "Stato").
  if (card.topicId) await recomputeTopicMastery(db, card.topicId);

  return {
    flashcard: toDto(updated),
    reviewId,
    dueAt: result.schedule.dueAt!.toISOString(),
    intervals: toIntervals(result.schedule, now),
  };
}

function scheduleColumns(s: FlashcardSchedule) {
  return {
    stability: s.stability,
    difficulty: s.difficulty,
    dueAt: s.dueAt,
    lastReviewAt: s.lastReviewAt,
    reps: s.reps,
    lapses: s.lapses,
    state: s.state,
  };
}

function toStoredSchedule(s: FlashcardSchedule): ReviewPrevSchedule {
  return {
    ...s,
    dueAt: s.dueAt ? s.dueAt.toISOString() : null,
    lastReviewAt: s.lastReviewAt ? s.lastReviewAt.toISOString() : null,
  };
}

function fromStoredSchedule(s: ReviewPrevSchedule): FlashcardSchedule {
  return {
    ...s,
    dueAt: s.dueAt ? new Date(s.dueAt) : null,
    lastReviewAt: s.lastReviewAt ? new Date(s.lastReviewAt) : null,
  };
}

export class ReviewNotFoundError extends Error {
  constructor(id: string) {
    super(`Valutazione non trovata: ${id}`);
    this.name = 'ReviewNotFoundError';
  }
}

export class ReviewNotUndoableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReviewNotUndoableError';
  }
}

/**
 * Undoes a rating (docs/09-ripasso-mobile.md §B3): puts the card back exactly as it was before
 * it and deletes the `reviews` row, so stats and calibration forget it too. Only the card's
 * latest review can be undone — restoring an older snapshot would silently drop the newer ones.
 */
export async function undoReview(db: AnyDb, reviewId: string): Promise<FlashcardDto> {
  return db.transaction(async (tx: AnyDb) => {
    const [review] = await tx.select().from(reviews).where(eq(reviews.id, reviewId));
    if (!review) throw new ReviewNotFoundError(reviewId);
    if (!review.prevSchedule) {
      throw new ReviewNotUndoableError(
        'Questa valutazione è precedente all’annulla e non si può annullare',
      );
    }
    const [latest] = await tx
      .select({ id: reviews.id })
      .from(reviews)
      .where(eq(reviews.flashcardId, review.flashcardId))
      .orderBy(desc(reviews.reviewedAt), desc(reviews.id))
      .limit(1);
    if (latest?.id !== reviewId) {
      throw new ReviewNotUndoableError('Si può annullare solo l’ultima valutazione della card');
    }

    const [restored] = await tx
      .update(flashcards)
      .set(scheduleColumns(fromStoredSchedule(review.prevSchedule)))
      .where(eq(flashcards.id, review.flashcardId))
      .returning();
    await tx.delete(reviews).where(eq(reviews.id, reviewId));
    if (restored.topicId) await recomputeTopicMastery(tx, restored.topicId);
    return toDto(restored);
  });
}

export interface ListFlashcardsOptions {
  topicId?: string | undefined;
  state?: FsrsCardState | undefined;
  suspended?: boolean | undefined;
  flagged?: boolean | undefined;
  /** true = suspended OR flagged, in an approved deck; false = the opposite. */
  excluded?: boolean | undefined;
  /** 'recent' (default): newest first. 'due': next review first, cards without one last. */
  sort?: 'due' | 'recent' | undefined;
  deckId?: string | undefined;
  tag?: string | undefined;
  q?: string | undefined;
  cursor?: string | undefined;
  limit?: number | undefined;
}

/** The DTO's `dueAt`: null for new and suspended cards, so the sort agrees with what the UI shows. */
const effectiveDueAt = sql`(case when ${flashcards.suspended} or ${flashcards.state} = 'new' then null else ${flashcards.dueAt} end)`;

/**
 * Timestamps in a cursor travel as text with microsecond precision (`to_char ... US`): batch-inserted
 * cards share a `created_at` that JS `Date` (milliseconds) would truncate, and the next page would
 * then skip or lose them.
 */
const PG_TS_FORMAT = `YYYY-MM-DD"T"HH24:MI:SS.US"Z"`;
const tsText = (expr: SQL) =>
  sql<string | null>`to_char(${expr} at time zone 'UTC', ${PG_TS_FORMAT}::text)`;

interface CursorKeys {
  ca: string;
  da: string | null;
}

function encodeCursor(row: { id: string } & CursorKeys, sort: 'due' | 'recent'): string {
  const text =
    sort === 'recent' ? `${row.ca}|${row.id}` : `due|${row.da ?? ''}|${row.ca}|${row.id}`;
  return Buffer.from(text, 'utf-8').toString('base64url');
}

function decodeCursor(cursor: string): { createdAt: string; id: string } {
  const [createdAt, id] = Buffer.from(cursor, 'base64url').toString('utf-8').split('|');
  if (!createdAt || !id) throw new InvalidRequestError('Cursore non valido');
  return { createdAt, id };
}

function decodeDueCursor(cursor: string): { dueAt: string | null; createdAt: string; id: string } {
  const parts = Buffer.from(cursor, 'base64url').toString('utf-8').split('|');
  if (parts[0] !== 'due' || parts.length !== 4 || !parts[2] || !parts[3]) {
    throw new InvalidRequestError('Cursore non valido');
  }
  return { dueAt: parts[1] || null, createdAt: parts[2], id: parts[3] };
}

/** DTOs with the source document's original name in `sourceRef.docTitle` (null if it is gone). */
async function withDocTitles(
  db: AnyDb,
  subjectId: string,
  cards: Flashcard[],
): Promise<FlashcardDto[]> {
  const docIds = [...new Set(cards.flatMap((c) => (c.sourceRef ? [c.sourceRef.docId] : [])))];
  const docNames = new Map<string, string>();
  if (docIds.length > 0) {
    const docs: { id: string; name: string }[] = await db
      .select({ id: documents.id, name: documents.originalName })
      .from(documents)
      .where(and(inArray(documents.id, docIds), eq(documents.subjectId, subjectId)));
    for (const d of docs) docNames.set(d.id, d.name);
  }
  return cards.map((c) => {
    const dto = toDto(c);
    return dto.sourceRef
      ? {
          ...dto,
          sourceRef: { ...dto.sourceRef, docTitle: docNames.get(dto.sourceRef.docId) ?? null },
        }
      : dto;
  });
}

/** One card of the subject, with the source document name; NotFoundError (404) otherwise. */
export async function getFlashcard(
  db: AnyDb,
  subjectSlug: string,
  cardId: string,
): Promise<FlashcardDto> {
  const subject = await requireSubject(db, subjectSlug);
  const [row] = await db
    .select({ f: flashcards })
    .from(flashcards)
    .innerJoin(artifacts, eq(flashcards.deckId, artifacts.id))
    .where(and(eq(flashcards.id, cardId), eq(artifacts.subjectId, subject.id)));
  if (!row) throw new NotFoundError(`Flashcard non trovata: ${cardId}`);
  return (await withDocTitles(db, subject.id, [row.f]))[0]!;
}

/**
 * Flashcard list for the Flashcard tab. Cursor-based: a deck can hold thousands of cards, and
 * offset pagination would only get slower as the user pages deeper in. `sort: 'recent'` (default)
 * is `(createdAt, id)` DESC; `sort: 'due'` is next review first, never-scheduled cards last, then
 * newest. `total` counts the cards matching the filters, whatever the cursor.
 */
export async function listFlashcards(
  db: AnyDb,
  subjectSlug: string,
  options: ListFlashcardsOptions = {},
): Promise<FlashcardPageDto> {
  const subject = await requireSubject(db, subjectSlug);
  const limit = Math.min(options.limit ?? 50, 200);
  const sort = options.sort ?? 'recent';

  const conditions = [eq(artifacts.subjectId, subject.id)];
  if (options.topicId === 'none') conditions.push(isNull(flashcards.topicId));
  else if (options.topicId) conditions.push(eq(flashcards.topicId, options.topicId));
  if (options.state) conditions.push(eq(flashcards.state, options.state));
  if (options.suspended !== undefined) conditions.push(eq(flashcards.suspended, options.suspended));
  if (options.flagged !== undefined) {
    conditions.push(
      options.flagged ? isNotNull(flashcards.flaggedAt) : isNull(flashcards.flaggedAt),
    );
  }
  if (options.excluded !== undefined) {
    // Same set as `excludedCount` in the stats: only approved decks (drafts are "Da approvare").
    const excluded = and(
      eq(artifacts.status, 'approved'),
      or(eq(flashcards.suspended, true), isNotNull(flashcards.flaggedAt)),
    )!;
    conditions.push(options.excluded ? excluded : not(excluded));
  }
  if (options.deckId) conditions.push(eq(flashcards.deckId, options.deckId));
  if (options.tag) conditions.push(sql`${options.tag} = ANY(${flashcards.tags})`);
  if (options.q) {
    // Escape LIKE wildcards so a search for "100%" doesn't match everything.
    const needle = `%${options.q.replace(/[\\%_]/g, '\\$&')}%`;
    conditions.push(or(ilike(flashcards.front, needle), ilike(flashcards.back, needle))!);
  }

  const [totalRow] = (await db
    .select({ total: sql<number>`count(*)::int` })
    .from(flashcards)
    .innerJoin(artifacts, eq(flashcards.deckId, artifacts.id))
    .where(and(...conditions))) as { total: number }[];
  const total = totalRow?.total ?? 0;

  const createdBefore = (createdAt: string, id: string) =>
    or(
      sql`${flashcards.createdAt} < ${createdAt}::timestamptz`,
      and(sql`${flashcards.createdAt} = ${createdAt}::timestamptz`, lt(flashcards.id, id))!,
    )!;
  if (options.cursor) {
    if (sort === 'recent') {
      const { createdAt, id } = decodeCursor(options.cursor);
      conditions.push(createdBefore(createdAt, id));
    } else {
      const { dueAt, createdAt, id } = decodeDueCursor(options.cursor);
      const tie = createdBefore(createdAt, id);
      conditions.push(
        dueAt
          ? or(
              sql`${effectiveDueAt} > ${dueAt}::timestamptz`,
              sql`${effectiveDueAt} is null`,
              and(sql`${effectiveDueAt} = ${dueAt}::timestamptz`, tie)!,
            )!
          : and(sql`${effectiveDueAt} is null`, tie)!,
      );
    }
  }

  const orderBy =
    sort === 'due'
      ? [sql`${effectiveDueAt} asc nulls last`, desc(flashcards.createdAt), desc(flashcards.id)]
      : [desc(flashcards.createdAt), desc(flashcards.id)];
  const joined: ({ f: Flashcard } & CursorKeys)[] = await db
    .select({
      f: flashcards,
      ca: tsText(sql`${flashcards.createdAt}`),
      da: tsText(effectiveDueAt),
    })
    .from(flashcards)
    .innerJoin(artifacts, eq(flashcards.deckId, artifacts.id))
    .where(and(...conditions))
    .orderBy(...orderBy)
    .limit(limit + 1);
  const rows = joined.map((r) => r.f);

  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit);
  const last = joined[page.length - 1];

  const items = await withDocTitles(db, subject.id, page);
  return {
    items,
    nextCursor:
      hasMore && last ? encodeCursor({ id: last.f.id, ca: last.ca, da: last.da }, sort) : null,
    total: Number(total),
  };
}

export async function setFlashcardSuspended(
  db: AnyDb,
  subjectSlug: string,
  cardId: string,
  suspended: boolean,
): Promise<FlashcardDto> {
  const subject = await requireSubject(db, subjectSlug);
  const [row] = await db
    .select({ f: flashcards })
    .from(flashcards)
    .innerJoin(artifacts, eq(flashcards.deckId, artifacts.id))
    .where(and(eq(flashcards.id, cardId), eq(artifacts.subjectId, subject.id)));
  if (!row) throw new FlashcardNotFoundError(cardId);

  const [updated] = await db
    .update(flashcards)
    .set({ suspended })
    .where(eq(flashcards.id, cardId))
    .returning();
  return toDto(updated);
}
