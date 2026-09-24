import { describe, expect, it, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { createTestDb } from '../src/testDb.js';
import {
  artifacts,
  attemptItemResults,
  documentTopics,
  documents,
  flashcards,
  recomputeTopicMastery,
  simulationAttempts,
  simulationItems,
  studyPlans,
  subjects,
  tasks,
  topics,
} from '../src/index.js';

async function addParsedDoc(
  db: Awaited<ReturnType<typeof createTestDb>>,
  subjectId: string,
  pages: number,
) {
  const id = randomUUID();
  await db.insert(documents).values({
    id,
    subjectId,
    type: 'appunti',
    originalName: `doc-${id.slice(0, 4)}.pdf`,
    storedPath: '/irrelevant',
    mime: 'application/pdf',
    bytes: 10,
    sha256: 'a'.repeat(64),
    status: 'parsed',
    pages,
  });
  return id;
}

async function addPlan(db: Awaited<ReturnType<typeof createTestDb>>, subjectId: string) {
  const id = randomUUID();
  await db.insert(studyPlans).values({
    id,
    subjectId,
    startDate: '2026-01-05',
    targetDate: '2026-02-04',
    availability: { perWeekday: [0, 120, 120, 120, 120, 120, 0], blackoutDates: [] },
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
    promptVersion: 'estimate_topics/v1',
    status: 'active',
  });
  return id;
}

async function addReadTask(
  db: Awaited<ReturnType<typeof createTestDb>>,
  args: {
    subjectId: string;
    planId: string;
    topicId: string;
    material: { docId: string; pageFrom: number; pageTo: number }[];
    status?: 'todo' | 'doing' | 'done' | 'skipped' | 'moved';
  },
) {
  await db.insert(tasks).values({
    id: randomUUID(),
    subjectId: args.subjectId,
    planId: args.planId,
    taskKey: `read:${randomUUID().slice(0, 8)}`,
    date: '2026-01-05',
    kind: 'read',
    topicId: args.topicId,
    minutes: 30,
    title: 'Studia',
    description: '',
    payload: { action: 'read', material: args.material, topicId: args.topicId },
    status: args.status ?? 'done',
  });
}

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

  describe('coverage (fraction of the topic’s material actually read)', () => {
    it('is absent, not zero, when no document is tagged to the topic', async () => {
      const value = await recomputeTopicMastery(db, topicId);
      expect(value).toBeNull();
    });

    it('is a partial fraction when only some pages have a done read task', async () => {
      const docId = await addParsedDoc(db, subjectId, 20);
      await db.insert(documentTopics).values({ documentId: docId, topicId });
      const planId = await addPlan(db, subjectId);
      await addReadTask(db, {
        subjectId,
        planId,
        topicId,
        material: [{ docId, pageFrom: 1, pageTo: 10 }], // half the document
      });

      const value = await recomputeTopicMastery(db, topicId);
      expect(value).not.toBeNull();
      expect(value!).toBeCloseTo(0.5, 1); // coverage is the only component with data
    });

    it('ignores a read task that is not yet done', async () => {
      const docId = await addParsedDoc(db, subjectId, 20);
      await db.insert(documentTopics).values({ documentId: docId, topicId });
      const planId = await addPlan(db, subjectId);
      await addReadTask(db, {
        subjectId,
        planId,
        topicId,
        material: [{ docId, pageFrom: 1, pageTo: 20 }],
        status: 'todo',
      });

      const value = await recomputeTopicMastery(db, topicId);
      expect(value).toBe(0); // material assigned, none of it read yet — a real zero, not absent
    });

    it('clamps coverage at 100% even with overlapping done tasks from more than one plan generation', async () => {
      const docId = await addParsedDoc(db, subjectId, 10);
      await db.insert(documentTopics).values({ documentId: docId, topicId });
      const planA = await addPlan(db, subjectId);
      const planB = await addPlan(db, subjectId);
      await addReadTask(db, {
        subjectId,
        planId: planA,
        topicId,
        material: [{ docId, pageFrom: 1, pageTo: 10 }],
      });
      await addReadTask(db, {
        subjectId,
        planId: planB,
        topicId,
        material: [{ docId, pageFrom: 1, pageTo: 10 }],
      });

      const value = await recomputeTopicMastery(db, topicId);
      expect(value).toBe(1);
    });

    it('only counts a document toward the coverage of its primary (lowest orderIndex) topic', async () => {
      const secondaryTopicId = randomUUID();
      await db.insert(topics).values({
        id: secondaryTopicId,
        subjectId,
        name: 'Secondario',
        slug: 'secondario',
        orderIndex: 5,
      });
      const docId = await addParsedDoc(db, subjectId, 10);
      // topicId (orderIndex default 0) is primary; secondaryTopicId is not.
      await db.insert(documentTopics).values([
        { documentId: docId, topicId: secondaryTopicId },
        { documentId: docId, topicId },
      ]);
      const planId = await addPlan(db, subjectId);
      await addReadTask(db, {
        subjectId,
        planId,
        topicId,
        material: [{ docId, pageFrom: 1, pageTo: 10 }],
      });

      const primaryValue = await recomputeTopicMastery(db, topicId);
      expect(primaryValue).toBe(1);
      const secondaryValue = await recomputeTopicMastery(db, secondaryTopicId);
      expect(secondaryValue).toBeNull(); // no document is primarily tagged to it
    });
  });
});
