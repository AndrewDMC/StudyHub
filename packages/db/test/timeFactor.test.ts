import { describe, expect, it, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createTestDb } from '../src/testDb.js';
import { loadTimeFactor, studyPlans, studySessions, subjects, tasks } from '../src/index.js';

describe('loadTimeFactor', () => {
  let db: Awaited<ReturnType<typeof createTestDb>>;
  let subjectId: string;

  async function addPlan(timeFactor = 1) {
    const id = randomUUID();
    await db.insert(studyPlans).values({
      id,
      subjectId,
      startDate: '2026-01-05',
      targetDate: '2026-02-04',
      availability: { perWeekday: [0, 60, 60, 60, 60, 60, 0], blackoutDates: [] },
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
        strategies: [],
      },
      warnings: [],
      model: 'none',
      promptVersion: 'x',
      timeFactor,
    });
    return id;
  }

  /** An ended session on a task planned for `plannedMin`, in which `actualMin` were really studied. */
  async function addSession(
    planId: string,
    plannedMin: number,
    actualMin: number,
    endedAt: Date,
    status: 'active' | 'ended' = 'ended',
  ) {
    const taskId = randomUUID();
    await db.insert(tasks).values({
      id: taskId,
      subjectId,
      planId,
      taskKey: `read:${taskId}`,
      date: '2026-01-06',
      kind: 'read',
      minutes: plannedMin,
      title: 'Leggi',
      description: '',
      payload: { action: 'read' },
      status: 'done',
    });
    await db.insert(studySessions).values({
      id: randomUUID(),
      subjectId,
      taskId,
      topicIds: [],
      documentIds: [],
      status,
      activeMs: actualMin * 60_000,
      endedAt,
    });
  }

  beforeEach(async () => {
    db = await createTestDb();
    subjectId = randomUUID();
    await db.insert(subjects).values({
      id: subjectId,
      slug: 'fisica-1',
      name: 'Fisica 1',
      color: 'blue',
      folderPath: '/irrelevant',
    });
  });

  it('is neutral without history', async () => {
    expect(await loadTimeFactor(db)).toEqual({ factor: 1, sampleCount: 0, confident: false });
  });

  it('measures real against planned time over ended sessions only', async () => {
    const plan = await addPlan();
    for (let i = 0; i < 3; i++) await addSession(plan, 30, 42, new Date(2026, 0, 10 + i));
    // A session still running says nothing about how long the task takes.
    await addSession(plan, 30, 5, new Date(2026, 0, 20), 'active');
    expect(await loadTimeFactor(db)).toEqual({ factor: 1.4, sampleCount: 3, confident: true });
  });

  it('measures against the raw estimate when the plan was already corrected', async () => {
    const plan = await addPlan(1.4);
    // Planned 42 = 30 × 1.4; the student took 42: the bias is still ×1.4, not 1.
    for (let i = 0; i < 3; i++) await addSession(plan, 42, 42, new Date(2026, 0, 10 + i));
    expect((await loadTimeFactor(db)).factor).toBe(1.4);
  });

  it('weighs the newest sessions first', async () => {
    const plan = await addPlan();
    for (let i = 0; i < 20; i++) await addSession(plan, 30, 30, new Date(2026, 1, 1 + (i % 20)));
    for (let i = 0; i < 25; i++) await addSession(plan, 30, 60, new Date(2025, 5, 1 + (i % 25)));
    expect((await loadTimeFactor(db)).factor).toBe(1);
  });
});
