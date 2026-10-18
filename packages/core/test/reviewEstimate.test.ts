import { describe, expect, it } from 'vitest';
import {
  REVIEW_DEFAULT_MS_PER_CARD,
  REVIEW_MAX_MS_PER_CARD,
  REVIEW_MIN_MS_PER_CARD,
  averageMsPerCard,
  estimateReviewMinutes,
} from '../src/reviewEstimate.js';

describe('estimateReviewMinutes', () => {
  it('is 0 without due cards and at least 1 otherwise', () => {
    expect(estimateReviewMinutes(0, 20_000)).toBe(0);
    expect(estimateReviewMinutes(1, 3_000)).toBe(1);
  });
  it('rounds up', () => {
    expect(estimateReviewMinutes(10, 20_000)).toBe(4); // 200 s
    expect(estimateReviewMinutes(3, 20_000)).toBe(1);
    expect(estimateReviewMinutes(4, 20_000)).toBe(2);
  });
  it('clamps the average between 3 s and 120 s', () => {
    expect(estimateReviewMinutes(60, 100)).toBe(estimateReviewMinutes(60, REVIEW_MIN_MS_PER_CARD));
    expect(estimateReviewMinutes(60, 100)).toBe(3);
    expect(estimateReviewMinutes(30, 10 * 60_000)).toBe(
      estimateReviewMinutes(30, REVIEW_MAX_MS_PER_CARD),
    );
    expect(estimateReviewMinutes(30, 10 * 60_000)).toBe(60);
  });
});

describe('averageMsPerCard', () => {
  it('falls back to the default under 10 valid samples', () => {
    expect(averageMsPerCard([])).toBe(REVIEW_DEFAULT_MS_PER_CARD);
    expect(averageMsPerCard(Array(9).fill(5_000))).toBe(REVIEW_DEFAULT_MS_PER_CARD);
  });
  it('averages valid samples, ignoring outliers over 5 minutes', () => {
    expect(averageMsPerCard([...Array(10).fill(10_000), 600_000])).toBe(10_000);
  });
  it('clamps the result', () => {
    expect(averageMsPerCard(Array(10).fill(500))).toBe(REVIEW_MIN_MS_PER_CARD);
    expect(averageMsPerCard(Array(10).fill(250_000))).toBe(REVIEW_MAX_MS_PER_CARD);
  });
});
