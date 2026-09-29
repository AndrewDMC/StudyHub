import { retrievabilityAfter } from './fsrs.js';

/**
 * One past review, reduced to what a calibration check needs: how long the card had been left
 * alone, the stability FSRS had assigned it before, and whether the answer was a recall
 * (any rating but "Again").
 */
export interface ReviewSample {
  elapsedDays: number;
  prevStability: number;
  success: boolean;
}

export interface RetentionBucket {
  /** Predicted-retrievability range this bucket covers, `[from, to)` (the last one includes 1). */
  from: number;
  to: number;
  /** Mean retrievability FSRS predicted for the reviews in the bucket. */
  predicted: number;
  /** Share of those reviews that were actually recalled. */
  actual: number;
  count: number;
}

/**
 * Real vs predicted retention (docs/fasi/F4-flashcard.md "curva di ritenzione reale vs prevista"):
 * groups past reviews by the recall probability FSRS predicted at review time and compares it with
 * how often the user really remembered. A well-fitted scheduler has `actual ≈ predicted` in every
 * bucket; a systematic gap says the default parameters don't suit this user. Empty buckets are
 * left out.
 */
export function retentionCalibration(samples: ReviewSample[], bucketCount = 5): RetentionBucket[] {
  const width = 1 / bucketCount;
  const groups = Array.from({ length: bucketCount }, () => ({
    predictedSum: 0,
    successes: 0,
    count: 0,
  }));

  for (const sample of samples) {
    if (!(sample.prevStability > 0) || !Number.isFinite(sample.elapsedDays)) continue;
    const predicted = retrievabilityAfter(sample.elapsedDays, sample.prevStability);
    const index = Math.min(bucketCount - 1, Math.floor(predicted / width));
    const group = groups[index]!;
    group.predictedSum += predicted;
    group.successes += sample.success ? 1 : 0;
    group.count += 1;
  }

  return groups
    .map((g, i) => ({
      from: i * width,
      to: (i + 1) * width,
      predicted: g.count === 0 ? 0 : g.predictedSum / g.count,
      actual: g.count === 0 ? 0 : g.successes / g.count,
      count: g.count,
    }))
    .filter((b) => b.count > 0);
}
