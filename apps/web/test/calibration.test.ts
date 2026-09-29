import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { createTestDb } from '@studyhub/db/testDb';
import { artifacts, flashcards, reviews, topics } from '@studyhub/db';
import { createSubject } from '../src/lib/subjects';
import { submitReview } from '../src/lib/review';
import { getCalibration } from '../src/lib/calibration';
import { SubjectNotFoundError } from '../src/lib/errors';

describe('confidence calibration', () => {
  let dataRoot: string;
  let db: Awaited<ReturnType<typeof createTestDb>>;
  let subjectId: string;
  let slug: string;
  let deckId: string;

  beforeEach(async () => {
    dataRoot = await mkdtemp(join(tmpdir(), 'studyhub-calibration-'));
    db = await createTestDb();
    const subject = await createSubject(db, dataRoot, { name: 'Fisica 1', color: 'blue' });
    subjectId = subject.id;
    slug = subject.slug;
    deckId = randomUUID();
    await db.insert(artifacts).values({
      id: deckId,
      subjectId,
      kind: 'flashcard_deck',
      title: 'Deck',
      path: '/d.json',
      model: 'fake-v1',
      promptVersion: 'flashcards/v1',
    });
  });
  afterEach(async () => {
    await rm(dataRoot, { recursive: true, force: true });
  });

  async function addCard(topicId: string | null = null) {
    const id = randomUUID();
    await db.insert(flashcards).values({
      id,
      deckId,
      topicId,
      type: 'basic',
      front: 'Q',
      back: 'A',
      sourceRef: { docId: randomUUID(), page: 1, quote: 'q' },
    });
    return id;
  }

  /** Inserts review rows directly: the aggregation is what's under test, not FSRS. */
  async function addReviews(
    cardId: string,
    confidence: 1 | 2 | 3 | null,
    ratings: (1 | 2 | 3 | 4)[],
  ) {
    for (const rating of ratings)
      await db.insert(reviews).values({
        id: randomUUID(),
        flashcardId: cardId,
        rating,
        elapsedMs: 1000,
        newStability: 1,
        confidence,
      });
  }

  it('submitReview stores the declared confidence, and null when none was declared', async () => {
    const withConf = await addCard();
    const without = await addCard();
    await submitReview(db, slug, withConf, { rating: 3, elapsedMs: 900, confidence: 2 });
    await submitReview(db, slug, without, { rating: 3, elapsedMs: 900 });

    const [a] = await db.select().from(reviews).where(eq(reviews.flashcardId, withConf));
    const [b] = await db.select().from(reviews).where(eq(reviews.flashcardId, without));
    expect(a!.confidence).toBe(2);
    expect(b!.confidence).toBeNull();
  });

  it('the database itself rejects a confidence outside 1..3', async () => {
    const card = await addCard();
    await expect(
      db.insert(reviews).values({
        id: randomUUID(),
        flashcardId: card,
        rating: 3,
        elapsedMs: 1,
        newStability: 1,
        confidence: 4,
      }),
    ).rejects.toThrow();
  });

  it('is empty until the user has declared a confidence, and ignores reviews without one', async () => {
    const card = await addCard();
    await addReviews(card, null, [1, 3, 4, 3, 3, 1, 3]);
    const c = await getCalibration(db, slug);
    expect(c.total).toBe(0);
    expect(c.verdict).toBe('insufficient_data');
  });

  it('counts a review as correct unless it was Again (Hard is a pass)', async () => {
    const card = await addCard();
    await addReviews(card, 3, [1, 2, 3, 4]);
    const level3 = (await getCalibration(db, slug)).levels[2]!;
    expect(level3).toMatchObject({ total: 4, correct: 3 });
  });

  it('flags overconfidence and names the topic where sure answers keep failing', async () => {
    const t = randomUUID();
    await db.insert(topics).values({ id: t, subjectId, name: 'Entropia', slug: 'entropia' });
    const sureAndWrong = await addCard(t);
    await addReviews(sureAndWrong, 3, [1, 1, 1, 3, 1, 1]); // 5 wrong out of 6, all "lo so"
    const other = await addCard();
    await addReviews(other, 2, [1, 1, 3, 1]);

    const c = await getCalibration(db, slug);
    expect(c.verdict).toBe('overconfident');
    expect(c.illusionRate).toBeCloseTo(5 / 6);
    expect(c.illusionByTopic).toEqual([
      { topicId: t, name: 'Entropia', sure: 6, sureButWrong: 5, illusionRate: 5 / 6 },
    ]);
  });

  it('only counts this subject', async () => {
    const other = await createSubject(db, dataRoot, { name: 'Chimica', color: 'green' });
    const otherDeck = randomUUID();
    await db.insert(artifacts).values({
      id: otherDeck,
      subjectId: other.id,
      kind: 'flashcard_deck',
      title: 'Altro',
      path: '/o.json',
      model: 'fake-v1',
      promptVersion: 'flashcards/v1',
    });
    const foreignCard = randomUUID();
    await db.insert(flashcards).values({
      id: foreignCard,
      deckId: otherDeck,
      type: 'basic',
      front: 'Q',
      back: 'A',
      sourceRef: { docId: randomUUID(), page: 1, quote: 'q' },
    });
    await addReviews(foreignCard, 3, [1, 1, 1, 1, 1, 1]);
    expect((await getCalibration(db, slug)).total).toBe(0);
    await expect(getCalibration(db, 'non-esiste')).rejects.toBeInstanceOf(SubjectNotFoundError);
  });
});
