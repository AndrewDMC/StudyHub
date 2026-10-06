import { describe, expect, it } from 'vitest';
import { describeExamStyle, selectBriefingChunks } from '../src/sessionBriefing.js';

const chunk = (docId: string, page: number, size = 100) => ({
  docId,
  page,
  text: 'x'.repeat(size),
});

describe('selectBriefingChunks', () => {
  it('keeps everything that fits, in the original order', () => {
    const chunks = [chunk('a', 1), chunk('a', 2), chunk('b', 1)];
    expect(selectBriefingChunks(chunks, [], 1000)).toEqual(chunks);
  });

  it('prefers the pages the task planned when the budget is short', () => {
    const chunks = [chunk('a', 1), chunk('a', 2), chunk('a', 3), chunk('b', 1)];
    const picked = selectBriefingChunks(chunks, [{ docId: 'a', pageFrom: 3, pageTo: 3 }], 200);
    expect(picked.map((c) => `${c.docId}${c.page}`)).toEqual(['a1', 'a3']);
    // the planned page is in, even though it comes after others in reading order
    expect(picked.some((c) => c.docId === 'a' && c.page === 3)).toBe(true);
  });

  it('always keeps at least the first ranked chunk, however large', () => {
    const picked = selectBriefingChunks([chunk('a', 1, 5000)], [], 100);
    expect(picked).toHaveLength(1);
  });

  it('skips a chunk that overflows but still takes smaller ones after it', () => {
    const chunks = [chunk('a', 1, 150), chunk('a', 2, 500), chunk('a', 3, 40)];
    const picked = selectBriefingChunks(chunks, [], 200);
    expect(picked.map((c) => c.page)).toEqual([1, 3]);
  });
});

describe('describeExamStyle', () => {
  it('lists the kinds by weight, then verbosity and notes', () => {
    expect(
      describeExamStyle({
        kindDistribution: { open: 0.2, numeric: 0.8, proof: 0 },
        verbosity: 'breve',
        notes: 'Si usa la calcolatrice.',
      }),
    ).toBe('tipologie numeric 80%, open 20%; risposte breve; Si usa la calcolatrice.');
  });
});
