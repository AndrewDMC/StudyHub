import { describe, expect, it } from 'vitest';
import { applyTimeFactor, computeTimeFactor, describeTimeFactor } from '../src/timeFactor.js';

const s = (plannedMin: number, actualMin: number, appliedFactor?: number) => ({
  plannedMin,
  actualMin,
  ...(appliedFactor !== undefined ? { appliedFactor } : {}),
});

describe('computeTimeFactor', () => {
  it('stays neutral until there are enough sessions', () => {
    expect(computeTimeFactor([])).toEqual({ factor: 1, sampleCount: 0, confident: false });
    expect(computeTimeFactor([s(30, 60), s(30, 60)])).toEqual({
      factor: 1,
      sampleCount: 2,
      confident: false,
    });
  });

  it('is the median of actual over planned, so one outlier does not move it', () => {
    const tf = computeTimeFactor([s(30, 42), s(30, 39), s(30, 45), s(30, 300)]);
    expect(tf).toMatchObject({ confident: true, sampleCount: 4 });
    // ratios 1.4, 1.3, 1.5, 10 → the median is the mean of 1.4 and 1.5; the outlier does not count.
    expect(tf.factor).toBe(1.45);
  });

  it('ignores abandoned sessions and tasks with no plan', () => {
    const tf = computeTimeFactor([s(30, 1), s(30, 4), s(0, 30), s(30, 33), s(30, 33), s(30, 33)]);
    expect(tf.sampleCount).toBe(3);
    expect(tf.factor).toBe(1.1);
  });

  it('clamps an extreme bias', () => {
    expect(computeTimeFactor([s(10, 60), s(10, 60), s(10, 60)]).factor).toBe(2);
    expect(computeTimeFactor([s(120, 6), s(120, 6), s(120, 6)]).factor).toBe(0.5);
  });

  it('divides out the factor the plan already applied, so a correct correction holds steady', () => {
    // The plan was made with ×1.4 and the student then took exactly that: the bias is still 1.4.
    const tf = computeTimeFactor([s(42, 42, 1.4), s(42, 42, 1.4), s(42, 42, 1.4)]);
    expect(tf.factor).toBe(1.4);
  });

  it('keeps only the most recent sessions (newest first)', () => {
    const recent = Array.from({ length: 20 }, () => s(30, 30));
    const old = Array.from({ length: 30 }, () => s(30, 60));
    expect(computeTimeFactor([...recent, ...old]).factor).toBe(1);
  });
});

describe('applyTimeFactor', () => {
  it('scales and rounds the estimates, and is a no-op at 1', () => {
    const topics = [{ key: 'a', estimatedMinutes: 25 }];
    expect(applyTimeFactor(topics, 1)).toBe(topics);
    expect(applyTimeFactor(topics, 1.4)).toEqual([{ key: 'a', estimatedMinutes: 35 }]);
    expect(applyTimeFactor([{ estimatedMinutes: 1 }], 0.5)).toEqual([{ estimatedMinutes: 1 }]);
  });
});

describe('describeTimeFactor', () => {
  it('speaks only when confident and clearly off', () => {
    expect(describeTimeFactor({ factor: 1.4, sampleCount: 5, confident: true })).toBe(
      'sottostimi del 40%',
    );
    expect(describeTimeFactor({ factor: 0.8, sampleCount: 5, confident: true })).toBe(
      'sovrastimi del 20%',
    );
    expect(describeTimeFactor({ factor: 1.03, sampleCount: 5, confident: true })).toBeNull();
    expect(describeTimeFactor({ factor: 1.4, sampleCount: 2, confident: false })).toBeNull();
  });
});
