/**
 * Closed-material verification (docs/10-planner-lezioni.md §3.5): how the questions are picked from
 * the lessons of a topic and how an answer weighs on the topic's mastery. Pure: the web layer
 * loads the rows and hands plain candidates in.
 */

/** Questions a verification has; fewer than `VERIFY_MIN_ORIGIN_ITEMS` from the lessons means new ones are generated. */
export const VERIFY_TARGET_ITEMS = 3;
export const VERIFY_MIN_ORIGIN_ITEMS = 2;

/** An answer graded at least this well, but not enough to pass, is "partial" (worth half in the mastery). */
export const VERIFY_PARTIAL_RATIO = 0.5;

export type VerifyItemState = 'open' | 'done' | 'correct' | 'wrong' | 'unknown';
export type VerifyVerdict = 'correct' | 'partial' | 'wrong' | 'unknown';

/** The verdict of a verification item; `null` while it still has no outcome. */
export function verifyVerdict(state: VerifyItemState, score: number | null): VerifyVerdict | null {
  if (state === 'correct') return 'correct';
  if (state === 'unknown') return 'unknown';
  if (state === 'wrong')
    return score !== null && score >= VERIFY_PARTIAL_RATIO ? 'partial' : 'wrong';
  return null;
}

/** Accuracy an item adds to the topic's mastery: right 1, partial 0.5, wrong and "non so" 0; `null` = no outcome yet. */
export function verifyAccuracy(state: VerifyItemState, score: number | null): number | null {
  const verdict = verifyVerdict(state, score);
  if (verdict === null) return null;
  return verdict === 'correct' ? 1 : verdict === 'partial' ? 0.5 : 0;
}

export interface VerifyCandidate {
  id: string;
  /** The item this one was copied from (or retries): it is not picked next to it. */
  parentItemId: string | null;
  /** Latest outcome of the student on it is wrong / "non so" (lesson or previous verification). */
  failed: boolean;
  /** When it last appeared in a verification (ms), `null` = never used. */
  lastUsedAt: number | null;
  /** Start of the lesson (or verification) it comes from (ms): older first. */
  originAt: number;
  orderIndex: number;
}

/**
 * Priority: first the ones failed in the lesson or in the previous verification, then those not yet
 * used in a verification, then the others (least recently used first); inside a group the oldest
 * lesson first. An item is never picked together with the one it was copied from or retries.
 */
export function selectVerifyItems(candidates: VerifyCandidate[], max: number): VerifyCandidate[] {
  const tier = (c: VerifyCandidate) => (c.failed ? 0 : c.lastUsedAt === null ? 1 : 2);
  const sorted = [...candidates].sort(
    (a, b) =>
      tier(a) - tier(b) ||
      (tier(a) === 2 ? (a.lastUsedAt ?? 0) - (b.lastUsedAt ?? 0) : 0) ||
      a.originAt - b.originAt ||
      a.orderIndex - b.orderIndex ||
      a.id.localeCompare(b.id),
  );
  const picked: VerifyCandidate[] = [];
  for (const c of sorted) {
    if (picked.length >= max) break;
    if (picked.some((p) => p.id === c.parentItemId || p.parentItemId === c.id)) continue;
    picked.push(c);
  }
  return picked;
}
