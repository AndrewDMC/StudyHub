import { describe, expect, it, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { createTestDb } from '../src/testDb.js';
import {
  artifacts,
  attemptItemResults,
  chunks,
  documentTopics,
  documents,
  examProfiles,
  exams,
  flashcards,
  jobs,
  reviews,
  schemaEdges,
  schemaGroups,
  schemaNodes,
  settings,
  simulationAttempts,
  simulationItems,
  simulations,
  studyPlans,
  subjects,
  tasks,
  topics,
  transcriptionCorrections,
} from '../src/schema.js';

describe('subjects table', () => {
  let db: Awaited<ReturnType<typeof createTestDb>>;

  beforeEach(async () => {
    db = await createTestDb();
  });

  it('inserts and reads back a subject', async () => {
    const id = randomUUID();
    await db.insert(subjects).values({
      id,
      slug: 'fisica-1',
      name: 'Fisica 1',
      color: 'blue',
      folderPath: '/data/subjects/fisica-1',
    });

    const rows = await db.select().from(subjects).where(eq(subjects.id, id));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.slug).toBe('fisica-1');
    expect(rows[0]?.createdAt).toBeInstanceOf(Date);
  });

  it('enforces slug uniqueness', async () => {
    const values = {
      slug: 'fisica-1',
      name: 'Fisica 1',
      color: 'blue',
      folderPath: '/data/subjects/fisica-1',
    };
    await db.insert(subjects).values({ id: randomUUID(), ...values });
    await expect(db.insert(subjects).values({ id: randomUUID(), ...values })).rejects.toThrow();
  });

  it('renaming a subject does not change its folder_path or slug', async () => {
    const id = randomUUID();
    await db.insert(subjects).values({
      id,
      slug: 'fisica-1',
      name: 'Fisica 1',
      color: 'blue',
      folderPath: '/data/subjects/fisica-1',
    });

    await db.update(subjects).set({ name: 'Fisica Generale 1' }).where(eq(subjects.id, id));

    const [row] = await db.select().from(subjects).where(eq(subjects.id, id));
    expect(row?.name).toBe('Fisica Generale 1');
    expect(row?.slug).toBe('fisica-1');
    expect(row?.folderPath).toBe('/data/subjects/fisica-1');
  });
});

describe('jobs table', () => {
  let db: Awaited<ReturnType<typeof createTestDb>>;

  beforeEach(async () => {
    db = await createTestDb();
  });

  it('defaults status to queued and progress to 0', async () => {
    const id = randomUUID();
    await db.insert(jobs).values({ id, type: 'ping', input: {} });
    const [row] = await db.select().from(jobs).where(eq(jobs.id, id));
    expect(row?.status).toBe('queued');
    expect(row?.progressPct).toBe(0);
  });

  it('allows a job with no subjectId (global reconcile)', async () => {
    const id = randomUUID();
    await db.insert(jobs).values({ id, type: 'reconcile', input: {} });
    const [row] = await db.select().from(jobs).where(eq(jobs.id, id));
    expect(row?.subjectId).toBeNull();
  });

  it('cascades delete from subjects to jobs', async () => {
    const subjectId = randomUUID();
    await db.insert(subjects).values({
      id: subjectId,
      slug: 'fisica-1',
      name: 'Fisica 1',
      color: 'blue',
      folderPath: '/data/subjects/fisica-1',
    });
    const jobId = randomUUID();
    await db.insert(jobs).values({ id: jobId, type: 'reconcile', subjectId, input: {} });

    await db.delete(subjects).where(eq(subjects.id, subjectId));

    const rows = await db.select().from(jobs).where(eq(jobs.id, jobId));
    expect(rows).toHaveLength(0);
  });
});

describe('settings table', () => {
  it('stores arbitrary jsonb values keyed by string', async () => {
    const db = await createTestDb();
    await db.insert(settings).values({ key: 'model.default', value: { provider: 'anthropic' } });
    const [row] = await db.select().from(settings).where(eq(settings.key, 'model.default'));
    expect(row?.value).toEqual({ provider: 'anthropic' });
  });
});

describe('exams table', () => {
  let db: Awaited<ReturnType<typeof createTestDb>>;
  let subjectId: string;

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
  });

  it('defaults status to scheduled', async () => {
    const id = randomUUID();
    await db.insert(exams).values({
      id,
      subjectId,
      title: 'Scritto gennaio',
      kind: 'scritto',
      date: new Date('2026-01-15T09:00:00Z'),
    });
    const [row] = await db.select().from(exams).where(eq(exams.id, id));
    expect(row?.status).toBe('scheduled');
  });

  it('cascades delete from subjects to exams', async () => {
    const id = randomUUID();
    await db
      .insert(exams)
      .values({ id, subjectId, title: 'Orale', kind: 'orale', date: new Date() });
    await db.delete(subjects).where(eq(subjects.id, subjectId));
    expect(await db.select().from(exams).where(eq(exams.id, id))).toHaveLength(0);
  });
});

describe('topics table', () => {
  let db: Awaited<ReturnType<typeof createTestDb>>;
  let subjectId: string;

  beforeEach(async () => {
    db = await createTestDb();
    subjectId = randomUUID();
    await db.insert(subjects).values({
      id: subjectId,
      slug: 'analisi-1',
      name: 'Analisi 1',
      color: 'violet',
      folderPath: '/data/subjects/analisi-1',
    });
  });

  it('defaults source to user and mastery to null (no AI/FSRS data yet)', async () => {
    const id = randomUUID();
    await db.insert(topics).values({ id, subjectId, name: 'Limiti', slug: 'limiti' });
    const [row] = await db.select().from(topics).where(eq(topics.id, id));
    expect(row?.source).toBe('user');
    expect(row?.mastery).toBeNull();
  });

  it('supports a parent/child tree via self-referencing parent_id', async () => {
    const parentId = randomUUID();
    await db.insert(topics).values({ id: parentId, subjectId, name: 'Analisi', slug: 'analisi' });
    const childId = randomUUID();
    await db.insert(topics).values({
      id: childId,
      subjectId,
      parentId,
      name: 'Limiti',
      slug: 'limiti',
    });
    const [child] = await db.select().from(topics).where(eq(topics.id, childId));
    expect(child?.parentId).toBe(parentId);
  });

  it('cascades delete from a parent topic to its children', async () => {
    const parentId = randomUUID();
    await db.insert(topics).values({ id: parentId, subjectId, name: 'Analisi', slug: 'analisi' });
    const childId = randomUUID();
    await db
      .insert(topics)
      .values({ id: childId, subjectId, parentId, name: 'Limiti', slug: 'limiti' });

    await db.delete(topics).where(eq(topics.id, parentId));

    expect(await db.select().from(topics).where(eq(topics.id, childId))).toHaveLength(0);
  });
});

describe('artifacts and flashcards tables', () => {
  let db: Awaited<ReturnType<typeof createTestDb>>;
  let subjectId: string;

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
  });

  it('defaults artifact status to draft', async () => {
    const id = randomUUID();
    await db.insert(artifacts).values({
      id,
      subjectId,
      kind: 'flashcard_deck',
      title: 'Termodinamica',
      path: '/data/subjects/fisica-1/artifacts/flashcards/deck.json',
      model: 'fake-v1',
      promptVersion: 'flashcards/v1',
    });
    const [row] = await db.select().from(artifacts).where(eq(artifacts.id, id));
    expect(row?.status).toBe('draft');
  });

  it('stores a flashcard with its sourceRef and defaults FSRS state to new', async () => {
    const deckId = randomUUID();
    await db.insert(artifacts).values({
      id: deckId,
      subjectId,
      kind: 'flashcard_deck',
      title: 'Termodinamica',
      path: '/data/subjects/fisica-1/artifacts/flashcards/deck.json',
      model: 'fake-v1',
      promptVersion: 'flashcards/v1',
    });

    const cardId = randomUUID();
    const docId = randomUUID();
    await db.insert(flashcards).values({
      id: cardId,
      deckId,
      type: 'basic',
      front: "Cos'è l'entropia?",
      back: 'Una misura del disordine di un sistema.',
      sourceRef: { docId, page: 3, quote: 'entropia come misura del disordine' },
    });

    const [row] = await db.select().from(flashcards).where(eq(flashcards.id, cardId));
    expect(row?.state).toBe('new');
    expect(row?.suspended).toBe(false);
    expect(row?.sourceRef).toEqual({ docId, page: 3, quote: 'entropia come misura del disordine' });
    expect(row?.embedding).toBeNull(); // never set at generation time until semantic dedup runs
  });

  it('flashcards.embedding is null by default and round-trips a 384-dim vector once set (docs/fasi/F3-ai-core.md "Stato")', async () => {
    const deckId = randomUUID();
    await db.insert(artifacts).values({
      id: deckId,
      subjectId,
      kind: 'flashcard_deck',
      title: 'Termodinamica',
      path: '/x',
      model: 'fake-v1',
      promptVersion: 'flashcards/v1',
    });
    const cardId = randomUUID();
    await db.insert(flashcards).values({
      id: cardId,
      deckId,
      type: 'basic',
      front: "Cos'è l'entropia?",
      back: 'Una misura del disordine di un sistema.',
      sourceRef: { docId: randomUUID(), page: 1, quote: 'x' },
    });

    const vector = Array.from({ length: 384 }, (_, i) => i / 384);
    await db.update(flashcards).set({ embedding: vector }).where(eq(flashcards.id, cardId));

    const [row] = await db.select().from(flashcards).where(eq(flashcards.id, cardId));
    expect(row?.embedding).toHaveLength(384);
    expect(row?.embedding?.[0]).toBeCloseTo(0, 5);
    expect(row?.embedding?.[383]).toBeCloseTo(383 / 384, 5);
  });

  it('cascades delete from a deck (artifact) to its flashcards', async () => {
    const deckId = randomUUID();
    await db.insert(artifacts).values({
      id: deckId,
      subjectId,
      kind: 'flashcard_deck',
      title: 'X',
      path: '/x',
      model: 'fake-v1',
      promptVersion: 'v1',
    });
    const cardId = randomUUID();
    await db.insert(flashcards).values({
      id: cardId,
      deckId,
      type: 'basic',
      front: 'F',
      back: 'B',
      sourceRef: { docId: randomUUID(), page: 1, quote: 'x' },
    });

    await db.delete(artifacts).where(eq(artifacts.id, deckId));

    expect(await db.select().from(flashcards).where(eq(flashcards.id, cardId))).toHaveLength(0);
  });
});

describe('jobs table — cost and idempotency', () => {
  it('stores a cost breakdown and a job_key', async () => {
    const db = await createTestDb();
    const id = randomUUID();
    await db.insert(jobs).values({
      id,
      type: 'generate_flashcards',
      input: {},
      cost: { inputTokens: 1200, outputTokens: 400, eur: 0.012 },
      jobKey: 'abc123',
    });
    const [row] = await db.select().from(jobs).where(eq(jobs.id, id));
    expect(row?.cost).toEqual({ inputTokens: 1200, outputTokens: 400, eur: 0.012 });
    expect(row?.jobKey).toBe('abc123');
  });
});

describe('reviews table', () => {
  it('records one review row per flashcard rating and cascades on flashcard delete', async () => {
    const db = await createTestDb();
    const subjectId = randomUUID();
    await db.insert(subjects).values({
      id: subjectId,
      slug: 'fisica-1',
      name: 'Fisica 1',
      color: 'blue',
      folderPath: '/data/subjects/fisica-1',
    });
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
    });

    const reviewId = randomUUID();
    await db.insert(reviews).values({
      id: reviewId,
      flashcardId: cardId,
      rating: 3,
      elapsedMs: 4200,
      prevStability: null,
      newStability: 2.5,
    });

    const [row] = await db.select().from(reviews).where(eq(reviews.id, reviewId));
    expect(row?.rating).toBe(3);
    expect(row?.prevStability).toBeNull();

    await db.delete(flashcards).where(eq(flashcards.id, cardId));
    expect(await db.select().from(reviews).where(eq(reviews.id, reviewId))).toHaveLength(0);
  });
});

describe('F5 tables: exam profiles, simulations, attempts', () => {
  it('stores a profile (one per subject), a simulation with items, an attempt and its results; cascades from the artifact', async () => {
    const db = await createTestDb();
    const subjectId = randomUUID();
    await db.insert(subjects).values({
      id: subjectId,
      slug: 'fisica-1',
      name: 'Fisica 1',
      color: 'blue',
      folderPath: '/data/subjects/fisica-1',
    });

    const profile = {
      itemCount: 3,
      durationMin: 120,
      totalPoints: 30,
      kindDistribution: { open: 1 },
      avgMinutesPerItem: 40,
      verbosity: 'media' as const,
      recurringTopics: ['entropia'],
      notes: '',
    };
    await db.insert(examProfiles).values({
      id: randomUUID(),
      subjectId,
      sourceDocIds: [randomUUID()],
      profile,
      model: 'fake-v1',
      promptVersion: 'exam_profile/v1',
    });
    await expect(
      db.insert(examProfiles).values({
        id: randomUUID(),
        subjectId,
        sourceDocIds: [],
        profile,
        model: 'fake-v1',
        promptVersion: 'exam_profile/v1',
      }),
    ).rejects.toThrow(); // unique per subject

    const simId = randomUUID();
    await db.insert(artifacts).values({
      id: simId,
      subjectId,
      kind: 'simulation',
      title: 'Simulazione',
      path: '/x.json',
      model: 'fake-v1',
      promptVersion: 'simulation/v1',
    });
    await db
      .insert(simulations)
      .values({ artifactId: simId, mode: 'esame_completo', timeBudgetMin: 120, totalPoints: 30 });
    const itemId = randomUUID();
    await db.insert(simulationItems).values({
      id: itemId,
      simulationId: simId,
      ord: 0,
      prompt: 'Enuncia il secondo principio.',
      kind: 'open',
      points: 10,
      expectedPoints: ['entropia non diminuisce'],
      rubric: [{ criterion: 'Enunciato', points: 10 }],
      solution: "L'entropia non diminuisce.",
      sourceRef: { docId: randomUUID(), page: 3, quote: "L'entropia non diminuisce." },
    });

    const attemptId = randomUUID();
    await db
      .insert(simulationAttempts)
      .values({ id: attemptId, simulationId: simId, durationMin: 120 });
    const [attempt] = await db
      .select()
      .from(simulationAttempts)
      .where(eq(simulationAttempts.id, attemptId));
    expect(attempt?.status).toBe('in_progress');
    expect(attempt?.answers).toEqual({});

    await db.insert(attemptItemResults).values({
      id: randomUUID(),
      attemptId,
      itemId,
      awarded: 6,
      max: 10,
      criteria: [{ criterion: 'Enunciato', awarded: 6, max: 10, feedback: 'Parziale.' }],
      missing: [],
      sourceRef: { docId: randomUUID(), page: 3, quote: 'x' },
    });

    await db.delete(artifacts).where(eq(artifacts.id, simId));
    expect(await db.select().from(simulationItems)).toHaveLength(0);
    expect(await db.select().from(simulationAttempts)).toHaveLength(0);
    expect(await db.select().from(attemptItemResults)).toHaveLength(0);
    expect(await db.select().from(simulations)).toHaveLength(0);
  });
});

describe('F6 tables: study_plans, tasks', () => {
  async function subjectFixture(db: Awaited<ReturnType<typeof createTestDb>>) {
    const subjectId = randomUUID();
    await db.insert(subjects).values({
      id: subjectId,
      slug: 'fisica-1',
      name: 'Fisica 1',
      color: 'blue',
      folderPath: '/data/subjects/fisica-1',
    });
    return subjectId;
  }

  it('defaults a plan to draft and a task to proposed', async () => {
    const db = await createTestDb();
    const subjectId = await subjectFixture(db);
    const planId = randomUUID();
    await db.insert(studyPlans).values({
      id: planId,
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
    });
    const [plan] = await db.select().from(studyPlans).where(eq(studyPlans.id, planId));
    expect(plan?.status).toBe('draft');
    expect(plan?.committedAt).toBeNull();

    const taskId = randomUUID();
    await db.insert(tasks).values({
      id: taskId,
      subjectId,
      planId,
      taskKey: 'read:doc-1:001',
      date: '2026-01-05',
      kind: 'read',
      minutes: 50,
      title: 'Studia cap. 1',
      description: 'Sessione 1',
      payload: { action: 'read', material: [{ docId: 'doc-1', pageFrom: 1, pageTo: 10 }] },
    });
    const [task] = await db.select().from(tasks).where(eq(tasks.id, taskId));
    expect(task?.status).toBe('proposed');
    expect(task?.pinned).toBe(false);
    expect(task?.origin).toBe('planner');
  });

  it('cascades delete from a plan to its tasks, but not from a subject to other subjects’ plans', async () => {
    const db = await createTestDb();
    const subjectId = await subjectFixture(db);
    const planId = randomUUID();
    await db.insert(studyPlans).values({
      id: planId,
      subjectId,
      startDate: '2026-01-05',
      targetDate: '2026-01-10',
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
      promptVersion: 'estimate_topics/v1',
    });
    await db.insert(tasks).values({
      id: randomUUID(),
      subjectId,
      planId,
      taskKey: 'read:doc-1:001',
      date: '2026-01-05',
      kind: 'read',
      minutes: 50,
      title: 'x',
      description: 'x',
      payload: { action: 'read' },
    });

    await db.delete(studyPlans).where(eq(studyPlans.id, planId));
    expect(await db.select().from(tasks)).toHaveLength(0);
  });

  it('sets a task’s topicId to null when its linked topic is deleted, without deleting the task', async () => {
    const db = await createTestDb();
    const subjectId = await subjectFixture(db);
    const topicId = randomUUID();
    await db
      .insert(topics)
      .values({ id: topicId, subjectId, name: 'Termodinamica', slug: 'termodinamica' });
    const planId = randomUUID();
    await db.insert(studyPlans).values({
      id: planId,
      subjectId,
      startDate: '2026-01-05',
      targetDate: '2026-01-10',
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
      promptVersion: 'estimate_topics/v1',
    });
    const taskId = randomUUID();
    await db.insert(tasks).values({
      id: taskId,
      subjectId,
      planId,
      taskKey: 'read:t:001',
      topicId,
      date: '2026-01-05',
      kind: 'read',
      minutes: 50,
      title: 'x',
      description: 'x',
      payload: { action: 'read' },
    });

    await db.delete(topics).where(eq(topics.id, topicId));
    const [task] = await db.select().from(tasks).where(eq(tasks.id, taskId));
    expect(task).toBeDefined();
    expect(task?.topicId).toBeNull();
  });
});

describe('document_topics table', () => {
  async function fixture(db: Awaited<ReturnType<typeof createTestDb>>) {
    const subjectId = randomUUID();
    await db.insert(subjects).values({
      id: subjectId,
      slug: 'fisica-1',
      name: 'Fisica 1',
      color: 'blue',
      folderPath: '/data/subjects/fisica-1',
    });
    const documentId = randomUUID();
    await db.insert(documents).values({
      id: documentId,
      subjectId,
      type: 'appunti',
      originalName: 'lezione.pdf',
      storedPath: '/irrelevant',
      mime: 'application/pdf',
      bytes: 10,
      sha256: 'a'.repeat(64),
    });
    const topicId = randomUUID();
    await db
      .insert(topics)
      .values({ id: topicId, subjectId, name: 'Meccanica', slug: 'meccanica' });
    return { subjectId, documentId, topicId };
  }

  it('links a document to a topic, defaulting source to user', async () => {
    const db = await createTestDb();
    const { documentId, topicId } = await fixture(db);
    await db.insert(documentTopics).values({ documentId, topicId });

    const rows = await db.select().from(documentTopics);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ documentId, topicId, source: 'user', confidence: null });
  });

  it('rejects a duplicate link (composite primary key)', async () => {
    const db = await createTestDb();
    const { documentId, topicId } = await fixture(db);
    await db.insert(documentTopics).values({ documentId, topicId });
    await expect(db.insert(documentTopics).values({ documentId, topicId })).rejects.toThrow();
  });

  it('allows the same document linked to two different topics', async () => {
    const db = await createTestDb();
    const { documentId, topicId, subjectId } = await fixture(db);
    const topicId2 = randomUUID();
    await db
      .insert(topics)
      .values({ id: topicId2, subjectId, name: 'Termodinamica', slug: 'termodinamica' });
    await db.insert(documentTopics).values([
      { documentId, topicId },
      { documentId, topicId: topicId2 },
    ]);
    const rows = await db.select().from(documentTopics);
    expect(rows).toHaveLength(2);
  });

  it('cascades delete from either side: deleting the document removes the link, deleting the topic removes the link', async () => {
    const db = await createTestDb();
    const { documentId, topicId } = await fixture(db);
    await db.insert(documentTopics).values({ documentId, topicId });

    await db.delete(documents).where(eq(documents.id, documentId));
    expect(await db.select().from(documentTopics)).toHaveLength(0);
  });
});

describe('chunks table — pgvector embedding column', () => {
  async function fixtureDocument(db: Awaited<ReturnType<typeof createTestDb>>) {
    const subjectId = randomUUID();
    await db.insert(subjects).values({
      id: subjectId,
      slug: 'fisica-1',
      name: 'Fisica 1',
      color: 'blue',
      folderPath: '/data/subjects/fisica-1',
    });
    const documentId = randomUUID();
    await db.insert(documents).values({
      id: documentId,
      subjectId,
      type: 'appunti',
      originalName: 'lezione.pdf',
      storedPath: '/irrelevant',
      mime: 'application/pdf',
      bytes: 10,
      sha256: 'a'.repeat(64),
    });
    return { subjectId, documentId };
  }

  it('is null by default and round-trips a 384-dim vector once set', async () => {
    const db = await createTestDb();
    const { documentId } = await fixtureDocument(db);
    const chunkId = randomUUID();
    await db.insert(chunks).values({
      id: chunkId,
      documentId,
      pageFrom: 1,
      pageTo: 1,
      ord: 0,
      text: 'Il primo principio della termodinamica',
      tokens: 6,
    });

    const [beforeRow] = await db.select().from(chunks).where(eq(chunks.id, chunkId));
    expect(beforeRow?.embedding).toBeNull();

    const embedding = Array.from({ length: 384 }, (_, i) => i / 384);
    await db.update(chunks).set({ embedding }).where(eq(chunks.id, chunkId));

    const [afterRow] = await db.select().from(chunks).where(eq(chunks.id, chunkId));
    expect(afterRow?.embedding).toHaveLength(384);
    expect(afterRow?.embedding?.[1]).toBeCloseTo(1 / 384, 5);
  });
});

describe('schema graph tables (schema_nodes/schema_edges/schema_groups/transcription_corrections)', () => {
  async function fixtureDocument(db: Awaited<ReturnType<typeof createTestDb>>) {
    const subjectId = randomUUID();
    await db.insert(subjects).values({
      id: subjectId,
      slug: 'fisica-1',
      name: 'Fisica 1',
      color: 'blue',
      folderPath: '/data/subjects/fisica-1',
    });
    const documentId = randomUUID();
    await db.insert(documents).values({
      id: documentId,
      subjectId,
      type: 'schemi',
      originalName: 'schema.jpg',
      storedPath: '/irrelevant',
      mime: 'image/jpeg',
      bytes: 10,
      sha256: 'b'.repeat(64),
    });
    return { subjectId, documentId };
  }

  it('stores nodes, edges and groups for a document and cascades on delete', async () => {
    const db = await createTestDb();
    const { documentId } = await fixtureDocument(db);

    await db.insert(schemaNodes).values([
      {
        id: randomUUID(),
        documentId,
        nodeKey: 'n1',
        label: 'Primo principio',
        kind: 'principio',
        confidence: 'ok',
      },
      {
        id: randomUUID(),
        documentId,
        nodeKey: 'n2',
        label: 'Trasf. adiabatica',
        kind: 'caso',
        confidence: 'uncertain',
      },
    ]);
    await db.insert(schemaEdges).values({
      id: randomUUID(),
      documentId,
      fromNode: 'n1',
      toNode: 'n2',
      type: 'implica',
    });
    await db.insert(schemaGroups).values({
      id: randomUUID(),
      documentId,
      groupKey: 'g1',
      label: 'Trasformazioni',
      nodeKeys: ['n2'],
    });

    expect(await db.select().from(schemaNodes)).toHaveLength(2);
    expect(await db.select().from(schemaEdges)).toHaveLength(1);
    expect(await db.select().from(schemaGroups)).toHaveLength(1);

    await db.delete(documents).where(eq(documents.id, documentId));
    expect(await db.select().from(schemaNodes)).toHaveLength(0);
    expect(await db.select().from(schemaEdges)).toHaveLength(0);
    expect(await db.select().from(schemaGroups)).toHaveLength(0);
  });

  it('records a correction and cascades on document delete', async () => {
    const db = await createTestDb();
    const { documentId } = await fixtureDocument(db);
    await db.insert(transcriptionCorrections).values({
      id: randomUUID(),
      documentId,
      nodeKey: 'n1',
      before: 'Trasf adiabbatica',
      after: 'Trasf. adiabatica',
      kind: 'label',
    });

    expect(await db.select().from(transcriptionCorrections)).toHaveLength(1);
    await db.delete(documents).where(eq(documents.id, documentId));
    expect(await db.select().from(transcriptionCorrections)).toHaveLength(0);
  });
});
