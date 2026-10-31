import { describe, expect, it } from 'vitest';
import {
  selectVerifyItems,
  verifyAccuracy,
  verifyVerdict,
  type VerifyCandidate,
} from '../src/verify.js';

const cand = (id: string, over: Partial<VerifyCandidate> = {}): VerifyCandidate => ({
  id,
  parentItemId: null,
  failed: false,
  lastUsedAt: null,
  originAt: 1000,
  orderIndex: 0,
  ...over,
});

describe('verifyVerdict / verifyAccuracy', () => {
  it('right 1, partial 0.5, wrong and unknown 0, open has no outcome', () => {
    expect(verifyAccuracy('correct', 0.9)).toBe(1);
    expect(verifyAccuracy('wrong', 0.55)).toBe(0.5);
    expect(verifyVerdict('wrong', 0.55)).toBe('partial');
    expect(verifyAccuracy('wrong', 0.1)).toBe(0);
    expect(verifyAccuracy('wrong', null)).toBe(0);
    expect(verifyAccuracy('unknown', null)).toBe(0);
    expect(verifyAccuracy('open', null)).toBeNull();
  });
});

describe('selectVerifyItems', () => {
  it('failed first, then never used, then the least recently used', () => {
    const picked = selectVerifyItems(
      [
        cand('used-late', { lastUsedAt: 500 }),
        cand('fresh', { originAt: 900 }),
        cand('used-early', { lastUsedAt: 100 }),
        cand('failed', { failed: true, originAt: 2000 }),
      ],
      4,
    );
    expect(picked.map((c) => c.id)).toEqual(['failed', 'fresh', 'used-early', 'used-late']);
  });

  it('caps at max and takes the oldest lesson first inside a group', () => {
    const picked = selectVerifyItems(
      [cand('b', { originAt: 20 }), cand('a', { originAt: 10 }), cand('c', { originAt: 30 })],
      2,
    );
    expect(picked.map((c) => c.id)).toEqual(['a', 'b']);
  });

  it('never picks an item together with the one it retries', () => {
    const picked = selectVerifyItems(
      [
        cand('ex', { failed: true }),
        cand('retry', { parentItemId: 'ex', failed: true, orderIndex: 1 }),
        cand('other', { orderIndex: 2 }),
      ],
      3,
    );
    expect(picked.map((c) => c.id)).toEqual(['ex', 'other']);
  });
});
