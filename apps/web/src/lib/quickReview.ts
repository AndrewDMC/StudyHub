import type { RatingIntervals, ReviewOverviewDto, ReviewQueueItemDto } from '@studyhub/contracts';

/**
 * Ripasso rapido (docs/09-ripasso-mobile.md §C): the session as pure functions over
 * `{ queue, idx, history }`, so the re-queueing, undo and summary rules are testable without a DOM.
 * The server is the source of truth for FSRS; this only tracks what the user did in this session.
 */

export type Rating = 1 | 2 | 3 | 4;
export const RATINGS: readonly Rating[] = [1, 2, 3, 4];

export const RATING_LABELS: Record<Rating, string> = {
  1: 'Di nuovo',
  2: 'Difficile',
  3: 'Bene',
  4: 'Facile',
};

/** "Card per sessione": 0 = Tutte. */
export const SESSION_LIMITS = [5, 10, 0] as const;
export type SessionLimit = (typeof SESSION_LIMITS)[number];
export const DEFAULT_SESSION_LIMIT: SessionLimit = 10;

export function parseSessionLimit(value: string | null | undefined): SessionLimit {
  const n = value ? Number(value) : NaN;
  return (SESSION_LIMITS as readonly number[]).includes(n)
    ? (n as SessionLimit)
    : DEFAULT_SESSION_LIMIT;
}

/**
 * What a session draws from. `topicId` undefined = every topic of the subject, null = the cards
 * without a topic ("Senza argomento"); no `subjectSlug` = every subject.
 */
export interface ReviewScope {
  subjectSlug?: string;
  topicId?: string | null;
}

export function scopeToSearchParams(scope: ReviewScope, limit: number): URLSearchParams {
  const qs = new URLSearchParams();
  if (scope.subjectSlug) qs.set('materia', scope.subjectSlug);
  if (scope.subjectSlug && scope.topicId !== undefined) {
    qs.set('argomento', scope.topicId ?? 'none');
  }
  if (limit) qs.set('n', String(limit));
  return qs;
}

/** Inverse of `scopeToSearchParams`, for the `/ripasso?materia=&argomento=&n=` deep link. */
export function scopeFromSearchParams(params: {
  materia?: string | null | undefined;
  argomento?: string | null | undefined;
}): ReviewScope | null {
  if (!params.materia) return null;
  if (!params.argomento) return { subjectSlug: params.materia };
  return {
    subjectSlug: params.materia,
    topicId: params.argomento === 'none' ? null : params.argomento,
  };
}

/** "Basi di Dati · Normalizzazione", "Basi di Dati · tutti gli argomenti", "Tutte le materie". */
export function sessionTitle(scope: ReviewScope, overview: ReviewOverviewDto | undefined): string {
  if (!scope.subjectSlug) return 'Tutte le materie';
  const subject = overview?.subjects.find((s) => s.slug === scope.subjectSlug);
  const name = subject?.name ?? scope.subjectSlug;
  if (scope.topicId === undefined) return `${name} · tutti gli argomenti`;
  const topic = subject?.topics.find((t) => t.id === scope.topicId);
  return `${name} · ${topic?.name ?? (scope.topicId === null ? 'Senza argomento' : 'argomento')}`;
}

export interface RatedEntry {
  /** Client-side id: ties this rating to its request in the outbox (and to its undo). */
  key: string;
  cardId: string;
  rating: Rating;
  /** "Di nuovo" put a copy of the card at the end of the queue. */
  appended: boolean;
  /** Time on the card, from shown to rated. */
  ms: number;
  ratedAt: number;
  /** Next review, epoch ms: estimated from the card's intervals until the server answers. */
  dueAt: number;
}

export interface SessionState {
  queue: ReviewQueueItemDto[];
  /** Index of the card on screen; `queue.length` = finished. */
  idx: number;
  history: RatedEntry[];
}

export function startSession(queue: ReviewQueueItemDto[]): SessionState {
  return { queue, idx: 0, history: [] };
}

export function currentCard(state: SessionState): ReviewQueueItemDto | undefined {
  return state.queue[state.idx];
}

export function isFinished(state: SessionState): boolean {
  return state.idx >= state.queue.length;
}

/** Rates the card on screen and moves on; "Di nuovo" re-queues it at the end of the session. */
export function rateCard(
  state: SessionState,
  input: { key: string; rating: Rating; ms: number; now: number },
): SessionState {
  const card = currentCard(state);
  if (!card) return state;
  const appended = input.rating === 1;
  const entry: RatedEntry = {
    key: input.key,
    cardId: card.id,
    rating: input.rating,
    appended,
    ms: input.ms,
    ratedAt: input.now,
    dueAt: input.now + card.intervals[input.rating],
  };
  return {
    queue: appended ? [...state.queue, card] : state.queue,
    idx: state.idx + 1,
    history: [...state.history, entry],
  };
}

/** Steps back to the last rated card (and drops its re-queued copy). */
export function undoLast(state: SessionState): { state: SessionState; entry: RatedEntry } | null {
  const entry = state.history.at(-1);
  if (!entry) return null;
  return {
    entry,
    state: {
      queue: entry.appended ? state.queue.slice(0, -1) : state.queue,
      idx: state.idx - 1,
      history: state.history.slice(0, -1),
    },
  };
}

/**
 * The server's answer to a rating: the real due date for the summary, and fresh intervals for any
 * copy of the card still ahead in the queue (a "Di nuovo" card is shown again with its new steps).
 */
export function applyServerResult(
  state: SessionState,
  key: string,
  result: { dueAt: string; intervals: RatingIntervals },
): SessionState {
  const entry = state.history.find((h) => h.key === key);
  if (!entry) return state; // undone meanwhile
  return {
    ...state,
    history: state.history.map((h) =>
      h.key === key ? { ...h, dueAt: new Date(result.dueAt).getTime() } : h,
    ),
    queue: state.queue.map((card, i) =>
      i >= state.idx && card.id === entry.cardId ? { ...card, intervals: result.intervals } : card,
    ),
  };
}

/** Suspended or flagged: the card leaves the session (the one on screen and any copy ahead). */
export function removeCard(state: SessionState, cardId: string): SessionState {
  return {
    ...state,
    queue: state.queue.filter((card, i) => i < state.idx || card.id !== cardId),
  };
}

/** Edited in place: every copy of the card ahead (and on screen) shows the new text. */
export function replaceCard(
  state: SessionState,
  card: Pick<ReviewQueueItemDto, 'id' | 'front' | 'back' | 'hint'>,
): SessionState {
  return {
    ...state,
    queue: state.queue.map((c, i) =>
      i >= state.idx && c.id === card.id
        ? { ...c, front: card.front, back: card.back, hint: card.hint }
        : c,
    ),
  };
}

/** Calendar days from `now` to `at`, in local time: 0 = today. */
export function daysUntil(at: number, now: number): number {
  const day = (t: number) => {
    const d = new Date(t);
    return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  };
  return Math.max(0, Math.round((day(at) - day(now)) / 86_400_000));
}

export function dueDayLabel(days: number): string {
  if (days === 0) return 'Oggi';
  if (days === 1) return 'Domani';
  return `Tra ${days} giorni`;
}

export interface SessionSummary {
  /** Distinct cards rated. */
  cards: number;
  /** Share of cards whose first rating was Bene or Facile, 0-100. */
  firstTryPct: number;
  /** Average time per rating, ms. */
  avgMs: number;
  counts: Record<Rating, number>;
  /** Cards rated "Di nuovo" at least once, in first-seen order: "Ripassa gli errori". */
  errorIds: string[];
  /** Next reviews, by each card's latest rating, grouped by day. */
  next: { days: number; label: string; count: number }[];
}

export function summarize(history: RatedEntry[], now: number): SessionSummary {
  const first = new Map<string, Rating>();
  const lastDue = new Map<string, number>();
  const errors = new Set<string>();
  const counts: Record<Rating, number> = { 1: 0, 2: 0, 3: 0, 4: 0 };
  let totalMs = 0;
  for (const h of history) {
    if (!first.has(h.cardId)) first.set(h.cardId, h.rating);
    lastDue.set(h.cardId, h.dueAt);
    counts[h.rating] += 1;
    totalMs += h.ms;
    if (h.rating === 1) errors.add(h.cardId);
  }
  const ok = [...first.values()].filter((r) => r >= 3).length;
  const byDay = new Map<number, number>();
  for (const due of lastDue.values()) {
    const days = daysUntil(due, now);
    byDay.set(days, (byDay.get(days) ?? 0) + 1);
  }
  return {
    cards: first.size,
    firstTryPct: first.size ? Math.round((ok / first.size) * 100) : 0,
    avgMs: history.length ? totalMs / history.length : 0,
    counts,
    errorIds: [...errors],
    next: [...byDay.entries()]
      .sort(([a], [b]) => a - b)
      .map(([days, count]) => ({ days, label: dueDayLabel(days), count })),
  };
}

/** "6,1 s" */
export function formatSeconds(ms: number): string {
  return `${(ms / 1000).toFixed(1).replace('.', ',')} s`;
}

/**
 * Ratings go to the server one at a time, in order, so a card rated twice in a session is
 * scheduled twice in the right order and an undo always targets a review that exists.
 */
export type OutboxOp =
  | {
      kind: 'rate';
      key: string;
      subjectSlug: string;
      cardId: string;
      rating: Rating;
      elapsedMs: number;
    }
  | { kind: 'undo'; key: string };

/**
 * Undo of the rating `key`: if its request has not left yet it is simply dropped, otherwise an
 * undo request follows it.
 */
export function enqueueUndo(ops: OutboxOp[], key: string, inFlightKey: string | null): OutboxOp[] {
  const pending = ops.findIndex((op) => op.kind === 'rate' && op.key === key);
  if (pending !== -1 && key !== inFlightKey) return ops.filter((_, i) => i !== pending);
  return [...ops, { kind: 'undo', key }];
}
