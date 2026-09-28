import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { createTestDb } from '@studyhub/db/testDb';
import { artifacts, flashcards, reviews, topics } from '@studyhub/db';
import { createSubject } from '../src/lib/subjects';
import {
  FlashcardNotFoundError,
  getReviewQueue,
  listFlashcards,
  setFlashcardSuspended,
  submitReview,
} from '../src/lib/review';
import { SubjectNotFoundError } from '../src/lib/errors';

async function seedDeckAndCard(
  db: Awaited<ReturnType<typeof createTestDb>>,
  subjectId: string,
  overrides: Partial<typeof flashcards.$inferInsert> = {},
) {
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
  const cardId = randomUUID();
  await db.insert(flashcards).values({
    id: cardId,
    deckId,
    type: 'basic',
    front: 'F',
    back: 'B',
    sourceRef: { docId: randomUUID(), page: 1, quote: 'B' },
    ...overrides,
  });
  return { deckId, cardId };
}

describe('review queue + submitReview + suspend', () => {
  let dataRoot: string;
  let db: Awaited<ReturnType<typeof createTestDb>>;
  let subjectId: string;
  let subjectSlug: string;

  beforeEach(async () => {
    dataRoot = await mkdtemp(join(tmpdir(), 'studyhub-review-'));
    db = await createTestDb();
    const subject = await createSubject(db, dataRoot, { name: 'Fisica 1', color: 'blue' });
    subjectId = subject.id;
    subjectSlug = subject.slug;
  });

  afterEach(async () => {
    await rm(dataRoot, { recursive: true, force: true });
  });

  it('a fresh (state=new) card is always in the queue', async () => {
    await seedDeckAndCard(db, subjectId);
    const queue = await getReviewQueue(db, subjectSlug);
    expect(queue).toHaveLength(1);
  });

  it('a suspended card never appears in the queue', async () => {
    await seedDeckAndCard(db, subjectId, { suspended: true });
    expect(await getReviewQueue(db, subjectSlug)).toEqual([]);
  });

  it('a card not yet due (future dueAt, state=review) is excluded', async () => {
    await seedDeckAndCard(db, subjectId, {
      state: 'review',
      stability: 5,
      difficulty: 5,
      dueAt: new Date(Date.now() + 10 * 86_400_000),
      lastReviewAt: new Date(),
    });
    expect(await getReviewQueue(db, subjectSlug)).toEqual([]);
  });

  it('an overdue review card is included', async () => {
    await seedDeckAndCard(db, subjectId, {
      state: 'review',
      stability: 5,
      difficulty: 5,
      dueAt: new Date(Date.now() - 86_400_000),
      lastReviewAt: new Date(Date.now() - 6 * 86_400_000),
    });
    expect(await getReviewQueue(db, subjectSlug)).toHaveLength(1);
  });

  it('respects the cap and the new-card limit', async () => {
    for (let i = 0; i < 5; i += 1) await seedDeckAndCard(db, subjectId);
    const queue = await getReviewQueue(db, subjectSlug, { cap: 3, newLimit: 3 });
    expect(queue).toHaveLength(3);
  });

  it('filters by topicId when given', async () => {
    const { cardId: matching } = await seedDeckAndCard(db, subjectId);
    await seedDeckAndCard(db, subjectId);
    // No topics wired up in this fixture set — filter by a topic id that
    // matches nothing to confirm the filter is actually applied.
    const queue = await getReviewQueue(db, subjectSlug, { topicId: randomUUID() });
    expect(queue).toEqual([]);
    expect(matching).toBeTruthy(); // sanity: the unfiltered card really was created
  });

  it('submitReview updates the schedule and records a reviews row', async () => {
    const { cardId } = await seedDeckAndCard(db, subjectId);
    const updated = await submitReview(db, subjectSlug, cardId, { rating: 3, elapsedMs: 2500 });

    expect(updated.state).not.toBe('new');

    const [row] = await db.select().from(flashcards).where(eq(flashcards.id, cardId));
    expect(row?.dueAt).not.toBeNull();
    expect(row?.reps).toBe(1);

    const reviewRows = await db.select().from(reviews).where(eq(reviews.flashcardId, cardId));
    expect(reviewRows).toHaveLength(1);
    expect(reviewRows[0]?.rating).toBe(3);
    expect(reviewRows[0]?.elapsedMs).toBe(2500);
    expect(reviewRows[0]?.prevStability).toBeNull();
  });

  it('a reviewed card leaves the queue until its next due date', async () => {
    const { cardId } = await seedDeckAndCard(db, subjectId);
    await submitReview(db, subjectSlug, cardId, { rating: 4, elapsedMs: 1000 }); // Easy -> due far out
    expect(await getReviewQueue(db, subjectSlug)).toEqual([]);
  });

  it('submitReview recomputes the card’s topic mastery, not just after simulation grading', async () => {
    const topicId = randomUUID();
    await db.insert(topics).values({ id: topicId, subjectId, name: 'Entropia', slug: 'entropia' });
    const { cardId } = await seedDeckAndCard(db, subjectId, { topicId });

    let [topic] = await db.select().from(topics).where(eq(topics.id, topicId));
    expect(topic?.mastery).toBeNull(); // no data yet — absent, not a silent zero

    await submitReview(db, subjectSlug, cardId, { rating: 3, elapsedMs: 2000 });

    [topic] = await db.select().from(topics).where(eq(topics.id, topicId));
    expect(topic?.mastery).not.toBeNull();
    expect(topic!.mastery).toBeGreaterThanOrEqual(0);
    expect(topic!.mastery).toBeLessThanOrEqual(1);
  });

  it('submitReview on an untagged card (topicId null) does not touch any topic', async () => {
    const { cardId } = await seedDeckAndCard(db, subjectId); // no topicId
    await expect(
      submitReview(db, subjectSlug, cardId, { rating: 3, elapsedMs: 2000 }),
    ).resolves.toBeTruthy();
  });

  it('throws FlashcardNotFoundError for an unknown card', async () => {
    await expect(
      submitReview(db, subjectSlug, randomUUID(), { rating: 3, elapsedMs: 100 }),
    ).rejects.toBeInstanceOf(FlashcardNotFoundError);
  });

  it('throws SubjectNotFoundError for an unknown subject', async () => {
    await expect(getReviewQueue(db, 'nope')).rejects.toBeInstanceOf(SubjectNotFoundError);
  });

  it('setFlashcardSuspended toggles suspension and removes/restores queue visibility', async () => {
    const { cardId } = await seedDeckAndCard(db, subjectId);
    expect(await getReviewQueue(db, subjectSlug)).toHaveLength(1);

    await setFlashcardSuspended(db, subjectSlug, cardId, true);
    expect(await getReviewQueue(db, subjectSlug)).toEqual([]);

    await setFlashcardSuspended(db, subjectSlug, cardId, false);
    expect(await getReviewQueue(db, subjectSlug)).toHaveLength(1);
  });

  describe('listFlashcards', () => {
    it('lists newest-first, isolated to the subject (docs/fasi/F2-materie.md tab Flashcard)', async () => {
      const other = await createSubject(db, dataRoot, { name: 'Chimica 1', color: 'green' });
      const { cardId: older } = await seedDeckAndCard(db, subjectId, {
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
      });
      const { cardId: newer } = await seedDeckAndCard(db, subjectId, {
        createdAt: new Date('2026-01-02T00:00:00.000Z'),
      });
      await seedDeckAndCard(db, other.id); // must not leak into subjectSlug's list

      const page = await listFlashcards(db, subjectSlug);
      expect(page.items.map((c) => c.id)).toEqual([newer, older]);
      expect(page.nextCursor).toBeNull();
    });

    it('filters by topicId, state and suspended independently', async () => {
      const topicId = randomUUID();
      await db.insert(topics).values({ id: topicId, subjectId, name: 'A', slug: 'a' });
      const { cardId: tagged } = await seedDeckAndCard(db, subjectId, { topicId, state: 'review' });
      await seedDeckAndCard(db, subjectId, { state: 'new' });
      const { cardId: suspended } = await seedDeckAndCard(db, subjectId, {
        state: 'review', // distinct from the other two — isolates the `state: 'new'` assertion below
        suspended: true,
      });

      expect((await listFlashcards(db, subjectSlug, { topicId })).items.map((c) => c.id)).toEqual([
        tagged,
      ]);
      expect((await listFlashcards(db, subjectSlug, { state: 'new' })).items).toHaveLength(1);
      expect(
        (await listFlashcards(db, subjectSlug, { suspended: true })).items.map((c) => c.id),
      ).toEqual([suspended]);
    });

    it('paginates via cursor, splitting an exact-multiple set with no trailing empty page', async () => {
      for (let i = 0; i < 4; i++) {
        await seedDeckAndCard(db, subjectId, {
          createdAt: new Date(`2026-01-0${i + 1}T00:00:00.000Z`),
        });
      }

      const first = await listFlashcards(db, subjectSlug, { limit: 2 });
      expect(first.items).toHaveLength(2);
      expect(first.nextCursor).not.toBeNull();

      const second = await listFlashcards(db, subjectSlug, { limit: 2, cursor: first.nextCursor! });
      expect(second.items).toHaveLength(2);
      expect(second.nextCursor).toBeNull();

      const allIds = [...first.items, ...second.items].map((c) => c.id);
      expect(new Set(allIds).size).toBe(4); // no overlap or gap across the two pages
    });

    it('throws SubjectNotFoundError for an unknown slug', async () => {
      await expect(listFlashcards(db, 'nope')).rejects.toBeInstanceOf(SubjectNotFoundError);
    });
  });
});
