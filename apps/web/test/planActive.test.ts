import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { createTestDb } from '@studyhub/db/testDb';
import { exams, studyPlans, tasks } from '@studyhub/db';
import { createSubject } from '../src/lib/subjects';
import {
  applyBulk,
  applyBulkToDraft,
  commitPlan,
  listPlans,
  MoveRefusedError,
  moveTaskInPlan,
  moveTasksInPlan,
  NoDraftPlanError,
  PlanNotFoundError,
  PlanRequestError,
  TaskNotFoundError,
  updateDraftTask,
} from '../src/lib/plan';

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

describe('modifiche a un piano attivo (slice C)', () => {
  let dataRoot: string;
  let db: Awaited<ReturnType<typeof createTestDb>>;
  let subjectSlug: string;
  let subjectId: string;

  beforeEach(async () => {
    dataRoot = await mkdtemp(join(tmpdir(), 'studyhub-active-'));
    db = await createTestDb();
    const subject = await createSubject(db, dataRoot, { name: 'Fisica 1', color: 'blue' });
    subjectSlug = subject.slug;
    subjectId = subject.id;
  });
  afterEach(async () => {
    await rm(dataRoot, { recursive: true, force: true });
  });

  async function addExam() {
    const id = randomUUID();
    await db.insert(exams).values({
      id,
      subjectId,
      title: 'Parziale',
      kind: 'parziale',
      date: new Date('2026-02-04T09:00:00Z'),
    });
    return id;
  }
  async function addPlan(status: 'draft' | 'active', examId: string | null = null) {
    const id = randomUUID();
    await db.insert(studyPlans).values({
      id,
      subjectId,
      examId,
      startDate: '2026-01-05',
      targetDate: '2026-02-04',
      availability: AVAILABILITY,
      prefs: PREFS,
      feasibility: FEASIBILITY,
      warnings: [],
      model: 'fake-v1',
      promptVersion: 'estimate_topics/v1',
      status,
    });
    return id;
  }
  async function addTask(planId: string, o: Partial<typeof tasks.$inferInsert> = {}) {
    const id = randomUUID();
    await db.insert(tasks).values({
      id,
      subjectId,
      planId,
      taskKey: `read:t:${id.slice(0, 6)}`,
      date: '2026-01-06',
      kind: 'read',
      topicKey: 't',
      minutes: 30,
      title: 'Studia',
      description: 'x',
      payload: { action: 'read' },
      status: 'todo',
      ...o,
    });
    return id;
  }
  const row = async (id: string) => (await db.select().from(tasks).where(eq(tasks.id, id)))[0]!;

  it('pins and unpins an open task of an active plan, but refuses any other field or a closed task', async () => {
    const plan = await addPlan('active');
    const open = await addTask(plan);
    const done = await addTask(plan, { status: 'done' });

    expect((await updateDraftTask(db, subjectSlug, open, { pinned: true })).pinned).toBe(true);
    expect((await row(open)).pinned).toBe(true);
    expect((await updateDraftTask(db, subjectSlug, open, { pinned: false })).pinned).toBe(false);

    await expect(
      updateDraftTask(db, subjectSlug, open, { pinned: true, minutes: 10 }),
    ).rejects.toBeInstanceOf(PlanRequestError);
    await expect(updateDraftTask(db, subjectSlug, open, { title: 'x' })).rejects.toBeInstanceOf(
      PlanRequestError,
    );
    expect((await row(open)).minutes).toBe(30);
    await expect(updateDraftTask(db, subjectSlug, done, { pinned: true })).rejects.toThrow();
  });

  it('excludes a topic from an active plan: open tasks (any date) skipped, done kept, others untouched', async () => {
    const plan = await addPlan('active');
    const a = await addTask(plan, { topicKey: 'x', date: '2026-01-06' });
    const b = await addTask(plan, { topicKey: 'x', date: '2026-01-20', status: 'doing' });
    const done = await addTask(plan, { topicKey: 'x', status: 'done' });
    const other = await addTask(plan, { topicKey: 'y' });

    const res = await applyBulk(db, subjectSlug, { type: 'exclude_topic', topicKey: 'x' });
    expect(res.skipped).toBe(2);
    expect(res.plan.id).toBe(plan);
    expect((await row(a)).status).toBe('skipped');
    expect((await row(b)).status).toBe('skipped');
    expect((await row(a)).date).toBe('2026-01-06'); // no redistribution
    expect((await row(done)).status).toBe('done');
    expect((await row(other)).status).toBe('todo');
    expect(res.plan.tasks.find((t) => t.id === a)?.status).toBe('skipped');

    await expect(
      applyBulk(db, subjectSlug, { type: 'exclude_topic', topicKey: 'x' }),
    ).rejects.toBeInstanceOf(MoveRefusedError);
  });

  it('with several active plans exclude_topic needs a planId; shift/reduce_load never touch an active plan', async () => {
    const general = await addPlan('active');
    const partial = await addPlan('active', await addExam());
    const g = await addTask(general, { topicKey: 'x' });
    const p = await addTask(partial, { topicKey: 'x' });

    await expect(
      applyBulk(db, subjectSlug, { type: 'exclude_topic', topicKey: 'x' }),
    ).rejects.toBeInstanceOf(PlanRequestError);
    expect((await row(g)).status).toBe('todo');

    const res = await applyBulk(db, subjectSlug, {
      type: 'exclude_topic',
      topicKey: 'x',
      planId: partial,
    });
    expect(res.skipped).toBe(1);
    expect((await row(p)).status).toBe('skipped');
    expect((await row(g)).status).toBe('todo');

    await expect(
      applyBulk(db, subjectSlug, { type: 'exclude_topic', topicKey: 'x', planId: randomUUID() }),
    ).rejects.toBeInstanceOf(PlanNotFoundError);
    await expect(
      applyBulkToDraft(db, subjectSlug, { type: 'shift', days: 1 }),
    ).rejects.toBeInstanceOf(NoDraftPlanError);
    await expect(
      applyBulk(db, subjectSlug, { type: 'reduce_load', percent: 20 }),
    ).rejects.toBeInstanceOf(NoDraftPlanError);
  });

  it('exclude_topic without planId prefers the draft; with planId it targets the active plan', async () => {
    const active = await addPlan('active');
    const draft = await addPlan('draft');
    const inActive = await addTask(active, { topicKey: 'x' });
    const inDraft = await addTask(draft, { topicKey: 'x', status: 'proposed' });
    await applyBulk(db, subjectSlug, { type: 'exclude_topic', topicKey: 'x' });
    expect((await row(inActive)).status).toBe('todo');
    expect(await db.select().from(tasks).where(eq(tasks.id, inDraft))).toHaveLength(0);

    await applyBulk(db, subjectSlug, { type: 'exclude_topic', topicKey: 'x', planId: active });
    expect((await row(inActive)).status).toBe('skipped');
  });

  it('a draft coexists with the active plan and committing it supersedes the active one', async () => {
    const active = await addPlan('active');
    await addTask(active);
    const draft = await addPlan('draft');
    await addTask(draft, { status: 'proposed' });
    expect((await listPlans(db, subjectSlug)).map((p) => p.status)).toEqual(['draft', 'active']);
    await commitPlan(db, dataRoot, subjectSlug, draft);
    const plans = await db.select().from(studyPlans).where(eq(studyPlans.subjectId, subjectId));
    expect(plans.find((p) => p.id === active)?.status).toBe('superseded');
    expect(plans.find((p) => p.id === draft)?.status).toBe('active');
  });

  it('moves a group of open tasks by N days from each task’s own date, in one go', async () => {
    const plan = await addPlan('active');
    const a = await addTask(plan, { date: '2026-01-06' }); // Tue
    const b = await addTask(plan, { date: '2026-01-07' }); // Wed
    const res = await moveTasksInPlan(db, subjectSlug, [a, b], 1);
    expect((await row(a)).date).toBe('2026-01-07');
    expect((await row(b)).date).toBe('2026-01-08');
    expect(res.id).toBe(plan);
    expect(res.tasks.find((t) => t.id === a)?.date).toBe('2026-01-07');
  });

  it('refuses a group move with tasks of another plan, closed or proposed tasks, unknown ids', async () => {
    const plan = await addPlan('active');
    const otherPlan = await addPlan('active', await addExam());
    const a = await addTask(plan);
    const foreign = await addTask(otherPlan);
    const done = await addTask(plan, { status: 'done' });
    const proposed = await addTask(await addPlan('draft'), { status: 'proposed' });

    await expect(moveTasksInPlan(db, subjectSlug, [a, foreign], 1)).rejects.toBeInstanceOf(
      PlanRequestError,
    );
    await expect(moveTasksInPlan(db, subjectSlug, [a, done], 1)).rejects.toBeInstanceOf(
      PlanRequestError,
    );
    await expect(moveTasksInPlan(db, subjectSlug, [proposed], 1)).rejects.toBeInstanceOf(
      PlanRequestError,
    );
    await expect(moveTasksInPlan(db, subjectSlug, [randomUUID()], 1)).rejects.toBeInstanceOf(
      TaskNotFoundError,
    );
    expect((await row(a)).date).toBe('2026-01-06');
  });

  it('a group move refused by the planner (new reading in the last two days) is all-or-nothing', async () => {
    const plan = await addPlan('active');
    const ok = await addTask(plan, { date: '2026-01-06' });
    // Sunday before the exam: the next day with time (Monday 02-02) is within the last two, where no new reading may start.
    const bad = await addTask(plan, { date: '2026-02-01' });
    await expect(moveTasksInPlan(db, subjectSlug, [ok, bad], 1)).rejects.toBeInstanceOf(
      MoveRefusedError,
    );
    expect((await row(ok)).date).toBe('2026-01-06');
    expect((await row(bad)).date).toBe('2026-02-01');
  });

  it('a group move treats done tasks as fixed and ignores skipped ones, never shifting them', async () => {
    const plan = await addPlan('active');
    // 2026-01-07 (Wed) holds a done 50 min task and a skipped 120 min one; capacity is ~100 (standard pace).
    const done = await addTask(plan, { date: '2026-01-07', minutes: 50, status: 'done' });
    const skipped = await addTask(plan, { date: '2026-01-07', minutes: 120, status: 'skipped' });
    const a = await addTask(plan, { date: '2026-01-06', minutes: 50 });
    await moveTasksInPlan(db, subjectSlug, [a], 1);
    expect((await row(a)).date).toBe('2026-01-07');
    expect((await row(done)).date).toBe('2026-01-07');
    expect((await row(done)).pinned).toBe(false); // pinned only in the engine state
    expect((await row(skipped)).date).toBe('2026-01-07');
  });

  it('a Saturday task goes to the first day with time (Monday) when Sunday has none', async () => {
    const plan = await addPlan('active');
    const sat = await addTask(plan, { date: '2026-01-10' });
    const res = await moveTasksInPlan(db, subjectSlug, [sat], 1);
    expect((await row(sat)).date).toBe('2026-01-12');
    expect(res.id).toBe(plan);
  });

  it('moves latest first on consecutive full days, without cascading onto tasks waiting their turn', async () => {
    const plan = await addPlan('active');
    const tue = await addTask(plan, { date: '2026-01-06', minutes: 100 });
    const wed = await addTask(plan, { date: '2026-01-07', minutes: 100 });
    const thu = await addTask(plan, { date: '2026-01-08', minutes: 100 });
    await moveTasksInPlan(db, subjectSlug, [tue, wed, thu], 1);
    expect((await row(tue)).date).toBe('2026-01-07');
    expect((await row(wed)).date).toBe('2026-01-08');
    expect((await row(thu)).date).toBe('2026-01-09');
  });

  it('single move and reabsorb do not displace done tasks either', async () => {
    const plan = await addPlan('active');
    const done = await addTask(plan, { date: '2026-01-07', minutes: 50, status: 'done' });
    const other = await addTask(plan, { date: '2026-01-07', minutes: 50 });
    const c = await addTask(plan, { date: '2026-01-06', minutes: 50 });
    await moveTaskInPlan(db, subjectSlug, c, '2026-01-07');
    expect((await row(done)).date).toBe('2026-01-07');
    expect((await row(other)).date).not.toBe('2026-01-07');
    expect((await row(done)).pinned).toBe(false);
  });
});
