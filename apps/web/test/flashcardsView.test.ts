import { DEFAULT_NEW_LIMIT } from '@studyhub/contracts';
import { describe, expect, it } from 'vitest';
import {
  flashcardsHref,
  flashcardsLink,
  NEW_CARDS_PER_DAY,
  hasCardFilters,
  parseFlashcardsParams,
  reviewDeckHref,
} from '../src/lib/flashcardsView';

const sp = (q: string) => new URLSearchParams(q);

describe('flashcardsView', () => {
  it('falls back to defaults on invalid values', () => {
    const p = parseFlashcardsParams(sp('view=boh&group=x&stato=zzz&ordine=y'));
    expect(p.view).toBe('panoramica');
    expect(p.group).toBe('argomento');
    expect(p.stato).toBeNull();
    expect(p.ordine).toBe('due');
    expect(hasCardFilters(p)).toBe(false);
  });

  it('reads every param', () => {
    const p = parseFlashcardsParams(
      sp(
        'view=card&argomento=none&mazzo=d1&stato=review&tag=orale&escluse=1&ordine=recenti&card=c1',
      ),
    );
    expect(p).toMatchObject({
      view: 'card',
      argomento: 'none',
      mazzo: 'd1',
      stato: 'review',
      tag: 'orale',
      escluse: true,
      ordine: 'recenti',
      card: 'c1',
    });
    expect(hasCardFilters(p)).toBe(true);
  });

  it('omits defaults and keeps foreign params', () => {
    expect(flashcardsHref('mat', sp('tab=flashcard&filtro=x'), { group: 'mazzo' })).toBe(
      '/materie/mat?tab=flashcard&filtro=x&group=mazzo',
    );
    expect(flashcardsHref('mat', sp('tab=flashcard&group=mazzo'), { group: 'argomento' })).toBe(
      '/materie/mat?tab=flashcard',
    );
  });

  it('drops card on view change and filters when leaving the Card view', () => {
    const base = sp('tab=flashcard&view=card&argomento=t1&escluse=1&card=c1');
    expect(flashcardsHref('mat', base, { view: 'statistiche' })).toBe(
      '/materie/mat?tab=flashcard&view=statistiche',
    );
    expect(flashcardsHref('mat', base, { card: null })).toBe(
      '/materie/mat?tab=flashcard&view=card&argomento=t1&escluse=1',
    );
  });

  it('builds deep links', () => {
    expect(flashcardsLink('mat', { view: 'card', escluse: true })).toBe(
      '/materie/mat?tab=flashcard&view=card&escluse=1',
    );
    expect(flashcardsLink('mat', { view: 'card', argomento: 'none' })).toBe(
      '/materie/mat?tab=flashcard&view=card&argomento=none',
    );
    expect(reviewDeckHref('mat', 'd1')).toBe('/ripasso?materia=mat&mazzo=d1');
  });

  it('mirrors the daily new-card limit of the contracts', () => {
    expect(NEW_CARDS_PER_DAY).toBe(DEFAULT_NEW_LIMIT);
  });
});
