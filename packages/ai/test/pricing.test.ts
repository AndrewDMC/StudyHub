import { describe, expect, it } from 'vitest';
import { estimateCostEur, estimateTokens } from '../src/pricing.js';

describe('estimateCostEur', () => {
  it('is zero for the fake model', () => {
    expect(estimateCostEur('fake-v1', 100_000, 50_000)).toBe(0);
  });

  it('scales with token counts for a real model', () => {
    const small = estimateCostEur('claude-sonnet-5-5', 1000, 500);
    const large = estimateCostEur('claude-sonnet-5-5', 10_000, 5000);
    expect(large).toBeGreaterThan(small);
    expect(large).toBeCloseTo(small * 10, 5);
  });

  it('falls back to a default price for an unknown model rather than throwing', () => {
    expect(() => estimateCostEur('some-future-model', 1000, 1000)).not.toThrow();
    expect(estimateCostEur('some-future-model', 1000, 1000)).toBeGreaterThan(0);
  });
});

describe('estimateTokens', () => {
  it('never returns less than 1 for non-empty text', () => {
    expect(estimateTokens('a')).toBeGreaterThanOrEqual(1);
  });

  it('grows roughly with text length', () => {
    expect(estimateTokens('a'.repeat(400))).toBeGreaterThan(estimateTokens('a'.repeat(40)));
  });
});
