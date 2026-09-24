import { describe, expect, it } from 'vitest';
import { schedulePlan, buildCapacity } from '../../src/planner/schedule.js';
import { addDays, weekday } from '../../src/planner/dates.js';
import type { PlannerInput, PlannerTopic, PlannedTask } from '../../src/planner/types.js';

/**
 * Fase B scenario tests (docs/fasi/F6-planner-calendario.md "Rischi":
 * "snapshot test su 10 casi: poco tempo, tanto tempo, un argomento, 5
 * materie, zero materiale… Scrivere quei test prima"). Written before
 * `schedule.ts`; every scenario also re-checks the hard constraints.
 */

const START = '2026-01-05'; // a Monday

function topic(key: string, overrides: Partial<PlannerTopic> = {}): PlannerTopic {
  return {
    key,
    topicId: key,
    name: `Argomento ${key}`,
    estimatedMinutes: 120,
    difficulty: 3,
    examWeight: 0.5,
    prerequisites: [],
    mastery: null,
    material: [{ docId: `doc-${key}`, pageFrom: 1, pageTo: 40 }],
    ...overrides,
  };
}

function input(overrides: Partial<PlannerInput> = {}): PlannerInput {
  return {
    startDate: START,
    targetDate: addDays(START, 30),
    availability: { perWeekday: [120, 180, 180, 180, 180, 180, 120], blackoutDates: [] },
    topics: [topic('a')],
    prefs: {
      sessionLength: 50,
      intensity: 'standard',
      simulationCount: 'auto',
      simulationMinutes: 90,
      reviewMinutesPerCard: 0.5,
    },
    ...overrides,
  };
}

/** Hard constraints that must hold in every scenario (docs/04-planner.md §4). */
function assertHardConstraints(i: PlannerInput, tasks: PlannedTask[]) {
  const capacity = buildCapacity(i);
  const byDay = new Map<string, number>();
  for (const t of tasks) byDay.set(t.date, (byDay.get(t.date) ?? 0) + t.minutes);
  for (const [date, minutes] of byDay) {
    // Pinned tasks are the user's explicit choice; everything else must fit.
    const pinned = tasks
      .filter((t) => t.date === date && t.pinned)
      .reduce((s, t) => s + t.minutes, 0);
    expect(minutes - pinned, `day ${date} over capacity`).toBeLessThanOrEqual(
      Math.max(0, (capacity.get(date) ?? 0) - pinned),
    );
    expect(date >= i.startDate && date < i.targetDate, `day ${date} outside the study window`).toBe(
      true,
    );
    expect(
      i.availability.blackoutDates.includes(date) && minutes > 0,
      `blackout ${date} used`,
    ).toBe(false);
  }
  const lastTwo = [addDays(i.targetDate, -1), addDays(i.targetDate, -2)];
  expect(tasks.filter((t) => t.kind === 'read' && lastTwo.includes(t.date))).toEqual([]);
  // Every task is actionable: reading tasks always say which material.
  for (const t of tasks.filter((x) => x.kind === 'read')) {
    expect(t.payload.material?.length ?? 0).toBeGreaterThan(0);
  }
}

describe('Fase B — scenario tests', () => {
  it('1. tanto tempo, un argomento: everything fits, spaced revisits and simulations are placed', () => {
    const i = input();
    const r = schedulePlan(i);
    assertHardConstraints(i, r.tasks);
    expect(r.feasibility.feasible).toBe(true);
    expect(r.tasks.filter((t) => t.kind === 'read').reduce((s, t) => s + t.minutes, 0)).toBe(120);
    // "ogni argomento rivisto ≥3 volte a intervalli crescenti"
    const revisits = r.tasks.filter(
      (t) => t.topicKey === 'a' && (t.kind === 'flashcards' || t.kind === 'review'),
    );
    expect(revisits.length).toBeGreaterThanOrEqual(3);
    const gaps = revisits
      .slice(1)
      .map((t, idx) => new Date(t.date).getTime() - new Date(revisits[idx]!.date).getTime());
    expect(gaps.every((g, idx) => idx === 0 || g >= gaps[idx - 1]!)).toBe(true);
    expect(r.tasks.filter((t) => t.kind === 'simulation')).toHaveLength(3);
  });

  it('2. poco tempo: declared infeasible up front, with shortfall and the 3 strategies, never overbooking', () => {
    const i = input({
      targetDate: addDays(START, 4),
      availability: { perWeekday: [60, 60, 60, 60, 60, 60, 60], blackoutDates: [] },
      topics: [topic('a', { estimatedMinutes: 600 }), topic('b', { estimatedMinutes: 600 })],
    });
    const r = schedulePlan(i);
    assertHardConstraints(i, r.tasks);
    expect(r.feasibility.feasible).toBe(false);
    expect(r.feasibility.shortfallMinutes).toBeGreaterThan(0);
    expect(r.feasibility.strategies.map((s) => s.id).sort()).toEqual([
      'copertura_superficiale',
      'estendi_data',
      'focus_80',
    ]);
  });

  it('3. prerequisites: a topic never starts before its prerequisite is finished', () => {
    const i = input({ topics: [topic('b', { prerequisites: ['a'] }), topic('a')] });
    const r = schedulePlan(i);
    assertHardConstraints(i, r.tasks);
    const lastA = r.tasks
      .filter((t) => t.kind === 'read' && t.topicKey === 'a')
      .map((t) => t.date)
      .sort()
      .at(-1)!;
    const firstB = r.tasks
      .filter((t) => t.kind === 'read' && t.topicKey === 'b')
      .map((t) => t.date)
      .sort()[0]!;
    expect(firstB > lastA).toBe(true);
  });

  it('4. blackout dates stay empty', () => {
    const blackout = [addDays(START, 1), addDays(START, 2)];
    const i = input({
      availability: { perWeekday: [180, 180, 180, 180, 180, 180, 180], blackoutDates: blackout },
    });
    const r = schedulePlan(i);
    assertHardConstraints(i, r.tasks);
    expect(r.tasks.filter((t) => blackout.includes(t.date))).toEqual([]);
  });

  it('5. ultimi 2 giorni: only review and light simulation, no new content', () => {
    const i = input({
      targetDate: addDays(START, 6),
      topics: [topic('a', { estimatedMinutes: 300 })],
    });
    const r = schedulePlan(i);
    assertHardConstraints(i, r.tasks);
    const lastTwo = [addDays(i.targetDate, -1), addDays(i.targetDate, -2)];
    const kindsInLastTwo = new Set(
      r.tasks.filter((t) => lastTwo.includes(t.date)).map((t) => t.kind),
    );
    expect(kindsInLastTwo.has('read')).toBe(false);
  });

  it('6. FSRS cards due have absolute precedence over new content', () => {
    const i = input({
      availability: { perWeekday: [60, 60, 60, 60, 60, 60, 60], blackoutDates: [] },
      dueCardsByDate: { [START]: 200 }, // 200 × 0.5 = 100 min, more than the day holds
    });
    const r = schedulePlan(i);
    assertHardConstraints(i, r.tasks);
    const day0 = r.tasks.filter((t) => t.date === START);
    expect(day0.map((t) => t.kind)).toEqual(['review']);
    expect(day0[0]?.payload.action).toBe('review_session');
  });

  it('7. interleaving: at most 2 new topics started per day', () => {
    const i = input({
      topics: ['a', 'b', 'c', 'd', 'e'].map((k) => topic(k, { estimatedMinutes: 30 })),
      availability: { perWeekday: [480, 480, 480, 480, 480, 480, 480], blackoutDates: [] },
    });
    const r = schedulePlan(i);
    assertHardConstraints(i, r.tasks);
    const firstDay = new Map<string, string>();
    for (const t of r.tasks.filter((x) => x.kind === 'read')) {
      if (!firstDay.has(t.topicKey!) || t.date < firstDay.get(t.topicKey!)!)
        firstDay.set(t.topicKey!, t.date);
    }
    const startsPerDay = new Map<string, number>();
    for (const d of firstDay.values()) startsPerDay.set(d, (startsPerDay.get(d) ?? 0) + 1);
    expect(Math.max(...startsPerDay.values())).toBeLessThanOrEqual(2);
  });

  it('8. due esami ravvicinati: minutes taken by the other subject are respected every day', () => {
    const busy: Record<string, number> = {};
    for (let d = 0; d < 30; d += 1) busy[addDays(START, d)] = 150;
    const i = input({ busyMinutesByDate: busy });
    const r = schedulePlan(i);
    assertHardConstraints(i, r.tasks);
    for (const t of r.tasks) {
      const perWeekday = i.availability.perWeekday[weekday(t.date)]!;
      const planned = r.tasks.filter((x) => x.date === t.date).reduce((s, x) => s + x.minutes, 0);
      expect(planned + 150).toBeLessThanOrEqual(perWeekday);
    }
  });

  it('9. pinned tasks stay put and their minutes are consumed first', () => {
    const pinned: PlannedTask = {
      key: 'manual:1',
      date: addDays(START, 3),
      kind: 'rest',
      topicKey: null,
      topicId: null,
      minutes: 180,
      title: 'Giornata libera',
      description: '',
      payload: { action: 'manual' },
      pinned: true,
      origin: 'manual',
    };
    const i = input({ pinned: [pinned] });
    const r = schedulePlan(i);
    assertHardConstraints(i, r.tasks);
    expect(r.tasks.find((t) => t.key === 'manual:1')?.date).toBe(addDays(START, 3));
    expect(r.tasks.filter((t) => t.date === addDays(START, 3) && !t.pinned)).toEqual([]);
  });

  it('10. zero materiale: a topic without material produces no task, and says why', () => {
    const i = input({ topics: [topic('a', { material: [] })] });
    const r = schedulePlan(i);
    expect(r.tasks.filter((t) => t.topicKey === 'a')).toEqual([]);
    expect(r.warnings.join(' ')).toMatch(/materiale/);
  });

  it('11. 5 materie-sized load (8 topics) still respects every constraint', () => {
    const topics = Array.from({ length: 8 }, (_, n) =>
      topic(`t${n}`, {
        estimatedMinutes: 90 + n * 20,
        difficulty: (n % 5) + 1,
        examWeight: (n + 1) / 10,
      }),
    );
    const i = input({ topics });
    const r = schedulePlan(i);
    assertHardConstraints(i, r.tasks);
    expect(r.feasibility.feasible).toBe(true);
  });

  it('12. deterministic: same input, same plan', () => {
    const i = input({ topics: [topic('a'), topic('b', { difficulty: 5 })] });
    expect(schedulePlan(i)).toEqual(schedulePlan(i));
  });

  it('13. an exam date not after the start is infeasible and proposes extending it', () => {
    const r = schedulePlan(input({ targetDate: START }));
    expect(r.feasibility.feasible).toBe(false);
    expect(r.feasibility.strategies.some((s) => s.id === 'estendi_data')).toBe(true);
  });

  it('14. already-mastered material needs less time', () => {
    const fresh = schedulePlan(input({ topics: [topic('a', { mastery: 0 })] }));
    const known = schedulePlan(input({ topics: [topic('a', { mastery: 0.8 })] }));
    const minutes = (r: typeof fresh) =>
      r.tasks.filter((t) => t.kind === 'read').reduce((s, t) => s + t.minutes, 0);
    expect(minutes(known)).toBeLessThan(minutes(fresh));
  });

  it('15. reading sessions cover the material pages in order, without gaps', () => {
    const r = schedulePlan(input({ topics: [topic('a', { estimatedMinutes: 200 })] }));
    const reads = r.tasks
      .filter((t) => t.kind === 'read')
      .sort((x, y) => (x.date + x.key).localeCompare(y.date + y.key));
    const pages = reads.flatMap((t) => t.payload.material!);
    expect(pages[0]?.pageFrom).toBe(1);
    expect(pages.at(-1)?.pageTo).toBe(40);
    for (let n = 1; n < pages.length; n += 1)
      expect(pages[n]!.pageFrom).toBe(pages[n - 1]!.pageTo + 1);
  });

  it('15b. uneven splits (81 min over 15 pages) still cover every page exactly once', () => {
    // Regression: rounding start with floor and end with round repeated p. 43.
    const r = schedulePlan(
      input({
        targetDate: addDays(START, 14),
        availability: { perWeekday: [0, 120, 120, 120, 120, 120, 60], blackoutDates: [] },
        topics: [
          topic('a', {
            estimatedMinutes: 150,
            material: [{ docId: 'd1', pageFrom: 1, pageTo: 30 }],
          }),
          topic('b', {
            estimatedMinutes: 90,
            mastery: 0.2,
            prerequisites: ['a'],
            material: [{ docId: 'd1', pageFrom: 31, pageTo: 45 }],
          }),
        ],
      }),
    );
    for (const key of ['a', 'b']) {
      const pages = r.tasks
        .filter((t) => t.kind === 'read' && t.topicKey === key)
        .flatMap((t) => t.payload.material!)
        .flatMap((m) =>
          Array.from({ length: m.pageTo - m.pageFrom + 1 }, (_, i) => m.pageFrom + i),
        );
      expect(new Set(pages).size, `pages repeated for ${key}`).toBe(pages.length);
      expect(pages).toEqual(
        key === 'a'
          ? Array.from({ length: 30 }, (_, i) => i + 1)
          : Array.from({ length: 15 }, (_, i) => i + 31),
      );
    }
  });

  it('15c. simulations are numbered in calendar order even when one is displaced', () => {
    const r = schedulePlan(
      input({
        targetDate: addDays(START, 14),
        availability: { perWeekday: [0, 120, 120, 120, 120, 120, 60], blackoutDates: [] },
      }),
    );
    const sims = r.tasks.filter((t) => t.kind === 'simulation');
    expect(sims.length).toBeGreaterThan(1);
    sims.forEach((s, i) => expect(s.title).toBe(`Simulazione d'esame ${i + 1}`));
    const dates = sims.map((s) => s.date);
    expect([...dates].sort()).toEqual(dates);
  });

  it('16. Fase B is fast: 8 topics over 30 days in well under 500 ms', () => {
    const topics = Array.from({ length: 8 }, (_, n) => topic(`t${n}`, { estimatedMinutes: 150 }));
    const t0 = performance.now();
    schedulePlan(input({ topics }));
    expect(performance.now() - t0).toBeLessThan(500);
  });
});
