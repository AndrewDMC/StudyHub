import { describe, expect, it } from 'vitest';
import type { FlashcardDto } from '@studyhub/contracts';
import {
  attachableCards,
  cardCountLabel,
  cardPreview,
  focusIndexAfterRemoval,
  reviewableCount,
  ripassaTaskHref,
  topicFilterParam,
  topicOptions,
} from '../src/components/task-flashcards/taskFlashcardsModel';

const card = (id: string) => ({ id }) as FlashcardDto;

describe('taskFlashcardsModel', () => {
  it('builds the review link and count label', () => {
    expect(ripassaTaskHref('mat', 't1')).toBe('/ripasso?materia=mat&task=t1');
    expect(cardCountLabel(1)).toBe('1 card');
    expect(cardCountLabel(3)).toBe('3 card');
  });

  it('counts only reviewable cards', () => {
    expect(
      reviewableCount([{ reviewable: true }, { reviewable: false }, { reviewable: true }]),
    ).toBe(2);
    expect(reviewableCount([])).toBe(0);
  });

  it('previews plain text, truncated', () => {
    expect(cardPreview('Cos’è {{c1::un nodo}}?')).toBe('Cos’è un nodo?');
    expect(cardPreview('x'.repeat(100), 10)).toBe('xxxxxxxxx…');
  });

  it('flags attached cards and dedupes across pages', () => {
    const rows = attachableCards(
      [{ items: [card('a'), card('b')] }, { items: [card('b'), card('c')] }],
      new Set(['b']),
    );
    expect(rows.map((r) => [r.card.id, r.attached])).toEqual([
      ['a', false],
      ['b', true],
      ['c', false],
    ]);
  });

  it('maps the topic filter to the query value', () => {
    expect(topicFilterParam('all')).toBe('');
    expect(topicFilterParam('none')).toBe('none');
    expect(topicFilterParam('u1')).toBe('u1');
  });

  it('orders topics by name with children indented', () => {
    const out = topicOptions([
      { id: 'c', name: 'Beta figlio', parentId: 'b' },
      { id: 'b', name: 'Beta', parentId: null },
      { id: 'a', name: 'Alfa', parentId: null },
    ]);
    expect(out.map((o) => o.label)).toEqual(['Alfa', 'Beta', '— Beta figlio']);
  });

  it('picks the focus target after a removal', () => {
    expect(focusIndexAfterRemoval(0, 3)).toBe(0);
    expect(focusIndexAfterRemoval(2, 3)).toBe(1);
    expect(focusIndexAfterRemoval(0, 1)).toBeNull();
  });
});
