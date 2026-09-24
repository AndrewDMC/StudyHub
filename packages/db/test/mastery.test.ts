import { describe, expect, it, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { createTestDb } from '../src/testDb.js';
import {
  artifacts,
  attemptItemResults,
  flashcards,
  recomputeTopicMastery,
  simulationAttempts,
  simulationItems,
  subjects,
  topics,
} from '../src/index.js';

describe('recomputeTopicMastery', () => {
  let db: Awaited<ReturnType<typeof createTestDb>>;
  let subjectId: string;
  let topicId: string;

  beforeEach(async () => {
    db = await createTestDb();
    subjectId = randomUUID();
    await db.insert(subjects).values({
      id: subjectId,
      slug: 'fisica-1',
      name: 'Fisica 1',
      color: 'blue',
      folderPath: '/data/subjects/fisica-1',
    });
    topicId = randomUUID();
    await db.insert(topics).values({ id: topicId, subjectId, name: 'Entropia', slug: 'entropia' });
  });

  it('leaves mastery null when the topic has neither reviewed cards nor graded simulation items', async () => {
    const value = await recomputeTopicMastery(db, topicId);
    expect(value).toBeNull();
    const [topic] = await db.select().from(topics).where(eq(topics.id, topicId));
    expect(topic?.mastery).toBeNull();
  });

  it('combines flashcard retrievability and simulation accuracy when both exist (0.5/0.3 renormalized to 0.625/0.375)', async () => {
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
    // A just-reviewed card: retrievability ~1 right now.
    await db.insert(flashcards).values({
      id: randomUUID(),
      deckId,
      topicId,
      type: 'basic',
      front: 'F',
      back: 'B',
      sourceRef: { docId: randomUUID(), page: 1, quote: 'B' },
      state: 'review',
      stability: 10,
      difficulty: 5,
      reps: 1,
      dueAt: new Date(Date.now() + 10 * 86_400_000),
      lastReviewAt: new Date(),
    });

    const simId = randomUUID();
    await db.insert(artifacts).values({
      id: simId,
      subjectId,
      kind: 'simulation',
      title: 'Sim',
      path: '/y',
      model: 'fake-v1',
      promptVersion: 'simulation/v1',
    });
    const itemId = randomUUID();
    await db.insert(simulationItems).values({
      id: itemId,
      simulationId: simId,
      ord: 0,
      topicId,
      prompt: 'Enuncia il secondo principio.',
      kind: 'open',
      points: 10,
      expectedPoints: ['entropia'],
      rubric: [{ criterion: 'entropia', points: 10 }],
      solution: 'L’entropia non diminuisce mai.',
      sourceRef: { docId: randomUUID(), page: 1, quote: 'x' },
    });
    const attemptId = randomUUID();
    await db.insert(simulationAttempts).values({
      id: attemptId,
      simulationId: simId,
      status: 'graded',
      durationMin: 30,
    });
    await db.insert(attemptItemResults).values({
      id: randomUUID(),
      attemptId,
      itemId,
      awarded: 5,
      max: 10, // 50% accuracy
      criteria: [],
      missing: [],
      sourceRef: { docId: randomUUID(), page: 1, quote: 'x' },
    });

    const value = await recomputeTopicMastery(db, topicId);
    expect(value).not.toBeNull();
    // Retrievability dominates (0.5/0.8) and is near 1, accuracy (0.3/0.8) is 0.5 — expect > 0.5.
    expect(value!).toBeGreaterThan(0.5);
    expect(value!).toBeLessThanOrEqual(1);

    const [topic] = await db.select().from(topics).where(eq(topics.id, topicId));
    expect(topic?.mastery).toBe(value);
  });

  it('ignores suspended and never-reviewed (state=new) cards', async () => {
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
    await db.insert(flashcards).values([
      {
        id: randomUUID(),
        deckId,
        topicId,
        type: 'basic',
        front: 'new',
        back: 'B',
        sourceRef: { docId: randomUUID(), page: 1, quote: 'B' },
        state: 'new',
      },
      {
        id: randomUUID(),
        deckId,
        topicId,
        type: 'basic',
        front: 'suspended',
        back: 'B',
        sourceRef: { docId: randomUUID(), page: 1, quote: 'B' },
        state: 'review',
        stability: 10,
        difficulty: 5,
        reps: 1,
        suspended: true,
        dueAt: new Date(),
        lastReviewAt: new Date(),
      },
    ]);

    const value = await recomputeTopicMastery(db, topicId);
    expect(value).toBeNull(); // neither counts, so no data at all
  });
});
