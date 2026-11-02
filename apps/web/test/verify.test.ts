import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { asc, eq } from 'drizzle-orm';
import { createTestDb } from '@studyhub/db/testDb';
import {
  documents,
  documentTopics,
  jobs,
  lessonBlocks,
  sessionItems,
  studyPlans,
  studySessions,
  tasks,
  topics,
} from '@studyhub/db';
import { FakeProvider, type AiProvider } from '@studyhub/ai';
import { createSubject } from '../src/lib/subjects';
import { endSession, startSession } from '../src/lib/sessions';
import { gradeSessionItem, updateSessionItem } from '../src/lib/sessionBriefing';
import {
  getVerifyState,
  markVerifyItemUnknown,
  prepareVerifySession,
  retryVerify,
  startVerify,
} from '../src/lib/verify';
import { ConflictError } from '../src/lib/examPrep';

describe('verification (closed material)', () => {
  let dataRoot: string;
  let db: Awaited<ReturnType<typeof createTestDb>>;
  let slug: string;
  let subjectId: string;
  let planId: string;
  let topicId: string;
  let docId: string;
  const queue = { add: vi.fn().mockResolvedValue({ id: 'job' }) };

  beforeEach(async () => {
    queue.add.mockReset().mockResolvedValue({ id: 'job' });
    dataRoot = await mkdtemp(join(tmpdir(), 'studyhub-verify-'));
    db = await createTestDb();
    const subject = await createSubject(db, dataRoot, { name: 'Fisica 1', color: 'violet' });
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
      .values({ id: topicId, subjectId, name: 'Lavoro ed energia', slug: 'lavoro-energia' });
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

  const material = () => [{ docId, pageFrom: 1, pageTo: 5 }];
  const cite = (page = 1) => [{ docId, page, quote: 'Il lavoro di una forza' }];

  async function addTask(kind: 'lesson' | 'verify', key: string, date: string, title: string) {
    const id = randomUUID();
    await db.insert(tasks).values({
      id,
      subjectId,
      planId,
      taskKey: key,
      date,
      kind,
      topicKey: 'topic-1',
      topicId,
      minutes: 30,
      title,
      description: '',
      payload:
        kind === 'verify'
          ? { action: 'verify', topicId, material: material() }
          : { action: 'lesson', method: 'standard', topicId, material: material() },
      status: 'todo',
    });
    return id;
  }

  /** A finished lesson on the topic with `n` exercises (the first `wrong` ones marked wrong) and two blocks. */
  async function lessonWithItems(
    exercises: { state?: 'open' | 'correct' | 'wrong' | 'unknown'; body?: string }[],
    options: { guideQuestion?: boolean; title?: string; key?: string } = {},
  ) {
    const taskId = await addTask(
      'lesson',
      options.key ?? `lesson:topic-1:${randomUUID().slice(0, 4)}`,
      '2026-09-29',
      options.title ?? 'Lezione 1',
    );
    const sessionId = randomUUID();
    await db.insert(studySessions).values({
      id: sessionId,
      subjectId,
      taskId,
      topicIds: [topicId],
      documentIds: [docId],
      kind: 'lesson',
      phase: 'recall',
      status: 'ended',
    });
    const blocks: string[] = [];
    for (let i = 0; i < 2; i++) {
      const id = randomUUID();
      blocks.push(id);
      await db.insert(lessonBlocks).values({
        id,
        sessionId,
        orderIndex: i,
        title: `Blocco ${i + 1}`,
        body: `Spiegazione del blocco ${i + 1}`,
        citations: cite(i + 1),
        state: 'done',
      });
    }
    const ids: string[] = [];
    for (const [i, e] of exercises.entries()) {
      const id = randomUUID();
      ids.push(id);
      await db.insert(sessionItems).values({
        id,
        sessionId,
        kind: 'exercise',
        orderIndex: i,
        title: `Esercizio ${i + 1}`,
        body: e.body ?? `Soluzione ${i + 1}`,
        citations: cite(2),
        state: e.state ?? 'open',
        topicId,
        ...(i === 0 ? { linkedBlockIds: [blocks[0]!] } : {}),
      });
    }
    if (options.guideQuestion) {
      const id = randomUUID();
      ids.push(id);
      await db.insert(sessionItems).values({
        id,
        sessionId,
        kind: 'guide_question',
        orderIndex: 10,
        title: 'Che cos’è il lavoro?',
        body: '',
        state: 'correct',
        topicId,
      });
    }
    return { sessionId, taskId, blocks, ids };
  }

  async function verifyTask(key = 'rev:topic-1:02', date = '2026-10-02') {
    return addTask('verify', key, date, 'Verifica · Lavoro ed energia');
  }

  const itemsOf = (sessionId: string) =>
    db
      .select()
      .from(sessionItems)
      .where(eq(sessionItems.sessionId, sessionId))
      .orderBy(asc(sessionItems.orderIndex));

  const grader = (score: number): AiProvider =>
    Object.assign(Object.create(new FakeProvider()), {
      async gradeAnswer() {
        return {
          data: {
            criteria: [
              { criterion: 'Risposta', awarded: score, max: 1, feedback: 'Ecco il punto.' },
            ],
            missing: [],
          },
          usage: { inputTokens: 10, outputTokens: 5 },
          model: 'claude-sonnet-5-5',
          promptVersion: 'grading/v1',
        };
      },
    });

  async function startVerifySession(options: { queued?: boolean } = {}) {
    const taskId = await verifyTask();
    const session = await startSession(
      db,
      slug,
      { taskId },
      options.queued === false ? {} : { queue },
    );
    return { session, taskId };
  }

  describe('preparation', () => {
    it('copies the failed questions first, with the origin, the blocks and an open state', async () => {
      const lesson = await lessonWithItems(
        [{ state: 'correct' }, { state: 'wrong' }, { state: 'correct' }, { state: 'unknown' }],
        { guideQuestion: true },
      );
      const { session } = await startVerifySession();
      expect(session).toMatchObject({ kind: 'verify', phase: null });

      const rows = await itemsOf(session.id);
      expect(rows).toHaveLength(3);
      // wrong and "non so" first, then the oldest of the rest.
      expect(rows.map((r) => r.parentItemId)).toEqual([
        lesson.ids[1],
        lesson.ids[3],
        lesson.ids[0],
      ]);
      for (const r of rows) {
        expect(r.state).toBe('open');
        expect(r.answer).toBeNull();
        expect(r.linkedBlockIds.length).toBeGreaterThan(0);
      }
      // the exercise without blocks points to the block citing the same page (page 2 -> block 2)
      expect(rows[0]!.linkedBlockIds).toEqual([lesson.blocks[1]]);
      // the one with blocks keeps them
      expect(rows[2]!.linkedBlockIds).toEqual([lesson.blocks[0]]);
      // enough from the lesson: nothing generated
      expect(queue.add).not.toHaveBeenCalled();
      const [row] = await db.select().from(studySessions).where(eq(studySessions.id, session.id));
      expect(row?.verifyPreparedAt).not.toBeNull();
    });

    it('a guide question becomes self-contained: the lesson text is its reference', async () => {
      await lessonWithItems([{}, {}], { guideQuestion: true });
      const { session } = await startVerifySession();
      const rows = await itemsOf(session.id);
      const guide = rows.find((r) => r.kind === 'guide_question');
      expect(guide).toBeDefined();
      expect(guide!.body).toContain('Spiegazione del blocco');
      expect(guide!.citations.length).toBe(1);
    });

    it('is idempotent: starting again or preparing twice at once does not duplicate', async () => {
      await lessonWithItems([{ state: 'wrong' }, {}, {}]);
      const { session, taskId } = await startVerifySession();
      expect(await itemsOf(session.id)).toHaveLength(3);

      const again = await startSession(db, slug, { taskId }, { queue });
      expect(again.id).toBe(session.id);
      const [row] = await db.select().from(studySessions).where(eq(studySessions.id, session.id));
      await Promise.all([
        prepareVerifySession(db, queue, row!),
        prepareVerifySession(db, queue, row!),
      ]);
      expect(await itemsOf(session.id)).toHaveLength(3);
      expect(queue.add).not.toHaveBeenCalled();
    });

    it('concurrent preparations of an unprepared verification copy and queue once', async () => {
      await lessonWithItems([{ state: 'wrong' }]);
      const taskId = await verifyTask();
      const sessionId = randomUUID();
      await db.insert(studySessions).values({
        id: sessionId,
        subjectId,
        taskId,
        topicIds: [topicId],
        documentIds: [docId],
        kind: 'verify',
      });
      const [row] = await db.select().from(studySessions).where(eq(studySessions.id, sessionId));
      await Promise.all([
        prepareVerifySession(db, queue, row!),
        prepareVerifySession(db, queue, row!),
        prepareVerifySession(db, queue, row!),
      ]);
      expect(await itemsOf(sessionId)).toHaveLength(1);
      expect(queue.add).toHaveBeenCalledTimes(1);
      // no orphan job rows left by the calls that lost
      expect(await db.select().from(jobs).where(eq(jobs.type, 'prepare_session'))).toHaveLength(1);
    });

    it('a retry right after the start does not double the questions; later it may generate', async () => {
      const { session } = await startVerifySession({ queued: false });
      // never queued (no queue at start) and just prepared: nothing yet
      expect(await startVerify(db, queue, slug, session.id, { force: false })).toEqual({
        jobId: null,
      });
      expect(queue.add).not.toHaveBeenCalled();
      await db
        .update(studySessions)
        .set({ verifyPreparedAt: new Date(Date.now() - 120_000) })
        .where(eq(studySessions.id, session.id));
      const { jobId } = await startVerify(db, queue, slug, session.id, { force: false });
      expect(jobId).not.toBeNull();
      expect(queue.add).toHaveBeenCalledTimes(1);
    });

    it('only questions on the topic are picked, and their documents join the scope', async () => {
      const otherTopic = randomUUID();
      await db
        .insert(topics)
        .values({ id: otherTopic, subjectId, name: 'Termodinamica', slug: 'termo' });
      const otherDoc = randomUUID();
      await db.insert(documents).values({
        id: otherDoc,
        subjectId,
        type: 'appunti',
        originalName: 'Dispense.pdf',
        storedPath: '/y',
        mime: 'application/pdf',
        bytes: 1,
        sha256: 'd'.repeat(64),
        status: 'parsed',
        pages: 4,
      });
      const lesson = await lessonWithItems([{}, {}, {}]);
      // an item of another topic in the same session, and one on the topic citing another document
      await db
        .update(sessionItems)
        .set({ topicId: otherTopic })
        .where(eq(sessionItems.id, lesson.ids[0]!));
      await db
        .update(sessionItems)
        .set({ citations: [{ docId: otherDoc, page: 1, quote: 'x' }] })
        .where(eq(sessionItems.id, lesson.ids[1]!));
      const { session } = await startVerifySession();
      const rows = await itemsOf(session.id);
      expect(rows.map((r) => r.parentItemId).sort()).toEqual([lesson.ids[1], lesson.ids[2]].sort());
      const [row] = await db.select().from(studySessions).where(eq(studySessions.id, session.id));
      expect(row!.documentIds).toContain(otherDoc);
      expect(row!.documentIds).toContain(docId);
    });

    it('with fewer than 2 questions from the lessons it generates the missing ones', async () => {
      await lessonWithItems([{ state: 'wrong' }]);
      const { session } = await startVerifySession();
      expect(await itemsOf(session.id)).toHaveLength(1);
      expect(queue.add).toHaveBeenCalledTimes(1);
      const [name, data, opts] = queue.add.mock.calls[0]!;
      expect(name).toBe('prepare_session');
      expect(data).toMatchObject({ sessionId: session.id, mode: 'exercises', exerciseCount: 2 });
      const [job] = await db.select().from(jobs).where(eq(jobs.id, opts.jobId));
      expect(job).toMatchObject({ type: 'prepare_session', status: 'queued' });

      const state = await getVerifyState(db, slug, session.id);
      expect(state.job).toMatchObject({ id: opts.jobId, status: 'queued' });
      // asking again while it is on its way does not queue another
      expect(await startVerify(db, queue, slug, session.id, { force: false })).toEqual({
        jobId: opts.jobId,
      });
      expect(queue.add).toHaveBeenCalledTimes(1);
    });

    it('a queue that throws leaves the job failed, never queued forever', async () => {
      queue.add.mockRejectedValueOnce(new Error('redis giù'));
      const { session } = await startVerifySession();
      const state = await getVerifyState(db, slug, session.id);
      expect(state.job).toMatchObject({ status: 'failed', error: 'redis giù' });
      // "Riprova" queues a new one
      await startVerify(db, queue, slug, session.id, { force: false });
      expect(queue.add).toHaveBeenCalledTimes(2);
    });

    it('a second verification brings back what the first got wrong, then the unused ones', async () => {
      const lesson = await lessonWithItems([{ state: 'correct' }, { state: 'correct' }, {}, {}]);
      const first = await startVerifySession();
      const firstRows = await itemsOf(first.session.id);
      expect(firstRows).toHaveLength(3);
      // answer: first right, second wrong, third unknown, then end
      await db
        .update(sessionItems)
        .set({ state: 'correct' })
        .where(eq(sessionItems.id, firstRows[0]!.id));
      await db
        .update(sessionItems)
        .set({ state: 'wrong' })
        .where(eq(sessionItems.id, firstRows[1]!.id));
      await db
        .update(sessionItems)
        .set({ state: 'unknown' })
        .where(eq(sessionItems.id, firstRows[2]!.id));
      await endSession(db, slug, first.session.id);

      const secondTask = await verifyTask('rev:topic-1:03', '2026-10-06');
      const second = await startSession(db, slug, { taskId: secondTask }, { queue });
      const rows = await itemsOf(second.id);
      expect(rows).toHaveLength(3);
      // the two failed in the first verification come first, the unused fourth one follows
      expect(
        rows
          .slice(0, 2)
          .map((r) => r.parentItemId)
          .sort(),
      ).toEqual([firstRows[1]!.parentItemId, firstRows[2]!.parentItemId].sort());
      expect(rows[2]!.parentItemId).toBe(lesson.ids[3]);
    });

    it('an old verification session (no prepared questions) is left alone', async () => {
      const taskId = await verifyTask();
      const sessionId = randomUUID();
      await db.insert(studySessions).values({
        id: sessionId,
        subjectId,
        taskId,
        topicIds: [topicId],
        documentIds: [docId],
        kind: 'verify',
      });
      await db.insert(sessionItems).values({
        id: randomUUID(),
        sessionId,
        kind: 'exercise',
        orderIndex: 0,
        title: 'Vecchio esercizio',
        body: 'Soluzione',
        state: 'correct',
      });
      const again = await startSession(db, slug, { taskId }, { queue });
      expect(again.id).toBe(sessionId);
      expect(await itemsOf(sessionId)).toHaveLength(1);
      const state = await getVerifyState(db, slug, sessionId);
      expect(state).toMatchObject({ prepared: false, job: null });
      expect(queue.add).not.toHaveBeenCalled();
    });

    it('a preparation that failed (session without questions) is picked up again on reopening', async () => {
      await lessonWithItems([{}, {}, {}]);
      const taskId = await verifyTask();
      const sessionId = randomUUID();
      await db.insert(studySessions).values({
        id: sessionId,
        subjectId,
        taskId,
        topicIds: [topicId],
        documentIds: [docId],
        kind: 'verify',
      });
      const again = await startSession(db, slug, { taskId }, { queue });
      expect(again.id).toBe(sessionId);
      expect(await itemsOf(sessionId)).toHaveLength(3);
    });

    it('a lesson session is untouched and is not a verification', async () => {
      const taskId = await addTask('lesson', 'lesson:topic-1:001', '2026-09-29', 'Lezione');
      const session = await startSession(db, slug, { taskId }, { queue });
      expect(session.kind).toBe('lesson');
      await expect(getVerifyState(db, slug, session.id)).rejects.toBeInstanceOf(ConflictError);
    });
  });

  describe('state', () => {
    it('hides the reference answer and the key point until an item has an outcome', async () => {
      await lessonWithItems([{}, {}, {}]);
      const { session } = await startVerifySession();
      const state = await getVerifyState(db, slug, session.id);
      expect(state).toMatchObject({
        prepared: true,
        ended: false,
        subjectName: 'Fisica 1',
        topicName: 'Lavoro ed energia',
        daysOffset: 3,
        summary: null,
      });
      expect(state.items).toHaveLength(3);
      for (const i of state.items) {
        expect(i).toMatchObject({ state: 'open', feedback: null, keyPoint: null });
        expect(i.originLessonTitle).toBe('Lezione 1');
        expect(JSON.stringify(i)).not.toContain('Soluzione');
      }
    });

    it('"+7" is read from the task key', async () => {
      await lessonWithItems([{}, {}]);
      const taskId = await verifyTask('rev:topic-1:03', '2026-10-06');
      const session = await startSession(db, slug, { taskId }, { queue });
      expect((await getVerifyState(db, slug, session.id)).daysOffset).toBe(7);
    });

    it('"Non me lo ricordo" sets unknown without AI and reveals the key point', async () => {
      const lesson = await lessonWithItems([{ state: 'wrong' }, {}, {}]);
      const { session } = await startVerifySession();
      const first = (await getVerifyState(db, slug, session.id)).items[0]!;
      const after = await markVerifyItemUnknown(db, slug, session.id, first.id);
      const item = after.items[0]!;
      expect(item.state).toBe('unknown');
      expect(item.feedback).toBeNull();
      expect(item.keyPoint).toMatchObject({
        title: 'Blocco 1',
        body: 'Spiegazione del blocco 1',
        citation: { docId, documentName: 'Appunti cap.4.pdf', page: 1 },
      });
      expect(lesson.blocks).toHaveLength(2);
      // idempotent
      expect((await markVerifyItemUnknown(db, slug, session.id, first.id)).items[0]!.state).toBe(
        'unknown',
      );
      expect(await db.select().from(jobs).where(eq(jobs.type, 'session_grade'))).toHaveLength(0);
    });

    it('rejects "unknown" on an answered item and on a foreign item', async () => {
      await lessonWithItems([{}, {}, {}]);
      const { session } = await startVerifySession();
      const [a] = await itemsOf(session.id);
      await updateSessionItem(db, slug, session.id, a!.id, { answer: 'Boh' });
      await gradeSessionItem(db, grader(0.9), slug, session.id, a!.id, {});
      await expect(markVerifyItemUnknown(db, slug, session.id, a!.id)).rejects.toBeInstanceOf(
        ConflictError,
      );
      await expect(markVerifyItemUnknown(db, slug, session.id, randomUUID())).rejects.toThrow(
        /non trovat/i,
      );
    });

    it('the student cannot set the outcome by hand or edit a graded answer', async () => {
      await lessonWithItems([{}, {}, {}]);
      const { session } = await startVerifySession();
      const [a] = await itemsOf(session.id);
      await expect(
        updateSessionItem(db, slug, session.id, a!.id, { state: 'correct' }),
      ).rejects.toBeInstanceOf(ConflictError);
      await updateSessionItem(db, slug, session.id, a!.id, { answer: 'Prima risposta' });
      await gradeSessionItem(db, grader(0.2), slug, session.id, a!.id, {});
      await expect(
        updateSessionItem(db, slug, session.id, a!.id, { answer: 'Cambio' }),
      ).rejects.toBeInstanceOf(ConflictError);
    });
  });

  describe('correction, summary and mastery', () => {
    it('a wrong answer shows the key point, a right one does not; the summary counts correct only', async () => {
      await lessonWithItems([{}, {}, {}]);
      const { session } = await startVerifySession();
      const [a, b, c] = await itemsOf(session.id);

      await updateSessionItem(db, slug, session.id, a!.id, { answer: 'Giusta' });
      const right = await gradeSessionItem(db, grader(0.9), slug, session.id, a!.id, {});
      expect(right.state).toBe('correct');
      await updateSessionItem(db, slug, session.id, b!.id, { answer: 'Così così' });
      await gradeSessionItem(db, grader(0.55), slug, session.id, b!.id, {});

      let state = await getVerifyState(db, slug, session.id);
      expect(state.items[0]).toMatchObject({
        state: 'correct',
        feedback: { verdict: 'correct', text: 'Ecco il punto.' },
        keyPoint: null,
      });
      expect(state.items[1]).toMatchObject({ state: 'wrong', feedback: { verdict: 'partial' } });
      expect(state.items[1]!.keyPoint).not.toBeNull();
      expect(state.summary).toBeNull();

      await markVerifyItemUnknown(db, slug, session.id, c!.id);
      state = await getVerifyState(db, slug, session.id);
      expect(state.summary).toMatchObject({ correct: 1, total: 3, nextVerifyDate: null });
      expect(state.summary!.unstable).toHaveLength(2);
      // accuracy (1 + 0.5 + 0) / 3 = 0.5 at weight 0.3, nothing covered yet at weight 0.2 -> 0.6 * 0.5
      expect(state.summary!.masteryNow).toBe(0.3);
      expect(state.summary!.masteryBefore).toBeNull();
    });

    it('no summary while new questions are still being generated', async () => {
      await lessonWithItems([{ state: 'wrong' }]);
      const { session } = await startVerifySession();
      const [only] = await itemsOf(session.id);
      await markVerifyItemUnknown(db, slug, session.id, only!.id);
      const state = await getVerifyState(db, slug, session.id);
      expect(state.job?.status).toBe('queued');
      expect(state.summary).toBeNull();
      await db.update(jobs).set({ status: 'failed' }).where(eq(jobs.id, state.job!.id));
      expect((await getVerifyState(db, slug, session.id)).summary).toMatchObject({ total: 1 });
    });

    it('an answered question is not corrected again', async () => {
      await lessonWithItems([{}, {}, {}]);
      const { session } = await startVerifySession();
      const [a] = await itemsOf(session.id);
      await updateSessionItem(db, slug, session.id, a!.id, { answer: 'ok' });
      await gradeSessionItem(db, grader(0.2), slug, session.id, a!.id, {});
      await expect(
        gradeSessionItem(db, grader(1), slug, session.id, a!.id, {}),
      ).rejects.toBeInstanceOf(ConflictError);
    });

    it('a copied guide question is corrected against the lesson text', async () => {
      await lessonWithItems([{}], { guideQuestion: true });
      const { session } = await startVerifySession();
      const guide = (await itemsOf(session.id)).find((r) => r.kind === 'guide_question')!;
      await updateSessionItem(db, slug, session.id, guide.id, { answer: 'Forza per spostamento' });
      const graded = await gradeSessionItem(db, grader(0.9), slug, session.id, guide.id, {});
      expect(graded.state).toBe('correct');
    });

    it('masteryBefore is the topic value at the start, masteryNow the recomputed one', async () => {
      await db.update(topics).set({ mastery: 0.3 }).where(eq(topics.id, topicId));
      await lessonWithItems([{}, {}, {}]);
      const { session } = await startVerifySession();
      for (const r of await itemsOf(session.id)) {
        await updateSessionItem(db, slug, session.id, r.id, { answer: 'ok' });
        await gradeSessionItem(db, grader(1), slug, session.id, r.id, {});
      }
      const { summary } = await getVerifyState(db, slug, session.id);
      expect(summary).toMatchObject({ correct: 3, total: 3, masteryBefore: 0.3, masteryNow: 0.6 });
      const [topic] = await db.select().from(topics).where(eq(topics.id, topicId));
      expect(topic?.mastery).toBe(0.6);
    });

    it('the next verification of the topic in the plan is reported', async () => {
      await lessonWithItems([{}, {}, {}]);
      await verifyTask('rev:topic-1:03', '2026-10-06');
      const { session } = await startVerifySession();
      for (const r of await itemsOf(session.id))
        await markVerifyItemUnknown(db, slug, session.id, r.id);
      expect((await getVerifyState(db, slug, session.id)).summary?.nextVerifyDate).toBe(
        '2026-10-06',
      );
    });
  });

  describe('Rifalla', () => {
    it('resets only the questions that were not right, in the same session, and the mastery follows', async () => {
      await lessonWithItems([{}, {}, {}]);
      const { session } = await startVerifySession();
      const [a, b, c] = await itemsOf(session.id);
      await updateSessionItem(db, slug, session.id, a!.id, { answer: 'ok' });
      await gradeSessionItem(db, grader(1), slug, session.id, a!.id, {});
      await updateSessionItem(db, slug, session.id, b!.id, { answer: 'no' });
      await gradeSessionItem(db, grader(0), slug, session.id, b!.id, {});
      await markVerifyItemUnknown(db, slug, session.id, c!.id);

      const state = await retryVerify(db, slug, session.id);
      expect(state.summary).toBeNull();
      expect(state.items.map((i) => i.state)).toEqual(['correct', 'open', 'open']);
      expect(state.items[1]).toMatchObject({ studentAnswer: null, feedback: null, keyPoint: null });
      const rows = await itemsOf(session.id);
      expect(rows.map((r) => r.id)).toEqual([a!.id, b!.id, c!.id]);
      expect(rows[1]!.feedback).toBeNull();
      const [topic] = await db.select().from(topics).where(eq(topics.id, topicId));
      expect(topic?.mastery).toBe(0.6);

      // nothing to redo: a no-op
      expect((await retryVerify(db, slug, session.id)).items.map((i) => i.state)).toEqual([
        'correct',
        'open',
        'open',
      ]);
    });

    it('is refused once the session has ended', async () => {
      await lessonWithItems([{}, {}, {}]);
      const { session } = await startVerifySession();
      await endSession(db, slug, session.id);
      await expect(retryVerify(db, slug, session.id)).rejects.toBeInstanceOf(ConflictError);
      await expect(
        startVerify(db, queue, slug, session.id, { force: false }),
      ).rejects.toBeInstanceOf(ConflictError);
      expect((await getVerifyState(db, slug, session.id)).ended).toBe(true);
    });
  });
});
