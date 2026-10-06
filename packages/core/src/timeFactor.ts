/**
 * The student's personal time-estimation bias (docs/06-miglioramenti.md #7): how long their study sessions
 * really take against what the Planner assumed. Pure, so the rule can be tested without a database.
 */

/** Fewer sessions than this say nothing yet: the Planner keeps its own estimates. */
export const TIME_FACTOR_MIN_SAMPLES = 3;
/** Only the most recent sessions count, so a changed habit shows up within a couple of weeks. */
export const TIME_FACTOR_MAX_SAMPLES = 20;
/** A session shorter than this was abandoned or a misclick, not a measure of the task. */
export const TIME_FACTOR_MIN_ACTUAL_MIN = 5;
/** Never plan on a fraction or a multiple that extreme from a handful of sessions. */
export const TIME_FACTOR_MIN = 0.5;
export const TIME_FACTOR_MAX = 2;

export interface TimeSample {
  /** Minutes the task was planned for. */
  plannedMin: number;
  /** Minutes actually studied (pauses and breaks excluded). */
  actualMin: number;
  /**
   * The factor the Planner had already applied when it chose `plannedMin` (1 = none). Dividing it out keeps
   * the measure on the raw estimate: otherwise a correct correction would read as "no bias" next time and the
   * factor would swing back and forth.
   */
  appliedFactor?: number;
}

export interface TimeFactor {
  /** Multiplier for the Planner's estimates; 1 when there is not enough data. */
  factor: number;
  /** Sessions that counted. */
  sampleCount: number;
  /** True once there were enough sessions for the factor to be applied. */
  confident: boolean;
}

const NEUTRAL: TimeFactor = { factor: 1, sampleCount: 0, confident: false };

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/**
 * Median of actual / raw-planned over the recent sessions (samples are given newest first). The median, not
 * the mean: one session left open overnight or one 5-minute skim must not move the plan.
 */
export function computeTimeFactor(samples: TimeSample[]): TimeFactor {
  const usable = samples
    .filter((s) => s.plannedMin > 0 && s.actualMin >= TIME_FACTOR_MIN_ACTUAL_MIN)
    .slice(0, TIME_FACTOR_MAX_SAMPLES);
  if (usable.length === 0) return NEUTRAL;

  const ratios = usable.map((s) => (s.actualMin * (s.appliedFactor ?? 1)) / s.plannedMin);
  const confident = usable.length >= TIME_FACTOR_MIN_SAMPLES;
  const raw = median(ratios);
  const factor = confident
    ? Math.round(Math.min(TIME_FACTOR_MAX, Math.max(TIME_FACTOR_MIN, raw)) * 100) / 100
    : 1;
  return { factor, sampleCount: usable.length, confident };
}

/** Scales every topic's estimate by the factor (a no-op at 1), never below one minute. */
export function applyTimeFactor<T extends { estimatedMinutes: number }>(
  topics: T[],
  factor: number,
): T[] {
  if (factor === 1) return topics;
  return topics.map((t) => ({
    ...t,
    estimatedMinutes: Math.max(1, Math.round(t.estimatedMinutes * factor)),
  }));
}

/** "sottostimi del 40%" / "sovrastimi del 20%" / null when the bias is within noise (±5%). */
export function describeTimeFactor(tf: TimeFactor): string | null {
  if (!tf.confident) return null;
  const pct = Math.round(Math.abs(tf.factor - 1) * 100);
  if (pct < 5) return null;
  return tf.factor > 1 ? `sottostimi del ${pct}%` : `sovrastimi del ${pct}%`;
}
