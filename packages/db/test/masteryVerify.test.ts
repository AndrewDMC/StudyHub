import { describe, expect, it, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { createTestDb } from '../src/testDb.js';
import {
  documentTopics,
  documents,
  recomputeTopicMastery,
  sessionItems,
  studyPlans,
  studySessions,
  subjects,
  tasks,
  topics,
} from '../src/index.js';

type Db = Awaited<ReturnType<typeof createTestDb>>;

describe('mastery from verifications and lessons', () => {
  let db: Db;
  let subjectId: string;
  let topicId: string;
  let planId: string;

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
    planId = randomUUID();
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
      status: 'active',
    });
  });

  async function verifySession(prepared: boolean) {
    const id = randomUUID();
    await db.insert(studySessions).values({
      id,
      subjectId,
      topicIds: [topicId],
      documentIds: [],
      kind: 'verify',
      verifyPreparedAt: prepared ? new Date() : null,
    });
    return id;
  }

  async function addItem(
    sessionId: string,
    state: 'open' | 'correct' | 'wrong' | 'unknown',
    score?: number,
  ) {
    await db.insert(sessionItems).values({
      id: randomUUID(),
      sessionId,
      kind: 'exercise',
      orderIndex: 0,
      title: 'Domanda',
      body: 'Risposta',
      state,
      feedback:
        score === undefined
          ? null
          : {
              score,
              feedback: 'x',
              missing: [],
              model: 'fake',
              gradedAt: new Date().toISOString(),
            },
    });
  }

  it('answered verification questions are the accuracy (right 1, partial 0.5, wrong and unknown 0)', async () => {
    const s = await verifySession(true);
    await addItem(s, 'correct', 0.9);
    await addItem(s, 'correct', 0.8);
    await addItem(s, 'wrong', 0.55); // partial
    await addItem(s, 'unknown');
    await addItem(s, 'open'); // no outcome yet: not counted
    expect(await recomputeTopicMastery(db, topicId)).toBe(0.625);
    const [topic] = await db.select().from(topics).where(eq(topics.id, topicId));
    expect(topic?.mastery).toBe(0.625);
  });

  it('a retried question counts with its current outcome only', async () => {
    const s = await verifySession(true);
    await addItem(s, 'wrong', 0.1);
    expect(await recomputeTopicMastery(db, topicId)).toBe(0);
    await db.update(sessionItems).set({ state: 'correct' }).where(eq(sessionItems.sessionId, s));
    expect(await recomputeTopicMastery(db, topicId)).toBe(1);
    await db.update(sessionItems).set({ state: 'open' }).where(eq(sessionItems.sessionId, s));
    expect(await recomputeTopicMastery(db, topicId)).toBeNull();
  });

  it('a verification belongs to the topic of its task, not to whatever its scope lists', async () => {
    const otherTopic = randomUUID();
    await db
      .insert(topics)
      .values({ id: otherTopic, subjectId, name: 'Termodinamica', slug: 'termo' });
    const taskId = randomUUID();
    await db.insert(tasks).values({
      id: taskId,
      subjectId,
      planId,
      taskKey: 'rev:termo:02',
      date: '2026-01-05',
      kind: 'verify',
      topicId: otherTopic,
      minutes: 15,
      title: 'Verifica',
      description: '',
      payload: { action: 'verify', topicId: otherTopic },
      status: 'doing',
    });
    const s = randomUUID();
    await db.insert(studySessions).values({
      id: s,
      subjectId,
      taskId,
      topicIds: [topicId, otherTopic],
      documentIds: [],
      kind: 'verify',
      verifyPreparedAt: new Date(),
    });
    await addItem(s, 'correct', 1);
    expect(await recomputeTopicMastery(db, topicId)).toBeNull();
    expect(await recomputeTopicMastery(db, otherTopic)).toBe(1);
  });

  it('verifications from before the prepared questions do not count', async () => {
    const s = await verifySession(false);
    await addItem(s, 'correct', 1);
    expect(await recomputeTopicMastery(db, topicId)).toBeNull();
  });

  it('a done lesson task covers its pages like a read task', async () => {
    const docId = randomUUID();
    await db.insert(documents).values({
      id: docId,
      subjectId,
      type: 'appunti',
      originalName: 'doc.pdf',
      storedPath: '/x',
      mime: 'application/pdf',
      bytes: 1,
      sha256: 'a'.repeat(64),
      status: 'parsed',
      pages: 10,
    });
    await db.insert(documentTopics).values({ documentId: docId, topicId });
    const lesson = async (status: 'todo' | 'done') => {
      await db.insert(tasks).values({
        id: randomUUID(),
        subjectId,
        planId,
        taskKey: `lesson:${randomUUID().slice(0, 6)}`,
        date: '2026-01-05',
        kind: 'lesson',
        topicId,
        minutes: 45,
        title: 'Lezione',
        description: '',
        payload: {
          action: 'lesson',
          method: 'standard',
          topicId,
          material: [{ docId, pageFrom: 1, pageTo: 5 }],
        },
        status,
      });
    };
    await lesson('todo');
    expect(await recomputeTopicMastery(db, topicId)).toBe(0);
    await lesson('done');
    expect(await recomputeTopicMastery(db, topicId)).toBe(0.5);
  });
});
