import { describe, expect, it, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { createTestDb } from '@studyhub/db/testDb';
import {
  artifacts,
  chunks,
  documents,
  flashcards,
  studyPlans,
  subjects,
  tasks,
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
    await db
      .insert(chunks)
      .values({
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
});
