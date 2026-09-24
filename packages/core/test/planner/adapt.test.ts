import { describe, expect, it } from 'vitest';
import {
  detectDrift,
  diffPlans,
  moveTask,
  validatePlan,
  type PlanWindow,
  type TaskStatus,
} from '../../src/planner/adapt.js';
import { addDays } from '../../src/planner/dates.js';
import type { PlannedTask } from '../../src/planner/types.js';

/**
 * `adapt.ts` had zero test coverage despite being exactly the code the F6
 * risk mitigation asked to test first ("il re-schedule dev'essere istantaneo
 * e gratuito" — docs/fasi/F6 "Decisioni"). These are scenario tests for the
 * three responsibilities it has: validating hard constraints on an arbitrary
 * task set, moving one task without breaking them, and summarizing a
 * recalculation as a readable diff.
 */

const START = '2026-01-05';
const TARGET = addDays(START, 10); // 10 study days: START..addDays(START,9)

function task(overrides: Partial<PlannedTask> & Pick<PlannedTask, 'key' | 'date'>): PlannedTask {
  return {
    kind: 'read',
    topicKey: 'a',
    topicId: 'a',
    minutes: 50,
    title: `Task ${overrides.key}`,
    description: '',
    payload: { action: 'read' },
    pinned: false,
    origin: 'planner',
    ...overrides,
  };
}

function window(overrides: Partial<PlanWindow> = {}): PlanWindow {
  const capacity = new Map<string, number>();
  for (let d = START; d < TARGET; d = addDays(d, 1)) capacity.set(d, 100);
  return { capacity, targetDate: TARGET, prerequisites: new Map(), ...overrides };
}

describe('validatePlan', () => {
  it('accepts a plan within capacity and constraints', () => {
    const tasks = [task({ key: 'read:a:001', date: START, minutes: 50 })];
    expect(validatePlan(tasks, window())).toEqual([]);
  });

  it('flags a day over capacity', () => {
    const tasks = [
      task({ key: 'read:a:001', date: START, minutes: 60 }),
      task({ key: 'read:a:002', date: START, minutes: 60 }),
    ];
    const violations = validatePlan(tasks, window());
    expect(violations).toHaveLength(1);
    expect(violations[0]!.date).toBe(START);
  });

  it('flags a day outside the plan window', () => {
    const tasks = [task({ key: 'read:a:001', date: addDays(TARGET, 5), minutes: 10 })];
    const violations = validatePlan(tasks, window());
    expect(violations).toHaveLength(1);
    expect(violations[0]!.message).toMatch(/fuori dal periodo/);
  });

  it('flags new content in the last two days before the exam', () => {
    const lastDay = addDays(TARGET, -1);
    const tasks = [task({ key: 'read:a:001', date: lastDay, kind: 'read', minutes: 10 })];
    const violations = validatePlan(tasks, window());
    expect(violations.some((v) => v.message.includes('ultimi 2 giorni'))).toBe(true);
  });

  it('does not flag a review in the last two days', () => {
    const lastDay = addDays(TARGET, -1);
    const tasks = [task({ key: 'rev:a:1', date: lastDay, kind: 'review', minutes: 10 })];
    expect(validatePlan(tasks, window())).toEqual([]);
  });

  it('flags reading sessions on the same topic out of sequence order', () => {
    const tasks = [
      task({ key: 'read:a:002', date: START, minutes: 10 }),
      task({ key: 'read:a:001', date: addDays(START, 1), minutes: 10 }),
    ];
    const violations = validatePlan(tasks, window());
    expect(
      violations.some((v) => v.message.includes('viene prima della sessione precedente')),
    ).toBe(true);
  });

  it('flags flashcards scheduled before the topic is finished', () => {
    const tasks = [
      task({ key: 'read:a:001', date: addDays(START, 2), minutes: 10 }),
      task({ key: 'rev:a:1', date: START, kind: 'flashcards', minutes: 10 }),
    ];
    const violations = validatePlan(tasks, window());
    expect(violations.some((v) => v.message.includes('arriva prima di aver finito'))).toBe(true);
  });

  it('flags a topic starting before its prerequisite is finished', () => {
    const tasks = [
      task({ key: 'read:a:001', date: START, topicKey: 'a', minutes: 10 }),
      task({ key: 'read:b:001', date: START, topicKey: 'b', minutes: 10 }),
    ];
    const w = window({ prerequisites: new Map([['b', ['a']]]) });
    const violations = validatePlan(tasks, w);
    expect(violations.some((v) => v.message.includes('prerequisito'))).toBe(true);
  });
});

describe('moveTask', () => {
  it('moves a task to a day with room and pins it', () => {
    const tasks = [task({ key: 'read:a:001', date: START, minutes: 50 })];
    const result = moveTask(tasks, 'read:a:001', addDays(START, 1), window());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.tasks[0]!.date).toBe(addDays(START, 1));
    expect(result.tasks[0]!.pinned).toBe(true);
    expect(result.displaced).toEqual([]);
  });

  it('refuses to move a task that does not exist', () => {
    const result = moveTask([], 'nope', START, window());
    expect(result).toEqual({ ok: false, reason: 'Task non trovata nel piano.' });
  });

  it('refuses a target day outside the plan window', () => {
    const tasks = [task({ key: 'read:a:001', date: START, minutes: 50 })];
    const result = moveTask(tasks, 'read:a:001', addDays(TARGET, 5), window());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/fuori dal periodo/);
  });

  it('refuses a target day with zero capacity', () => {
    const w = window();
    w.capacity.set(addDays(START, 1), 0);
    const tasks = [task({ key: 'read:a:001', date: START, minutes: 50 })];
    const result = moveTask(tasks, 'read:a:001', addDays(START, 1), w);
    expect(result.ok).toBe(false);
  });

  it('cascades a displaced task to the next day with room', () => {
    const tasks = [
      task({ key: 'read:a:001', date: START, minutes: 50 }),
      task({ key: 'read:b:001', date: addDays(START, 1), topicKey: 'b', minutes: 90 }),
    ];
    const result = moveTask(tasks, 'read:a:001', addDays(START, 1), window());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Moved task (50) + existing (90) = 140 > 100 capacity: the existing one is displaced.
    expect(result.displaced).toEqual([
      { key: 'read:b:001', from: addDays(START, 1), to: addDays(START, 2) },
    ]);
    const moved = result.tasks.find((t) => t.key === 'read:b:001')!;
    expect(moved.date).toBe(addDays(START, 2));
  });

  it('refuses the move when the only other tasks on the target day are pinned', () => {
    const tasks = [
      task({ key: 'read:a:001', date: START, minutes: 50 }),
      task({
        key: 'read:b:001',
        date: addDays(START, 1),
        topicKey: 'b',
        minutes: 90,
        pinned: true,
      }),
    ];
    const result = moveTask(tasks, 'read:a:001', addDays(START, 1), window());
    expect(result.ok).toBe(false);
  });

  it('refuses a move that would break a hard constraint (new content in the last 2 days)', () => {
    const lastDay = addDays(TARGET, -1);
    const tasks = [task({ key: 'read:a:001', date: START, kind: 'read', minutes: 50 })];
    const result = moveTask(tasks, 'read:a:001', lastDay, window());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/ultimi 2 giorni/);
  });

  it('does not mutate the input array', () => {
    const tasks = [task({ key: 'read:a:001', date: START, minutes: 50 })];
    moveTask(tasks, 'read:a:001', addDays(START, 1), window());
    expect(tasks[0]!.date).toBe(START);
    expect(tasks[0]!.pinned).toBe(false);
  });
});

describe('detectDrift', () => {
  const today = addDays(START, 8);

  function withStatus(key: string, date: string, status: TaskStatus) {
    return { key, date, status };
  }

  it('reports no drift when everything is done or in the future', () => {
    const tasks = [
      withStatus('a', addDays(today, -1), 'done'),
      withStatus('b', addDays(today, 1), 'todo'),
    ];
    const report = detectDrift(tasks, today);
    expect(report.shouldRecalculate).toBe(false);
    expect(report.overdueKeys).toEqual([]);
  });

  it('recalculates after 2+ missed days', () => {
    const tasks = [
      withStatus('a', addDays(today, -1), 'todo'),
      withStatus('b', addDays(today, -2), 'todo'),
    ];
    const report = detectDrift(tasks, today);
    expect(report.shouldRecalculate).toBe(true);
    expect(report.missedDays).toHaveLength(2);
    expect(report.reason).toMatch(/giorni saltati/);
  });

  it('recalculates when 30%+ of the past week is overdue even without 2 fully-missed days', () => {
    const tasks = [
      withStatus('a', addDays(today, -1), 'done'),
      withStatus('b', addDays(today, -1), 'todo'),
      withStatus('c', addDays(today, -1), 'todo'),
      withStatus('d', addDays(today, -1), 'done'),
    ];
    const report = detectDrift(tasks, today);
    expect(report.shouldRecalculate).toBe(true);
    expect(report.reason).toMatch(/%/);
  });

  it('ignores tasks older than 7 days', () => {
    const tasks = [withStatus('old', addDays(today, -20), 'todo')];
    const report = detectDrift(tasks, today);
    expect(report.overdueKeys).toEqual([]);
    expect(report.shouldRecalculate).toBe(false);
  });
});

describe('diffPlans', () => {
  it('reports added, removed, moved and unchanged tasks with the given reason', () => {
    const active = [
      task({ key: 'read:a:001', date: START, minutes: 50 }),
      task({ key: 'read:a:002', date: addDays(START, 1), minutes: 50 }),
    ];
    const draft = [
      task({ key: 'read:a:001', date: START, minutes: 50 }), // unchanged
      task({ key: 'read:a:002', date: addDays(START, 2), minutes: 50 }), // moved
      task({ key: 'read:a:003', date: addDays(START, 3), minutes: 50 }), // added
    ];
    const diff = diffPlans(active, draft, 'simulazione sotto soglia');
    expect(diff.unchanged).toBe(1);
    const added = diff.rows.find((r) => r.key === 'read:a:003');
    expect(added).toMatchObject({ change: 'added', to: addDays(START, 3) });
    const moved = diff.rows.find((r) => r.key === 'read:a:002');
    expect(moved).toMatchObject({
      change: 'moved',
      from: addDays(START, 1),
      to: addDays(START, 2),
    });
    expect(diff.rows.every((r) => r.reason.includes('simulazione sotto soglia'))).toBe(true);
  });

  it('never lists a pinned task in the diff', () => {
    const active = [task({ key: 'read:a:001', date: START, minutes: 50, pinned: true })];
    const draft = [task({ key: 'read:a:001', date: addDays(START, 3), minutes: 50, pinned: true })];
    const diff = diffPlans(active, draft, 'ricalcolo');
    expect(diff.rows).toEqual([]);
  });

  it('reports a resized task with the minute delta in the reason', () => {
    const active = [task({ key: 'read:a:001', date: START, minutes: 50 })];
    const draft = [task({ key: 'read:a:001', date: START, minutes: 80 })];
    const diff = diffPlans(active, draft, 'nuovo materiale');
    expect(diff.rows).toEqual([
      expect.objectContaining({
        change: 'resized',
        key: 'read:a:001',
        reason: '50 → 80 min — nuovo materiale',
      }),
    ]);
  });
});
