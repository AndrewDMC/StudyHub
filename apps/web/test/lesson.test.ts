import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { createTestDb } from '@studyhub/db/testDb';
import {
  documents,
  documentTopics,
  jobs,
  lessonBlocks,
  studyPlans,
  studySessions,
  tasks,
  topics,
} from '@studyhub/db';
import { FakeProvider } from '@studyhub/ai';
import { createSubject } from '../src/lib/subjects';
import { getSession, startSession, updateSession } from '../src/lib/sessions';
import {
  checkLessonBlock,
  getLesson,
  regenerateLessonBlock,
  startLesson,
  verdictForScore,
} from '../src/lib/lesson';
import { ConflictError, InvalidRequestError, NotFoundError } from '../src/lib/examPrep';

describe('guided lesson', () => {
  let dataRoot: string;
  let db: Awaited<ReturnType<typeof createTestDb>>;
  let slug: string;
  let subjectId: string;
  let planId: string;
  let topicId: string;
  let docId: string;
  const queue = { add: vi.fn().mockResolvedValue({ id: 'job' }) };

  beforeEach(async () => {
    queue.add.mockClear();
    dataRoot = await mkdtemp(join(tmpdir(), 'studyhub-lesson-'));
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
    topicId = randomUUID();
    await db
      .insert(topics)
      .values({ id: topicId, subjectId, name: 'Integrali', slug: 'integrali' });
    docId = randomUUID();
    await db.insert(documents).values({
      id: docId,
      subjectId,
      type: 'appunti',
      originalName: 'Appunti cap.4.pdf',
      storedPath: '/x',
      mime: 'application/pdf',
      bytes: 1,
      sha256: 'c'.repeat(64),
      status: 'parsed',
      pages: 10,
      mdPath: 'content.md',
    });
    await db.insert(documentTopics).values({ documentId: docId, topicId });
  });

  afterEach(async () => {
    await rm(dataRoot, { recursive: true, force: true });
  });

  async function addTask(over: Partial<typeof tasks.$inferInsert> = {}) {
    const id = randomUUID();
    await db.insert(tasks).values({
      id,
      subjectId,
      planId,
      taskKey: `t:${id.slice(0, 4)}`,
      date: '2026-09-29',
      kind: 'lesson',
      minutes: 60,
      title: 'Integrali',
      description: '',
      topicId,
      payload: { action: 'lesson', method: 'standard', topicId },
      status: 'todo',
      ...over,
    });
    return id;
  }

  async function lessonSession(blockCount: number | null = 4) {
    const session = await startSession(db, slug, { taskId: await addTask() });
    if (blockCount !== null) {
      await db.update(studySessions).set({ blockCount }).where(eq(studySessions.id, session.id));
    }
    return session.id;
  }

  async function addBlock(sessionId: string, orderIndex: number, state: 'open' | 'locked') {
    const id = randomUUID();
    await db.insert(lessonBlocks).values({
      id,
      sessionId,
      orderIndex,
      title: `Blocco ${orderIndex}`,
      body: 'Spiegazione',
      checkQuestion: 'Che cosa dice il teorema?',
      checkAnswer: 'Si può scambiare l’ordine di integrazione',
      citations: [{ docId, page: 1, quote: 'Fubini' }],
      state,
    });
    return id;
  }

  describe('startSession', () => {
    it('a lesson task opens a lesson with its method and its first phase', async () => {
      const taskId = await addTask({ payload: { action: 'lesson', method: 'sprint' } });
      const session = await startSession(db, slug, { taskId });
      expect(session).toMatchObject({
        kind: 'lesson',
        method: 'sprint',
        phase: 'exercises',
        blockIndex: 0,
      });
    });

    it('a standard lesson opens on the explore phase', async () => {
      const taskId = await addTask({ payload: { action: 'lesson' } });
      const session = await startSession(db, slug, { taskId });
      expect(session).toMatchObject({ method: 'standard', phase: 'explore' });
    });

    it('a verify task opens a verification without a phase', async () => {
      const taskId = await addTask({
        kind: 'verify',
        payload: { action: 'verify', topicId },
        title: 'Verifica · Integrali',
      });
      const session = await startSession(db, slug, { taskId });
      expect(session).toMatchObject({ kind: 'verify', phase: null });
    });

    it('free sessions and read tasks keep the layout without phases', async () => {
      const free = await startSession(db, slug, { topicIds: [topicId] });
      expect(free.phase).toBeNull();
      const readTask = await addTask({ kind: 'read', payload: { action: 'read' } });
      const fromRead = await startSession(db, slug, { taskId: readTask });
      expect(fromRead.phase).toBeNull();
    });

    it('PATCH moves a standard lesson among the standard phases and refuses sprint ones', async () => {
      const id = await lessonSession();
      for (const phase of ['understand', 'rework', 'apply', 'recall', 'explore'] as const) {
        expect((await updateSession(db, slug, id, { phase })).phase).toBe(phase);
      }
      await expect(updateSession(db, slug, id, { phase: 'exercises' })).rejects.toBeInstanceOf(
        InvalidRequestError,
      );
      await expect(updateSession(db, slug, id, { phase: 'theory' })).rejects.toBeInstanceOf(
        InvalidRequestError,
      );
    });

    it('PATCH refuses a standard-only phase on a sprint lesson', async () => {
      const taskId = await addTask({ payload: { action: 'lesson', method: 'sprint' } });
      const session = await startSession(db, slug, { taskId });
      expect((await updateSession(db, slug, session.id, { phase: 'theory' })).phase).toBe('theory');
      await expect(updateSession(db, slug, session.id, { phase: 'rework' })).rejects.toBeInstanceOf(
        InvalidRequestError,
      );
    });

    it('PATCH accepts phase and blockIndex', async () => {
      const id = await lessonSession();
      const updated = await updateSession(db, slug, id, { phase: 'rework', blockIndex: 2 });
      expect(updated).toMatchObject({ phase: 'rework', blockIndex: 2 });
      expect((await getSession(db, slug, id)).blockIndex).toBe(2);
    });
  });

  describe('startLesson', () => {
    it('queues block 0 once, with a queued job row, and is idempotent', async () => {
      const id = await lessonSession(null);
      const first = await startLesson(db, queue, slug, id, { force: true });
      expect(first.jobId).not.toBeNull();
      expect(queue.add).toHaveBeenCalledTimes(1);
      expect(queue.add.mock.calls[0]![0]).toBe('generate_lesson_block');
      expect(queue.add.mock.calls[0]![1]).toMatchObject({
        sessionId: id,
        blockIndex: 0,
        regenerate: false,
        force: true,
      });
      const [row] = await db.select().from(jobs).where(eq(jobs.id, first.jobId!));
      expect(row?.status).toBe('queued');

      const again = await startLesson(db, queue, slug, id);
      expect(again.jobId).toBeNull();
      expect(queue.add).toHaveBeenCalledTimes(1);

      const lesson = await getLesson(db, slug, id);
      expect(lesson.blocks).toEqual([]);
      expect(lesson.blockCount).toBeNull();
      expect(lesson.job).toMatchObject({ id: first.jobId, blockIndex: 0, status: 'queued' });
    });

    it('does nothing when block 0 already exists', async () => {
      const id = await lessonSession();
      await addBlock(id, 0, 'open');
      expect((await startLesson(db, queue, slug, id)).jobId).toBeNull();
      expect(queue.add).not.toHaveBeenCalled();
    });

    it('refuses an ended session', async () => {
      const id = await lessonSession(null);
      await db.update(studySessions).set({ status: 'ended' }).where(eq(studySessions.id, id));
      await expect(startLesson(db, queue, slug, id)).rejects.toBeInstanceOf(ConflictError);
    });
  });

  describe('checkLessonBlock', () => {
    it('hides the expected answer until the block is done', async () => {
      const id = await lessonSession();
      await addBlock(id, 0, 'open');
      const before = await getLesson(db, slug, id);
      expect(before.blocks[0]?.checkAnswer).toBeNull();
      expect(before.blocks[0]?.citations[0]?.documentName).toBe('Appunti cap.4.pdf');

      await checkLessonBlock(db, new FakeProvider(), queue, slug, id, 0, { answer: 'Boh' });
      const after = await getLesson(db, slug, id);
      expect(after.blocks[0]).toMatchObject({ state: 'done', studentAnswer: 'Boh' });
      expect(after.blocks[0]?.checkAnswer).toBe('Si può scambiare l’ordine di integrazione');
    });

    it('opens block n+1, queues block n+2 and moves block_index', async () => {
      const id = await lessonSession(4);
      await addBlock(id, 0, 'open');
      const second = await addBlock(id, 1, 'locked');

      const result = await checkLessonBlock(db, new FakeProvider(), queue, slug, id, 0, {
        answer: 'Si può scambiare l’ordine di integrazione',
      });
      expect(['ok', 'partial', 'wrong']).toContain(result.verdict);
      expect(result.block.state).toBe('done');
      expect(result.nextBlock).toMatchObject({ id: second, state: 'open', checkAnswer: null });

      const queued = queue.add.mock.calls.map((c) => (c[1] as { blockIndex: number }).blockIndex);
      expect(queued).toEqual([2]);
      const [session] = await db.select().from(studySessions).where(eq(studySessions.id, id));
      expect(session?.blockIndex).toBe(1);

      // Answering again is refused, and so is skipping ahead.
      await expect(
        checkLessonBlock(db, new FakeProvider(), queue, slug, id, 0, { answer: 'di nuovo' }),
      ).rejects.toBeInstanceOf(ConflictError);
    });

    it('does not queue past the last block and refuses a locked block', async () => {
      const id = await lessonSession(2);
      await addBlock(id, 0, 'open');
      await addBlock(id, 1, 'locked');
      await expect(
        checkLessonBlock(db, new FakeProvider(), queue, slug, id, 1, { answer: 'x' }),
      ).rejects.toBeInstanceOf(ConflictError);

      await checkLessonBlock(db, new FakeProvider(), queue, slug, id, 0, { answer: 'x' });
      expect(queue.add).not.toHaveBeenCalled();
      const last = await checkLessonBlock(db, new FakeProvider(), queue, slug, id, 1, {
        answer: 'x',
      });
      expect(last.nextBlock).toBeNull();
      const [session] = await db.select().from(studySessions).where(eq(studySessions.id, id));
      expect(session?.blockIndex).toBe(1);
    });

    it('unknown block is not found', async () => {
      const id = await lessonSession();
      await expect(
        checkLessonBlock(db, new FakeProvider(), queue, slug, id, 3, { answer: 'x' }),
      ).rejects.toBeInstanceOf(NotFoundError);
    });

    it('records the correction in the lesson cost ledger', async () => {
      const id = await lessonSession();
      await addBlock(id, 0, 'open');
      await checkLessonBlock(db, new FakeProvider(), queue, slug, id, 0, { answer: 'x' });
      const ledger = await db.select().from(jobs).where(eq(jobs.type, 'session_grade'));
      expect(ledger).toHaveLength(1);
      expect(ledger[0]?.input).toMatchObject({ sessionId: id });
    });
  });

  describe('regenerateLessonBlock', () => {
    it('queues a regeneration with the hint and refuses a duplicate', async () => {
      const id = await lessonSession();
      await addBlock(id, 0, 'open');
      const { jobId } = await regenerateLessonBlock(db, queue, slug, id, 0, { hint: 'simpler' });
      expect(queue.add.mock.calls[0]![1]).toMatchObject({
        blockIndex: 0,
        regenerate: true,
        hint: 'simpler',
      });
      const [row] = await db.select().from(jobs).where(eq(jobs.id, jobId));
      expect(row?.status).toBe('queued');
      await expect(regenerateLessonBlock(db, queue, slug, id, 0, {})).rejects.toBeInstanceOf(
        ConflictError,
      );
    });

    it('refuses a locked or missing block', async () => {
      const id = await lessonSession();
      await addBlock(id, 1, 'locked');
      await expect(regenerateLessonBlock(db, queue, slug, id, 1, {})).rejects.toBeInstanceOf(
        ConflictError,
      );
      await expect(regenerateLessonBlock(db, queue, slug, id, 5, {})).rejects.toBeInstanceOf(
        NotFoundError,
      );
    });
  });

  describe('review fixes', () => {
    it('retries a block whose job failed: plain generation, and the failed job is surfaced', async () => {
      const id = await lessonSession(4);
      await addBlock(id, 0, 'open');
      await checkLessonBlock(db, new FakeProvider(), queue, slug, id, 0, { answer: 'x' });
      queue.add.mockClear();
      await db.delete(jobs); // drop the jobs the check queued
      // Block 1 never got created: its job failed.
      const failedId = randomUUID();
      await db.insert(jobs).values({
        id: failedId,
        type: 'generate_lesson_block',
        subjectId,
        status: 'failed',
        input: { sessionId: id, blockIndex: 1 },
        error: { code: 'job_failed', message: 'Budget superato', retryable: true },
        createdAt: new Date(Date.now() - 5000),
      });
      await db.insert(jobs).values({
        id: randomUUID(),
        type: 'generate_lesson_block',
        subjectId,
        status: 'succeeded',
        input: { sessionId: id, blockIndex: 0 },
        createdAt: new Date(Date.now() - 2000),
      });
      const lesson = await getLesson(db, slug, id);
      expect(lesson.job).toMatchObject({ id: failedId, blockIndex: 1, status: 'failed' });
      expect(lesson.job?.error).toBe('Budget superato');

      const { jobId } = await regenerateLessonBlock(db, queue, slug, id, 1, {});
      expect(queue.add.mock.calls[0]![1]).toMatchObject({ blockIndex: 1, regenerate: false });
      const after = await getLesson(db, slug, id);
      expect(after.job).toMatchObject({ id: jobId, blockIndex: 1, status: 'queued' });
    });

    it('a missing block can be retried only once the previous one is answered', async () => {
      const id = await lessonSession(4);
      await addBlock(id, 0, 'open');
      await expect(regenerateLessonBlock(db, queue, slug, id, 1, {})).rejects.toBeInstanceOf(
        ConflictError,
      );
      const none = await lessonSession(null);
      const { jobId } = await regenerateLessonBlock(db, queue, slug, none, 0, {});
      expect(jobId).toBeTruthy();
      expect(queue.add.mock.calls.at(-1)![1]).toMatchObject({ blockIndex: 0, regenerate: false });
    });

    it('propagates the model chosen at start to later jobs', async () => {
      const id = await lessonSession(4);
      await startLesson(db, queue, slug, id, { model: 'claude-opus-4-7' });
      await db.update(jobs).set({ status: 'succeeded' });
      await addBlock(id, 0, 'open');
      await addBlock(id, 1, 'locked');
      queue.add.mockClear();
      await checkLessonBlock(db, new FakeProvider(), queue, slug, id, 0, { answer: 'x' });
      expect(queue.add.mock.calls[0]![1]).toMatchObject({
        blockIndex: 2,
        model: 'claude-opus-4-7',
      });
    });

    it('a double submit is graded once and the second gets a conflict', async () => {
      const id = await lessonSession();
      await addBlock(id, 0, 'open');
      const grade = vi.spyOn(FakeProvider.prototype, 'gradeAnswer');
      const results = await Promise.allSettled([
        checkLessonBlock(db, new FakeProvider(), queue, slug, id, 0, { answer: 'a' }),
        checkLessonBlock(db, new FakeProvider(), queue, slug, id, 0, { answer: 'a' }),
      ]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
      expect(rejected.reason).toBeInstanceOf(ConflictError);
      expect(grade).toHaveBeenCalledTimes(1);
      grade.mockRestore();
    });

    it('a failed grading gives the block back', async () => {
      const id = await lessonSession();
      await addBlock(id, 0, 'open');
      const grade = vi
        .spyOn(FakeProvider.prototype, 'gradeAnswer')
        .mockRejectedValueOnce(new Error('rete'));
      await expect(
        checkLessonBlock(db, new FakeProvider(), queue, slug, id, 0, { answer: 'a' }),
      ).rejects.toThrow('rete');
      grade.mockRestore();
      expect((await getLesson(db, slug, id)).blocks[0]?.state).toBe('open');
    });

    it('regenerate on an answered block is refused', async () => {
      const id = await lessonSession();
      await addBlock(id, 0, 'open');
      await checkLessonBlock(db, new FakeProvider(), queue, slug, id, 0, { answer: 'x' });
      await expect(regenerateLessonBlock(db, queue, slug, id, 0, {})).rejects.toBeInstanceOf(
        ConflictError,
      );
    });

    it('PATCH phase is refused on a session without phases', async () => {
      const free = await startSession(db, slug, { topicIds: [topicId] });
      await expect(updateSession(db, slug, free.id, { phase: 'rework' })).rejects.toBeInstanceOf(
        InvalidRequestError,
      );
    });
  });

  it('verdict thresholds', () => {
    expect(verdictForScore(0.75)).toBe('ok');
    expect(verdictForScore(0.5)).toBe('partial');
    expect(verdictForScore(0.4)).toBe('partial');
    expect(verdictForScore(0.39)).toBe('wrong');
  });
});
