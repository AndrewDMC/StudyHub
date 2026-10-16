/**
 * Single pass bar for graded work: an exercise or an attempt scoring at least this share of the
 * available points counts as passed ("Sufficiente"); below it, it is weak.
 * Browser-safe (re-exported by `@studyhub/core/browser`).
 */
export const PASS_RATIO = 0.6;

/** `true` when `ratio` (awarded / max, 0..1) reaches the pass bar. Exactly `PASS_RATIO` passes. */
export function isPassing(ratio: number): boolean {
  return ratio >= PASS_RATIO;
}
