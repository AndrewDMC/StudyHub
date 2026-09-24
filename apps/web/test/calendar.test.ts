import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createTestDb } from '@studyhub/db/testDb';
import { exams, studyPlans, tasks } from '@studyhub/db';
import { createSubject } from '../src/lib/subjects';
import { getCalendarRange } from '../src/lib/calendar';

const AVAILABILITY = { perWeekday: [0, 120, 120, 120, 120, 120, 0], blackoutDates: [] };
const PREFS = {
  sessionLength: 50,
  intensity: 'standard' as const,
  simulationCount: 'auto' as const,
  simulationMinutes: 90,
  reviewMinutesPerCard: 0.5,
};
const FEASIBILITY = {
  feasible: true,
  requiredMinutes: 0,
  availableMinutes: 0,
  shortfallMinutes: 0,
  unscheduledTopicKeys: [],
  strategies: [],
};

describe('getCalendarRange', () => {
  let dataRoot: string;
  let db: Awaited<ReturnType<typeof createTestDb>>;

  beforeEach(async () => {
    dataRoot = await mkdtemp(join(tmpdir(), 'studyhub-calendar-'));
    db = await createTestDb();
  });
  afterEach(async () => {
    await rm(dataRoot, { recursive: true, force: true });
  });

  async function activePlan(subjectId: string) {
    const planId = randomUUID();
    await db.insert(studyPlans).values({
      id: planId,
      subjectId,
      startDate: '2026-01-01',
      targetDate: '2026-02-01',
      availability: AVAILABILITY,
      prefs: PREFS,
      feasibility: FEASIBILITY,
      warnings: [],
      model: 'fake-v1',
      promptVersion: 'estimate_topics/v1',
      status: 'active',
    });
    return planId;
  }

  it('includes tasks from active plans of every subject, tagged with subject identity', async () => {
    const fisica = await createSubject(db, dataRoot, { name: 'Fisica 1', color: 'blue' });
    const chimica = await createSubject(db, dataRoot, { name: 'Chimica 1', color: 'green' });
    const fisicaPlan = await activePlan(fisica.id);
    const chimicaPlan = await activePlan(chimica.id);

    await db.insert(tasks).values({
      id: randomUUID(),
      subjectId: fisica.id,
      planId: fisicaPlan,
      taskKey: 'read:a:001',
      date: '2026-01-10',
      kind: 'read',
      minutes: 50,
      title: 'Studia termodinamica',
      description: '',
      payload: { action: 'read' },
      status: 'todo',
    });
    await db.insert(tasks).values({
      id: randomUUID(),
      subjectId: chimica.id,
      planId: chimicaPlan,
      taskKey: 'read:b:001',
      date: '2026-01-12',
      kind: 'read',
      minutes: 40,
      title: 'Studia stechiometria',
      description: '',
      payload: { action: 'read' },
      status: 'todo',
    });

    const range = await getCalendarRange(db, '2026-01-01', '2026-02-01');
    expect(range.tasks).toHaveLength(2);
    const fisicaTask = range.tasks.find((t) => t.title === 'Studia termodinamica')!;
    expect(fisicaTask.subjectSlug).toBe(fisica.slug);
    expect(fisicaTask.subjectColor).toBe('blue');
    const chimicaTask = range.tasks.find((t) => t.title === 'Studia stechiometria')!;
    expect(chimicaTask.subjectSlug).toBe(chimica.slug);
  });

  it('excludes tasks from a draft plan (not yet committed)', async () => {
    const subject = await createSubject(db, dataRoot, { name: 'Fisica 1', color: 'blue' });
    const draftPlanId = randomUUID();
    await db.insert(studyPlans).values({
      id: draftPlanId,
      subjectId: subject.id,
      startDate: '2026-01-01',
      targetDate: '2026-02-01',
      availability: AVAILABILITY,
      prefs: PREFS,
      feasibility: FEASIBILITY,
      warnings: [],
      model: 'fake-v1',
      promptVersion: 'estimate_topics/v1',
      status: 'draft',
    });
    await db.insert(tasks).values({
      id: randomUUID(),
      subjectId: subject.id,
      planId: draftPlanId,
      taskKey: 'read:a:001',
      date: '2026-01-10',
      kind: 'read',
      minutes: 50,
      title: 'x',
      description: '',
      payload: { action: 'read' },
      status: 'proposed',
    });

    const range = await getCalendarRange(db, '2026-01-01', '2026-02-01');
    expect(range.tasks).toEqual([]);
  });

  it('excludes tasks outside the [start, end) range', async () => {
    const subject = await createSubject(db, dataRoot, { name: 'Fisica 1', color: 'blue' });
    const planId = await activePlan(subject.id);
    await db.insert(tasks).values([
      {
        id: randomUUID(),
        subjectId: subject.id,
        planId,
        taskKey: 'read:a:before',
        date: '2025-12-31',
        kind: 'read',
        minutes: 10,
        title: 'before',
        description: '',
        payload: { action: 'read' },
      },
      {
        id: randomUUID(),
        subjectId: subject.id,
        planId,
        taskKey: 'read:a:boundary',
        date: '2026-02-01', // end is exclusive
        kind: 'read',
        minutes: 10,
        title: 'on-end',
        description: '',
        payload: { action: 'read' },
      },
      {
        id: randomUUID(),
        subjectId: subject.id,
        planId,
        taskKey: 'read:a:inside',
        date: '2026-01-15',
        kind: 'read',
        minutes: 10,
        title: 'inside',
        description: '',
        payload: { action: 'read' },
      },
    ]);

    const range = await getCalendarRange(db, '2026-01-01', '2026-02-01');
    expect(range.tasks.map((t) => t.title)).toEqual(['inside']);
  });

  it('includes exams as milestones, tagged with subject identity, within the date range', async () => {
    const subject = await createSubject(db, dataRoot, { name: 'Fisica 1', color: 'blue' });
    await db.insert(exams).values([
      {
        id: randomUUID(),
        subjectId: subject.id,
        title: 'Scritto',
        kind: 'scritto',
        date: new Date('2026-01-20T09:00:00.000Z'),
      },
      {
        id: randomUUID(),
        subjectId: subject.id,
        title: 'Fuori range',
        kind: 'scritto',
        date: new Date('2026-03-01T09:00:00.000Z'),
      },
    ]);

    const range = await getCalendarRange(db, '2026-01-01', '2026-02-01');
    expect(range.exams).toHaveLength(1);
    expect(range.exams[0]).toMatchObject({
      title: 'Scritto',
      subjectSlug: subject.slug,
      subjectColor: 'blue',
    });
  });
});
