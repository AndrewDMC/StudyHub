import { describe, expect, it } from 'vitest';
import { applyBulkAction } from '../../src/planner/bulk.js';
import { addDays } from '../../src/planner/dates.js';
import type { PlanWindow } from '../../src/planner/adapt.js';
import type { PlannedTask } from '../../src/planner/types.js';

const START = '2026-01-05';
const TARGET = addDays(START, 10);

function task(o: Partial<PlannedTask> & Pick<PlannedTask, 'key' | 'date'>): PlannedTask {
  return {
    kind: 'read',
    topicKey: 'a',
    topicId: 'a',
    minutes: 50,
    title: `Task ${o.key}`,
    description: '',
    payload: { action: 'read' },
    pinned: false,
    origin: 'planner',
    ...o,
  };
}

function window(cap = 100, overrides: Partial<PlanWindow> = {}): PlanWindow {
  const capacity = new Map<string, number>();
  for (let d = START; d < TARGET; d = addDays(d, 1)) capacity.set(d, cap);
  return { capacity, targetDate: TARGET, prerequisites: new Map(), ...overrides };
}

describe('applyBulkAction — shift', () => {
  it('shifts every unpinned task from a date onward, and leaves pinned and earlier ones', () => {
    const tasks = [
      task({ key: 'read:a:001', date: START }),
      task({ key: 'read:a:002', date: addDays(START, 1) }),
      task({ key: 'read:b:001', topicKey: 'b', date: addDays(START, 2), pinned: true }),
      task({ key: 'read:a:004', date: addDays(START, 3) }),
    ];
    const r = applyBulkAction(tasks, { type: 'shift', days: 2, from: addDays(START, 1) }, window());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const date = (k: string) => r.tasks.find((t) => t.key === k)!.date;
    expect(date('read:a:001')).toBe(START);
    expect(date('read:a:002')).toBe(addDays(START, 3));
    expect(date('read:b:001')).toBe(addDays(START, 2)); // pinned
    expect(date('read:a:004')).toBe(addDays(START, 5));
    expect(r.changedKeys).toEqual(['read:a:002', 'read:a:004']);
  });

  it('refuses the whole action when a task would leave the plan window, changing nothing', () => {
    const tasks = [task({ key: 'read:a:001', date: addDays(START, 8) })];
    const r = applyBulkAction(tasks, { type: 'shift', days: 5 }, window());
    expect(r.ok).toBe(false);
    expect(tasks[0]!.date).toBe(addDays(START, 8));
  });

  it('refuses when a day would overflow because of the shift', () => {
    const tasks = [
      task({ key: 'read:a:001', date: START, minutes: 80 }),
      task({ key: 'read:a:002', date: addDays(START, 1), minutes: 80, pinned: true }),
    ];
    const r = applyBulkAction(tasks, { type: 'shift', days: 1 }, window(100));
    expect(r).toMatchObject({ ok: false });
  });

  it('rejects zero / non-integer shifts and nothing-to-move', () => {
    expect(applyBulkAction([], { type: 'shift', days: 0 }, window()).ok).toBe(false);
    expect(
      applyBulkAction(
        [task({ key: 'k', date: START, pinned: true })],
        { type: 'shift', days: 1 },
        window(),
      ).ok,
    ).toBe(false);
  });
});

describe('applyBulkAction — reduce_load', () => {
  it('shortens study tasks by the percentage, rounded to 5, never below 10 min', () => {
    const tasks = [
      task({ key: 'read:a:001', date: START, minutes: 50 }),
      task({ key: 'flash:a:001', date: START, kind: 'flashcards', minutes: 12 }),
    ];
    const r = applyBulkAction(tasks, { type: 'reduce_load', percent: 20 }, window());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.tasks.map((t) => t.minutes)).toEqual([40, 10]);
  });

  it('leaves pinned, simulation and rest tasks alone', () => {
    const tasks = [
      task({ key: 'a', date: START, pinned: true, minutes: 60 }),
      task({ key: 'b', date: START, kind: 'simulation', minutes: 90 }),
      task({ key: 'c', date: START, kind: 'rest', minutes: 30 }),
    ];
    const r = applyBulkAction(tasks, { type: 'reduce_load', percent: 30 }, window(300));
    expect(r.ok).toBe(false);
  });

  it('rejects an out-of-range percentage', () => {
    expect(
      applyBulkAction(
        [task({ key: 'a', date: START })],
        { type: 'reduce_load', percent: 0 },
        window(),
      ).ok,
    ).toBe(false);
    expect(
      applyBulkAction(
        [task({ key: 'a', date: START })],
        { type: 'reduce_load', percent: 100 },
        window(),
      ).ok,
    ).toBe(false);
  });
});

describe('applyBulkAction — exclude_topic', () => {
  it('removes the unpinned tasks of a topic and keeps its pinned ones', () => {
    const tasks = [
      task({ key: 'a1', date: START, topicKey: 'a' }),
      task({ key: 'a2', date: START, topicKey: 'a', pinned: true }),
      task({ key: 'b1', date: START, topicKey: 'b' }),
    ];
    const r = applyBulkAction(tasks, { type: 'exclude_topic', topicKey: 'a' }, window());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.tasks.map((t) => t.key)).toEqual(['a2', 'b1']);
    expect(r.removedKeys).toEqual(['a1']);
  });

  it('says so when there is nothing to exclude', () => {
    expect(
      applyBulkAction(
        [task({ key: 'a', date: START })],
        { type: 'exclude_topic', topicKey: 'zzz' },
        window(),
      ).ok,
    ).toBe(false);
  });
});
