import { randomUUID } from 'node:crypto';
import { and, desc, eq, ilike, isNotNull, isNull, lt, or, sql } from 'drizzle-orm';
import {
  artifacts,
  flashcards,
  recomputeTopicMastery,
  reviews,
  subjects,
  type Flashcard,
} from '@studyhub/db';
import {
  isDue,
  newCardSchedule,
  scheduleReview,
  type FlashcardSchedule,
  type FsrsCardState,
  type FsrsRating,
} from '@studyhub/core';
import type { FlashcardDto, FlashcardPageDto } from '@studyhub/contracts';
import { SubjectNotFoundError } from './errors';

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
    createdAt: row.createdAt.toISOString(),
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

export interface ReviewQueueOptions {
  cap?: number | undefined;
  newLimit?: number | undefined;
  topicId?: string | undefined;
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
  const subject = await requireSubject(db, subjectSlug);
  const cap = options.cap ?? 50;
  const newLimit = options.newLimit ?? 20;

  // Flagged ("scadente") cards stay in the deck but never reach the queue (F4 "Rischi").
  const conditions = [
    eq(artifacts.subjectId, subject.id),
    eq(flashcards.suspended, false),
    isNull(flashcards.flaggedAt),
  ];
  if (options.topicId) conditions.push(eq(flashcards.topicId, options.topicId));

  const joined: { f: Flashcard }[] = await db
    .select({ f: flashcards })
    .from(flashcards)
    .innerJoin(artifacts, eq(flashcards.deckId, artifacts.id))
    .where(and(...conditions));
  const rows = joined.map((r) => r.f);

  const now = new Date();
  const due = rows.filter((r) => r.state !== 'new' && isDue(toSchedule(r), now));
  due.sort((a, b) => (a.dueAt?.getTime() ?? 0) - (b.dueAt?.getTime() ?? 0));
  const fresh = rows.filter((r) => r.state === 'new');

  const queue = [...due, ...fresh.slice(0, newLimit)].slice(0, cap);
  return queue.map(toDto);
}

export interface SubmitReviewInput {
  rating: FsrsRating;
  elapsedMs: number;
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
): Promise<FlashcardDto> {
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
  const result = scheduleReview(currentSchedule, input.rating, new Date());

  const [updated] = await db
    .update(flashcards)
    .set({
      stability: result.schedule.stability,
      difficulty: result.schedule.difficulty,
      dueAt: result.schedule.dueAt,
      lastReviewAt: result.schedule.lastReviewAt,
      reps: result.schedule.reps,
      lapses: result.schedule.lapses,
      state: result.schedule.state,
    })
    .where(eq(flashcards.id, cardId))
    .returning();

  await db.insert(reviews).values({
    id: randomUUID(),
    flashcardId: cardId,
    rating: input.rating,
    elapsedMs: input.elapsedMs,
    prevStability: result.prevStability,
    newStability: result.newStability,
  });

  // Every review shifts this card's retrievability, and the topic's mastery
  // (docs/02-filesystem-e-dati.md §5) is an average over it — not just after
  // simulation grading (docs/fasi/F5-esami-simulazioni.md "Stato").
  if (card.topicId) await recomputeTopicMastery(db, card.topicId);

  return toDto(updated);
}

export interface ListFlashcardsOptions {
  topicId?: string | undefined;
  state?: FsrsCardState | undefined;
  suspended?: boolean | undefined;
  flagged?: boolean | undefined;
  deckId?: string | undefined;
  tag?: string | undefined;
  q?: string | undefined;
  cursor?: string | undefined;
  limit?: number | undefined;
}

function encodeCursor(row: Flashcard): string {
  return Buffer.from(`${row.createdAt.toISOString()}|${row.id}`, 'utf-8').toString('base64url');
}

function decodeCursor(cursor: string): { createdAt: Date; id: string } {
  const [iso, id] = Buffer.from(cursor, 'base64url').toString('utf-8').split('|');
  return { createdAt: new Date(iso!), id: id! };
}

/**
 * Read-only flashcard list for the Flashcard tab (docs/fasi/F2-materie.md — the bulk editor
 * stays F4). Cursor-based on `(createdAt, id)` DESC, newest first: a deck can hold thousands of
 * cards, and offset pagination would only get slower as the user pages deeper in.
 */
export async function listFlashcards(
  db: AnyDb,
  subjectSlug: string,
  options: ListFlashcardsOptions = {},
): Promise<FlashcardPageDto> {
  const subject = await requireSubject(db, subjectSlug);
  const limit = Math.min(options.limit ?? 50, 200);

  const conditions = [eq(artifacts.subjectId, subject.id)];
  if (options.topicId) conditions.push(eq(flashcards.topicId, options.topicId));
  if (options.state) conditions.push(eq(flashcards.state, options.state));
  if (options.suspended !== undefined) conditions.push(eq(flashcards.suspended, options.suspended));
  if (options.flagged !== undefined) {
    conditions.push(
      options.flagged ? isNotNull(flashcards.flaggedAt) : isNull(flashcards.flaggedAt),
    );
  }
  if (options.deckId) conditions.push(eq(flashcards.deckId, options.deckId));
  if (options.tag) conditions.push(sql`${options.tag} = ANY(${flashcards.tags})`);
  if (options.q) {
    // Escape LIKE wildcards so a search for "100%" doesn't match everything.
    const needle = `%${options.q.replace(/[\\%_]/g, '\\$&')}%`;
    conditions.push(or(ilike(flashcards.front, needle), ilike(flashcards.back, needle))!);
  }
  if (options.cursor) {
    const { createdAt, id } = decodeCursor(options.cursor);
    conditions.push(
      or(
        lt(flashcards.createdAt, createdAt),
        and(eq(flashcards.createdAt, createdAt), lt(flashcards.id, id))!,
      )!,
    );
  }

  const joined: { f: Flashcard }[] = await db
    .select({ f: flashcards })
    .from(flashcards)
    .innerJoin(artifacts, eq(flashcards.deckId, artifacts.id))
    .where(and(...conditions))
    .orderBy(desc(flashcards.createdAt), desc(flashcards.id))
    .limit(limit + 1);
  const rows = joined.map((r) => r.f);

  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit);
  return {
    items: page.map(toDto),
    nextCursor: hasMore ? encodeCursor(page[page.length - 1]!) : null,
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
