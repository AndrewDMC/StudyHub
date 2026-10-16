import { describe, expect, it } from 'vitest';
import { pickLessonForTopic, type LessonCandidate } from '../../src/planner/index.js';

function t(over: Partial<LessonCandidate> & { id: string }): LessonCandidate {
  return {
    taskKey: over.id,
    date: '2026-10-20',
    kind: 'read',
    status: 'todo',
    topicId: 'A',
    ...over,
  };
}

describe('pickLessonForTopic', () => {
  it('returns null without candidates', () => {
    expect(pickLessonForTopic([], 'A', '2026-10-16')).toBeNull();
    expect(pickLessonForTopic([t({ id: '1', topicId: 'B' })], 'A', '2026-10-16')).toBeNull();
  });

  it('picks the nearest date on or after today', () => {
    const tasks = [
      t({ id: 'past', date: '2026-10-10' }),
      t({ id: 'later', date: '2026-10-25' }),
      t({ id: 'today', date: '2026-10-16' }),
    ];
    expect(pickLessonForTopic(tasks, 'A', '2026-10-16')).toBe('today');
  });

  it('skips closed statuses and rest/simulation kinds', () => {
    const tasks = [
      t({ id: 'done', date: '2026-10-16', status: 'done' }),
      t({ id: 'skipped', date: '2026-10-16', status: 'skipped' }),
      t({ id: 'moved', date: '2026-10-16', status: 'moved' }),
      t({ id: 'rest', date: '2026-10-16', kind: 'rest' }),
      t({ id: 'sim', date: '2026-10-16', kind: 'simulation' }),
      t({ id: 'ok', date: '2026-10-30', status: 'proposed' }),
    ];
    expect(pickLessonForTopic(tasks, 'A', '2026-10-16')).toBe('ok');
  });

  it('prefers review > flashcards > read > others on the same date', () => {
    const tasks = [
      t({ id: 'drill', kind: 'drill' }),
      t({ id: 'read', kind: 'read' }),
      t({ id: 'fc', kind: 'flashcards' }),
      t({ id: 'rev', kind: 'review' }),
    ];
    expect(pickLessonForTopic(tasks, 'A', '2026-10-16')).toBe('rev');
    expect(pickLessonForTopic(tasks.slice(0, 3), 'A', '2026-10-16')).toBe('fc');
    expect(pickLessonForTopic(tasks.slice(0, 2), 'A', '2026-10-16')).toBe('read');
  });

  it('breaks full ties by taskKey then id', () => {
    const tasks = [t({ id: 'x', taskKey: 'b' }), t({ id: 'y', taskKey: 'a' })];
    expect(pickLessonForTopic(tasks, 'A', '2026-10-16')).toBe('y');
  });
});
