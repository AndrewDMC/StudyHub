import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { createTestDb } from '@studyhub/db/testDb';
import { calendarEvents, documentTopics, documents, studyPlans, tasks, topics } from '@studyhub/db';
import { createSubject } from '../src/lib/subjects';
import {
  commitPlan,
  createManualTask,
  deleteDraftTask,
  discardDraft,
  enqueueGeneratePlan,
  applyBulkToDraft,
  ExamNotFoundError,
  getCurrentPlan,
  getPlanPreview,
  getDailyTasks,
  getPlanDiff,
  getPlanDrift,
  MoveRefusedError,
  moveTaskInPlan,
  NoDraftPlanError,
  PlanNotFoundError,
  reabsorbTaskInPlan,
  setTaskStatus,
  TaskNotFoundError,
  updateDraftTask,
} from '../src/lib/plan';
import { SubjectNotFoundError } from '../src/lib/errors';

function fakeQueue() {
  return { add: vi.fn().mockResolvedValue({ id: 'job-plan-1' }) };
}

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

describe('enqueueGeneratePlan', () => {
  let dataRoot: string;

  beforeEach(async () => {
    dataRoot = await mkdtemp(join(tmpdir(), 'studyhub-plan-'));
  });
  afterEach(async () => {
    await rm(dataRoot, { recursive: true, force: true });
  });

  it('resolves the subject slug to an id and enqueues generate_plan', async () => {
    const db = await createTestDb();
    const subject = await createSubject(db, dataRoot, { name: 'Fisica 1', color: 'blue' });
    const queue = fakeQueue();

    const result = await enqueueGeneratePlan(db, queue, subject.slug, {
      startDate: '2026-01-05',
      targetDate: '2026-02-04',
      availability: AVAILABILITY,
      prefs: PREFS,
      force: false,
    });

    expect(result.jobId).toEqual(expect.any(String));
    expect(queue.add).toHaveBeenCalledWith(
      'generate_plan',
      expect.objectContaining({ subjectId: subject.id }),
      { jobId: result.jobId },
    );
  });

  it('throws SubjectNotFoundError for an unknown slug without touching the queue', async () => {
    const db = await createTestDb();
    const queue = fakeQueue();
    await expect(
      enqueueGeneratePlan(db, queue, 'nope', {
        startDate: '2026-01-05',
        targetDate: '2026-02-04',
        availability: AVAILABILITY,
        prefs: PREFS,
        force: false,
      }),
    ).rejects.toThrow(SubjectNotFoundError);
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('throws ExamNotFoundError for an examId from another subject', async () => {
    const db = await createTestDb();
    const subjectA = await createSubject(db, dataRoot, { name: 'Fisica 1', color: 'blue' });
    const queue = fakeQueue();
    await expect(
      enqueueGeneratePlan(db, queue, subjectA.slug, {
        startDate: '2026-01-05',
        targetDate: '2026-02-04',
        availability: AVAILABILITY,
        prefs: PREFS,
        examId: randomUUID(),
        force: false,
      }),
    ).rejects.toThrow(ExamNotFoundError);
  });
});

describe('plan draft/commit lifecycle', () => {
  let dataRoot: string;
  let db: Awaited<ReturnType<typeof createTestDb>>;
  let subjectSlug: string;
  let subjectId: string;

  beforeEach(async () => {
    dataRoot = await mkdtemp(join(tmpdir(), 'studyhub-plan-'));
    db = await createTestDb();
    const subject = await createSubject(db, dataRoot, { name: 'Fisica 1', color: 'blue' });
    subjectSlug = subject.slug;
    subjectId = subject.id;
  });
  afterEach(async () => {
    await rm(dataRoot, { recursive: true, force: true });
  });

  async function insertDraftPlan() {
    const planId = randomUUID();
    await db.insert(studyPlans).values({
      id: planId,
      subjectId,
      startDate: '2026-01-05',
      targetDate: '2026-02-04',
      availability: AVAILABILITY,
      prefs: PREFS,
      feasibility: FEASIBILITY,
      warnings: [],
      model: 'fake-v1',
      promptVersion: 'estimate_topics/v1',
      status: 'draft',
    });
    return planId;
  }

  async function insertTask(planId: string, overrides: Partial<typeof tasks.$inferInsert> = {}) {
    const id = randomUUID();
    await db.insert(tasks).values({
      id,
      subjectId,
      planId,
      taskKey: `read:doc:${id.slice(0, 4)}`,
      date: '2026-01-06',
      kind: 'read',
      minutes: 50,
      title: 'Studia cap. 1',
      description: 'x',
      payload: { action: 'read' },
      status: 'proposed',
      ...overrides,
    });
    return id;
  }

  it('getCurrentPlan prefers a draft over an active plan', async () => {
    const activeId = await insertDraftPlan();
    await db.update(studyPlans).set({ status: 'active' }).where(eq(studyPlans.id, activeId));
    const draftId = await insertDraftPlan();

    const plan = await getCurrentPlan(db, subjectSlug);
    expect(plan?.id).toBe(draftId);
    expect(plan?.status).toBe('draft');
  });

  it('commit flips proposed tasks to todo, writes plans/<id>.json, and supersedes the previous active plan', async () => {
    const oldActiveId = await insertDraftPlan();
    await db.update(studyPlans).set({ status: 'active' }).where(eq(studyPlans.id, oldActiveId));

    const draftId = await insertDraftPlan();
    await insertTask(draftId);

    const committed = await commitPlan(db, dataRoot, subjectSlug, draftId);
    expect(committed.status).toBe('active');
    expect(committed.tasks.every((t) => t.status === 'todo')).toBe(true);

    const [oldPlan] = await db.select().from(studyPlans).where(eq(studyPlans.id, oldActiveId));
    expect(oldPlan?.status).toBe('superseded');

    const written = await readFile(
      join(dataRoot, 'subjects', subjectSlug, 'plans', `${draftId}.json`),
      'utf-8',
    );
    expect(JSON.parse(written).plan.id).toBe(draftId);
  });

  it('commit is idempotent: committing an already-active plan again is a no-op', async () => {
    const draftId = await insertDraftPlan();
    await insertTask(draftId);
    await commitPlan(db, dataRoot, subjectSlug, draftId);

    const second = await commitPlan(db, dataRoot, subjectSlug, draftId);
    expect(second.status).toBe('active');
    const plans = await db.select().from(studyPlans).where(eq(studyPlans.subjectId, subjectId));
    expect(plans).toHaveLength(1); // no duplicate, no re-supersede
  });

  it('commit refuses a superseded plan', async () => {
    const planId = await insertDraftPlan();
    await db.update(studyPlans).set({ status: 'superseded' }).where(eq(studyPlans.id, planId));
    await expect(commitPlan(db, dataRoot, subjectSlug, planId)).rejects.toThrow(PlanNotFoundError);
  });

  it('updateDraftTask edits a proposed task but refuses an already-committed one', async () => {
    const draftId = await insertDraftPlan();
    const taskId = await insertTask(draftId);

    const updated = await updateDraftTask(db, subjectSlug, taskId, { pinned: true, minutes: 30 });
    expect(updated.pinned).toBe(true);
    expect(updated.minutes).toBe(30);

    await commitPlan(db, dataRoot, subjectSlug, draftId);
    await expect(updateDraftTask(db, subjectSlug, taskId, { minutes: 10 })).rejects.toThrow();
  });

  it('deleteDraftTask removes a proposed task', async () => {
    const draftId = await insertDraftPlan();
    const taskId = await insertTask(draftId);
    await deleteDraftTask(db, subjectSlug, taskId);
    const rows = await db.select().from(tasks).where(eq(tasks.id, taskId));
    expect(rows).toEqual([]);
  });

  it('createManualTask adds to the current draft, and fails with NoDraftPlanError without one', async () => {
    await expect(
      createManualTask(db, subjectSlug, {
        date: '2026-01-06',
        kind: 'read',
        minutes: 30,
        title: 'Ripasso extra',
        description: '',
      }),
    ).rejects.toThrow(NoDraftPlanError);

    const draftId = await insertDraftPlan();
    const task = await createManualTask(db, subjectSlug, {
      date: '2026-01-06',
      kind: 'read',
      minutes: 30,
      title: 'Ripasso extra',
      description: '',
    });
    expect(task.origin).toBe('manual');
    expect(task.planId).toBe(draftId);
  });

  it('moveTaskInPlan relocates a task and refuses a move outside the plan window', async () => {
    const draftId = await insertDraftPlan();
    const taskId = await insertTask(draftId, { date: '2026-01-06' });

    const plan = await moveTaskInPlan(db, subjectSlug, taskId, '2026-01-07');
    const moved = plan.tasks.find((t) => t.id === taskId)!;
    expect(moved.date).toBe('2026-01-07');
    expect(moved.pinned).toBe(true);

    await expect(moveTaskInPlan(db, subjectSlug, taskId, '2026-03-01')).rejects.toThrow(
      MoveRefusedError,
    );
  });

  it('reabsorbTaskInPlan ("Debito" — riassorbi) picks the first day from today with room, refusing when none is left', async () => {
    const draftId = await insertDraftPlan();
    const taskId = await insertTask(draftId, { date: '2026-01-06' });

    // 2026-01-12 is a Monday (120min/day available) — the earliest day
    // on/after "today" with room, since nothing else is scheduled there.
    const plan = await reabsorbTaskInPlan(db, subjectSlug, taskId, '2026-01-12');
    const moved = plan.tasks.find((t) => t.id === taskId)!;
    expect(moved.date).toBe('2026-01-12');
    expect(moved.pinned).toBe(true);

    // "today" past the plan's own window: no candidate day exists at all.
    await expect(reabsorbTaskInPlan(db, subjectSlug, taskId, '2026-03-01')).rejects.toThrow(
      MoveRefusedError,
    );
  });

  it('setTaskStatus refuses a still-proposed task and updates a committed one', async () => {
    const draftId = await insertDraftPlan();
    const taskId = await insertTask(draftId);
    await expect(setTaskStatus(db, subjectSlug, taskId, 'done')).rejects.toThrow();

    await commitPlan(db, dataRoot, subjectSlug, draftId);
    const updated = await setTaskStatus(db, subjectSlug, taskId, 'done');
    expect(updated.status).toBe('done');
  });

  it('marking a read task done recomputes its topic’s mastery (coverage component)', async () => {
    const docId = randomUUID();
    await db.insert(documents).values({
      id: docId,
      subjectId,
      type: 'appunti',
      originalName: 'doc.pdf',
      storedPath: '/irrelevant',
      mime: 'application/pdf',
      bytes: 10,
      sha256: 'a'.repeat(64),
      status: 'parsed',
      pages: 10,
    });
    const topicId = randomUUID();
    await db.insert(topics).values({ id: topicId, subjectId, name: 'Entropia', slug: 'entropia' });
    await db.insert(documentTopics).values({ documentId: docId, topicId });

    const draftId = await insertDraftPlan();
    const taskId = await insertTask(draftId, {
      topicId,
      payload: { action: 'read', material: [{ docId, pageFrom: 1, pageTo: 10 }], topicId },
    });
    await commitPlan(db, dataRoot, subjectSlug, draftId);

    let [topic] = await db.select().from(topics).where(eq(topics.id, topicId));
    expect(topic?.mastery).toBeNull();

    await setTaskStatus(db, subjectSlug, taskId, 'done');

    [topic] = await db.select().from(topics).where(eq(topics.id, topicId));
    expect(topic?.mastery).toBe(1); // full document read, no other component to renormalize against
  });

  it('getDailyTasks returns only todo/doing tasks from the active plan, up to today', async () => {
    const draftId = await insertDraftPlan();
    await insertTask(draftId, { date: '2026-01-06' });
    await commitPlan(db, dataRoot, subjectSlug, draftId);

    expect(await getDailyTasks(db, subjectSlug, '2026-01-05')).toEqual([]); // before the task's date
    const today = await getDailyTasks(db, subjectSlug, '2026-01-06');
    expect(today).toHaveLength(1);
    expect(today[0]!.status).toBe('todo');
  });

  it('getPlanDiff is null with no draft, and reports added/removed rows against the active plan otherwise', async () => {
    const draftId = await insertDraftPlan();
    const keptTaskId = await insertTask(draftId, { taskKey: 'read:doc:kept', date: '2026-01-06' });
    await commitPlan(db, dataRoot, subjectSlug, draftId);
    expect(await getPlanDiff(db, subjectSlug)).toBeNull();

    const newDraftId = await insertDraftPlan();
    await insertTask(newDraftId, { taskKey: 'read:doc:kept', date: '2026-01-06' }); // unchanged
    await insertTask(newDraftId, { taskKey: 'read:doc:new', date: '2026-01-08' }); // added

    const diff = await getPlanDiff(db, subjectSlug, 'nuovo materiale');
    expect(diff).not.toBeNull();
    expect(diff!.unchanged).toBe(1);
    expect(diff!.rows.some((r) => r.change === 'added' && r.key === 'read:doc:new')).toBe(true);
    void keptTaskId;
  });

  it('getPlanDrift is null with no active plan (nothing to check yet, not "no drift")', async () => {
    expect(await getPlanDrift(db, subjectSlug, '2026-01-10')).toBeNull();
    const draftId = await insertDraftPlan(); // a draft alone isn't active yet
    await insertTask(draftId, { date: '2026-01-06' });
    expect(await getPlanDrift(db, subjectSlug, '2026-01-10')).toBeNull();
  });

  it('getPlanDrift does not flag a plan whose past tasks are all done', async () => {
    const draftId = await insertDraftPlan();
    await insertTask(draftId, { date: '2026-01-06', status: 'done' });
    await insertTask(draftId, { date: '2026-01-07', status: 'done' });
    // Both tasks are already 'done' (not 'proposed'), so commitPlan's status
    // flip leaves them untouched — only the plan itself becomes active.
    await commitPlan(db, dataRoot, subjectSlug, draftId);

    const drift = await getPlanDrift(db, subjectSlug, '2026-01-10');
    expect(drift?.shouldRecalculate).toBe(false);
    expect(drift?.missedDays).toEqual([]);
  });

  it('getPlanDrift flags two entirely-missed days in the last week for a recalculation', async () => {
    const draftId = await insertDraftPlan();
    await insertTask(draftId, { taskKey: 'read:a', date: '2026-01-06' });
    await insertTask(draftId, { taskKey: 'read:b', date: '2026-01-07' });
    await commitPlan(db, dataRoot, subjectSlug, draftId);
    // Both days' tasks are still 'todo' by "today" — two fully-missed days.

    const drift = await getPlanDrift(db, subjectSlug, '2026-01-10');
    expect(drift?.shouldRecalculate).toBe(true);
    expect(drift?.missedDays).toEqual(['2026-01-06', '2026-01-07']);
    expect(drift?.reason).toContain('giorni saltati');
  });

  it('discardDraft removes the draft plan and its tasks without touching the active one', async () => {
    const activeId = await insertDraftPlan();
    await insertTask(activeId);
    await commitPlan(db, dataRoot, subjectSlug, activeId);

    const draftId = await insertDraftPlan();
    await insertTask(draftId);
    await discardDraft(db, subjectSlug);

    const remaining = await db.select().from(studyPlans).where(eq(studyPlans.subjectId, subjectId));
    expect(remaining.map((p) => p.id)).toEqual([activeId]);
    void draftId;
  });

  it('throws TaskNotFoundError for a task belonging to another subject', async () => {
    const otherSubject = await createSubject(db, dataRoot, { name: 'Chimica 1', color: 'green' });
    const draftId = await insertDraftPlan();
    const taskId = await insertTask(draftId);
    await expect(updateDraftTask(db, otherSubject.slug, taskId, { pinned: true })).rejects.toThrow(
      TaskNotFoundError,
    );
  });
});

describe('getPlanPreview (free pre-flight, no AI)', () => {
  let dataRoot: string;
  let db: Awaited<ReturnType<typeof createTestDb>>;
  let subjectSlug: string;
  let subjectId: string;

  beforeEach(async () => {
    dataRoot = await mkdtemp(join(tmpdir(), 'studyhub-preview-'));
    db = await createTestDb();
    const subject = await createSubject(db, dataRoot, { name: 'Chimica', color: 'green' });
    subjectSlug = subject.slug;
    subjectId = subject.id;
  });
  afterEach(async () => {
    await rm(dataRoot, { recursive: true, force: true });
  });

  async function addDoc(pages: number) {
    await db.insert(documents).values({
      id: randomUUID(),
      subjectId,
      type: 'appunti',
      originalName: `doc-${pages}.pdf`,
      storedPath: '/x',
      mime: 'application/pdf',
      bytes: 1,
      sha256: randomUUID().replace(/-/g, '').padEnd(64, '0'),
      status: 'parsed',
      pages,
    });
  }

  const request = (over: Partial<Parameters<typeof getPlanPreview>[2]> = {}) => ({
    startDate: '2026-03-02',
    targetDate: '2026-03-16',
    availability: { perWeekday: [0, 120, 120, 120, 120, 120, 0], blackoutDates: [] },
    prefs: PREFS,
    force: false,
    ...over,
  });

  it('says a plan is feasible with ample time, and writes nothing', async () => {
    await addDoc(40);
    const preview = await getPlanPreview(db, subjectSlug, request());
    expect(preview.estimate).toBe('heuristic');
    expect(preview.topicCount).toBe(1);
    expect(preview.feasibility.feasible).toBe(true);
    expect(preview.loadPerWeek.length).toBeGreaterThanOrEqual(2);
    expect(await db.select().from(studyPlans)).toEqual([]);
    expect(await db.select().from(tasks)).toEqual([]);
  });

  it('declares insufficient time BEFORE generating, with the 3 strategies', async () => {
    await addDoc(400);
    const preview = await getPlanPreview(
      db,
      subjectSlug,
      request({ availability: { perWeekday: [0, 20, 20, 20, 20, 20, 0], blackoutDates: [] } }),
    );
    expect(preview.feasibility.feasible).toBe(false);
    expect(preview.feasibility.shortfallMinutes).toBeGreaterThan(0);
    expect(preview.feasibility.strategies).toHaveLength(3);
  });

  it('subtracts imported calendar events from the days they fall on', async () => {
    await addDoc(20);
    const without = await getPlanPreview(db, subjectSlug, request());
    await db.insert(calendarEvents).values({
      id: randomUUID(),
      uid: 'ev-1',
      date: '2026-03-03', // a Tuesday inside the window
      title: 'Laboratorio',
    });
    const withEvent = await getPlanPreview(db, subjectSlug, request());
    const sum = (p: typeof without) => p.loadPerWeek.reduce((a, w) => a + w.available, 0);
    expect(withEvent.busyMinutes).toBe(60);
    expect(sum(withEvent)).toBeLessThan(sum(without));
  });

  it('an event outside the window changes nothing', async () => {
    await addDoc(20);
    await db.insert(calendarEvents).values({
      id: randomUUID(),
      uid: 'ev-2',
      date: '2027-01-01',
      title: 'Lontano',
    });
    expect((await getPlanPreview(db, subjectSlug, request())).busyMinutes).toBe(0);
  });
});

describe('applyBulkToDraft', () => {
  let dataRoot: string;
  let db: Awaited<ReturnType<typeof createTestDb>>;
  let subjectSlug: string;
  let subjectId: string;
  let planId: string;

  beforeEach(async () => {
    dataRoot = await mkdtemp(join(tmpdir(), 'studyhub-bulk-'));
    db = await createTestDb();
    const subject = await createSubject(db, dataRoot, { name: 'Fisica 1', color: 'blue' });
    subjectSlug = subject.slug;
    subjectId = subject.id;
    planId = randomUUID();
    await db.insert(studyPlans).values({
      id: planId,
      subjectId,
      startDate: '2026-01-05',
      targetDate: '2026-02-04',
      availability: AVAILABILITY,
      prefs: PREFS,
      feasibility: FEASIBILITY,
      warnings: [],
      model: 'fake-v1',
      promptVersion: 'estimate_topics/v1',
      status: 'draft',
    });
  });
  afterEach(async () => {
    await rm(dataRoot, { recursive: true, force: true });
  });

  async function addTask(o: Partial<typeof tasks.$inferInsert>) {
    const id = randomUUID();
    await db.insert(tasks).values({
      id,
      subjectId,
      planId,
      taskKey: `read:t:${id.slice(0, 4)}`,
      date: '2026-01-06',
      kind: 'read',
      topicKey: 't',
      minutes: 50,
      title: 'Studia',
      description: 'x',
      payload: { action: 'read' },
      status: 'proposed',
      ...o,
    });
    return id;
  }
  const row = async (id: string) => (await db.select().from(tasks).where(eq(tasks.id, id)))[0]!;

  it('shifts the unpinned draft tasks and persists it', async () => {
    const a = await addTask({ date: '2026-01-06' }); // Tue
    const b = await addTask({ date: '2026-01-07', pinned: true });
    await applyBulkToDraft(db, subjectSlug, { type: 'shift', days: 1 });
    expect((await row(a)).date).toBe('2026-01-07');
    expect((await row(b)).date).toBe('2026-01-07'); // pinned: untouched
  });

  it('refuses a shift that lands on a day with no time (Sunday), changing nothing', async () => {
    const a = await addTask({ date: '2026-01-10' }); // Saturday: Sunday has 0 minutes
    await expect(
      applyBulkToDraft(db, subjectSlug, { type: 'shift', days: 1 }),
    ).rejects.toBeInstanceOf(MoveRefusedError);
    expect((await row(a)).date).toBe('2026-01-10');
  });

  it('reduces the load and excludes a topic', async () => {
    const a = await addTask({ minutes: 60, topicKey: 'x' });
    const b = await addTask({ minutes: 60, topicKey: 'y' });
    await applyBulkToDraft(db, subjectSlug, { type: 'reduce_load', percent: 50 });
    expect((await row(a)).minutes).toBe(30);

    const plan = await applyBulkToDraft(db, subjectSlug, { type: 'exclude_topic', topicKey: 'x' });
    expect(plan.tasks.map((t) => t.id)).toEqual([b]);
  });

  it('needs a draft, and never touches an active plan', async () => {
    await db.update(studyPlans).set({ status: 'active' }).where(eq(studyPlans.id, planId));
    await addTask({});
    await expect(
      applyBulkToDraft(db, subjectSlug, { type: 'reduce_load', percent: 20 }),
    ).rejects.toBeInstanceOf(NoDraftPlanError);
  });
});
