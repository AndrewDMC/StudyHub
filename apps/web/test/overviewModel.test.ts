import { describe, expect, it } from 'vitest';
import type { PlanDto, TaskDto, TopicDto } from '@studyhub/contracts';
import {
  buildTodayModel,
  fixRows,
  heroOrder,
  pickActivePlan,
  progressCounts,
  topicRows,
} from '../src/components/overview/model';
import { stripPartSuffix, verifyOffset } from '../src/components/plan/planModel';

const TODAY = '2026-11-02';
let seq = 0;

function task(over: Partial<TaskDto>): TaskDto {
  seq += 1;
  return {
    id: `00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`,
    planId: '00000000-0000-4000-8000-0000000000aa',
    taskKey: `lesson:t1:0${seq}`,
    date: TODAY,
    kind: 'lesson',
    topicKey: 't1',
    topicId: null,
    minutes: 30,
    title: 'Limiti',
    description: '',
    payload: { action: 'lesson' },
    pinned: false,
    origin: 'planner',
    status: 'todo',
    flashcardCount: 0,
    ...over,
  };
}

function plan(tasks: TaskDto[], over: Partial<PlanDto> = {}): PlanDto {
  return {
    id: '00000000-0000-4000-8000-0000000000aa',
    subjectId: '00000000-0000-4000-8000-0000000000bb',
    examId: null,
    status: 'active',
    startDate: '2026-10-30',
    targetDate: '2026-11-20',
    availability: { perWeekday: [0, 0, 0, 0, 0, 0, 0], blackoutDates: [] },
    prefs: {
      sessionLength: 50,
      intensity: 'standard',
      simulationCount: 'auto',
      simulationMinutes: 90,
      reviewMinutesPerCard: 0.5,
    },
    feasibility: {
      feasible: true,
      requiredMinutes: 0,
      availableMinutes: 0,
      shortfallMinutes: 0,
      unscheduledTopicKeys: [],
      sprintLessonKeys: [],
      excludedTopicKeys: [],
      strategies: [],
    },
    warnings: [],
    loadPerDay: [],
    tasks,
    createdAt: '2026-10-30T10:00:00.000Z',
    committedAt: '2026-10-30T10:00:00.000Z',
    ...over,
  };
}

function topic(id: string, name: string, orderIndex: number, mastery: number | null): TopicDto {
  return { id, name, orderIndex, mastery, parentId: null } as unknown as TopicDto;
}

describe('stripPartSuffix / verifyOffset', () => {
  it('drops the part suffix', () => {
    expect(stripPartSuffix('Integrali · parte 1 di 2')).toBe('Integrali');
    expect(stripPartSuffix('Integrali')).toBe('Integrali');
  });
  it('maps the verification keys to days', () => {
    const v = (taskKey: string) => verifyOffset({ kind: 'verify', taskKey });
    expect(v('rev:abc:02')).toBe(3);
    expect(v('rev:abc:03')).toBe(7);
    expect(v('rev:abc:09')).toBeNull();
    expect(v('lesson:abc:01')).toBeNull();
  });
});

describe('pickActivePlan', () => {
  const a = plan([], { id: '00000000-0000-4000-8000-000000000001', targetDate: '2026-12-01' });
  const b = plan([], {
    id: '00000000-0000-4000-8000-000000000002',
    targetDate: '2026-11-10',
    examId: '00000000-0000-4000-8000-0000000000e1',
  });
  const draft = plan([], { status: 'draft' });
  it('prefers the plan of the next exam, then the closest target', () => {
    expect(pickActivePlan([a, b], '00000000-0000-4000-8000-0000000000e1', TODAY)?.id).toBe(b.id);
    expect(pickActivePlan([a, b], null, TODAY)?.id).toBe(b.id);
    expect(pickActivePlan([draft], null, TODAY)).toBeNull();
  });
});

describe('heroOrder / buildTodayModel', () => {
  it('puts the started task first, then lessons, verifies, flashcards; skips other days', () => {
    const lesson2 = task({ taskKey: 'lesson:t1:02' });
    const lesson1 = task({ taskKey: 'lesson:t1:01' });
    const verify = task({ kind: 'verify', taskKey: 'rev:t1:02' });
    const doingVerify = task({ kind: 'verify', taskKey: 'rev:t2:02', status: 'doing' });
    const overdue = task({ date: '2026-11-01' });
    const order = heroOrder([verify, lesson2, overdue, lesson1, doingVerify], TODAY);
    expect(order.map((t) => t.id)).toEqual([doingVerify.id, lesson1.id, lesson2.id, verify.id]);
  });

  it('falls back to the next lesson, the rest day, the draft and the empty state', () => {
    const future = task({ date: '2026-11-04' });
    const p = plan([future], { loadPerDay: [{ date: TODAY, available: 0, planned: 0 }] });
    const rest = buildTodayModel([], [p], p, TODAY);
    expect(rest.state).toBe('rest');
    expect(rest.nextDate).toBe('2026-11-04');
    const next = buildTodayModel([], [plan([future])], plan([future]), TODAY);
    expect(next.state).toBe('next');
    const done = buildTodayModel([], [plan([])], plan([]), TODAY);
    expect(done.state).toBe('done');
    expect(buildTodayModel([], [plan([], { status: 'draft' })], null, TODAY).state).toBe('draft');
    expect(buildTodayModel([], [], null, TODAY).state).toBe('no-plan');
  });

  it('keeps an overdue started lesson at the head of the hero, not an overdue todo one', () => {
    const lateDoing = task({ date: '2026-10-30', status: 'doing', taskKey: 'lesson:t9:01' });
    const lateTodo = task({ date: '2026-10-31' });
    const todays = task({});
    const order = heroOrder([todays, lateTodo, lateDoing], TODAY);
    expect(order.map((t) => t.id)).toEqual([lateDoing.id, todays.id]);
  });

  it('uses an overdue todo lesson as the next one when nothing is on today', () => {
    const late = task({ date: '2026-10-31' });
    const p = plan([late]);
    const model = buildTodayModel([late], [p], p, TODAY);
    expect(model.state).toBe('next');
    expect(model.candidates[0]!.id).toBe(late.id);
  });

  it('keeps the other open tasks of today and never says "done" while something is open', () => {
    const drill = task({ kind: 'drill', taskKey: 'drill:1' });
    const sim = task({ kind: 'simulation', taskKey: 'sim:1', status: 'done' });
    const doneLesson = task({ status: 'done', date: '2026-10-31' });
    const p = plan([doneLesson, drill, sim]);
    const idle = buildTodayModel([drill], [p], p, TODAY);
    expect(idle.state).toBe('idle');
    expect(idle.others.map((t) => t.id)).toEqual([drill.id]);
    const overdueRead = task({ kind: 'read', date: '2026-10-30' });
    expect(buildTodayModel([overdueRead], [p], p, TODAY).state).toBe('idle');
    // an open lesson in the plan (e.g. on a past date it does not show) keeps the plan open too
    const doingFuture = task({ status: 'doing', date: '2026-11-09' });
    const p2 = plan([doneLesson, doingFuture]);
    expect(buildTodayModel([], [p2], p2, TODAY).state).not.toBe('done');
    expect(buildTodayModel([], [plan([doneLesson])], plan([doneLesson]), TODAY).state).toBe('done');
  });

  it('sums only the lessons of today', () => {
    const model = buildTodayModel(
      [task({ minutes: 25 }), task({ minutes: 35 }), task({ kind: 'verify', minutes: 10 })],
      [],
      null,
      TODAY,
    );
    expect(model.summary).toEqual({ lessons: 2, minutes: 60 });
  });
});

describe('progressCounts / topicRows', () => {
  const t1 = '00000000-0000-4000-8000-0000000000c1';
  const t2 = '00000000-0000-4000-8000-0000000000c2';
  const t3 = '00000000-0000-4000-8000-0000000000c3';
  const t4 = '00000000-0000-4000-8000-0000000000c4';
  const tasks = [
    task({ topicKey: t1, taskKey: `lesson:${t1}:01`, status: 'done', date: '2026-10-31' }),
    task({ topicKey: t2, taskKey: `lesson:${t2}:01`, status: 'done', date: '2026-11-01' }),
    task({
      topicKey: t2,
      taskKey: `lesson:${t2}:02`,
      date: TODAY,
      payload: { action: 'lesson', part: { n: 2, of: 2 }, method: 'sprint' },
    }),
    task({ topicKey: t3, taskKey: `lesson:${t3}:01`, date: '2026-11-05' }),
    task({ topicKey: t3, taskKey: `lesson:${t3}:02`, status: 'moved', date: '2026-11-05' }),
    task({ kind: 'verify', topicKey: t1, taskKey: `rev:${t1}:02`, date: '2026-11-03' }),
  ];
  const p = plan(tasks, {
    feasibility: { ...plan([]).feasibility, excludedTopicKeys: [t4] },
  });
  const topics = [
    topic(t1, 'Limiti', 0, 0.8),
    topic(t2, 'Derivate', 1, 0.3),
    topic(t3, 'Integrali', 2, null),
    topic(t4, 'Serie', 3, 0.5),
    topic('00000000-0000-4000-8000-0000000000c5', 'Fuori elenco', 4, null),
  ];

  it('counts topics and lessons without the moved ones', () => {
    expect(progressCounts(p)).toEqual({
      studied: 1,
      inProgress: 1,
      todo: 1,
      out: 1,
      lessonsDone: 2,
      lessonsTotal: 4,
    });
    expect(progressCounts(null).lessonsTotal).toBe(0);
  });

  it('does not call a topic studied when a lesson was skipped', () => {
    const k = '00000000-0000-4000-8000-0000000000d1';
    const skipped = plan([
      task({ topicKey: k, taskKey: `lesson:${k}:01`, status: 'done', date: '2026-10-31' }),
      task({ topicKey: k, taskKey: `lesson:${k}:02`, status: 'skipped', date: '2026-11-01' }),
    ]);
    const counts = progressCounts(skipped);
    expect(counts).toMatchObject({ studied: 0, inProgress: 1, lessonsDone: 1, lessonsTotal: 2 });
    expect(topicRows(skipped, [topic(k, 'Serie', 0, 0.5)], [], TODAY)[0]!.kind).not.toBe('studied');
  });

  it('counts as out only the excluded keys that have no lesson', () => {
    const k = '00000000-0000-4000-8000-0000000000d2';
    const p2 = plan([task({ topicKey: k, taskKey: `lesson:${k}:01` })], {
      feasibility: { ...plan([]).feasibility, excludedTopicKeys: [k, 'other'] },
    });
    expect(progressCounts(p2).out).toBe(1);
  });

  it('builds one row per topic in planner order, then excluded, then unplanned', () => {
    const rows = topicRows(p, topics, [], TODAY);
    expect(rows.map((r) => r.name)).toEqual([
      'Limiti',
      'Derivate',
      'Integrali',
      'Serie',
      'Fuori elenco',
    ]);
    expect(rows[0]).toMatchObject({
      kind: 'studied',
      planLabel: expect.stringContaining('verifica il'),
    });
    expect(rows[1]).toMatchObject({
      kind: 'in_progress',
      progress: '1 di 2 fatte',
      method: 'mixed',
    });
    expect(rows[1]!.planLabel).toContain('oggi parte 2');
    expect(rows[1]!.startable?.date).toBe(TODAY);
    expect(rows[2]).toMatchObject({ kind: 'from', mastery: null, startable: null });
    expect(rows[3]).toMatchObject({ kind: 'out', planLabel: 'Fuori dal piano' });
    expect(rows[4]).toMatchObject({ kind: 'unplanned', method: null });
  });
});

describe('fixRows', () => {
  const overview = {
    suggestedActions: [],
    recentActivity: [],
    gaps: [
      { kind: 'topic_without_documents' as const, topicId: 'a', topicName: 'Serie', message: '' },
      { kind: 'low_mastery' as const, topicId: 'b', topicName: 'Limiti', message: '' },
    ],
    untaggedDocumentCount: 2,
  };
  it('lists only what applies, in order', () => {
    const rows = fixRows({
      slug: 'analisi',
      overview,
      plan: null,
      drift: { shouldRecalculate: true, reason: '3 task scadute' } as never,
      topics: [],
      documents: [],
    });
    expect(rows.map((r) => r.id)).toEqual(['drift', 'no-docs', 'untagged', 'low']);
    expect(rows[2]!.title).toBe('2 documenti senza argomento');
    expect(rows[1]!.action.href).toBe('/materie/analisi?tab=appunti');
  });
  it('is empty when nothing is wrong', () => {
    expect(
      fixRows({
        slug: 'x',
        overview: { ...overview, gaps: [], untaggedDocumentCount: 0 },
        plan: null,
        drift: null,
        topics: [],
        documents: [],
      }),
    ).toEqual([]);
  });
});
