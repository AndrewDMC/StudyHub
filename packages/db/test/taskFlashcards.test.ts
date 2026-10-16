import { beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { createTestDb } from '../src/testDb.js';
import {
  artifacts,
  autoAttachFlashcards,
  countTaskFlashcards,
  flashcards,
  reattachFlashcards,
  studyPlans,
  subjects,
  taskFlashcards,
  tasks,
  topics,
  type TaskKind,
  type TaskStatus,
} from '../src/index.js';

type Db = Awaited<ReturnType<typeof createTestDb>>;

const TODAY = '2026-10-16';

async function setup(db: Db) {
  const subjectId = randomUUID();
  await db.insert(subjects).values({
    id: subjectId,
    slug: `s-${subjectId.slice(0, 6)}`,
    name: 'Materia',
    color: 'blue',
    folderPath: '/x',
  });
  const topicA = randomUUID();
  const topicB = randomUUID();
  for (const [i, id] of [topicA, topicB].entries()) {
    await db.insert(topics).values({ id, subjectId, slug: `t${i}`, name: `T${i}`, orderIndex: i });
  }
  const deckId = randomUUID();
  await db.insert(artifacts).values({
    id: deckId,
    subjectId,
    kind: 'flashcard_deck',
    title: 'Mazzo',
    path: 'p',
    status: 'approved',
    model: 'm',
    promptVersion: 'v',
  });
  const planId = randomUUID();
  await db.insert(studyPlans).values({
    id: planId,
    subjectId,
    startDate: '2026-10-01',
    targetDate: '2026-12-01',
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
    model: 'fake-v1',
    promptVersion: 'p',
    status: 'active',
  });
  return { subjectId, topicA, topicB, deckId, planId };
}

async function addTask(
  db: Db,
  ctx: { subjectId: string; planId: string },
  over: { topicId: string | null; date: string; kind?: TaskKind; status?: TaskStatus },
) {
  const id = randomUUID();
  await db.insert(tasks).values({
    id,
    subjectId: ctx.subjectId,
    planId: ctx.planId,
    taskKey: `k-${id}`,
    date: over.date,
    kind: over.kind ?? 'read',
    topicId: over.topicId,
    minutes: 30,
    title: 't',
    description: '',
    payload: { action: 'read' },
    status: over.status ?? 'todo',
  });
  return id;
}

async function addCard(
  db: Db,
  deckId: string,
  topicId: string | null,
  over: { suspended?: boolean } = {},
) {
  const id = randomUUID();
  await db.insert(flashcards).values({
    id,
    deckId,
    topicId,
    type: 'basic',
    front: 'f',
    back: 'b',
    suspended: over.suspended ?? false,
  });
  return id;
}

describe('task flashcards helpers', () => {
  let db: Db;
  beforeEach(async () => {
    db = await createTestDb();
  });

  it('autoAttach links each card to the nearest open lesson of its topic', async () => {
    const ctx = await setup(db);
    await addTask(db, ctx, { topicId: ctx.topicA, date: '2026-10-10' }); // past
    const near = await addTask(db, ctx, { topicId: ctx.topicA, date: '2026-10-18' });
    await addTask(db, ctx, { topicId: ctx.topicA, date: '2026-10-25' });
    const c1 = await addCard(db, ctx.deckId, ctx.topicA);
    await addCard(db, ctx.deckId, null); // no topic
    await addCard(db, ctx.deckId, ctx.topicA, { suspended: true });
    await addCard(db, ctx.deckId, ctx.topicB); // no lesson for B

    const n = await autoAttachFlashcards(db, { subjectId: ctx.subjectId, today: TODAY });
    expect(n).toBe(1);
    const links = await db.select().from(taskFlashcards);
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({ taskId: near, flashcardId: c1, source: 'auto' });

    // Idempotent.
    expect(await autoAttachFlashcards(db, { subjectId: ctx.subjectId, today: TODAY })).toBe(0);
    const counts = await countTaskFlashcards(db, [near, randomUUID()]);
    expect(counts.get(near)).toBe(1);
    expect(counts.size).toBe(1);
  });

  async function clonePlan(db: Db, planId: string, status: 'draft' | 'active' | 'superseded') {
    const [src] = await db.select().from(studyPlans).where(eq(studyPlans.id, planId));
    const id = randomUUID();
    await db.insert(studyPlans).values({ ...src!, id, status });
    return id;
  }

  it('attaches once per plan when the subject has two active plans', async () => {
    const ctx = await setup(db);
    const second = await clonePlan(db, ctx.planId, 'active');
    const t1 = await addTask(db, ctx, { topicId: ctx.topicA, date: '2026-10-18' });
    const t2 = await addTask(
      db,
      { ...ctx, planId: second },
      { topicId: ctx.topicA, date: '2026-10-22' },
    );
    const card = await addCard(db, ctx.deckId, ctx.topicA);

    expect(await autoAttachFlashcards(db, { subjectId: ctx.subjectId, today: TODAY })).toBe(2);
    const links = await db.select().from(taskFlashcards);
    expect(links.map((l) => `${l.taskId}:${l.flashcardId}`).sort()).toEqual(
      [`${t1}:${card}`, `${t2}:${card}`].sort(),
    );
    expect(await autoAttachFlashcards(db, { subjectId: ctx.subjectId, today: TODAY })).toBe(0);
  });

  it('with a draft next to the active plan, links go to both; superseded plans are ignored', async () => {
    const ctx = await setup(db);
    const draft = await clonePlan(db, ctx.planId, 'draft');
    const old = await clonePlan(db, ctx.planId, 'superseded');
    const active = await addTask(db, ctx, { topicId: ctx.topicA, date: '2026-10-18' });
    const inDraft = await addTask(
      db,
      { ...ctx, planId: draft },
      { topicId: ctx.topicA, date: '2026-10-19' },
    );
    await addTask(db, { ...ctx, planId: old }, { topicId: ctx.topicA, date: '2026-10-17' });
    const card = await addCard(db, ctx.deckId, ctx.topicA);

    expect(await autoAttachFlashcards(db, { subjectId: ctx.subjectId, today: TODAY })).toBe(2);
    const links = await db.select().from(taskFlashcards);
    expect(links.map((l) => l.taskId).sort()).toEqual([active, inDraft].sort());
    expect(links.every((l) => l.flashcardId === card)).toBe(true);
  });

  it('does not re-attach a card that already has a user link in the plan', async () => {
    const ctx = await setup(db);
    await addTask(db, ctx, { topicId: ctx.topicA, date: '2026-10-18' });
    const other = await addTask(db, ctx, { topicId: ctx.topicB, date: '2026-10-19' });
    const card = await addCard(db, ctx.deckId, ctx.topicA);
    await db.insert(taskFlashcards).values({ taskId: other, flashcardId: card, source: 'user' });
    expect(await autoAttachFlashcards(db, { subjectId: ctx.subjectId, today: TODAY })).toBe(0);
  });

  it('respects cardIds / planIds filters and ignores superseded plans', async () => {
    const ctx = await setup(db);
    const t = await addTask(db, ctx, { topicId: ctx.topicA, date: '2026-10-18' });
    const c1 = await addCard(db, ctx.deckId, ctx.topicA);
    await addCard(db, ctx.deckId, ctx.topicA);
    expect(
      await autoAttachFlashcards(db, { subjectId: ctx.subjectId, cardIds: [c1], today: TODAY }),
    ).toBe(1);
    expect(
      await autoAttachFlashcards(db, { subjectId: ctx.subjectId, cardIds: [], today: TODAY }),
    ).toBe(0);
    await db.update(studyPlans).set({ status: 'superseded' }).where(eq(studyPlans.id, ctx.planId));
    expect(await autoAttachFlashcards(db, { subjectId: ctx.subjectId, today: TODAY })).toBe(0);
    expect(
      await autoAttachFlashcards(db, {
        subjectId: ctx.subjectId,
        planIds: [ctx.planId],
        today: TODAY,
      }),
    ).toBe(1);
    expect((await countTaskFlashcards(db, [t])).get(t)).toBe(2);
  });

  it('reattach moves auto links, keeps user links and links to closed tasks', async () => {
    const ctx = await setup(db);
    const lessonA = await addTask(db, ctx, { topicId: ctx.topicA, date: '2026-10-18' });
    const lessonB = await addTask(db, ctx, { topicId: ctx.topicB, date: '2026-10-20' });
    const closedA = await addTask(db, ctx, {
      topicId: ctx.topicA,
      date: '2026-10-01',
      status: 'done',
    });
    const moved = await addCard(db, ctx.deckId, ctx.topicA);
    const kept = await addCard(db, ctx.deckId, ctx.topicA);
    await db.insert(taskFlashcards).values([
      { taskId: lessonA, flashcardId: moved, source: 'auto' },
      { taskId: closedA, flashcardId: moved, source: 'auto' },
      { taskId: lessonA, flashcardId: kept, source: 'user' },
    ]);

    await db.update(flashcards).set({ topicId: ctx.topicB }).where(eq(flashcards.id, moved));
    await db.update(flashcards).set({ topicId: ctx.topicB }).where(eq(flashcards.id, kept));
    const created = await reattachFlashcards(db, {
      subjectId: ctx.subjectId,
      cardIds: [moved, kept],
      today: TODAY,
    });
    expect(created).toBe(1); // `kept` still has its user link to an open task

    const links = await db.select().from(taskFlashcards);
    const key = (l: { taskId: string; flashcardId: string }) => `${l.taskId}:${l.flashcardId}`;
    expect(links.map(key).sort()).toEqual(
      [`${lessonB}:${moved}`, `${closedA}:${moved}`, `${lessonA}:${kept}`].sort(),
    );

    // Topic cleared: auto links to open tasks go away, nothing re-attached.
    await db.update(flashcards).set({ topicId: null }).where(eq(flashcards.id, moved));
    expect(
      await reattachFlashcards(db, { subjectId: ctx.subjectId, cardIds: [moved], today: TODAY }),
    ).toBe(0);
    const after = await db.select().from(taskFlashcards);
    expect(after.map(key).sort()).toEqual([`${closedA}:${moved}`, `${lessonA}:${kept}`].sort());
  });
});
