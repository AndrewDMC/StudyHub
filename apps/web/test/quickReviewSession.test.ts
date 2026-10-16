import { describe, expect, it } from 'vitest';
import type { ReviewOverviewDto, ReviewQueueItemDto } from '@studyhub/contracts';
import {
  applyServerResult,
  currentCard,
  daysUntil,
  enqueueUndo,
  formatSeconds,
  isFinished,
  parseSessionLimit,
  rateCard,
  removeCard,
  replaceCard,
  scopeFromSearchParams,
  scopeToSearchParams,
  sessionTitle,
  startSession,
  summarize,
  undoLast,
  type OutboxOp,
  type Rating,
  type SessionState,
} from '../src/lib/quickReview';

const MIN = 60_000;
const DAY = 86_400_000;
// Local noon: day arithmetic below never straddles midnight whatever the test machine's zone.
const NOW = new Date(2026, 9, 13, 12, 0, 0).getTime();

function card(id: string, over: Partial<ReviewQueueItemDto> = {}): ReviewQueueItemDto {
  return {
    id,
    deckId: '00000000-0000-4000-8000-000000000001',
    topicId: null,
    type: 'basic',
    front: `F ${id}`,
    back: `B ${id}`,
    hint: null,
    sourceRef: null,
    state: 'new',
    suspended: false,
    tags: [],
    flaggedAt: null,
    dueAt: null,
    createdAt: new Date(NOW).toISOString(),
    subjectSlug: 'bd',
    subjectName: 'Basi di Dati',
    subjectColor: 'violet',
    topicName: null,
    intervals: { 1: MIN, 2: 8 * MIN, 3: DAY, 4: 4 * DAY },
    ...over,
  };
}

let seq = 0;
function rate(state: SessionState, rating: Rating, ms = 1000): SessionState {
  seq += 1;
  return rateCard(state, { key: `k${seq}`, rating, ms, now: NOW });
}

describe('session', () => {
  it('advances on every rating and re-queues "Di nuovo" at the end', () => {
    let s = startSession([card('a'), card('b')]);
    s = rate(s, 1);
    expect(s.queue.map((c) => c.id)).toEqual(['a', 'b', 'a']);
    expect(currentCard(s)?.id).toBe('b');
    s = rate(s, 3);
    expect(currentCard(s)?.id).toBe('a');
    s = rate(s, 3);
    expect(isFinished(s)).toBe(true);
    expect(s.history.map((h) => [h.cardId, h.rating, h.appended])).toEqual([
      ['a', 1, true],
      ['b', 3, false],
      ['a', 3, false],
    ]);
  });

  it('undo steps back and drops the copy a "Di nuovo" had re-queued', () => {
    let s = startSession([card('a'), card('b')]);
    s = rate(s, 3);
    s = rate(s, 1);
    expect(s.queue).toHaveLength(3);
    const undone = undoLast(s)!;
    expect(undone.entry).toMatchObject({ cardId: 'b', rating: 1, appended: true });
    expect(undone.state.queue.map((c) => c.id)).toEqual(['a', 'b']);
    expect(currentCard(undone.state)?.id).toBe('b');
    expect(undone.state.history).toHaveLength(1);
    expect(undoLast(startSession([card('a')]))).toBeNull();
  });

  it('can undo all the way back after re-queueing', () => {
    let s = startSession([card('a')]);
    s = rate(s, 1);
    s = rate(s, 1);
    s = rate(s, 3);
    expect(isFinished(s)).toBe(true);
    for (let i = 0; i < 3; i += 1) s = undoLast(s)!.state;
    expect(s).toEqual(startSession([card('a')]));
  });

  it('estimates the due date from the intervals, then takes the server one', () => {
    let s = startSession([card('a'), card('b')]);
    s = rateCard(s, { key: 'x', rating: 1, ms: 500, now: NOW });
    expect(s.history[0]!.dueAt).toBe(NOW + MIN);

    const fresh = { 1: 2 * MIN, 2: 10 * MIN, 3: 2 * DAY, 4: 5 * DAY };
    const serverDue = new Date(NOW + 90_000).toISOString();
    const next = applyServerResult(s, 'x', { dueAt: serverDue, intervals: fresh });
    expect(next.history[0]!.dueAt).toBe(NOW + 90_000);
    // Only the copy still ahead gets the new intervals; the card already shown keeps its own.
    expect(next.queue[2]!.intervals).toEqual(fresh);
    expect(next.queue[0]!.intervals[1]).toBe(MIN);
    // An answer for a rating undone meanwhile changes nothing.
    expect(applyServerResult(s, 'gone', { dueAt: serverDue, intervals: fresh })).toBe(s);
  });

  it('removeCard drops the card on screen and its copies ahead, not the past', () => {
    let s = startSession([card('a'), card('b'), card('c')]);
    s = rate(s, 1); // a re-queued
    s = rate(s, 3); // b
    expect(currentCard(s)?.id).toBe('c');
    s = removeCard(s, 'a');
    expect(s.queue.map((c) => c.id)).toEqual(['a', 'b', 'c']);
    s = removeCard(s, 'c');
    expect(isFinished(s)).toBe(true);
  });

  it('replaceCard updates the text of every copy still ahead', () => {
    let s = startSession([card('a'), card('b')]);
    s = rate(s, 1);
    s = replaceCard(s, { id: 'a', front: 'nuovo', back: 'retro', hint: 'h' });
    expect(s.queue[0]!.front).toBe('F a');
    expect(s.queue[2]).toMatchObject({ front: 'nuovo', back: 'retro', hint: 'h' });
  });
});

describe('summarize', () => {
  it('matches the prototype: 8 ratings over 6 cards, 67% at the first try', () => {
    const ids = ['c1', 'c2', 'c3', 'c4', 'c5', 'c6'];
    let s = startSession(ids.map((id) => card(id)));
    const ratings: Rating[] = [3, 1, 3, 4, 1, 3, 3, 3];
    const ms = [5100, 9800, 6000, 3200, 11400, 7100, 4000, 3900];
    ratings.forEach((r, i) => (s = rate(s, r, ms[i])));
    expect(isFinished(s)).toBe(true);

    const sum = summarize(s.history, NOW);
    expect(sum.cards).toBe(6);
    expect(sum.firstTryPct).toBe(67);
    expect(sum.counts).toEqual({ 1: 2, 2: 0, 3: 5, 4: 1 });
    expect(formatSeconds(sum.avgMs)).toBe('6,3 s');
    expect(sum.errorIds).toEqual(['c2', 'c5']);
    // Last ratings: c1 3, c2 3, c3 3, c4 4, c5 3, c6 3 → 5 tomorrow, 1 in four days.
    expect(sum.next).toEqual([
      { days: 1, label: 'Domani', count: 5 },
      { days: 4, label: 'Tra 4 giorni', count: 1 },
    ]);
  });

  it('is empty-safe', () => {
    expect(summarize([], NOW)).toMatchObject({ cards: 0, firstTryPct: 0, avgMs: 0, next: [] });
  });

  it('counts calendar days, not 24 h blocks', () => {
    const lateEvening = new Date(2026, 9, 13, 23, 30).getTime();
    expect(daysUntil(lateEvening + 60 * MIN, lateEvening)).toBe(1);
    expect(daysUntil(NOW + 10 * MIN, NOW)).toBe(0);
    expect(daysUntil(NOW - DAY, NOW)).toBe(0);
  });
});

describe('scope and limits', () => {
  it('maps scopes to the queue query and back', () => {
    expect(scopeToSearchParams({}, 10).toString()).toBe('n=10');
    expect(scopeToSearchParams({ subjectSlug: 'bd' }, 0).toString()).toBe('materia=bd');
    expect(scopeToSearchParams({ subjectSlug: 'bd', topicId: null }, 5).toString()).toBe(
      'materia=bd&argomento=none&n=5',
    );
    expect(scopeFromSearchParams({ materia: 'bd', argomento: 'none' })).toEqual({
      subjectSlug: 'bd',
      topicId: null,
    });
    expect(scopeFromSearchParams({ materia: 'bd' })).toEqual({ subjectSlug: 'bd' });
    expect(scopeFromSearchParams({ argomento: 'none' })).toBeNull();
  });

  it('parses the stored limit, falling back to 10', () => {
    expect(parseSessionLimit('5')).toBe(5);
    expect(parseSessionLimit('0')).toBe(0);
    expect(parseSessionLimit('7')).toBe(10);
    expect(parseSessionLimit(null)).toBe(10);
  });

  it('titles the session from the overview', () => {
    const overview: ReviewOverviewDto = {
      totalDue: 1,
      totalCards: 1,
      nextDueAt: null,
      subjects: [
        {
          slug: 'bd',
          name: 'Basi di Dati',
          color: 'violet',
          nextExam: null,
          due: 1,
          cardCount: 1,
          topics: [
            {
              id: '00000000-0000-4000-8000-0000000000aa',
              name: 'Normalizzazione',
              mastery: 0.5,
              due: 1,
              cardCount: 1,
            },
          ],
        },
      ],
    };
    expect(sessionTitle({}, overview)).toBe('Tutte le materie');
    expect(sessionTitle({ subjectSlug: 'bd' }, overview)).toBe(
      'Basi di Dati · tutti gli argomenti',
    );
    expect(
      sessionTitle(
        { subjectSlug: 'bd', topicId: '00000000-0000-4000-8000-0000000000aa' },
        overview,
      ),
    ).toBe('Basi di Dati · Normalizzazione');
    expect(sessionTitle({ subjectSlug: 'bd', topicId: null }, overview)).toBe(
      'Basi di Dati · Senza argomento',
    );
    expect(sessionTitle({ subjectSlug: 'x' }, undefined)).toBe('x · tutti gli argomenti');
  });
});

describe('enqueueUndo', () => {
  const rateOp = (key: string): OutboxOp => ({
    kind: 'rate',
    key,
    subjectSlug: 'bd',
    cardId: key,
    rating: 3,
    elapsedMs: 1,
  });

  it('drops a rating that has not been sent yet', () => {
    expect(enqueueUndo([rateOp('a'), rateOp('b')], 'b', 'a')).toEqual([rateOp('a')]);
  });

  it('follows a rating already sent or in flight with an undo request', () => {
    expect(enqueueUndo([rateOp('a')], 'a', 'a')).toEqual([rateOp('a'), { kind: 'undo', key: 'a' }]);
    expect(enqueueUndo([], 'a', null)).toEqual([{ kind: 'undo', key: 'a' }]);
  });
});
