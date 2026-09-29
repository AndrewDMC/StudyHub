import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { createTestDb } from '@studyhub/db/testDb';
import { documents, documentTopics, studyPlans, tasks, topics } from '@studyhub/db';
import { createSubject } from '../src/lib/subjects';
import { endSession, getSession, startSession, updateSession } from '../src/lib/sessions';
import { SubjectNotFoundError } from '../src/lib/errors';
import { ConflictError, NotFoundError } from '../src/lib/examPrep';

describe('study sessions', () => {
  let dataRoot: string;
  let db: Awaited<ReturnType<typeof createTestDb>>;
  let slug: string;
  let subjectId: string;
  let planId: string;

  beforeEach(async () => {
    dataRoot = await mkdtemp(join(tmpdir(), 'studyhub-sessions-'));
    db = await createTestDb();
    const subject = await createSubject(db, dataRoot, { name: 'Analisi 2', color: 'violet' });
    slug = subject.slug;
    subjectId = subject.id;
    planId = randomUUID();
    await db.insert(studyPlans).values({
      id: planId,
      subjectId,
      status: 'active',
      startDate: '2026-09-29',
      targetDate: '2026-10-30',
      availability: { perWeekday: [60, 60, 60, 60, 60, 0, 0], blackoutDates: [] },
      prefs: {
        sessionLength: 45,
        intensity: 'standard',
        simulationCount: 'auto',
        simulationMinutes: 90,
        reviewMinutesPerCard: 1,
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
      model: 'fake',
      promptVersion: 'v1',
    });
  });

  afterEach(async () => {
    await rm(dataRoot, { recursive: true, force: true });
  });

  async function addTopic(name: string) {
    const id = randomUUID();
    await db.insert(topics).values({ id, subjectId, name, slug: name.toLowerCase() });
    return id;
  }

  async function addDoc(name: string, topicIds: string[], mdPath: string | null = 'content.md') {
    const id = randomUUID();
    await db.insert(documents).values({
      id,
      subjectId,
      type: 'appunti',
      originalName: name,
      storedPath: '/x',
      mime: 'application/pdf',
      bytes: 1,
      sha256: randomUUID().replace(/-/g, '').padEnd(64, '0'),
      status: 'parsed',
      pages: 10,
      mdPath,
    });
    for (const topicId of topicIds)
      await db.insert(documentTopics).values({ documentId: id, topicId });
    return id;
  }

  async function addTask(over: Partial<typeof tasks.$inferInsert> = {}) {
    const id = randomUUID();
    await db.insert(tasks).values({
      id,
      subjectId,
      planId,
      taskKey: `read:${id.slice(0, 4)}`,
      date: '2026-09-29',
      kind: 'read',
      minutes: 45,
      title: 'Leggi integrali doppi',
      description: '',
      payload: { action: 'read' },
      status: 'todo',
      ...over,
    });
    return id;
  }

  it('starts from a task: material first and highlighted, then the rest of its topics', async () => {
    const t1 = await addTopic('Integrali');
    const t2 = await addTopic('Fubini');
    const d1 = await addDoc('Appunti cap.4', [t1]);
    const d2 = await addDoc('Slide L12', [t1]);
    const d3 = await addDoc('Esercitazione 3', [t2]);
    const taskId = await addTask({
      topicId: t1,
      payload: { action: 'read', material: [{ docId: d3, pageFrom: 2, pageTo: 5 }] },
    });

    const session = await startSession(db, slug, { taskId });

    expect(session.status).toBe('active');
    expect(session.taskTitle).toBe('Leggi integrali doppi');
    expect(session.topics.map((t) => t.name).sort()).toEqual(['Fubini', 'Integrali']);
    expect(session.documents.map((d) => d.id)).toEqual([d3, d1, d2]);
    expect(session.documents[0]).toMatchObject({
      highlighted: true,
      pageRanges: [{ pageFrom: 2, pageTo: 5 }],
    });
    expect(session.documents[1]!.highlighted).toBe(false);

    const [task] = await db.select().from(tasks).where(eq(tasks.id, taskId));
    expect(task!.status).toBe('doing');
  });

  it('re-opens the active session of a task instead of creating a second one', async () => {
    const taskId = await addTask();
    const first = await startSession(db, slug, { taskId });
    const second = await startSession(db, slug, { taskId });
    expect(second.id).toBe(first.id);
  });

  it('refuses a draft task and an unknown task or topic', async () => {
    const draft = await addTask({ status: 'proposed' });
    await expect(startSession(db, slug, { taskId: draft })).rejects.toBeInstanceOf(ConflictError);
    await expect(startSession(db, slug, { taskId: randomUUID() })).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(startSession(db, slug, { topicIds: [randomUUID()] })).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(startSession(db, 'nope', { topicIds: [randomUUID()] })).rejects.toBeInstanceOf(
      SubjectNotFoundError,
    );
  });

  it('starts a free session from topics, no task involved', async () => {
    const t = await addTopic('Serie');
    const d = await addDoc('Serie.pdf', [t], null);
    const session = await startSession(db, slug, { topicIds: [t] });
    expect(session.taskId).toBeNull();
    expect(session.documents).toHaveLength(1);
    expect(session.documents[0]).toMatchObject({ id: d, hasContent: false, highlighted: false });
  });

  it('changing topics recomputes the documents; activeMs never shrinks', async () => {
    const t1 = await addTopic('A');
    const t2 = await addTopic('B');
    const d1 = await addDoc('a.pdf', [t1]);
    const d2 = await addDoc('b.pdf', [t2]);
    const session = await startSession(db, slug, { topicIds: [t1] });
    expect(session.documents.map((d) => d.id)).toEqual([d1]);

    const updated = await updateSession(db, slug, session.id, {
      topicIds: [t1, t2],
      activeMs: 60_000,
    });
    expect(updated.documents.map((d) => d.id).sort()).toEqual([d1, d2].sort());
    expect(updated.activeMs).toBe(60_000);

    const counted = await updateSession(db, slug, session.id, { pomodoros: 2 });
    expect(counted.pomodoros).toBe(2);

    const stale = await updateSession(db, slug, session.id, { activeMs: 1_000, pomodoros: 1 });
    expect(stale.activeMs).toBe(60_000);
    expect(stale.pomodoros).toBe(2);
  });

  it('ending completes the task and freezes the session', async () => {
    const taskId = await addTask();
    const session = await startSession(db, slug, { taskId });

    const ended = await endSession(db, slug, session.id, { activeMs: 125_000, pomodoros: 3 });
    expect(ended.status).toBe('ended');
    expect(ended.endedAt).not.toBeNull();
    expect(ended.activeMs).toBe(125_000);
    expect(ended.pomodoros).toBe(3);

    const [task] = await db.select().from(tasks).where(eq(tasks.id, taskId));
    expect(task!.status).toBe('done');

    // idempotent, and no longer editable
    expect((await endSession(db, slug, session.id)).activeMs).toBe(125_000);
    await expect(updateSession(db, slug, session.id, { activeMs: 1 })).rejects.toBeInstanceOf(
      ConflictError,
    );
    expect((await getSession(db, slug, session.id)).status).toBe('ended');
  });

  it('does not reopen a finished session on a later start; a new one begins', async () => {
    const taskId = await addTask();
    const first = await startSession(db, slug, { taskId });
    await endSession(db, slug, first.id);
    // the task is done now, but the student can still start again from it
    const again = await startSession(db, slug, { taskId });
    expect(again.id).not.toBe(first.id);
  });
});
