import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
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
  type FsrsRating,
} from '@studyhub/core';
import type { FlashcardDto } from '@studyhub/contracts';
import { SubjectNotFoundError } from './errors';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = any;

export class FlashcardNotFoundError extends Error {
  constructor(id: string) {
    super(`Flashcard non trovata: ${id}`);
    this.name = 'FlashcardNotFoundError';
  }
}

function toDto(row: Flashcard): FlashcardDto {
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

  const conditions = [eq(artifacts.subjectId, subject.id), eq(flashcards.suspended, false)];
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
