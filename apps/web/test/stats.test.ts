import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { artifacts, exams, flashcards, reviews, topics } from '@studyhub/db';
import { createTestDb } from '@studyhub/db/testDb';
import { createSubject } from '../src/lib/subjects';
import { getFlashcardStats } from '../src/lib/stats';
import { SubjectNotFoundError } from '../src/lib/errors';

async function seedDeck(db: Awaited<ReturnType<typeof createTestDb>>, subjectId: string) {
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

describe('getFlashcardStats', () => {
  let dataRoot: string;
  let db: Awaited<ReturnType<typeof createTestDb>>;
  let subjectId: string;
  let subjectSlug: string;

  beforeEach(async () => {
    dataRoot = await mkdtemp(join(tmpdir(), 'studyhub-stats-'));
    db = await createTestDb();
    const subject = await createSubject(db, dataRoot, { name: 'Fisica 1', color: 'blue' });
    subjectId = subject.id;
    subjectSlug = subject.slug;
  });

  afterEach(async () => {
    await rm(dataRoot, { recursive: true, force: true });
  });

  it('counts cards by state, keeping suspended cards separate', async () => {
    const deckId = await seedDeck(db, subjectId);
    await db.insert(flashcards).values([
      {
        id: randomUUID(),
        deckId,
        type: 'basic',
        front: 'a',
        back: 'a',
        sourceRef: { docId: randomUUID(), page: 1, quote: 'a' },
      },
      {
        id: randomUUID(),
        deckId,
        type: 'basic',
        front: 'b',
        back: 'b',
        sourceRef: { docId: randomUUID(), page: 1, quote: 'b' },
      },
      {
        id: randomUUID(),
        deckId,
        type: 'basic',
        front: 'c',
        back: 'c',
        sourceRef: { docId: randomUUID(), page: 1, quote: 'c' },
        suspended: true,
      },
    ]);

    const stats = await getFlashcardStats(db, subjectSlug);
    expect(stats.countsByState.new).toBe(2);
    expect(stats.suspendedCount).toBe(1);
  });

  it('returns a 30-entry forecast', async () => {
    const stats = await getFlashcardStats(db, subjectSlug);
    expect(stats.forecast).toHaveLength(30);
  });

  it('is null for atRiskForNextExam when there is no upcoming exam', async () => {
    const stats = await getFlashcardStats(db, subjectSlug);
    expect(stats.atRiskForNextExam).toBeNull();
  });

  it('reports at-risk cards against the soonest upcoming exam', async () => {
    const deckId = await seedDeck(db, subjectId);
    const cardId = randomUUID();
    // A card reviewed with a weak rating long ago -> low stability -> at risk far in the future.
    await db.insert(flashcards).values({
      id: cardId,
      deckId,
      type: 'basic',
      front: 'x',
      back: 'x',
      sourceRef: { docId: randomUUID(), page: 1, quote: 'x' },
      state: 'review',
      stability: 1,
      difficulty: 5,
      dueAt: new Date(Date.now() + 86_400_000),
      lastReviewAt: new Date(),
      reps: 1,
    });
    await db.insert(exams).values({
      id: randomUUID(),
      subjectId,
      title: 'Scritto',
      kind: 'scritto',
      date: new Date(Date.now() + 365 * 86_400_000),
    });

    const stats = await getFlashcardStats(db, subjectSlug);
    expect(stats.atRiskForNextExam).not.toBeNull();
    expect(stats.atRiskForNextExam?.examTitle).toBe('Scritto');
    expect(stats.atRiskForNextExam?.atRiskCount).toBe(1);
    expect(stats.atRiskForNextExam?.totalCount).toBe(1);
  });

  it('throws SubjectNotFoundError for an unknown subject', async () => {
    await expect(getFlashcardStats(db, 'nope')).rejects.toBeInstanceOf(SubjectNotFoundError);
  });

  const card = (deckId: string, over: Partial<typeof flashcards.$inferInsert> = {}) => ({
    id: randomUUID(),
    deckId,
    type: 'basic' as const,
    front: 'f',
    back: 'b',
    sourceRef: null,
    ...over,
  });

  it('leaves flagged cards out of the counts, forecast and exam risk, and reports them apart', async () => {
    const deckId = await seedDeck(db, subjectId);
    await db.insert(flashcards).values([card(deckId), card(deckId, { flaggedAt: new Date() })]);

    const stats = await getFlashcardStats(db, subjectSlug);
    expect(stats.countsByState.new).toBe(1);
    expect(stats.flaggedCount).toBe(1);
    expect(stats.forecast[0]!.count).toBe(1);
  });

  it('builds the mastery heatmap: every topic, stored mastery, live card count', async () => {
    const deckId = await seedDeck(db, subjectId);
    const cinematica = randomUUID();
    const dinamica = randomUUID();
    await db.insert(topics).values([
      { id: cinematica, subjectId, name: 'Cinematica', slug: 'cinematica', mastery: 0.8 },
      { id: dinamica, subjectId, name: 'Dinamica', slug: 'dinamica' },
    ]);
    await db
      .insert(flashcards)
      .values([
        card(deckId, { topicId: cinematica }),
        card(deckId, { topicId: cinematica }),
        card(deckId, { topicId: cinematica, suspended: true }),
      ]);

    const { topicMastery } = await getFlashcardStats(db, subjectSlug);
    expect(topicMastery.find((t) => t.name === 'Cinematica')).toMatchObject({
      mastery: 0.8,
      cardCount: 2,
    });
    expect(topicMastery.find((t) => t.name === 'Dinamica')).toMatchObject({
      mastery: null,
      cardCount: 0,
    });
  });

  it('derives real-vs-predicted retention from the review log, per card history', async () => {
    const deckId = await seedDeck(db, subjectId);
    const c1 = card(deckId);
    const c2 = card(deckId);
    await db.insert(flashcards).values([c1, c2]);

    const day = 86_400_000;
    const t0 = new Date('2026-01-01T00:00:00.000Z').getTime();
    const review = (cardId: string, offsetDays: number, rating: number, prev: number | null) => ({
      id: randomUUID(),
      flashcardId: cardId,
      rating,
      elapsedMs: 3000,
      reviewedAt: new Date(t0 + offsetDays * day),
      prevStability: prev,
      newStability: 10,
    });
    await db.insert(reviews).values([
      // c1: first review (no sample), then recalled after 1 day, then forgotten after 60 days.
      review(c1.id, 0, 3, null),
      review(c1.id, 1, 3, 10),
      review(c1.id, 61, 1, 10),
      // c2: first review, then recalled after 2 days. Interleaved on purpose.
      review(c2.id, 0, 3, null),
      review(c2.id, 2, 4, 10),
    ]);

    const { retention } = await getFlashcardStats(db, subjectSlug);
    expect(retention.sampleCount).toBe(3);
    const total = retention.buckets.reduce((n, b) => n + b.count, 0);
    expect(total).toBe(3);
    // The 60-day gap is the low-predicted bucket and was forgotten; the other two were recalled.
    const low = retention.buckets[0]!;
    const high = retention.buckets[retention.buckets.length - 1]!;
    expect(low.actual).toBe(0);
    expect(low.predicted).toBeLessThan(high.predicted);
    expect(high.actual).toBe(1);
  });

  it('retention is empty with no review history', async () => {
    const { retention } = await getFlashcardStats(db, subjectSlug);
    expect(retention).toEqual({ sampleCount: 0, buckets: [] });
  });
});
