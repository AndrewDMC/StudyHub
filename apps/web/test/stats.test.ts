import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { artifacts, exams, flashcards } from '@studyhub/db';
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
});
