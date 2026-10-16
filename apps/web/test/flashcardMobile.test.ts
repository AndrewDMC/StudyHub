import { describe, expect, it } from 'vitest';
import {
  deckCardsLabel,
  draftDecksLabel,
  formatCardDue,
  forecastPeak,
  plainCardText,
  retentionMessage,
  retentionSummary,
  reviewProgress,
} from '../src/lib/flashcardMobile';
import { cardSourceHref, reviewHref, toMobileReviewHref } from '../src/lib/quickReview';

describe('flashcardMobile', () => {
  it('averages retention weighted by count', () => {
    const b = (predicted: number, actual: number, count: number) => ({
      from: 0,
      to: 1,
      predicted,
      actual,
      count,
    });
    const s = retentionSummary([b(0.9, 0.8, 1), b(0.9, 1, 3)]);
    expect(s?.actual).toBeCloseTo(0.95);
    expect(s?.predicted).toBeCloseTo(0.9);
    expect(retentionSummary([])).toBeNull();
  });

  it('picks a neutral retention sentence', () => {
    expect(retentionMessage(0.8, 0.9)).toContain('meno');
    expect(retentionMessage(0.95, 0.9)).toContain('più');
    expect(retentionMessage(0.9, 0.9)).toBe('Ricordi quanto previsto.');
  });

  it('finds the forecast peak', () => {
    expect(forecastPeak([{ count: 1 }, { count: 5 }, { count: 5 }])).toEqual({
      max: 5,
      dayIndex: 1,
    });
    expect(forecastPeak([{ count: 0 }])).toEqual({ max: 0, dayIndex: 0 });
  });

  it('counts review marks', () => {
    expect(reviewProgress({ a: 'keep', b: 'drop', c: 'drop' }, 5)).toEqual({
      kept: 1,
      dropped: 2,
      left: 2,
      reviewed: 3,
    });
  });

  it('labels decks', () => {
    expect(deckCardsLabel(1)).toBe('1 card generata');
    expect(deckCardsLabel(24)).toBe('24 card generate');
    expect(draftDecksLabel(2)).toBe('2 mazzi da approvare');
  });

  it('strips cloze markers for accessible names', () => {
    expect(plainCardText('La {{c1::mitosi}} è\n una divisione')).toBe('La mitosi è una divisione');
  });

  it('builds review links', () => {
    expect(reviewHref('mat')).toBe('/ripasso?materia=mat');
    expect(reviewHref('mat', 't1')).toBe('/ripasso?materia=mat&argomento=t1');
    expect(toMobileReviewHref('/materie/mat/review')).toBe('/ripasso?materia=mat');
    expect(toMobileReviewHref('/materie/mat/review?topicId=t1')).toBe(
      '/ripasso?materia=mat&argomento=t1',
    );
    expect(toMobileReviewHref('/materie/mat/piano')).toBe('/materie/mat/piano');
    expect(cardSourceHref({ subjectSlug: 'mat', sourceRef: { docId: 'd', page: 3 } })).toBe(
      '/api/subjects/mat/documents/d/file#page=3',
    );
  });
});

describe('formatCardDue', () => {
  // Same day boundary as the server queue: end of the UTC day.
  const now = Date.parse('2026-06-10T15:00:00Z');

  it('shows a dash for new or suspended cards', () => {
    expect(formatCardDue(null, now)).toBe('—');
  });

  it('says "oggi" until the end of the UTC day, and for overdue cards', () => {
    expect(formatCardDue('2026-06-10T23:59:59.000Z', now)).toBe('oggi');
    expect(formatCardDue('2026-06-02T08:00:00.000Z', now)).toBe('oggi');
  });

  it('straddles UTC midnight regardless of the local timezone', () => {
    // 22:30Z is already 00:30 of the next day in Europe/Rome, but still "oggi" for the queue.
    expect(formatCardDue('2026-06-10T22:30:00.000Z', now)).toBe('oggi');
    expect(formatCardDue('2026-06-11T00:00:00.000Z', now)).toBe('domani');
    expect(formatCardDue('2026-06-11T23:59:59.000Z', now)).toBe('domani');
  });

  it('counts the following UTC days', () => {
    expect(formatCardDue('2026-06-12T00:00:00.000Z', now)).toBe('tra 2 g');
    expect(formatCardDue('2026-06-16T09:00:00.000Z', now)).toBe('tra 6 g');
  });
});
