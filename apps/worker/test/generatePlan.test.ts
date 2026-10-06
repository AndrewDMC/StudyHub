import { describe, expect, it, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { createTestDb } from '@studyhub/db/testDb';
import {
  artifacts,
  calendarEvents,
  chunks,
  documentTopics,
  documents,
  exams,
  flashcards,
  studyPlans,
  studySessions,
  subjects,
  tasks,
  topics,
} from '@studyhub/db';
import { FakeProvider } from '@studyhub/ai';
import { processGeneratePlan } from '../src/processors/planner/generatePlan.js';

const SAMPLE_TEXT =
  "L'entropia di un sistema isolato non diminuisce mai. Il secondo principio della termodinamica lo formalizza. Boltzmann la collegò al disordine microscopico.";

describe('processGeneratePlan', () => {
  let db: Awaited<ReturnType<typeof createTestDb>>;
  let subjectId: string;

  const baseInput = () => ({
    subjectId,
    startDate: '2026-01-05',
    targetDate: '2026-02-04', // 30 study days
    availability: { perWeekday: [0, 120, 120, 120, 120, 120, 0], blackoutDates: [] },
    prefs: {
      sessionLength: 50,
      intensity: 'standard' as const,
      simulationCount: 'auto' as const,
      simulationMinutes: 90,
      reviewMinutesPerCard: 0.5,
    },
    force: false,
  });

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

  async function addParsedDocument(pages: number, text = SAMPLE_TEXT) {
    const docId = randomUUID();
    await db.insert(documents).values({
      id: docId,
      subjectId,
      type: 'appunti',
      originalName: `doc-${docId.slice(0, 4)}.pdf`,
      storedPath: '/irrelevant',
      mime: 'application/pdf',
      bytes: 10,
      sha256: 'a'.repeat(64),
      status: 'parsed',
      pages,
    });
    await db.insert(chunks).values({
      id: randomUUID(),
      documentId: docId,
      pageFrom: 1,
      pageTo: 1,
      ord: 0,
      text,
      tokens: 50,
    });
    return docId;
  }

  it('produces a draft plan with tasks built from the subject’s parsed documents', async () => {
    const docId = await addParsedDocument(20);

    const result = await processGeneratePlan(db, baseInput(), new FakeProvider());

    expect(result.taskCount).toBeGreaterThan(0);
    const [plan] = await db.select().from(studyPlans).where(eq(studyPlans.id, result.planId));
    expect(plan?.status).toBe('draft');
    expect(plan?.subjectId).toBe(subjectId);

    const taskRows = await db.select().from(tasks).where(eq(tasks.planId, result.planId));
    expect(taskRows.length).toBe(result.taskCount);
    expect(taskRows.every((t) => t.status === 'proposed')).toBe(true);
    // Reading tasks cite the actual document, not a placeholder.
    const readTask = taskRows.find((t) => t.kind === 'read');
    expect(readTask?.payload.material?.[0]?.docId).toBe(docId);
  });

  it('plans on the student’s own pace once enough real sessions say they take longer', async () => {
    await addParsedDocument(20);
    const before = await processGeneratePlan(db, baseInput(), new FakeProvider());
    const readMinutes = async (planId: string) =>
      (await db.select().from(tasks).where(eq(tasks.planId, planId)))
        .filter((t) => t.kind === 'read')
        .reduce((sum, t) => sum + t.minutes, 0);
    const baseline = await readMinutes(before.planId);
    const [first] = await db.select().from(studyPlans).where(eq(studyPlans.id, before.planId));
    expect(first?.timeFactor).toBe(1);

    // Three finished sessions that each took twice the planned time.
    for (let i = 0; i < 3; i++) {
      const taskId = randomUUID();
      await db.insert(tasks).values({
        id: taskId,
        subjectId,
        planId: before.planId,
        taskKey: `read:history-${i}`,
        date: '2026-01-06',
        kind: 'read',
        minutes: 30,
        title: 'Leggi',
        description: '',
        payload: { action: 'read' },
        status: 'done',
      });
      await db.insert(studySessions).values({
        id: randomUUID(),
        subjectId,
        taskId,
        topicIds: [],
        documentIds: [],
        status: 'ended',
        activeMs: 60 * 60_000,
        endedAt: new Date(2026, 0, 10 + i),
      });
    }

    const after = await processGeneratePlan(db, baseInput(), new FakeProvider());
    const [second] = await db.select().from(studyPlans).where(eq(studyPlans.id, after.planId));
    expect(second?.timeFactor).toBe(2);
    expect(await readMinutes(after.planId)).toBeGreaterThan(baseline);
  });

  it('is a no-op AI call (zero cost, no reading tasks) when the subject has no parsed documents', async () => {
    const result = await processGeneratePlan(db, baseInput(), new FakeProvider());
    // Fase B still schedules simulations independently of material; only the
    // AI-estimated, material-backed tasks (read/flashcards/review) are absent.
    const taskRows = await db.select().from(tasks).where(eq(tasks.planId, result.planId));
    expect(taskRows.some((t) => t.kind === 'read')).toBe(false);
    expect(result.costEur).toBe(0);
    expect(result.feasible).toBe(true); // nothing to schedule = trivially feasible
    const [plan] = await db.select().from(studyPlans).where(eq(studyPlans.id, result.planId));
    expect(plan?.warnings).toEqual(
      expect.arrayContaining([expect.stringContaining('Nessun materiale')]),
    );
  });

  it('replaces a previous draft for the same subject instead of accumulating drafts', async () => {
    await addParsedDocument(10);
    const first = await processGeneratePlan(db, baseInput(), new FakeProvider());
    const second = await processGeneratePlan(db, baseInput(), new FakeProvider());

    expect(second.planId).not.toBe(first.planId);
    const plans = await db.select().from(studyPlans).where(eq(studyPlans.subjectId, subjectId));
    expect(plans).toHaveLength(1);
    expect(plans[0]!.id).toBe(second.planId);
    const oldTasks = await db.select().from(tasks).where(eq(tasks.planId, first.planId));
    expect(oldTasks).toEqual([]); // cascaded with the deleted draft
  });

  it('gives FSRS reviews due in the plan window absolute precedence over new content', async () => {
    const docId = await addParsedDocument(40);
    const deckId = randomUUID();
    await db.insert(artifacts).values({
      id: deckId,
      subjectId,
      kind: 'flashcard_deck',
      title: 'Deck',
      path: '/x.json',
      model: 'fake-v1',
      promptVersion: 'flashcards/v1',
    });
    await db.insert(flashcards).values({
      id: randomUUID(),
      deckId,
      type: 'basic',
      front: 'Domanda?',
      back: 'Risposta.',
      sourceRef: { docId, page: 1, quote: 'Risposta.' },
      state: 'review',
      dueAt: new Date('2026-01-05T06:00:00.000Z'),
    });

    const result = await processGeneratePlan(db, baseInput(), new FakeProvider());
    const taskRows = await db.select().from(tasks).where(eq(tasks.planId, result.planId));
    const reviewTask = taskRows.find((t) => t.date === '2026-01-05' && t.kind === 'review');
    expect(reviewTask?.title).toContain('scadenza');
  });

  it('treats other subjects’ active tasks as busy minutes competing for the same day', async () => {
    await addParsedDocument(10);

    const otherSubjectId = randomUUID();
    await db.insert(subjects).values({
      id: otherSubjectId,
      slug: 'chimica-1',
      name: 'Chimica 1',
      color: 'green',
      folderPath: '/data/subjects/chimica-1',
    });
    const otherPlanId = randomUUID();
    await db.insert(studyPlans).values({
      id: otherPlanId,
      subjectId: otherSubjectId,
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
    // Every minute of the first Monday (120 min) already taken by the other subject.
    await db.insert(tasks).values({
      id: randomUUID(),
      subjectId: otherSubjectId,
      planId: otherPlanId,
      taskKey: 'read:x:001',
      date: '2026-01-05',
      kind: 'read',
      minutes: 120,
      title: 'Occupato',
      description: '',
      payload: { action: 'read' },
      status: 'todo',
    });

    const result = await processGeneratePlan(db, baseInput(), new FakeProvider());
    const taskRows = await db.select().from(tasks).where(eq(tasks.planId, result.planId));
    expect(taskRows.some((t) => t.date === '2026-01-05')).toBe(false);
  });

  it('imported calendar events take time out of the day, whatever the subject', async () => {
    await addParsedDocument(10);
    // The first Monday is 120 min; two imported events (60 each) leave nothing.
    await db.insert(calendarEvents).values([
      { id: randomUUID(), uid: 'a', date: '2026-01-05', title: 'Lezione' },
      { id: randomUUID(), uid: 'b', date: '2026-01-05', title: 'Laboratorio' },
    ]);

    const result = await processGeneratePlan(db, baseInput(), new FakeProvider());
    const taskRows = await db.select().from(tasks).where(eq(tasks.planId, result.planId));
    expect(taskRows.some((t) => t.date === '2026-01-05')).toBe(false);
    expect(taskRows.length).toBeGreaterThan(0);
  });

  it('plans a partial: only the chosen topics, the notes reach the model and the plan keeps its exam', async () => {
    const docIn = await addParsedDocument(20);
    const docOut = await addParsedDocument(20);
    const topicIn = randomUUID();
    const topicOut = randomUUID();
    await db.insert(topics).values([
      { id: topicIn, subjectId, name: 'Meccanica', slug: 'meccanica', orderIndex: 0 },
      { id: topicOut, subjectId, name: 'Ottica', slug: 'ottica', orderIndex: 1 },
    ]);
    await db.insert(documentTopics).values([
      { documentId: docIn, topicId: topicIn },
      { documentId: docOut, topicId: topicOut },
    ]);
    const examId = randomUUID();
    await db.insert(exams).values({
      id: examId,
      subjectId,
      title: 'Primo parziale',
      kind: 'parziale',
      date: new Date('2026-02-04T09:00:00Z'),
      description: 'Solo meccanica, molti esercizi',
    });
    const seen: { notes?: string; keys: string[] }[] = [];
    class SpyProvider extends FakeProvider {
      override async estimateTopics(
        ...args: Parameters<FakeProvider['estimateTopics']>
      ): ReturnType<FakeProvider['estimateTopics']> {
        seen.push({ notes: args[0].notes, keys: args[0].units.map((u) => u.key) });
        return super.estimateTopics(...args);
      }
    }

    const result = await processGeneratePlan(
      db,
      { ...baseInput(), examId, topicIds: [topicIn] },
      new SpyProvider(),
    );

    // The exam's own description is used when the request carries no notes of its own.
    expect(seen).toEqual([{ notes: 'Solo meccanica, molti esercizi', keys: [topicIn] }]);
    const [plan] = await db.select().from(studyPlans).where(eq(studyPlans.id, result.planId));
    expect(plan?.examId).toBe(examId);
    const taskRows = await db.select().from(tasks).where(eq(tasks.planId, result.planId));
    const readTasks = taskRows.filter((t) => t.kind === 'read');
    expect(readTasks.length).toBeGreaterThan(0);
    expect(readTasks.every((t) => t.topicId === topicIn)).toBe(true);

    await processGeneratePlan(
      db,
      { ...baseInput(), examId, topicIds: [topicIn], notes: 'Anche gli esercizi' },
      new SpyProvider(),
    );
    expect(seen[1]?.notes).toBe('Anche gli esercizi');
  });

  it('a partial’s plan makes room for the other exams’ active plans of the same subject, but not for the one it replaces', async () => {
    await addParsedDocument(10);
    const mkExam = async (title: string) => {
      const id = randomUUID();
      await db.insert(exams).values({
        id,
        subjectId,
        title,
        kind: 'parziale',
        date: new Date('2026-02-04T09:00:00Z'),
      });
      return id;
    };
    const examA = await mkExam('Parziale 1');
    const examB = await mkExam('Parziale 2');
    const activePlan = async (examId: string) => {
      const id = randomUUID();
      await db.insert(studyPlans).values({
        id,
        subjectId,
        examId,
        startDate: '2026-01-05',
        targetDate: '2026-02-04',
        availability: baseInput().availability,
        prefs: baseInput().prefs,
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
        promptVersion: 'x',
        status: 'active',
      });
      await db.insert(tasks).values({
        id: randomUUID(),
        subjectId,
        planId: id,
        taskKey: `read:${id}`,
        date: '2026-01-05',
        kind: 'read',
        minutes: 120,
        title: 'Già pianificato',
        description: '',
        payload: { action: 'read' },
        status: 'todo',
      });
    };
    await activePlan(examA);

    // Regenerating exam A's own plan: its old task is going away, so the Monday is free again.
    const own = await processGeneratePlan(
      db,
      { ...baseInput(), examId: examA },
      new FakeProvider(),
    );
    expect(
      (await db.select().from(tasks).where(eq(tasks.planId, own.planId))).some(
        (t) => t.date === '2026-01-05',
      ),
    ).toBe(true);

    // Exam B's plan has to work around exam A's full Monday.
    const other = await processGeneratePlan(
      db,
      { ...baseInput(), examId: examB },
      new FakeProvider(),
    );
    expect(
      (await db.select().from(tasks).where(eq(tasks.planId, other.planId))).some(
        (t) => t.date === '2026-01-05',
      ),
    ).toBe(false);
  });

  it('groups documents tagged to the same topic into one planning unit, and persists the real topic id on tasks', async () => {
    const docA = await addParsedDocument(20);
    const docB = await addParsedDocument(20);
    const topicId = randomUUID();
    await db
      .insert(topics)
      .values({ id: topicId, subjectId, name: 'Termodinamica', slug: 'termodinamica' });
    await db.insert(documentTopics).values([
      { documentId: docA, topicId },
      { documentId: docB, topicId },
    ]);

    const result = await processGeneratePlan(db, baseInput(), new FakeProvider());
    const taskRows = await db.select().from(tasks).where(eq(tasks.planId, result.planId));

    const readTasks = taskRows.filter((t) => t.kind === 'read');
    expect(readTasks.length).toBeGreaterThan(0);
    expect(readTasks.every((t) => t.topicId === topicId)).toBe(true);

    // Both documents' material is covered across the topic's reading sessions — neither is left planless.
    const citedDocIds = new Set(
      readTasks.flatMap((t) => t.payload.material?.map((m) => m.docId) ?? []),
    );
    expect(citedDocIds).toEqual(new Set([docA, docB]));
  });

  it('assigns a document tagged to two topics to its primary (lowest orderIndex) topic only', async () => {
    const doc = await addParsedDocument(20);
    const primaryTopicId = randomUUID();
    const secondaryTopicId = randomUUID();
    await db.insert(topics).values([
      { id: primaryTopicId, subjectId, name: 'Meccanica', slug: 'meccanica', orderIndex: 0 },
      { id: secondaryTopicId, subjectId, name: 'Cinematica', slug: 'cinematica', orderIndex: 1 },
    ]);
    await db.insert(documentTopics).values([
      { documentId: doc, topicId: secondaryTopicId },
      { documentId: doc, topicId: primaryTopicId },
    ]);

    const result = await processGeneratePlan(db, baseInput(), new FakeProvider());
    const taskRows = await db.select().from(tasks).where(eq(tasks.planId, result.planId));

    expect(taskRows.some((t) => t.topicId === primaryTopicId)).toBe(true);
    expect(taskRows.some((t) => t.topicId === secondaryTopicId)).toBe(false);
  });

  it('feeds a topic’s real mastery into the estimate, shortening the first-pass reading time relative to an unmastered topic', async () => {
    const masteredDoc = await addParsedDocument(20);
    const freshDoc = await addParsedDocument(20);
    const masteredTopicId = randomUUID();
    const freshTopicId = randomUUID();
    await db.insert(topics).values([
      {
        id: masteredTopicId,
        subjectId,
        name: 'Argomento noto',
        slug: 'argomento-noto',
        mastery: 0.9,
      },
      {
        id: freshTopicId,
        subjectId,
        name: 'Argomento nuovo',
        slug: 'argomento-nuovo',
        mastery: null,
      },
    ]);
    await db.insert(documentTopics).values([
      { documentId: masteredDoc, topicId: masteredTopicId },
      { documentId: freshDoc, topicId: freshTopicId },
    ]);

    const result = await processGeneratePlan(db, baseInput(), new FakeProvider());
    const taskRows = await db.select().from(tasks).where(eq(tasks.planId, result.planId));

    const minutesFor = (topicId: string) =>
      taskRows
        .filter((t) => t.kind === 'read' && t.topicId === topicId)
        .reduce((s, t) => s + t.minutes, 0);
    expect(minutesFor(masteredTopicId)).toBeLessThan(minutesFor(freshTopicId));
  });
});
