import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { createTestDb } from '@studyhub/db/testDb';
import {
  artifacts,
  flashcards,
  studyPlans,
  taskFlashcards,
  tasks,
  topics,
  type TaskKind,
} from '@studyhub/db';
import { createSubject, listSubjectSummaries } from '../src/lib/subjects';
import { getQuickReviewQueue, getReviewOverview, getReviewQueue } from '../src/lib/review';
import { listDeckGroups } from '../src/lib/flashcardGroups';
import { getFlashcardStats } from '../src/lib/stats';

const NOW = new Date('2026-03-10T10:00:00Z');
const TODAY = '2026-03-10';

interface Ctx {
  id: string;
  slug: string;
  deckId: string;
  planId: string | null;
}

describe('review queue: only treated lessons', () => {
  let dataRoot: string;
  let db: Awaited<ReturnType<typeof createTestDb>>;
  let ctx: Ctx;

  async function makeSubject(name: string, planStatus: 'active' | 'draft' | null): Promise<Ctx> {
    const subject = await createSubject(db, dataRoot, { name, color: 'blue' });
    const deckId = randomUUID();
    await db.insert(artifacts).values({
      id: deckId,
      subjectId: subject.id,
      kind: 'flashcard_deck',
      title: 'Deck',
      path: '/x',
      model: 'fake-v1',
      promptVersion: 'flashcards/v1',
      status: 'approved',
    });
    let planId: string | null = null;
    if (planStatus) {
      planId = randomUUID();
      await db.insert(studyPlans).values({
        id: planId,
        subjectId: subject.id,
        status: planStatus,
        startDate: '2026-03-01',
        targetDate: '2026-04-01',
        availability: {} as never,
        prefs: {} as never,
        feasibility: {} as never,
        warnings: [],
        model: 'fake-v1',
        promptVersion: 'planner/v1',
      });
    }
    return { id: subject.id, slug: subject.slug, deckId, planId };
  }

  async function addCard(
    opts: {
      c?: Ctx;
      topicId?: string | null;
      state?: 'new' | 'review';
    } = {},
  ) {
    const c = opts.c ?? ctx;
    const id = randomUUID();
    const state = opts.state ?? 'new';
    await db.insert(flashcards).values({
      id,
      deckId: c.deckId,
      topicId: opts.topicId ?? null,
      type: 'basic',
      front: 'F',
      back: 'B',
      sourceRef: { docId: randomUUID(), page: 1, quote: 'B' },
      ...(state === 'review'
        ? {
            state: 'review' as const,
            stability: 5,
            difficulty: 5,
            reps: 2,
            dueAt: new Date('2026-03-09T10:00:00Z'),
            lastReviewAt: new Date('2026-03-04T10:00:00Z'),
          }
        : {}),
    });
    return id;
  }

  async function addTask(
    date: string,
    status: 'todo' | 'doing' | 'done',
    opts: { c?: Ctx; cardId?: string; topicId?: string; kind?: TaskKind; planId?: string } = {},
  ) {
    const c = opts.c ?? ctx;
    const id = randomUUID();
    await db.insert(tasks).values({
      id,
      subjectId: c.id,
      planId: opts.planId ?? c.planId!,
      taskKey: `read:${id}`,
      date,
      kind: opts.kind ?? 'read',
      topicId: opts.topicId ?? null,
      minutes: 30,
      title: 'Lezione',
      description: '',
      payload: { action: 'read' },
      status,
    });
    if (opts.cardId)
      await db.insert(taskFlashcards).values({ taskId: id, flashcardId: opts.cardId });
    return id;
  }

  async function addTopic(c: Ctx = ctx) {
    const id = randomUUID();
    await db.insert(topics).values({ id, subjectId: c.id, name: 'Cinematica', slug: `t-${id}` });
    return id;
  }

  const addLinkedTask = (
    cardId: string,
    date: string,
    status: 'todo' | 'doing' | 'done',
    planId?: string,
  ) => addTask(date, status, { cardId, ...(planId ? { planId } : {}) });

  async function addPlan(status: 'active' | 'draft' | 'superseded'): Promise<string> {
    const id = randomUUID();
    await db.insert(studyPlans).values({
      id,
      subjectId: ctx.id,
      status,
      startDate: '2026-03-01',
      targetDate: '2026-04-01',
      availability: {} as never,
      prefs: {} as never,
      feasibility: {} as never,
      warnings: [],
      model: 'fake-v1',
      promptVersion: 'planner/v1',
    });
    return id;
  }

  const queueIds = async (c: Ctx = ctx) =>
    (await getReviewQueue(db, c.slug, { now: NOW })).map((q) => q.id);

  beforeEach(async () => {
    dataRoot = await mkdtemp(join(tmpdir(), 'studyhub-treated-'));
    db = await createTestDb();
    ctx = await makeSubject('Fisica 1', 'active');
  });

  afterEach(async () => {
    await rm(dataRoot, { recursive: true, force: true });
  });

  it('keeps out a new card of a future lesson, from queue and overview', async () => {
    const card = await addCard();
    await addLinkedTask(card, '2026-03-20', 'todo');
    expect(await getReviewQueue(db, ctx.slug, { now: NOW })).toEqual([]);
    expect((await getReviewOverview(db, NOW)).totalDue).toBe(0);
  });

  it('lets in done lessons and today lessons, today first', async () => {
    const done = await addCard();
    const today = await addCard();
    const yesterday = await addCard();
    await addLinkedTask(done, '2026-03-02', 'done');
    await addLinkedTask(today, TODAY, 'todo');
    await addLinkedTask(yesterday, '2026-03-09', 'todo');
    const queue = await getReviewQueue(db, ctx.slug, { now: NOW });
    expect(queue.map((c) => c.id)).toEqual([today, done]);
    expect((await getReviewOverview(db, NOW)).totalDue).toBe(2);
  });

  it('lets in an unattached new card whose topic has a done lesson', async () => {
    const topic = await addTopic();
    const card = await addCard({ topicId: topic });
    await addTask('2026-03-02', 'done', { topicId: topic });
    expect(await queueIds()).toEqual([card]);
  });

  it('does not count a done simulation/rest task as treating the topic', async () => {
    const topic = await addTopic();
    await addCard({ topicId: topic });
    await addTask('2026-03-02', 'done', { topicId: topic, kind: 'simulation' });
    await addTask('2026-03-03', 'done', { topicId: topic, kind: 'rest' });
    expect(await queueIds()).toEqual([]);
  });

  it('keeps out a new card with no topic and no link in a subject with an active plan', async () => {
    await addCard();
    expect(await queueIds()).toEqual([]);
    expect((await getReviewOverview(db, NOW)).totalDue).toBe(0);
  });

  it('keeps in a due review card of an untreated topic', async () => {
    const topic = await addTopic();
    const future = await addCard({ topicId: topic, state: 'review' });
    await addTask('2026-03-20', 'todo', { topicId: topic, cardId: future });
    expect(await queueIds()).toEqual([future]);
  });

  it('keeps new cards in a subject with no plan at all', async () => {
    const other = await makeSubject('Chimica', null);
    const card = await addCard({ c: other });
    expect(await queueIds(other)).toEqual([card]);
  });

  it('keeps new cards in a subject with only a draft plan', async () => {
    const other = await makeSubject('Analisi', 'draft');
    const card = await addCard({ c: other });
    await addTask('2026-03-20', 'todo', { c: other, cardId: card });
    expect(await queueIds(other)).toEqual([card]);
    expect((await getReviewOverview(db, NOW)).totalDue).toBe(1);
  });

  it('leaves the ?task= queue unchanged: includes cards of a future lesson', async () => {
    const card = await addCard();
    const taskId = await addTask('2026-03-20', 'todo', { cardId: card });
    const queue = await getQuickReviewQueue(db, { subjectSlug: ctx.slug, taskId }, { now: NOW });
    expect(queue.map((q) => q.id)).toEqual([card]);
    // ...while the same card stays out of the normal queue.
    expect(await queueIds()).toEqual([]);
  });

  it('keeps overview totalDue equal to the global queue and to the subject dueCardsToday', async () => {
    const other = await makeSubject('Chimica', null);
    const done = await addCard();
    const future = await addCard();
    const started = await addCard({ state: 'review' });
    const unlinked = await addCard();
    await addLinkedTask(done, '2026-03-02', 'done');
    await addLinkedTask(future, '2026-03-20', 'todo');
    await addCard({ c: other });
    expect(unlinked).toBeTruthy();
    expect(started).toBeTruthy();

    const queue = await getQuickReviewQueue(db, {}, { n: 10_000, now: NOW });
    expect(queue).toHaveLength(3); // fisica: done + started; chimica: 1 (no plan); not future/unlinked
    const overview = await getReviewOverview(db, NOW);
    expect(overview.totalDue).toBe(queue.length);

    // dueCardsToday uses the real clock: the "done" lesson and the SRS state are clock independent,
    // the future lesson card (todo) and the unlinked one stay out either way.
    const summaries = await listSubjectSummaries(db);
    const fisica = summaries.find((s) => s.slug === ctx.slug)!;
    const chimica = summaries.find((s) => s.slug === other.slug)!;
    expect(chimica.dueCardsToday).toBe(1);
    expect(fisica.dueCardsToday).toBe(2);
  });

  it('lists deck groups with due/new counts consistent with the rule', async () => {
    const topic = await addTopic();
    const treated = await addCard({ topicId: topic });
    const untreated = await addCard({ topicId: topic });
    const started = await addCard({ topicId: topic, state: 'review' });
    await addLinkedTask(treated, '2026-03-02', 'done');
    await addLinkedTask(untreated, '2026-03-20', 'todo');
    const loose = await addCard(); // no topic, no link
    expect(loose).toBeTruthy();
    expect(started).toBeTruthy();

    const groups = await listDeckGroups(db, ctx.slug, NOW);
    const g = groups.find((x) => x.topicId === topic)!;
    expect(g.total).toBe(3);
    expect(g.new).toBe(1);
    expect(g.due).toBe(1);
    const looseGroup = groups.find((x) => x.topicId === null)!;
    expect(looseGroup.total).toBe(1);
    expect(looseGroup.new).toBe(0);
    expect(looseGroup.due).toBe(0);
    // Sum of new+due matches the subject queue.
    expect(groups.reduce((s, x) => s + x.new + x.due, 0)).toBe((await queueIds()).length);
  });

  it('forecast today counts only the cards of the queue', async () => {
    const treated = await addCard();
    const untreated = await addCard();
    const unlinked = await addCard();
    await addCard({ state: 'review' });
    await addLinkedTask(treated, '2026-03-02', 'done');
    await addLinkedTask(untreated, '2026-03-20', 'todo');
    expect(unlinked).toBeTruthy();

    const stats = await getFlashcardStats(db, ctx.slug, NOW);
    expect(stats.forecast[0]!.date).toBe(TODAY);
    expect(stats.forecast[0]!.count).toBe((await queueIds()).length);
    expect(stats.forecast[0]!.count).toBe(2);
  });

  it('a done lesson still counts after its plan is superseded by a new one', async () => {
    const card = await addCard();
    await addLinkedTask(card, '2026-03-02', 'done');
    await db.update(studyPlans).set({ status: 'superseded' }).where(eq(studyPlans.id, ctx.planId!));
    await addPlan('active');
    expect(await queueIds()).toEqual([card]);
  });

  it('a today lesson in "doing" counts, a done one in a draft plan does not', async () => {
    const doing = await addCard();
    await addLinkedTask(doing, TODAY, 'doing');
    const drafted = await addCard();
    await addLinkedTask(drafted, '2026-03-02', 'done', await addPlan('draft'));
    expect(await queueIds()).toEqual([doing]);
  });

  it('two active plans: a lesson done in either one counts', async () => {
    const other = await addPlan('active');
    const a = await addCard();
    const b = await addCard();
    await addLinkedTask(a, '2026-03-02', 'done');
    await addLinkedTask(b, '2026-03-03', 'done', other);
    expect(await queueIds()).toHaveLength(2);
  });

  it('caps new cards at 20 and queue, overview, summary and forecast[0] agree', async () => {
    for (let i = 0; i < 25; i += 1) {
      await addLinkedTask(await addCard(), '2026-03-02', 'done');
    }
    const [summary] = await listSubjectSummaries(db, { now: NOW });
    const stats = await getFlashcardStats(db, ctx.slug, NOW);
    expect(await queueIds()).toHaveLength(20);
    expect((await getReviewOverview(db, NOW)).totalDue).toBe(20);
    expect(summary!.dueCardsToday).toBe(20);
    expect(stats.forecast[0]!.count).toBe(20);
  });
});
