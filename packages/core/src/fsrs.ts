import { createEmptyCard, forgetting_curve, fsrs, State, type Card, type Grade } from 'ts-fsrs';

/**
 * FSRS-5 scheduling (docs/02-filesystem-e-dati.md §4, docs/fasi/F4-flashcard.md):
 * wraps `ts-fsrs` behind our own DB-shaped types so nothing outside this file
 * needs to know the library's `Card`/`Rating`/`State` representations.
 */
export type FsrsRating = 1 | 2 | 3 | 4; // Again, Hard, Good, Easy (never Manual=0)
export type FsrsCardState = 'new' | 'learning' | 'review' | 'relearning';

export interface FlashcardSchedule {
  stability: number | null;
  difficulty: number | null;
  dueAt: Date | null;
  lastReviewAt: Date | null;
  reps: number;
  lapses: number;
  state: FsrsCardState;
}

export interface ReviewResult {
  schedule: FlashcardSchedule;
  prevStability: number | null;
  newStability: number;
  elapsedDays: number;
  scheduledDays: number;
}

const STATE_TO_DB: Record<State, FsrsCardState> = {
  [State.New]: 'new',
  [State.Learning]: 'learning',
  [State.Review]: 'review',
  [State.Relearning]: 'relearning',
};
const DB_TO_STATE: Record<FsrsCardState, State> = {
  new: State.New,
  learning: State.Learning,
  review: State.Review,
  relearning: State.Relearning,
};

// Default FSRS-5 parameters (docs/02 §4: "Parametri ottimizzabili dai reviews
// dell'utente dopo ~1000 recensioni" — optimization from user history is a
// later phase; this is the library's stock, well-validated default).
const scheduler = fsrs();

function cardToSchedule(card: Card): FlashcardSchedule {
  return {
    stability: card.stability,
    difficulty: card.difficulty,
    dueAt: card.due,
    lastReviewAt: card.last_review ?? null,
    reps: card.reps,
    lapses: card.lapses,
    state: STATE_TO_DB[card.state],
  };
}

function scheduleToCard(schedule: FlashcardSchedule, now: Date): Card {
  if (schedule.state === 'new') {
    // A never-reviewed card has no meaningful stability/difficulty yet —
    // let the library seed them from scratch, "due now".
    return createEmptyCard(now);
  }
  const base: Card = {
    due: schedule.dueAt ?? now,
    stability: schedule.stability ?? 0,
    difficulty: schedule.difficulty ?? 0,
    elapsed_days: schedule.lastReviewAt
      ? Math.max(0, (now.getTime() - schedule.lastReviewAt.getTime()) / 86_400_000)
      : 0,
    scheduled_days: 0,
    reps: schedule.reps,
    lapses: schedule.lapses,
    state: DB_TO_STATE[schedule.state],
  };
  return schedule.lastReviewAt ? { ...base, last_review: schedule.lastReviewAt } : base;
}

/** The schedule a freshly-created flashcard starts with — no history, due immediately. */
export function newCardSchedule(): FlashcardSchedule {
  return {
    stability: null,
    difficulty: null,
    dueAt: null,
    lastReviewAt: null,
    reps: 0,
    lapses: 0,
    state: 'new',
  };
}

/** Applies one FSRS review to a card's schedule. Pure — no I/O, no clock reads unless `now` is omitted. */
export function scheduleReview(
  current: FlashcardSchedule,
  rating: FsrsRating,
  now: Date = new Date(),
): ReviewResult {
  const card = scheduleToCard(current, now);
  const { card: nextCard, log } = scheduler.next(card, now, rating as Grade);
  return {
    schedule: cardToSchedule(nextCard),
    prevStability: current.state === 'new' ? null : current.stability,
    newStability: nextCard.stability,
    elapsedDays: log.elapsed_days,
    scheduledDays: log.scheduled_days,
  };
}

/**
 * `retrievability(t)` — probability of recall right now, per FSRS's
 * forgetting curve. 0 for a card that has never been reviewed (docs/02 §5
 * uses this to feed `mastery`, and F4's "card a rischio per la data
 * d'esame" — see `packages/core/src/forecast.ts`).
 */
export function retrievability(schedule: FlashcardSchedule, at: Date = new Date()): number {
  if (schedule.state === 'new' || schedule.stability === null || !schedule.lastReviewAt) return 0;
  const elapsedDays = Math.max(0, (at.getTime() - schedule.lastReviewAt.getTime()) / 86_400_000);
  return forgetting_curve(elapsedDays, schedule.stability);
}

export function isDue(schedule: FlashcardSchedule, at: Date = new Date()): boolean {
  if (schedule.state === 'new') return true;
  return (schedule.dueAt?.getTime() ?? 0) <= at.getTime();
}
