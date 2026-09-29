import { describe, expect, it } from 'vitest';
import { retentionCalibration, type ReviewSample } from '../src/retention.js';
import { retrievabilityAfter } from '../src/fsrs.js';

describe('retentionCalibration', () => {
  it('groups reviews by predicted retrievability and compares with the real recall rate', () => {
    // Stability 10 days: after 1 day recall is predicted ~0.99, after 60 days far lower.
    const samples: ReviewSample[] = [
      ...Array.from({ length: 10 }, (_, i) => ({
        elapsedDays: 1,
        prevStability: 10,
        success: i < 9, // 90% actually recalled
      })),
      ...Array.from({ length: 10 }, (_, i) => ({
        elapsedDays: 60,
        prevStability: 10,
        success: i < 2, // 20% actually recalled
      })),
    ];
    const buckets = retentionCalibration(samples);
    expect(buckets).toHaveLength(2);

    const [low, high] = buckets as [(typeof buckets)[number], (typeof buckets)[number]];
    expect(low.predicted).toBeLessThan(high.predicted);
    expect(low.actual).toBeCloseTo(0.2);
    expect(high.actual).toBeCloseTo(0.9);
    expect(high.predicted).toBeCloseTo(retrievabilityAfter(1, 10));
    expect(low.count + high.count).toBe(20);
  });

  it('is deterministic and leaves empty buckets out', () => {
    const samples: ReviewSample[] = [{ elapsedDays: 0, prevStability: 5, success: true }];
    const a = retentionCalibration(samples);
    expect(a).toEqual(retentionCalibration(samples));
    expect(a).toHaveLength(1);
    expect(a[0]!.to).toBe(1);
  });

  it('ignores samples that cannot be scored (no stability, non-finite time)', () => {
    expect(
      retentionCalibration([
        { elapsedDays: 3, prevStability: 0, success: true },
        { elapsedDays: Number.NaN, prevStability: 4, success: true },
      ]),
    ).toEqual([]);
  });

  it('a perfectly calibrated learner lands on the diagonal', () => {
    // 100 reviews at predicted ~0.9, 90 recalled.
    const elapsed = 1;
    const stability = 9.2; // R(1, 9.2) ≈ 0.9 under FSRS-5's curve
    const predicted = retrievabilityAfter(elapsed, stability);
    const n = 100;
    const samples = Array.from({ length: n }, (_, i) => ({
      elapsedDays: elapsed,
      prevStability: stability,
      success: i < Math.round(predicted * n),
    }));
    const [bucket] = retentionCalibration(samples);
    expect(Math.abs(bucket!.actual - bucket!.predicted)).toBeLessThan(0.01);
  });
});
