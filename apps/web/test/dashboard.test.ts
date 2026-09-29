import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createTestDb } from '@studyhub/db/testDb';
import {
  artifacts,
  documents,
  exams,
  flashcards,
  jobs,
  studyPlans,
  tasks,
  topics,
} from '@studyhub/db';
import { createSubject, setSubjectArchived } from '../src/lib/subjects';
import { getDashboardSummary, getOnboarding } from '../src/lib/dashboard';

const AVAILABILITY = { perWeekday: [0, 120, 120, 120, 120, 120, 0], blackoutDates: [] };
const PREFS = {
  sessionLength: 50,
  intensity: 'standard' as const,
  simulationCount: 'auto' as const,
  simulationMinutes: 90,
  reviewMinutesPerCard: 0.5,
};
const FEASIBILITY = {
  feasible: true,
  requiredMinutes: 0,
  availableMinutes: 0,
  shortfallMinutes: 0,
  unscheduledTopicKeys: [],
  strategies: [],
};
const TODAY = '2026-01-10';

describe('getDashboardSummary', () => {
  let dataRoot: string;
  let db: Awaited<ReturnType<typeof createTestDb>>;

  beforeEach(async () => {
    dataRoot = await mkdtemp(join(tmpdir(), 'studyhub-dashboard-'));
    db = await createTestDb();
  });
  afterEach(async () => {
    await rm(dataRoot, { recursive: true, force: true });
  });

  it('reports an empty-but-valid state with no subjects at all', async () => {
    const summary = await getDashboardSummary(db, TODAY);
    expect(summary).toMatchObject({
      subjectsCount: 0,
      daysToNextExam: null,
      nextExam: null,
      minutesPlannedToday: 0,
      dueCardsCount: 0,
      averageMastery: null,
      todayTasks: [],
      subjects: [],
      recentJobs: [],
    });
  });

  it('reports averageMastery as null when no topic has a computed mastery (the current, real state of the app)', async () => {
    const subject = await createSubject(db, dataRoot, { name: 'Fisica 1', color: 'blue' });
    await db.insert(topics).values({
      id: randomUUID(),
      subjectId: subject.id,
      name: 'Meccanica',
      slug: 'meccanica',
      mastery: null,
    });
    const summary = await getDashboardSummary(db, TODAY);
    expect(summary.averageMastery).toBeNull();
  });

  it('averages mastery across topics that do have one, ignoring those that do not', async () => {
    const subject = await createSubject(db, dataRoot, { name: 'Fisica 1', color: 'blue' });
    await db.insert(topics).values([
      { id: randomUUID(), subjectId: subject.id, name: 'A', slug: 'a', mastery: 0.4 },
      { id: randomUUID(), subjectId: subject.id, name: 'B', slug: 'b', mastery: 0.8 },
      { id: randomUUID(), subjectId: subject.id, name: 'C', slug: 'c', mastery: null },
    ]);
    const summary = await getDashboardSummary(db, TODAY);
    expect(summary.averageMastery).toBe(0.6);
  });

  it('finds the soonest scheduled exam across subjects, ignoring past and cancelled ones', async () => {
    const fisica = await createSubject(db, dataRoot, { name: 'Fisica 1', color: 'blue' });
    const chimica = await createSubject(db, dataRoot, { name: 'Chimica 1', color: 'green' });
    await db.insert(exams).values([
      {
        id: randomUUID(),
        subjectId: fisica.id,
        title: 'Passato',
        kind: 'scritto',
        date: new Date('2020-01-01T09:00:00.000Z'),
      },
      {
        id: randomUUID(),
        subjectId: fisica.id,
        title: 'Annullato',
        kind: 'scritto',
        date: new Date('2026-01-12T09:00:00.000Z'),
        status: 'cancelled',
      },
      {
        id: randomUUID(),
        subjectId: chimica.id,
        title: 'Il prossimo',
        kind: 'orale',
        date: new Date('2026-01-20T09:00:00.000Z'),
      },
      {
        id: randomUUID(),
        subjectId: fisica.id,
        title: 'Più lontano',
        kind: 'scritto',
        date: new Date('2026-02-01T09:00:00.000Z'),
      },
    ]);
    const summary = await getDashboardSummary(db, TODAY);
    expect(summary.nextExam).toMatchObject({ title: 'Il prossimo', subjectSlug: chimica.slug });
    expect(summary.daysToNextExam).toBe(10);
  });

  it('sums today’s planned minutes from every subject’s active plan and lists only actionable (todo/doing) tasks', async () => {
    const subject = await createSubject(db, dataRoot, { name: 'Fisica 1', color: 'blue' });
    const planId = randomUUID();
    await db.insert(studyPlans).values({
      id: planId,
      subjectId: subject.id,
      startDate: '2026-01-01',
      targetDate: '2026-02-01',
      availability: AVAILABILITY,
      prefs: PREFS,
      feasibility: FEASIBILITY,
      warnings: [],
      model: 'fake-v1',
      promptVersion: 'estimate_topics/v1',
      status: 'active',
    });
    await db.insert(tasks).values([
      {
        id: randomUUID(),
        subjectId: subject.id,
        planId,
        taskKey: 'a',
        date: TODAY,
        kind: 'read',
        minutes: 50,
        title: 'Da fare',
        description: '',
        payload: { action: 'read' },
        status: 'todo',
      },
      {
        id: randomUUID(),
        subjectId: subject.id,
        planId,
        taskKey: 'b',
        date: TODAY,
        kind: 'review',
        minutes: 20,
        title: 'Fatta',
        description: '',
        payload: { action: 'review_session' },
        status: 'done',
      },
    ]);

    const summary = await getDashboardSummary(db, TODAY);
    expect(summary.minutesPlannedToday).toBe(70); // both tasks count toward the day's planned load
    expect(summary.todayTasks).toHaveLength(1); // only the actionable one surfaces in "Oggi"
    expect(summary.todayTasks[0]!.title).toBe('Da fare');
  });

  it('counts due cards (new, or past dueAt) globally and per subject', async () => {
    const subject = await createSubject(db, dataRoot, { name: 'Fisica 1', color: 'blue' });
    const deckId = randomUUID();
    await db.insert(artifacts).values({
      id: deckId,
      subjectId: subject.id,
      kind: 'flashcard_deck',
      title: 'Deck',
      path: '/x.json',
      model: 'fake-v1',
      promptVersion: 'flashcards/v1',
    });
    await db.insert(flashcards).values([
      {
        id: randomUUID(),
        deckId,
        type: 'basic',
        front: 'new card',
        back: 'x',
        sourceRef: { docId: randomUUID(), page: 1, quote: 'x' },
        state: 'new',
      },
      {
        id: randomUUID(),
        deckId,
        type: 'basic',
        front: 'overdue',
        back: 'x',
        sourceRef: { docId: randomUUID(), page: 1, quote: 'x' },
        state: 'review',
        dueAt: new Date('2020-01-01T00:00:00.000Z'),
      },
      {
        id: randomUUID(),
        deckId,
        type: 'basic',
        front: 'future',
        back: 'x',
        sourceRef: { docId: randomUUID(), page: 1, quote: 'x' },
        state: 'review',
        dueAt: new Date('2099-01-01T00:00:00.000Z'),
      },
      {
        id: randomUUID(),
        deckId,
        type: 'basic',
        front: 'suspended overdue',
        back: 'x',
        sourceRef: { docId: randomUUID(), page: 1, quote: 'x' },
        state: 'review',
        dueAt: new Date('2020-01-01T00:00:00.000Z'),
        suspended: true,
      },
    ]);

    const summary = await getDashboardSummary(db, TODAY);
    expect(summary.dueCardsCount).toBe(2);
    expect(summary.subjects.find((s) => s.slug === subject.slug)?.dueCardsCount).toBe(2);
  });

  it('excludes an archived subject entirely: exam, mastery, due cards and today’s tasks all disappear (docs/fasi/F2-materie.md)', async () => {
    const active = await createSubject(db, dataRoot, { name: 'Chimica 1', color: 'green' });
    const archived = await createSubject(db, dataRoot, { name: 'Fisica 1', color: 'blue' });

    await db.insert(topics).values([
      { id: randomUUID(), subjectId: active.id, name: 'A', slug: 'a', mastery: 0.4 },
      { id: randomUUID(), subjectId: archived.id, name: 'B', slug: 'b', mastery: 1.0 },
    ]);
    await db.insert(exams).values({
      id: randomUUID(),
      subjectId: archived.id,
      title: 'Esame materia archiviata',
      kind: 'scritto',
      date: new Date('2026-01-20T09:00:00.000Z'),
    });
    const deckId = randomUUID();
    await db.insert(artifacts).values({
      id: deckId,
      subjectId: archived.id,
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
      front: 'due card of an archived subject',
      back: 'x',
      sourceRef: { docId: randomUUID(), page: 1, quote: 'x' },
      state: 'new',
    });
    const planId = randomUUID();
    await db.insert(studyPlans).values({
      id: planId,
      subjectId: archived.id,
      startDate: '2026-01-01',
      targetDate: '2026-02-01',
      availability: AVAILABILITY,
      prefs: PREFS,
      feasibility: FEASIBILITY,
      warnings: [],
      model: 'fake-v1',
      promptVersion: 'estimate_topics/v1',
      status: 'active',
    });
    await db.insert(tasks).values({
      id: randomUUID(),
      subjectId: archived.id,
      planId,
      taskKey: 'a',
      date: TODAY,
      kind: 'read',
      minutes: 50,
      title: 'Task materia archiviata',
      description: '',
      payload: { action: 'read' },
      status: 'todo',
    });

    await setSubjectArchived(db, archived.slug, true);

    const summary = await getDashboardSummary(db, TODAY);
    expect(summary.subjectsCount).toBe(1);
    expect(summary.subjects.map((s) => s.slug)).toEqual([active.slug]);
    expect(summary.averageMastery).toBe(0.4); // only the active subject's topic counts
    expect(summary.nextExam).toBeNull();
    expect(summary.dueCardsCount).toBe(0);
    expect(summary.minutesPlannedToday).toBe(0);
    expect(summary.todayTasks).toEqual([]);
  });

  it('surfaces recent jobs, newest first, with subject identity when scoped to one', async () => {
    const subject = await createSubject(db, dataRoot, { name: 'Fisica 1', color: 'blue' });
    await db.insert(jobs).values({ id: randomUUID(), type: 'reconcile', status: 'succeeded' });
    await new Promise((r) => setTimeout(r, 2));
    await db.insert(jobs).values({
      id: randomUUID(),
      type: 'generate_flashcards',
      status: 'succeeded',
      subjectId: subject.id,
      cost: { inputTokens: 10, outputTokens: 5, eur: 0.01 },
    });

    const summary = await getDashboardSummary(db, TODAY);
    expect(summary.recentJobs).toHaveLength(2);
    expect(summary.recentJobs[0]).toMatchObject({
      type: 'generate_flashcards',
      subjectSlug: subject.slug,
      costEur: 0.01,
    });
    expect(summary.recentJobs[1]).toMatchObject({ type: 'reconcile', subjectSlug: null });
  });
});

describe('getOnboarding (first-run checklist)', () => {
  let dataRoot: string;
  let db: Awaited<ReturnType<typeof createTestDb>>;

  beforeEach(async () => {
    dataRoot = await mkdtemp(join(tmpdir(), 'studyhub-onboarding-'));
    db = await createTestDb();
  });
  afterEach(async () => {
    await rm(dataRoot, { recursive: true, force: true });
  });

  const doneKeys = (o: Awaited<ReturnType<typeof getOnboarding>>) =>
    o.steps.filter((s) => s.done).map((s) => s.key);

  async function addDoc(subjectId: string, status: 'parsing' | 'parsed') {
    await db.insert(documents).values({
      id: randomUUID(),
      subjectId,
      type: 'appunti',
      originalName: 'a.pdf',
      storedPath: '/x',
      mime: 'application/pdf',
      bytes: 1,
      sha256: randomUUID().replace(/-/g, '').padEnd(64, '0'),
      status,
      pages: 3,
    });
  }

  it('starts empty: nothing done, first step is creating a subject', async () => {
    const o = await getOnboarding(db);
    expect(o.completed).toBe(false);
    expect(o.nextKey).toBe('subject');
    expect(doneKeys(o)).toEqual([]);
    expect(o.steps[0]!.href).toBe('/materie');
    expect(o.steps).toHaveLength(5);
  });

  it('advances with real state, and links the next step to the subject', async () => {
    const subject = await createSubject(db, dataRoot, { name: 'Fisica 1', color: 'blue' });
    let o = await getOnboarding(db);
    expect(doneKeys(o)).toEqual(['subject']);
    expect(o.nextKey).toBe('document');
    expect(o.steps.find((s) => s.key === 'document')!.href).toBe(`/materie/${subject.slug}`);

    await addDoc(subject.id, 'parsing');
    o = await getOnboarding(db);
    expect(doneKeys(o)).toEqual(['subject', 'document']);
    expect(o.nextKey).toBe('ready'); // uploaded is not enough: it has to be parsed

    await addDoc(subject.id, 'parsed');
    o = await getOnboarding(db);
    expect(doneKeys(o)).toEqual(['subject', 'document', 'ready']);
    expect(o.nextKey).toBe('flashcards');
  });

  it('is completed once a card exists and a plan is active — and a draft plan does not count', async () => {
    const subject = await createSubject(db, dataRoot, { name: 'Fisica 1', color: 'blue' });
    await addDoc(subject.id, 'parsed');

    const deckId = randomUUID();
    await db.insert(artifacts).values({
      id: deckId,
      subjectId: subject.id,
      kind: 'flashcard_deck',
      title: 'Deck',
      path: '/d.json',
      model: 'fake-v1',
      promptVersion: 'flashcards/v1',
    });
    await db.insert(flashcards).values({
      id: randomUUID(),
      deckId,
      type: 'basic',
      front: 'Q',
      back: 'A',
      sourceRef: { docId: randomUUID(), page: 1, quote: 'q' },
    });
    expect((await getOnboarding(db)).nextKey).toBe('plan');

    const planId = randomUUID();
    await db.insert(studyPlans).values({
      id: planId,
      subjectId: subject.id,
      startDate: '2026-01-05',
      targetDate: '2026-02-04',
      availability: AVAILABILITY,
      prefs: PREFS,
      feasibility: FEASIBILITY,
      warnings: [],
      model: 'fake-v1',
      promptVersion: 'estimate_topics/v1',
      status: 'draft',
    });
    await db.insert(tasks).values({
      id: randomUUID(),
      subjectId: subject.id,
      planId,
      taskKey: 'read:a:001',
      date: TODAY,
      kind: 'read',
      minutes: 30,
      title: 'Studia',
      description: '',
      payload: { action: 'read' },
      status: 'proposed',
    });
    expect((await getOnboarding(db)).completed).toBe(false); // a draft is invisible to the app

    await db.update(studyPlans).set({ status: 'active' });
    const o = await getOnboarding(db);
    expect(o.completed).toBe(true);
    expect(o.nextKey).toBeNull();
  });

  it('ignores archived subjects entirely', async () => {
    const subject = await createSubject(db, dataRoot, { name: 'Vecchia', color: 'rose' });
    await addDoc(subject.id, 'parsed');
    await setSubjectArchived(db, subject.slug, true);
    expect(doneKeys(await getOnboarding(db))).toEqual([]);
  });

  it('is part of the dashboard summary', async () => {
    expect((await getDashboardSummary(db, TODAY)).onboarding.nextKey).toBe('subject');
  });
});
