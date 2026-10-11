import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { createTestDb } from '@studyhub/db/testDb';
import { artifacts, exams, flashcards, reviews, subjects, topics } from '@studyhub/db';
import { createSubject } from '../src/lib/subjects';
import {
  getQuickReviewQueue,
  getReviewOverview,
  getReviewQueue,
  ReviewNotFoundError,
  ReviewNotUndoableError,
  submitReview,
  undoReview,
} from '../src/lib/review';
import { getDashboardSummary } from '../src/lib/dashboard';

type Db = Awaited<ReturnType<typeof createTestDb>>;

const NOW = new Date('2026-10-11T12:00:00.000Z');
const HOUR = 3_600_000;

async function seedDeck(db: Db, subjectId: string) {
  const deckId = randomUUID();
  await db.insert(artifacts).values({
    id: deckId,
    subjectId,
    kind: 'flashcard_deck',
    title: 'Deck',
    path: '/x',
    model: 'fake-v1',
    promptVersion: 'flashcards/v1',
  });
  return deckId;
}

let order = 0;
async function seedCard(
  db: Db,
  deckId: string,
  overrides: Partial<typeof flashcards.$inferInsert> = {},
) {
  const id = randomUUID();
  order += 1;
  await db.insert(flashcards).values({
    id,
    deckId,
    type: 'basic',
    front: `F${order}`,
    back: 'B',
    sourceRef: null,
    createdAt: new Date(Date.UTC(2026, 0, 1, 0, order)),
    ...overrides,
  });
  return id;
}

const reviewed = (lastReviewAt: Date, dueAt: Date) => ({
  state: 'review' as const,
  stability: 3,
  difficulty: 5,
  reps: 2,
  lastReviewAt,
  dueAt,
});

describe('Ripasso rapido backend (docs/09-ripasso-mobile.md §B)', () => {
  let dataRoot: string;
  let db: Db;
  let a: { id: string; slug: string };
  let b: { id: string; slug: string };
  let deckA: string;
  let deckB: string;

  beforeEach(async () => {
    dataRoot = await mkdtemp(join(tmpdir(), 'studyhub-quick-review-'));
    db = await createTestDb();
    a = await createSubject(db, dataRoot, { name: 'Analisi 2', color: 'blue' });
    b = await createSubject(db, dataRoot, { name: 'Fisica', color: 'green' });
    deckA = await seedDeck(db, a.id);
    deckB = await seedDeck(db, b.id);
  });

  afterEach(async () => {
    await rm(dataRoot, { recursive: true, force: true });
  });

  describe('queue', () => {
    it('spans every subject round-robin, and carries subject, topic and intervals', async () => {
      const topicId = randomUUID();
      await db
        .insert(topics)
        .values({ id: topicId, subjectId: a.id, name: 'Serie', slug: 'serie' });
      await seedCard(db, deckA, { topicId });
      await seedCard(db, deckA);
      await seedCard(db, deckA);
      await seedCard(db, deckB);
      await seedCard(db, deckB);

      const queue = await getQuickReviewQueue(db, {}, { now: NOW });
      expect(queue.map((q) => q.subjectSlug)).toEqual([a.slug, b.slug, a.slug, b.slug, a.slug]);
      expect(queue[0]).toMatchObject({
        subjectName: 'Analisi 2',
        subjectColor: 'blue',
        topicName: 'Serie',
      });
      expect(queue[0]!.intervals[1]).toBeLessThan(queue[0]!.intervals[4]);

      expect(await getQuickReviewQueue(db, {}, { n: 3, now: NOW })).toHaveLength(3);
    });

    it('leaves out flagged and suspended cards, and archived subjects unless asked for', async () => {
      await seedCard(db, deckA, { flaggedAt: NOW });
      await seedCard(db, deckA, { suspended: true });
      await seedCard(db, deckB);
      expect(await getQuickReviewQueue(db, {}, { now: NOW })).toHaveLength(1);

      await db.update(subjects).set({ archivedAt: NOW }).where(eq(subjects.id, b.id));
      expect(await getQuickReviewQueue(db, {}, { now: NOW })).toEqual([]);
      expect(await getQuickReviewQueue(db, { subjectSlug: b.slug }, { now: NOW })).toHaveLength(1);
    });

    it('narrows to one topic, or to the cards without a topic', async () => {
      const topicId = randomUUID();
      await db
        .insert(topics)
        .values({ id: topicId, subjectId: a.id, name: 'Serie', slug: 'serie' });
      const tagged = await seedCard(db, deckA, { topicId });
      const untagged = await seedCard(db, deckA);

      const byTopic = await getQuickReviewQueue(db, { subjectSlug: a.slug, topicId }, { now: NOW });
      expect(byTopic.map((q) => q.id)).toEqual([tagged]);
      const none = await getQuickReviewQueue(
        db,
        { subjectSlug: a.slug, topicId: null },
        { now: NOW },
      );
      expect(none.map((q) => q.id)).toEqual([untagged]);
    });

    it('serves review cards due later today, but learning steps only once they are due', async () => {
      const laterToday = await seedCard(
        db,
        deckA,
        reviewed(new Date(NOW.getTime() - 72 * HOUR), new Date(NOW.getTime() + 6 * HOUR)),
      );
      await seedCard(db, deckA, {
        state: 'learning',
        stability: 1,
        difficulty: 5,
        reps: 1,
        lastReviewAt: NOW,
        dueAt: new Date(NOW.getTime() + 0.2 * HOUR),
      });
      await seedCard(db, deckA, reviewed(NOW, new Date(NOW.getTime() + 24 * HOUR)));

      const queue = await getReviewQueue(db, a.slug, { now: NOW });
      expect(queue.map((q) => q.id)).toEqual([laterToday]);
    });
  });

  describe('overview', () => {
    it('counts exactly what each row starts, with the new-card limit per queue', async () => {
      const topicId = randomUUID();
      await db.insert(topics).values({
        id: topicId,
        subjectId: a.id,
        name: 'Serie',
        slug: 'serie',
        mastery: 0.4,
      });
      for (let i = 0; i < 22; i += 1) await seedCard(db, deckA, { topicId });
      await seedCard(db, deckA);
      await seedCard(db, deckA, { flaggedAt: NOW });
      await seedCard(db, deckB, reviewed(NOW, new Date('2026-10-20T08:00:00.000Z')));
      await db.insert(exams).values({
        id: randomUUID(),
        subjectId: a.id,
        title: 'Scritto',
        kind: 'scritto',
        date: new Date('2026-10-21T09:00:00.000Z'),
      });

      const overview = await getReviewOverview(db, NOW);
      const [sa, sb] = overview.subjects;
      expect(sa).toMatchObject({ slug: a.slug, due: 20, cardCount: 23 });
      expect(sa!.nextExam).toEqual({ title: 'Scritto', date: '2026-10-21T09:00:00.000Z' });
      expect(sa!.topics).toEqual([
        { id: topicId, name: 'Serie', mastery: 0.4, due: 20, cardCount: 22 },
        { id: null, name: 'Senza argomento', mastery: null, due: 1, cardCount: 1 },
      ]);
      expect(sb).toMatchObject({ slug: b.slug, due: 0, cardCount: 1, nextExam: null });
      expect(sb!.topics).toEqual([
        { id: null, name: 'Senza argomento', mastery: null, due: 0, cardCount: 1 },
      ]);
      expect(overview).toMatchObject({
        totalDue: 20,
        totalCards: 24,
        nextDueAt: '2026-10-20T08:00:00.000Z',
      });

      // Coherent with the queues the rows start.
      expect(await getQuickReviewQueue(db, {}, { now: NOW })).toHaveLength(overview.totalDue);
      expect(
        await getQuickReviewQueue(db, { subjectSlug: a.slug, topicId }, { now: NOW }),
      ).toHaveLength(20);
      expect(
        await getQuickReviewQueue(db, { subjectSlug: a.slug, topicId: null }, { now: NOW }),
      ).toHaveLength(1);
    });

    it('drives the Dashboard count too, so flagged cards are no longer counted there', async () => {
      await seedCard(db, deckA);
      await seedCard(db, deckA, { flaggedAt: new Date() });
      const today = new Date().toISOString().slice(0, 10);
      const summary = await getDashboardSummary(db, today);
      expect(summary.dueCardsCount).toBe(1);
      expect(summary.subjects.find((s) => s.slug === a.slug)?.dueCardsCount).toBe(1);
    });
  });

  describe('undo', () => {
    it('puts the card back exactly as it was and forgets the review', async () => {
      const cardId = await seedCard(db, deckA, {
        state: 'review',
        stability: 4.5,
        difficulty: 6.1,
        reps: 3,
        lapses: 1,
        lastReviewAt: new Date('2026-10-06T10:00:00.000Z'),
        dueAt: new Date('2026-10-10T10:00:00.000Z'),
      });
      const pick = async () => {
        const [r] = await db.select().from(flashcards).where(eq(flashcards.id, cardId));
        return {
          stability: r!.stability,
          difficulty: r!.difficulty,
          dueAt: r!.dueAt,
          lastReviewAt: r!.lastReviewAt,
          reps: r!.reps,
          lapses: r!.lapses,
          state: r!.state,
        };
      };
      const before = await pick();

      const { reviewId } = await submitReview(
        db,
        a.slug,
        cardId,
        { rating: 1, elapsedMs: 4000 },
        NOW,
      );
      expect((await pick()).lapses).toBe(2);
      const restored = await undoReview(db, reviewId);

      expect(await pick()).toEqual(before);
      expect(restored.state).toBe('review');
      expect(await db.select().from(reviews).where(eq(reviews.flashcardId, cardId))).toEqual([]);
    });

    it('brings a new card back to new, and into the queue', async () => {
      const cardId = await seedCard(db, deckA);
      const { reviewId } = await submitReview(
        db,
        a.slug,
        cardId,
        { rating: 4, elapsedMs: 900 },
        NOW,
      );
      expect(await getReviewQueue(db, a.slug, { now: NOW })).toEqual([]);

      await undoReview(db, reviewId);
      const queue = await getReviewQueue(db, a.slug, { now: NOW });
      expect(queue.map((q) => q.id)).toEqual([cardId]);
      expect(queue[0]!.state).toBe('new');
    });

    it('only allows the card’s latest review, never one recorded without a snapshot', async () => {
      const cardId = await seedCard(db, deckA);
      const first = await submitReview(db, a.slug, cardId, { rating: 1, elapsedMs: 900 }, NOW);
      await submitReview(
        db,
        a.slug,
        cardId,
        { rating: 3, elapsedMs: 900 },
        new Date(NOW.getTime() + 60_000),
      );
      await expect(undoReview(db, first.reviewId)).rejects.toBeInstanceOf(ReviewNotUndoableError);

      const legacyCard = await seedCard(db, deckA);
      const legacyId = randomUUID();
      await db.insert(reviews).values({
        id: legacyId,
        flashcardId: legacyCard,
        rating: 3,
        elapsedMs: 1000,
        newStability: 2,
      });
      await expect(undoReview(db, legacyId)).rejects.toBeInstanceOf(ReviewNotUndoableError);

      await expect(undoReview(db, randomUUID())).rejects.toBeInstanceOf(ReviewNotFoundError);
    });
  });
});
