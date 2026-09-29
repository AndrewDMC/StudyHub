import { describe, expect, it } from 'vitest';
import {
  computeCalibration,
  illusionByGroup,
  isCorrectRating,
  type CalibrationSample,
  type Confidence,
} from '../src/calibration.js';

const many = (confidence: Confidence, correct: number, wrong: number, group?: string) => [
  ...Array.from({ length: correct }, () => ({ confidence, correct: true, group })),
  ...Array.from({ length: wrong }, () => ({ confidence, correct: false, group })),
];

describe('isCorrectRating', () => {
  it('only Again is a failure (FSRS: Hard is a pass)', () => {
    expect([1, 2, 3, 4].map(isCorrectRating)).toEqual([false, true, true, true]);
  });
});

describe('computeCalibration', () => {
  it('reports accuracy per confidence level', () => {
    const c = computeCalibration([...many(1, 1, 4), ...many(2, 3, 3), ...many(3, 9, 1)]);
    expect(c.levels.map((l) => [l.total, l.correct, l.accuracy])).toEqual([
      [5, 1, 0.2],
      [6, 3, 0.5],
      [10, 9, 0.9],
    ]);
    expect(c.total).toBe(21);
  });

  it('names the illusion of knowing: sure (3) but wrong', () => {
    const c = computeCalibration(many(3, 6, 4));
    expect(c.illusionRate).toBeCloseTo(0.4);
  });

  it('names hidden knowledge: unsure (1) but right', () => {
    const c = computeCalibration(many(1, 3, 2));
    expect(c.hiddenKnowledgeRate).toBeCloseTo(0.6);
  });

  it('draws no conclusion from too few answers', () => {
    const c = computeCalibration([...many(3, 1, 2), ...many(1, 1, 1)]);
    expect(c.illusionRate).toBeNull();
    expect(c.hiddenKnowledgeRate).toBeNull();
    expect(c.bias).toBeNull();
    expect(c.verdict).toBe('insufficient_data');
    expect(c.levels[2]!.reliable).toBe(false);
  });

  it('overconfident: sure of things that turn out wrong', () => {
    const c = computeCalibration([...many(3, 4, 6), ...many(2, 2, 3)]);
    expect(c.bias!).toBeGreaterThan(0.1);
    expect(c.verdict).toBe('overconfident');
  });

  it('underconfident: unsure of things that turn out right', () => {
    const c = computeCalibration([...many(1, 5, 0), ...many(2, 5, 0)]);
    expect(c.bias!).toBeLessThan(-0.1);
    expect(c.verdict).toBe('underconfident');
  });

  it('calibrated: accuracy tracks confidence', () => {
    // expected 1/6, 1/2, 5/6 -> here 1/6, 3/6, 5/6 exactly
    const c = computeCalibration([...many(1, 1, 5), ...many(2, 3, 3), ...many(3, 5, 1)]);
    expect(Math.abs(c.bias!)).toBeLessThanOrEqual(0.1);
    expect(c.verdict).toBe('calibrated');
  });

  it('is safe on no data at all', () => {
    const c = computeCalibration([]);
    expect(c).toMatchObject({
      total: 0,
      illusionRate: null,
      bias: null,
      verdict: 'insufficient_data',
    });
    expect(c.levels.every((l) => l.accuracy === null)).toBe(true);
  });
});

describe('illusionByGroup', () => {
  const s: CalibrationSample[] = [
    ...many(3, 2, 4, 'entropia'),
    ...many(3, 5, 1, 'carnot'),
    ...many(3, 0, 3, 'poche'), // only 3 confident answers: not ranked
    ...many(3, 6, 0, 'perfetto'), // never wrong: not an illusion
    ...many(1, 0, 9, 'entropia'), // low-confidence answers don't count as "sure"
  ];

  it('ranks groups by how often confidence 3 was wrong, and drops thin or clean ones', () => {
    expect(illusionByGroup(s)).toEqual([
      { group: 'entropia', sure: 6, sureButWrong: 4, illusionRate: 4 / 6 },
      { group: 'carnot', sure: 6, sureButWrong: 1, illusionRate: 1 / 6 },
    ]);
  });

  it('ignores samples with no group', () => {
    expect(illusionByGroup(many(3, 0, 10))).toEqual([]);
  });
});
