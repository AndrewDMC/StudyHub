import { describe, expect, it } from 'vitest';
import {
  statusCountsLabel,
  topicDotTone,
  type ProgressCounts,
  type TopicPlanKind,
} from '../src/components/overview/model';
import { topicMetaLabel } from '../src/components/plan/planModel';
import { toneBar, toneText } from '../src/components/plan-mobile/kindStyle';

const counts = (over: Partial<ProgressCounts> = {}): ProgressCounts => ({
  studied: 0,
  inProgress: 0,
  todo: 0,
  out: 0,
  lessonsDone: 0,
  lessonsTotal: 0,
  ...over,
});

describe('topicDotTone', () => {
  it('maps every plan state to a token family', () => {
    const expected: Record<TopicPlanKind, string> = {
      studied: 'ok',
      in_progress: 'accent',
      today: 'accent',
      late: 'accent',
      from: 'neutral',
      unplanned: 'neutral',
      out: 'danger',
      skipped: 'danger',
    };
    for (const [kind, tone] of Object.entries(expected)) {
      expect(topicDotTone(kind as TopicPlanKind)).toBe(tone);
    }
  });
});

describe('statusCountsLabel', () => {
  it('spells out the four counts and leaves the zeros out', () => {
    expect(statusCountsLabel(counts({ studied: 4, inProgress: 1, todo: 3, out: 1 }))).toBe(
      '4 studiati · 1 in corso · 3 da fare · 1 fuori',
    );
    expect(statusCountsLabel(counts({ todo: 2 }))).toBe('2 da fare');
    expect(statusCountsLabel(counts())).toBe('');
  });
});

describe('topicMetaLabel', () => {
  const base = { method: 'standard', total: 2, done: 0, userSprint: false } as const;
  it('describes progress through the lessons of a topic', () => {
    expect(topicMetaLabel(base)).toBe('2 lezioni');
    expect(topicMetaLabel({ ...base, total: 1 })).toBe('1 lezione');
    expect(topicMetaLabel({ ...base, done: 1 })).toBe('1 di 2 fatte');
    expect(topicMetaLabel({ ...base, done: 2 })).toBe('2 lezioni · fatte');
    expect(topicMetaLabel({ ...base, total: 1, done: 1 })).toBe('1 lezione · fatta');
  });
  it('flags topics left out and sprint lessons chosen by the student', () => {
    expect(topicMetaLabel({ ...base, method: 'fuori', total: 0 })).toBe('Fuori dal piano');
    expect(topicMetaLabel({ ...base, userSprint: true })).toBe('2 lezioni · sprint scelto da te');
  });
});

describe('task tone classes', () => {
  it('colours lessons by method and verifies, flashcards and simulations by their own tone', () => {
    const lesson = { kind: 'lesson', payload: { action: 'lesson' } } as never;
    const sprint = { kind: 'lesson', payload: { action: 'lesson', method: 'sprint' } } as never;
    expect(toneBar(lesson)).toBe('bg-accent');
    expect(toneBar(sprint)).toBe('bg-info');
    expect(toneBar({ kind: 'verify', payload: {} } as never)).toBe('bg-ok');
    expect(toneBar({ kind: 'flashcards', payload: {} } as never)).toBe('bg-ok');
    expect(toneBar({ kind: 'simulation', payload: {} } as never)).toBe('bg-warn');
    expect(toneText(sprint)).toBe('text-info');
    expect(toneBar({ kind: 'read', payload: {} } as never)).toBe('bg-border-strong');
  });
});
