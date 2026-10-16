import { describe, expect, it } from 'vitest';
import type { DeckGroupDto, SortFlashcardsStatus, TopicDto } from '@studyhub/contracts';
import {
  NO_TOPIC,
  buildDeckTree,
  canReview,
  groupFilterValue,
  reviewHref,
  sortMessage,
  sortView,
} from '../src/lib/deckGroups';

const T1 = '00000000-0000-4000-8000-000000000001';
const T2 = '00000000-0000-4000-8000-000000000002';
const T3 = '00000000-0000-4000-8000-000000000003';

function group(topicId: string | null, over: Partial<DeckGroupDto> = {}): DeckGroupDto {
  return {
    topicId,
    topicName: topicId ? `Topic ${topicId.slice(-1)}` : null,
    parentTopicId: null,
    total: 4,
    due: 1,
    new: 2,
    suspended: 0,
    ...over,
  };
}
const topics = [{ id: T1 }, { id: T2 }, { id: T3 }] as TopicDto[];

describe('buildDeckTree', () => {
  it('orders by topic order and keeps the unsorted group apart', () => {
    const tree = buildDeckTree([group(null), group(T3), group(T1)], topics);
    expect(tree.rows.map((r) => r.group.topicId)).toEqual([T1, T3]);
    expect(tree.unsorted?.topicId).toBeNull();
  });

  it('nests children one level under a parent that has cards, without summing', () => {
    const tree = buildDeckTree([group(T2, { parentTopicId: T1 }), group(T1, { total: 9 })], topics);
    expect(tree.rows.map((r) => [r.group.topicId, r.depth])).toEqual([
      [T1, 0],
      [T2, 1],
    ]);
    expect(tree.rows[0]!.group.total).toBe(9);
  });

  it('promotes a child whose parent has no cards to root', () => {
    const tree = buildDeckTree([group(T2, { parentTopicId: T1 })], topics);
    expect(tree.rows).toEqual([{ group: expect.anything(), depth: 0 }]);
  });

  it('flattens deeper levels to depth 1', () => {
    const tree = buildDeckTree(
      [group(T1), group(T2, { parentTopicId: T1 }), group(T3, { parentTopicId: T2 })],
      topics,
    );
    expect(tree.rows.map((r) => [r.group.topicId, r.depth])).toEqual([
      [T1, 0],
      [T2, 1],
      [T3, 1],
    ]);
  });

  it('has no unsorted group when every card has a topic', () => {
    expect(buildDeckTree([group(T1)], topics).unsorted).toBeNull();
  });
});

describe('group helpers', () => {
  it('uses the none token for unsorted cards', () => {
    expect(groupFilterValue(group(null))).toBe(NO_TOPIC);
    expect(reviewHref('mat', group(null))).toBe('/ripasso?materia=mat&argomento=none');
    expect(reviewHref('mat', group(T1))).toBe(`/ripasso?materia=mat&argomento=${T1}`);
  });
  it('reviews only with due or new cards', () => {
    expect(canReview(group(T1, { due: 0, new: 0 }))).toBe(false);
    expect(canReview(group(T1, { due: 0, new: 1 }))).toBe(true);
  });
});

describe('sort status', () => {
  const output = {
    assigned: 5,
    assignedByDocument: 2,
    assignedByAi: 3,
    unassigned: 1,
    noTopics: false,
  };
  it('maps job states', () => {
    expect(sortView({ status: 'queued' } as SortFlashcardsStatus)).toEqual({ phase: 'running' });
    expect(sortView({ status: 'failed' } as SortFlashcardsStatus)).toEqual({ phase: 'failed' });
    const done = sortView({ status: 'succeeded', output } as SortFlashcardsStatus);
    expect(done).toEqual({ phase: 'done', sorted: 5, remaining: 1, noTopics: false });
  });
  it('words the outcome', () => {
    expect(sortMessage({ phase: 'done', sorted: 5, remaining: 1, noTopics: false })).toBe(
      '5 card ordinate nei loro argomenti. 1 sono rimaste senza argomento.',
    );
    expect(sortMessage({ phase: 'done', sorted: 0, remaining: 3, noTopics: false })).toMatch(
      /Nessuna card è stata assegnata/,
    );
  });
});
