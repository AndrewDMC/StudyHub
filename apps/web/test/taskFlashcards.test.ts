import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createTestDb } from '@studyhub/db/testDb';
import {
  artifacts,
  flashcards,
  studyPlans,
  taskFlashcards,
  tasks,
  topics,
  type TaskKind,
  type TaskStatus,
} from '@studyhub/db';
import { UpdateTaskFlashcardsRequestSchema } from '@studyhub/contracts';
import { createSubject } from '../src/lib/subjects';
import {
  bulkFlashcards,
  createDeck,
  createFlashcard,
  updateFlashcard,
} from '../src/lib/deckEditor';
import { getCurrentPlan } from '../src/lib/plan';
import { getQuickReviewQueue } from '../src/lib/review';
import {
  lessonExitHref,
  scopeFromSearchParams,
  scopeToSearchParams,
  sessionTitle,
} from '../src/lib/quickReview';
import { NotFoundError } from '../src/lib/examPrep';
import { getTaskFlashcards, updateTaskFlashcards } from '../src/lib/taskFlashcards';

type Db = Awaited<ReturnType<typeof createTestDb>>;

const NOW = new Date('2026-10-11T12:00:00.000Z');

describe('flashcards attached to lessons (task_flashcards)', () => {
  let dataRoot: string;
  let db: Db;
  let subject: { id: string; slug: string };
  let planId: string;

  beforeEach(async () => {
    dataRoot = await mkdtemp(join(tmpdir(), 'studyhub-task-flashcards-'));
    db = await createTestDb();
    subject = await createSubject(db, dataRoot, { name: 'Fisica 1', color: 'blue' });
    planId = randomUUID();
    await db.insert(studyPlans).values({
      id: planId,
      subjectId: subject.id,
      startDate: '2026-01-01',
      targetDate: '2099-12-31',
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
  });

  afterEach(async () => {
    await rm(dataRoot, { recursive: true, force: true });
  });

  async function seedTopic(slug: string) {
    const id = randomUUID();
    await db.insert(topics).values({ id, subjectId: subject.id, name: slug, slug });
    return id;
  }

  async function seedTask(
    topicId: string | null,
    date = '2099-01-01',
    over: { kind?: TaskKind; status?: TaskStatus } = {},
  ) {
    const id = randomUUID();
    await db.insert(tasks).values({
      id,
      subjectId: subject.id,
      planId,
      taskKey: `k-${id}`,
      date,
      kind: over.kind ?? 'read',
      topicId,
      minutes: 30,
      title: 'Lezione',
      description: '',
      payload: { action: 'read' },
      status: over.status ?? 'todo',
    });
    return id;
  }

  async function seedDeck(status: 'draft' | 'approved' = 'approved', subjectId = subject.id) {
    const deckId = randomUUID();
    await db.insert(artifacts).values({
      id: deckId,
      subjectId,
      kind: 'flashcard_deck',
      title: 'Deck',
      path: '/x',
      status,
      model: 'fake-v1',
      promptVersion: 'v',
    });
    return deckId;
  }

  async function seedCard(deckId: string, over: Partial<typeof flashcards.$inferInsert> = {}) {
    const id = randomUUID();
    await db.insert(flashcards).values({
      id,
      deckId,
      type: 'basic',
      front: 'F',
      back: 'B',
      ...over,
    });
    return id;
  }

  describe('GET / PUT lib', () => {
    it('lists attached cards with their source, and PUT adds (as user) and removes', async () => {
      const topicId = await seedTopic('cinematica');
      const taskId = await seedTask(topicId);
      const deck = await seedDeck();
      const c1 = await seedCard(deck, { topicId });
      const c2 = await seedCard(deck);
      await db.insert(taskFlashcards).values({ taskId, flashcardId: c1, source: 'auto' });

      const before = await getTaskFlashcards(db, subject.slug, taskId);
      expect(before.topicId).toBe(topicId);
      expect(before.items.map((i) => [i.id, i.source])).toEqual([[c1, 'auto']]);
      expect(before.items[0]!.reviewable).toBe(true);

      const after = await updateTaskFlashcards(db, subject.slug, taskId, { add: [c1, c2] });
      expect(after.items.map((i) => `${i.id}:${i.source}`).sort()).toEqual(
        [`${c1}:user`, `${c2}:user`].sort(),
      );

      const removed = await updateTaskFlashcards(db, subject.slug, taskId, { remove: [c1] });
      expect(removed.items.map((i) => i.id)).toEqual([c2]);
    });

    it('404s on a task or a card of another subject, writing nothing', async () => {
      const taskId = await seedTask(null);
      const other = await createSubject(db, dataRoot, { name: 'Chimica', color: 'rose' });
      const foreignCard = await seedCard(await seedDeck('approved', other.id));
      const ownCard = await seedCard(await seedDeck());

      await expect(
        updateTaskFlashcards(db, subject.slug, taskId, { add: [ownCard, foreignCard] }),
      ).rejects.toBeInstanceOf(NotFoundError);
      expect(await db.select().from(taskFlashcards)).toHaveLength(0);
      await expect(getTaskFlashcards(db, other.slug, taskId)).rejects.toBeInstanceOf(NotFoundError);
      await expect(getTaskFlashcards(db, subject.slug, randomUUID())).rejects.toBeInstanceOf(
        NotFoundError,
      );
    });

    it('marks suspended, flagged and draft-deck cards as not reviewable', async () => {
      const taskId = await seedTask(null);
      const ok = await seedCard(await seedDeck());
      const suspended = await seedCard(await seedDeck(), { suspended: true });
      const flagged = await seedCard(await seedDeck(), { flaggedAt: new Date() });
      const inDraft = await seedCard(await seedDeck('draft'));
      const res = await updateTaskFlashcards(db, subject.slug, taskId, {
        add: [ok, suspended, flagged, inDraft],
      });
      const flags = new Map(res.items.map((i) => [i.id, i.reviewable]));
      expect(flags.get(ok)).toBe(true);
      expect(flags.get(suspended)).toBe(false);
      expect(flags.get(flagged)).toBe(false);
      expect(flags.get(inDraft)).toBe(false);
    });

    it('re-activating a suspended card attaches it to its lesson', async () => {
      const topicId = await seedTopic('cinematica');
      const taskId = await seedTask(topicId);
      const deck = await seedDeck();
      const card = await seedCard(deck, { topicId, suspended: true });
      await updateFlashcard(db, subject.slug, card, { suspended: false });
      const links = await db.select().from(taskFlashcards);
      expect(links.map((l) => [l.taskId, l.flashcardId])).toEqual([[taskId, card]]);
    });

    it('lesson sessions exit to the plan page, never to the browser history', () => {
      expect(lessonExitHref({ subjectSlug: 'fisica-1', taskId: 't' })).toBe(
        '/materie/fisica-1/piano',
      );
      expect(lessonExitHref({ taskId: 't' })).toBe('/ripasso');
      expect(lessonExitHref({ subjectSlug: 'fisica-1' })).toBeNull();
    });

    it('request schema needs add or remove', () => {
      expect(UpdateTaskFlashcardsRequestSchema.safeParse({ add: [] }).success).toBe(false);
    });
  });

  describe('plan DTO', () => {
    it('carries flashcardCount per task', async () => {
      const taskId = await seedTask(null);
      const empty = await seedTask(null);
      const card = await seedCard(await seedDeck());
      await db.insert(taskFlashcards).values({ taskId, flashcardId: card });
      const plan = await getCurrentPlan(db, subject.slug);
      const byId = new Map(plan!.tasks.map((t) => [t.id, t.flashcardCount]));
      expect(byId.get(taskId)).toBe(1);
      expect(byId.get(empty)).toBe(0);
    });
  });

  describe('review queue with task', () => {
    it('returns attached reviewable cards, due first then the others, skipping unapproved and suspended', async () => {
      const taskId = await seedTask(null);
      const deck = await seedDeck();
      const reviewed = (lastReviewAt: string, dueAt: string) => ({
        state: 'review' as const,
        stability: 3,
        difficulty: 5,
        reps: 2,
        lastReviewAt: new Date(lastReviewAt),
        dueAt: new Date(dueAt),
      });
      const dueCard = await seedCard(
        deck,
        reviewed('2026-10-01T00:00:00Z', '2026-10-10T00:00:00Z'),
      );
      const laterCard = await seedCard(
        deck,
        reviewed('2026-10-10T00:00:00Z', '2026-10-25T00:00:00Z'),
      );
      const suspended = await seedCard(deck, { suspended: true });
      const inDraft = await seedCard(await seedDeck('draft'));
      const unattached = await seedCard(deck);
      await db
        .insert(taskFlashcards)
        .values(
          [laterCard, dueCard, suspended, inDraft].map((flashcardId) => ({ taskId, flashcardId })),
        );

      const queue = await getQuickReviewQueue(
        db,
        { subjectSlug: subject.slug, taskId },
        { now: NOW },
      );
      expect(queue.map((c) => c.id)).toEqual([dueCard, laterCard]);
      expect(queue.some((c) => c.id === unattached)).toBe(false);

      const capped = await getQuickReviewQueue(db, { taskId }, { n: 1, now: NOW });
      expect(capped.map((c) => c.id)).toEqual([dueCard]);
    });

    it('scope helpers round-trip task and title', () => {
      const scope = { subjectSlug: 'fisica-1', taskId: 'abc' };
      expect(scopeToSearchParams(scope, 0).toString()).toBe('materia=fisica-1&task=abc');
      expect(
        scopeFromSearchParams({ materia: 'fisica-1', task: 'abc', argomento: 'none' }),
      ).toEqual(scope);
      expect(sessionTitle(scope, undefined)).toContain('lezione');
    });
  });

  describe('automatic attach from the deck editor', () => {
    it('a new card with a topic joins the lesson of its topic', async () => {
      const topicId = await seedTopic('cinematica');
      const taskId = await seedTask(topicId);
      const deck = await createDeck(db, subject.slug, 'Manuale');
      const withTopic = await createFlashcard(db, subject.slug, {
        deckId: deck.id,
        type: 'basic',
        front: 'a',
        back: 'b',
        topicId,
      });
      const noTopic = await createFlashcard(db, subject.slug, {
        deckId: deck.id,
        type: 'basic',
        front: 'c',
        back: 'd',
      });
      const links = await db.select().from(taskFlashcards);
      expect(links).toHaveLength(1);
      expect(links[0]).toMatchObject({ taskId, flashcardId: withTopic.id, source: 'auto' });
      expect(links.some((l) => l.flashcardId === noTopic.id)).toBe(false);
    });

    it('changing the topic (update and bulk) moves auto links and keeps user links', async () => {
      const topicA = await seedTopic('a');
      const topicB = await seedTopic('b');
      const lessonA = await seedTask(topicA, '2099-01-01');
      const lessonB = await seedTask(topicB, '2099-01-02');
      const deck = await createDeck(db, subject.slug, 'Manuale');
      const mk = (front: string) =>
        createFlashcard(db, subject.slug, {
          deckId: deck.id,
          type: 'basic',
          front,
          back: 'b',
          topicId: topicA,
        });
      const viaUpdate = await mk('u');
      const viaBulk = await mk('b');
      const pinned = await mk('p');
      await updateTaskFlashcards(db, subject.slug, lessonA, { add: [pinned.id] });

      await updateFlashcard(db, subject.slug, viaUpdate.id, { topicId: topicB });
      await bulkFlashcards(db, subject.slug, {
        ids: [viaBulk.id, pinned.id],
        action: { type: 'topic', topicId: topicB },
      });

      const links = await db.select().from(taskFlashcards);
      const pairs = links.map((l) => `${l.taskId}:${l.flashcardId}:${l.source}`).sort();
      expect(pairs).toEqual(
        [
          `${lessonB}:${viaUpdate.id}:auto`,
          `${lessonB}:${viaBulk.id}:auto`,
          `${lessonA}:${pinned.id}:user`,
        ].sort(),
      );
    });
  });
});
