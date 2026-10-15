import { describe, expect, it } from 'vitest';
import {
  examsLabel,
  filterCounts,
  formatMastery,
  gapPriority,
  masteryTone,
  matchesFilter,
  mentionsLabel,
  topicAction,
} from '../src/lib/coverageMobile';

describe('coverageMobile', () => {
  it('picks the most urgent flag', () => {
    expect(gapPriority([])).toBeNull();
    expect(gapPriority(['weak', 'no_cards'])).toBe('no_cards');
    expect(gapPriority(['weak', 'no_material'])).toBe('no_material');
  });

  it('chooses one action by precedence', () => {
    expect(topicAction({ flags: ['no_material', 'no_cards'], cards: 0, materialDocs: 0 })).toBe(
      'upload',
    );
    expect(topicAction({ flags: ['no_cards', 'weak'], cards: 0, materialDocs: 2 })).toBe(
      'flashcards',
    );
    expect(topicAction({ flags: ['weak'], cards: 5, materialDocs: 2 })).toBe('review');
    expect(topicAction({ flags: [], cards: 5, materialDocs: 2 })).toBe('review');
    expect(topicAction({ flags: ['weak'], cards: 0, materialDocs: 2 })).toBe('drill');
    expect(topicAction({ flags: [], cards: 0, materialDocs: 2 })).toBeNull();
  });

  it('counts filters, a topic with several flags counts in each', () => {
    const topics = [
      { flags: ['weak', 'no_cards'] as const },
      { flags: ['weak'] as const },
      { flags: [] },
    ].map((t) => ({ flags: [...t.flags] }));
    expect(filterCounts(topics)).toEqual({ tutte: 3, weak: 2, no_cards: 1, no_material: 0 });
    expect(topics.filter((t) => matchesFilter(t, 'weak'))).toHaveLength(2);
    expect(topics.filter((t) => matchesFilter(t, 'tutte'))).toHaveLength(3);
  });

  it('maps mastery to tone and text', () => {
    expect(masteryTone(null)).toBeNull();
    expect(masteryTone(0.7)).toBe('ok');
    expect(masteryTone(0.69)).toBe('warn');
    expect(masteryTone(0.4)).toBe('warn');
    expect(masteryTone(0.39)).toBe('danger');
    expect(formatMastery(0.224)).toBe('22%');
    expect(formatMastery(null)).toBe('N/D');
  });

  it('formats exam frequency', () => {
    expect(examsLabel({ examTotal: 0, examMentions: 0, recurring: false })).toBe('—');
    expect(examsLabel({ examTotal: 0, examMentions: 0, recurring: true })).toBe('ricorrente');
    expect(examsLabel({ examTotal: 5, examMentions: 3, recurring: true })).toBe('3/5');
    expect(mentionsLabel({ examTotal: 5, examMentions: 1 })).toBe('1 volta negli esami');
    expect(mentionsLabel({ examTotal: 5, examMentions: 4 })).toBe('4 volte negli esami');
    expect(mentionsLabel({ examTotal: 5, examMentions: 0 })).toBeNull();
    expect(mentionsLabel({ examTotal: 0, examMentions: 0 })).toBeNull();
  });
});
