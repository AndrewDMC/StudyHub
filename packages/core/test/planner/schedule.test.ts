import { describe, expect, it } from 'vitest';
import { schedulePlan, buildCapacity } from '../../src/planner/schedule.js';
import { addDays, weekday } from '../../src/planner/dates.js';
import type {
  PlannerInput,
  PlannerLesson,
  PlannerTopic,
  PlannedTask,
} from '../../src/planner/types.js';

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

/** `n` lessons of `std` / `sprint` minutes each, split by content. */
function lessonsOf(key: string, n: number, std: number, sprint: number): PlannerLesson[] {
  return Array.from({ length: n }, (_, i) => ({
    title: `Lezione ${i + 1} di ${key}`,
    material: [{ docId: `doc-${key}`, pageFrom: i * 10 + 1, pageTo: i * 10 + 10 }],
    standardMinutes: std,
    sprintMinutes: sprint,
  }));
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
  expect(tasks.filter((t) => t.kind === 'lesson' && lastTwo.includes(t.date))).toEqual([]);
  // Every task is actionable: reading tasks always say which material.
  for (const t of tasks.filter((x) => x.kind === 'lesson')) {
    expect(t.payload.material?.length ?? 0).toBeGreaterThan(0);
  }
}

describe('Fase B — scenario tests', () => {
  it('1. tanto tempo, un argomento: everything fits, spaced revisits and simulations are placed', () => {
    const i = input();
    const r = schedulePlan(i);
    assertHardConstraints(i, r.tasks);
    expect(r.feasibility.feasible).toBe(true);
    expect(r.tasks.filter((t) => t.kind === 'lesson').reduce((s, t) => s + t.minutes, 0)).toBe(120);
    // "ogni argomento rivisto ≥3 volte a intervalli crescenti"
    const revisits = r.tasks.filter(
      (t) => t.topicKey === 'a' && (t.kind === 'flashcards' || t.kind === 'verify'),
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
      targetDate: addDays(START, 6),
      availability: { perWeekday: [60, 60, 60, 60, 60, 60, 60], blackoutDates: [] },
      topics: [
        topic('a', { lessons: lessonsOf('a', 6, 50, 35) }),
        topic('b', { lessons: lessonsOf('b', 6, 50, 35) }),
      ],
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

  it('2b. poco tempo: no lesson ever shrinks; sprint lessons and left-out topics are named', () => {
    const topics = [
      topic('a', { examWeight: 0.9, lessons: lessonsOf('a', 2, 50, 30) }),
      topic('b', { examWeight: 0.5, lessons: lessonsOf('b', 2, 50, 30) }),
      topic('c', { examWeight: 0.1, lessons: lessonsOf('c', 2, 50, 30) }),
    ];
    const i = input({
      targetDate: addDays(START, 8),
      availability: { perWeekday: [0, 60, 60, 60, 60, 60, 0], blackoutDates: [] },
      prefs: { ...input().prefs, simulationCount: 0 },
      topics,
    });
    const r = schedulePlan(i);
    assertHardConstraints(i, r.tasks);
    const f = r.feasibility;
    // Not enough time is still said out loud, with the real shortfall and the strategies...
    expect(f.feasible).toBe(false);
    expect(f.shortfallMinutes).toBeGreaterThan(0);
    expect(f.requiredMinutes).toBeGreaterThan(f.availableMinutes);
    expect(f.strategies).toHaveLength(3);
    // ...the method changed and topics left out, lowest exam weight first, by name...
    expect(f.excludedTopicKeys).toEqual(['c']);
    expect(f.unscheduledTopicKeys).toEqual(['c']);
    expect(f.sprintLessonKeys).toEqual(expect.arrayContaining(['lesson:b:001', 'lesson:b:002']));
    expect(f.sprintLessonKeys).not.toContain('lesson:c:001'); // left out, not sprint
    expect(r.warnings.some((w) => w.includes('Lezione 1 di b') && w.includes('sprint'))).toBe(true);
    expect(r.warnings.some((w) => w.includes('Argomento c') && w.includes('fuori'))).toBe(true);
    expect(r.warnings.some((w) => w.includes('compresso'))).toBe(false);
    // ...but no lesson is compressed: each lasts exactly its own estimate.
    const lessons = r.tasks.filter((t) => t.kind === 'lesson');
    expect(lessons.some((t) => t.topicKey === 'c')).toBe(false);
    for (const t of lessons) {
      const sprint = f.sprintLessonKeys!.includes(t.key);
      expect(t.minutes).toBe(sprint ? 30 : 50);
      expect(t.payload.method).toBe(sprint ? 'sprint' : 'standard');
    }
    expect(lessons.filter((t) => t.topicKey === 'a')).toHaveLength(2);
  });

  it('2c. no availability at all cannot be planned, and says so', () => {
    const r = schedulePlan(
      input({ availability: { perWeekday: [0, 0, 0, 0, 0, 0, 0], blackoutDates: [] } }),
    );
    expect(r.tasks.filter((t) => t.kind === 'lesson')).toHaveLength(0);
    expect(r.feasibility.feasible).toBe(false);
    expect(r.feasibility.excludedTopicKeys).toEqual(['a']);
  });

  it('2d. days fully taken by other subjects are said out loud, with the right strategy hint', () => {
    const busy: Record<string, number> = {};
    for (let d = 0; d <= 30; d++) busy[addDays(START, d)] = 1000;
    const r = schedulePlan(input({ busyMinutesByDate: busy }));
    expect(r.tasks.filter((t) => t.kind === 'lesson')).toHaveLength(0);
    expect(r.warnings.some((w) => w.includes('occupati da task di altre materie'))).toBe(true);
    const extend = r.feasibility.strategies.find((s) => s.id === 'estendi_data')!;
    expect(extend.description).toContain('già occupato da altre materie');
  });

  it('3. prerequisites: a topic never starts before its prerequisite is finished', () => {
    const i = input({ topics: [topic('b', { prerequisites: ['a'] }), topic('a')] });
    const r = schedulePlan(i);
    assertHardConstraints(i, r.tasks);
    // Tasks come sorted by date, then key: within a day, a's sessions are placed before b's.
    const reads = r.tasks.filter((t) => t.kind === 'lesson');
    const lastA = reads.findLastIndex((t) => t.topicKey === 'a');
    const firstB = reads.findIndex((t) => t.topicKey === 'b');
    expect(reads[firstB]!.date >= reads[lastA]!.date).toBe(true);
  });

  it('3b. esame vicino: the days fill with whole lessons, the time that is missing is declared', () => {
    // 6 study days, 180 min/day, 12 topics of 120 min: not everything fits, nothing gets shorter.
    for (const chain of [false, true]) {
      const i = input({
        startDate: '2026-10-28',
        targetDate: '2026-11-03',
        availability: { perWeekday: [180, 180, 180, 180, 180, 180, 180], blackoutDates: [] },
        topics: Array.from({ length: 12 }, (_, n) =>
          topic(`t${String(n).padStart(2, '0')}`, {
            examWeight: (n + 1) / 20,
            prerequisites: chain && n > 0 ? [`t${String(n - 1).padStart(2, '0')}`] : [],
          }),
        ),
      });
      const r = schedulePlan(i);
      assertHardConstraints(i, r.tasks);
      expect(r.feasibility.feasible).toBe(false);
      expect(r.feasibility.excludedTopicKeys!.length).toBeGreaterThan(0);
      // The topics left out are the ones with the lowest exam weight.
      const left = r.feasibility.excludedTopicKeys!;
      expect(left).toEqual(left.slice().sort());
      expect(left[0]).toBe('t00');
      for (const t of r.tasks.filter((x) => x.kind === 'lesson')) {
        const sprint = r.feasibility.sprintLessonKeys!.includes(t.key);
        expect(t.minutes).toBe(sprint ? 85 : 120);
      }
    }
  });

  it('3c. the per-day cap on new topics is lifted when it alone makes a plan infeasible', () => {
    // 8 short topics, 3 days of new content: the minutes are there, the 2-per-day cap is not.
    const i = input({
      targetDate: addDays(START, 5),
      availability: { perWeekday: [480, 480, 480, 480, 480, 480, 480], blackoutDates: [] },
      topics: Array.from({ length: 8 }, (_, n) => topic(`t${n}`, { estimatedMinutes: 30 })),
    });
    const r = schedulePlan(i);
    assertHardConstraints(i, r.tasks);
    expect(r.feasibility.feasible).toBe(true);
    expect(r.feasibility.sprintLessonKeys).toEqual([]);
    expect(r.feasibility.excludedTopicKeys).toEqual([]);
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
      topics: [topic('a', { lessons: lessonsOf('a', 5, 60, 40) })],
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
      topics: [topic('a', { lessons: lessonsOf('a', 4, 30, 20) })],
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
    for (const t of r.tasks.filter((x) => x.kind === 'lesson')) {
      if (!firstDay.has(t.topicKey!) || t.date < firstDay.get(t.topicKey!)!)
        firstDay.set(t.topicKey!, t.date);
    }
    const startsPerDay = new Map<string, number>();
    for (const d of firstDay.values()) startsPerDay.set(d, (startsPerDay.get(d) ?? 0) + 1);
    expect(Math.max(...startsPerDay.values())).toBeLessThanOrEqual(2);
  });

  it('8. due esami ravvicinati: minutes taken by the other subject are respected every day', () => {
    const busy: Record<string, number> = {};
    for (let d = 0; d < 30; d += 1) busy[addDays(START, d)] = 100;
    const i = input({
      busyMinutesByDate: busy,
      topics: [topic('a', { lessons: lessonsOf('a', 4, 30, 20) })],
    });
    const r = schedulePlan(i);
    assertHardConstraints(i, r.tasks);
    for (const t of r.tasks) {
      const perWeekday = i.availability.perWeekday[weekday(t.date)]!;
      const planned = r.tasks.filter((x) => x.date === t.date).reduce((s, x) => s + x.minutes, 0);
      expect(planned + 100).toBeLessThanOrEqual(perWeekday);
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
        estimatedMinutes: 60 + n * 12,
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
      r.tasks.filter((t) => t.kind === 'lesson').reduce((s, t) => s + t.minutes, 0);
    expect(minutes(known)).toBeLessThan(minutes(fresh));
  });

  it('15. a topic with 2 lessons gives 2 tasks, part 1 of 2 and 2 of 2, each with its own material', () => {
    const lessons: PlannerLesson[] = [
      {
        title: 'Limiti',
        material: [{ docId: 'd1', pageFrom: 1, pageTo: 20 }],
        standardMinutes: 60,
        sprintMinutes: 40,
      },
      {
        title: 'Derivate',
        material: [{ docId: 'd1', pageFrom: 21, pageTo: 40 }],
        standardMinutes: 90,
        sprintMinutes: 60,
      },
    ];
    const r = schedulePlan(input({ topics: [topic('a', { lessons })] }));
    const tasks = r.tasks.filter((t) => t.kind === 'lesson');
    expect(tasks.map((t) => t.key)).toEqual(['lesson:a:001', 'lesson:a:002']);
    expect(tasks.map((t) => t.title)).toEqual(['Limiti · parte 1 di 2', 'Derivate · parte 2 di 2']);
    expect(tasks.map((t) => t.payload.part)).toEqual([
      { n: 1, of: 2 },
      { n: 2, of: 2 },
    ]);
    expect(tasks.map((t) => t.minutes)).toEqual([60, 90]);
    expect(tasks[0]!.payload).toMatchObject({ action: 'lesson', method: 'standard', topicId: 'a' });
    expect(tasks[0]!.payload.material).toEqual(lessons[0]!.material);
    expect(tasks[1]!.payload.material).toEqual(lessons[1]!.material);
    expect(tasks[0]!.date <= tasks[1]!.date).toBe(true);
  });

  it('15b. a topic without lessons is one lesson: standard = estimate, no part, topic material', () => {
    const r = schedulePlan(input({ topics: [topic('a', { estimatedMinutes: 100 })] }));
    const tasks = r.tasks.filter((t) => t.kind === 'lesson');
    expect(tasks).toHaveLength(1);
    expect(tasks[0]!.key).toBe('lesson:a:001');
    expect(tasks[0]!.title).toBe('Argomento a');
    expect(tasks[0]!.minutes).toBe(100);
    expect(tasks[0]!.payload.part).toBeUndefined();
    expect(tasks[0]!.payload.material).toEqual([{ docId: 'doc-a', pageFrom: 1, pageTo: 40 }]);
  });

  it('15d. sprint intensity: every lesson is sprint (70% of the estimate by default)', () => {
    const r = schedulePlan(
      input({
        prefs: { ...input().prefs, intensity: 'sprint' },
        topics: [topic('a', { estimatedMinutes: 100 })],
      }),
    );
    const tasks = r.tasks.filter((t) => t.kind === 'lesson');
    expect(tasks.map((t) => [t.minutes, t.payload.method])).toEqual([[70, 'sprint']]);
    expect(r.feasibility.sprintLessonKeys).toEqual([]);
  });

  it('15e. revisits: +1 day flashcards, +3 and +7 days a 15-minute verify', () => {
    const r = schedulePlan(input({ topics: [topic('a')] }));
    const lesson = r.tasks.find((t) => t.kind === 'lesson')!;
    const rev = (n: string) => r.tasks.find((t) => t.key === `rev:a:0${n}`)!;
    expect(rev('01').kind).toBe('flashcards');
    expect(rev('01').payload.action).toBe('generate_flashcards');
    for (const [n, offset] of [
      ['02', 3],
      ['03', 7],
    ] as const) {
      const v = rev(n);
      expect(v.kind).toBe('verify');
      expect(v.minutes).toBe(15);
      expect(v.title).toBe('Verifica · Argomento a');
      expect(v.payload).toEqual({
        action: 'verify',
        topicId: 'a',
        material: [{ docId: 'doc-a', pageFrom: 1, pageTo: 40 }],
      });
      expect(v.date >= addDays(lesson.date, offset)).toBe(true);
    }
  });

  it('15f. a lesson longer than any day is split by content into the fewest parts that fit', () => {
    // 60 min/day (54 usable): an AI lesson of 90 min on 24 pages becomes 2 parts, nothing is left out.
    const i = input({
      availability: { perWeekday: [60, 60, 60, 60, 60, 60, 60], blackoutDates: [] },
      prefs: { ...input().prefs, simulationCount: 0 },
      topics: [
        topic('a', {
          lessons: [
            {
              title: 'Serie',
              material: [{ docId: 'd1', pageFrom: 1, pageTo: 24 }],
              standardMinutes: 90,
              sprintMinutes: 60,
            },
          ],
        }),
      ],
    });
    const r = schedulePlan(i);
    assertHardConstraints(i, r.tasks);
    const lessons = r.tasks.filter((t) => t.kind === 'lesson');
    expect(lessons.map((t) => t.key)).toEqual(['lesson:a:001', 'lesson:a:002']);
    expect(lessons.map((t) => t.title)).toEqual(['Serie · parte 1 di 2', 'Serie · parte 2 di 2']);
    expect(lessons.map((t) => t.payload.part)).toEqual([
      { n: 1, of: 2 },
      { n: 2, of: 2 },
    ]);
    expect(lessons.map((t) => t.minutes)).toEqual([45, 45]);
    expect(lessons.map((t) => t.payload.material)).toEqual([
      [{ docId: 'd1', pageFrom: 1, pageTo: 12 }],
      [{ docId: 'd1', pageFrom: 13, pageTo: 24 }],
    ]);
    expect(r.feasibility.feasible).toBe(true);
    expect(r.feasibility.excludedTopicKeys).toEqual([]);
    expect(r.feasibility.sprintLessonKeys).toEqual([]);
    expect(r.warnings).toEqual([]);
  });

  it('15g. parts of a split lesson renumber the whole topic', () => {
    const i = input({
      availability: { perWeekday: [60, 60, 60, 60, 60, 60, 60], blackoutDates: [] },
      prefs: { ...input().prefs, simulationCount: 0 },
      topics: [
        topic('a', {
          lessons: [
            { ...lessonsOf('a', 1, 40, 30)[0]!, title: 'Uno' },
            { ...lessonsOf('a', 2, 90, 60)[1]!, title: 'Due' },
          ],
        }),
      ],
    });
    const lessons = schedulePlan(i).tasks.filter((t) => t.kind === 'lesson');
    expect(lessons.map((t) => t.key)).toEqual(['lesson:a:001', 'lesson:a:002', 'lesson:a:003']);
    expect(lessons.map((t) => t.title)).toEqual([
      'Uno · parte 1 di 3',
      'Due · parte 2 di 3',
      'Due · parte 3 di 3',
    ]);
    expect(lessons.map((t) => t.payload.part?.of)).toEqual([3, 3, 3]);
  });

  it('15h. an indivisible lesson longer than any day goes on the roomiest day, with a warning naming it', () => {
    const i = input({
      availability: { perWeekday: [0, 100, 150, 100, 100, 100, 0], blackoutDates: [] },
      prefs: { ...input().prefs, simulationCount: 0 },
      topics: [
        topic('a', {
          material: [{ docId: 'd1', pageFrom: 7, pageTo: 7 }],
          lessons: [
            {
              title: 'Lezione enorme',
              material: [{ docId: 'd1', pageFrom: 7, pageTo: 7 }],
              standardMinutes: 400,
              sprintMinutes: 300,
            },
          ],
        }),
      ],
    });
    const r = schedulePlan(i);
    const lesson = r.tasks.find((t) => t.kind === 'lesson')!;
    expect(lesson.minutes).toBe(400);
    expect(weekday(lesson.date)).toBe(2);
    expect(
      r.warnings.some((w) => w.includes('Lezione enorme') && w.includes('non si può dividere')),
    ).toBe(true);
    expect(r.warnings.some((w) => w.includes("peso d'esame"))).toBe(false);
  });

  it('15i. the warning on left-out topics mentions the exam weight only when that is the reason', () => {
    const r = schedulePlan(
      input({ availability: { perWeekday: [0, 0, 0, 0, 0, 0, 0], blackoutDates: [] } }),
    );
    expect(r.feasibility.excludedTopicKeys).toEqual(['a']);
    expect(r.warnings.some((w) => w.includes('restano fuori') || w.includes('resta fuori'))).toBe(
      true,
    );
    expect(r.warnings.some((w) => w.includes("peso d'esame"))).toBe(false);
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
