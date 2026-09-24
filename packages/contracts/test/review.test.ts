import { describe, expect, it } from 'vitest';
import { SubmitReviewRequestSchema } from '../src/review.js';

describe('SubmitReviewRequestSchema', () => {
  it('accepts ratings 1-4', () => {
    for (const rating of [1, 2, 3, 4]) {
      expect(SubmitReviewRequestSchema.safeParse({ rating, elapsedMs: 1200 }).success).toBe(true);
    }
  });
  it('rejects rating 0 (Manual) and 5', () => {
    expect(SubmitReviewRequestSchema.safeParse({ rating: 0, elapsedMs: 1 }).success).toBe(false);
    expect(SubmitReviewRequestSchema.safeParse({ rating: 5, elapsedMs: 1 }).success).toBe(false);
  });
  it('rejects a negative elapsedMs', () => {
    expect(SubmitReviewRequestSchema.safeParse({ rating: 3, elapsedMs: -1 }).success).toBe(false);
  });
});
