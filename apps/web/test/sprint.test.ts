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
import { startSession, updateSession } from '../src/lib/sessions';
import { checkLessonBlock, getLesson, startLesson } from '../src/lib/lesson';
import { getSprint, startSprint, startSprintTheory } from '../src/lib/sprint';
import {
  getBriefing,
  gradeSessionItem,
  startBriefing,
  updateSessionItem,
} from '../src/lib/sessionBriefing';
import { ConflictError, InvalidRequestError } from '../src/lib/examPrep';

describe('sprint lesson', () => {
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
    dataRoot = await mkdtemp(join(tmpdir(), 'studyhub-sprint-'));
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

  async function addTask(method: 'standard' | 'sprint') {
    const id = randomUUID();
    await db.insert(tasks).values({
      id,
      subjectId,
      planId,
      taskKey: `t:${id.slice(0, 4)}`,
      date: '2026-09-29',
      kind: 'lesson',
      minutes: 60,
      title: 'Lavoro ed energia',
      description: '',
      topicId,
      payload: { action: 'lesson', method, topicId },
      status: 'todo',
    });
    return id;
  }

  async function sprintSession() {
    return (await startSession(db, slug, { taskId: await addTask('sprint') })).id;
  }

  /** What the worker saves: 3 exercises with their concepts and one retry each. */
  async function addExercises(sessionId: string) {
    const exercises: string[] = [];
    const retries: string[] = [];
    const concepts = [
      ['Lavoro di una forza'],
      ['Energia cinetica', 'lavoro di una forza.'],
      ['Potenza'],
    ];
    for (let i = 0; i < 3; i++) {
      const id = randomUUID();
      exercises.push(id);
      await db.insert(sessionItems).values({
        id,
        sessionId,
        kind: 'exercise',
        orderIndex: i,
        title: `Esercizio ${i + 1}`,
        body: `1. Soluzione ${i + 1}`,
        solutionSteps: [{ text: `Soluzione ${i + 1}` }, { text: 'Concludi', formula: 'x=1' }],
        concepts: concepts[i]!,
        citations: [{ docId, page: 1, quote: 'Il lavoro di una forza' }],
      });
      const retryId = randomUUID();
      retries.push(retryId);
      await db.insert(sessionItems).values({
        id: retryId,
        sessionId,
        kind: 'retry_exercise',
        orderIndex: i,
        title: `Riprova ${i + 1}`,
        body: `1. Soluzione riprova ${i + 1}`,
        solutionSteps: [{ text: 'Passo' }],
        citations: [{ docId, page: 1, quote: 'Il lavoro di una forza' }],
        parentItemId: id,
      });
    }
    return { exercises, retries };
  }

  const mark = (sessionId: string, itemId: string, state: 'correct' | 'wrong' | 'unknown') =>
    updateSessionItem(db, slug, sessionId, itemId, { state });

  const jobsOf = (type: string) =>
    db.select().from(jobs).where(eq(jobs.type, type)).orderBy(asc(jobs.createdAt));

  describe('phases', () => {
    it('a sprint lesson opens on the exercises and moves among the sprint phases', async () => {
      const session = await startSession(db, slug, { taskId: await addTask('sprint') });
      expect(session).toMatchObject({ method: 'sprint', phase: 'exercises' });
      for (const phase of ['theory', 'retry', 'recall', 'exercises'] as const) {
        expect((await updateSession(db, slug, session.id, { phase })).phase).toBe(phase);
      }
      for (const phase of ['understand', 'rework', 'explore'] as const) {
        await expect(updateSession(db, slug, session.id, { phase })).rejects.toBeInstanceOf(
          InvalidRequestError,
        );
      }
    });

    it('a sprint from before the sprint phases stays on its single phase', async () => {
      const id = await sprintSession();
      await db.update(studySessions).set({ phase: 'understand' }).where(eq(studySessions.id, id));
      expect((await updateSession(db, slug, id, { phase: 'understand' })).phase).toBe('understand');
      await expect(getSprint(db, slug, id)).rejects.toThrow(/non è una lezione sprint/);
      await expect(startSprint(db, queue, slug, id, { force: false })).rejects.toThrow(
        ConflictError,
      );
    });

    it('the sprint routes refuse a standard lesson', async () => {
      const standard = (await startSession(db, slug, { taskId: await addTask('standard') })).id;
      await expect(getSprint(db, slug, standard)).rejects.toThrow(/non è una lezione sprint/);
      await expect(startSprint(db, queue, slug, standard, { force: false })).rejects.toThrow(
        ConflictError,
      );
      await expect(startSprintTheory(db, queue, slug, standard, { force: false })).rejects.toThrow(
        ConflictError,
      );
      expect(queue.add).not.toHaveBeenCalled();
    });

    it('the sprint exercises job is not shown as a briefing, and the briefing cannot start', async () => {
      const id = await sprintSession();
      await startSprint(db, queue, slug, id, { force: false });
      queue.add.mockClear();
      expect((await getBriefing(db, slug, id)).job).toBeNull();
      await expect(
        startBriefing(db, queue, slug, id, { mode: 'all', force: false }),
      ).rejects.toThrow(/lezione sprint/);
      expect(queue.add).not.toHaveBeenCalled();
    });

    it('the guided-lesson start refuses a sprint on the new phases', async () => {
      const id = await sprintSession();
      await expect(startLesson(db, queue, slug, id)).rejects.toThrow(/dagli esercizi/);
    });
  });

  describe('startSprint', () => {
    it('queues the generation once and records it as the latest job of the session', async () => {
      const id = await sprintSession();
      const { jobId } = await startSprint(db, queue, slug, id, { force: false, model: 'm' });
      expect(jobId).toBeTruthy();
      expect(queue.add).toHaveBeenCalledTimes(1);
      expect(queue.add).toHaveBeenCalledWith(
        'generate_sprint_exercises',
        { subjectId, sessionId: id, force: false, model: 'm' },
        { jobId },
      );
      const [row] = await jobsOf('generate_sprint_exercises');
      expect(row).toMatchObject({ id: jobId, status: 'queued', subjectId });
      const [session] = await db.select().from(studySessions).where(eq(studySessions.id, id));
      expect(session?.briefingJobId).toBe(jobId);

      const state = await getSprint(db, slug, id);
      expect(state.job).toEqual({ id: jobId, status: 'queued', error: null });
      expect(state.exercises).toEqual([]);
    });

    it('a second or concurrent request attaches to the running job instead of queueing another', async () => {
      const id = await sprintSession();
      const [a, b] = await Promise.all([
        startSprint(db, queue, slug, id, { force: false }),
        startSprint(db, queue, slug, id, { force: false }),
      ]);
      expect(queue.add).toHaveBeenCalledTimes(1);
      expect(a.jobId).toBe(b.jobId);
      const again = await startSprint(db, queue, slug, id, { force: false });
      expect(again.jobId).toBe(a.jobId);
      expect(queue.add).toHaveBeenCalledTimes(1);
    });

    it('does nothing when the exercises already exist; retries after a failed job', async () => {
      const id = await sprintSession();
      const first = await startSprint(db, queue, slug, id, { force: false });
      await db
        .update(jobs)
        .set({ status: 'failed', error: { message: 'Budget finito' } })
        .where(eq(jobs.id, first.jobId!));
      const failed = await getSprint(db, slug, id);
      expect(failed.job).toEqual({ id: first.jobId, status: 'failed', error: 'Budget finito' });

      const second = await startSprint(db, queue, slug, id, { force: false });
      expect(second.jobId).not.toBe(first.jobId);
      expect(queue.add).toHaveBeenCalledTimes(2);

      await addExercises(id);
      expect(await startSprint(db, queue, slug, id, { force: false })).toEqual({ jobId: null });
      expect(queue.add).toHaveBeenCalledTimes(2);
    });

    it('marks the job failed when it cannot be queued, so the page does not wait forever', async () => {
      const id = await sprintSession();
      queue.add.mockRejectedValueOnce(new Error('Redis non risponde'));
      await expect(startSprint(db, queue, slug, id, { force: false })).rejects.toThrow(/Redis/);
      const [row] = await jobsOf('generate_sprint_exercises');
      expect(row).toMatchObject({ status: 'failed', error: { message: 'Redis non risponde' } });
      const state = await getSprint(db, slug, id);
      expect(state.job).toMatchObject({ status: 'failed', error: 'Redis non risponde' });
      // And it can be tried again.
      await startSprint(db, queue, slug, id, { force: false });
      expect(queue.add).toHaveBeenCalledTimes(2);
    });

    it('refuses an ended session and one without documents', async () => {
      const id = await sprintSession();
      await db.update(studySessions).set({ documentIds: [] }).where(eq(studySessions.id, id));
      await expect(startSprint(db, queue, slug, id, { force: false })).rejects.toThrow(
        /non ha documenti/,
      );
      await db
        .update(studySessions)
        .set({ documentIds: [docId], status: 'ended' })
        .where(eq(studySessions.id, id));
      await expect(startSprint(db, queue, slug, id, { force: false })).rejects.toThrow(
        /già terminata/,
      );
    });
  });

  describe('exercises and self-assessment', () => {
    it('hides the solution until the student self-assesses or asks for it', async () => {
      const id = await sprintSession();
      const { exercises, retries } = await addExercises(id);

      let state = await getSprint(db, slug, id);
      expect(state.exercises.map((e) => e.title)).toEqual([
        'Esercizio 1',
        'Esercizio 2',
        'Esercizio 3',
      ]);
      for (const e of state.exercises) {
        expect(e).toMatchObject({
          body: '',
          solutionSteps: [],
          solutionVisible: false,
          state: 'open',
          linkedBlockIds: [],
        });
        expect(e.concepts.length).toBeGreaterThan(0);
      }
      expect(state.exercises[0]?.retryId).toBe(retries[0]);

      // "Mostra soluzione" reveals it without assessing.
      const revealed = await updateSessionItem(db, slug, id, exercises[0]!, {
        revealSolution: true,
      });
      expect(revealed).toMatchObject({ state: 'open', solutionVisible: true });
      expect(revealed.body).toContain('Soluzione 1');
      expect(revealed.solutionSteps).toHaveLength(2);

      // "Non so da dove partire" is a state of its own and shows the solution too.
      const unknown = await mark(id, exercises[1]!, 'unknown');
      expect(unknown).toMatchObject({ state: 'unknown', solutionVisible: true });
      const wrong = await mark(id, exercises[2]!, 'wrong');
      expect(wrong.solutionSteps).toHaveLength(2);

      state = await getSprint(db, slug, id);
      expect(state.exercises.map((e) => e.state)).toEqual(['open', 'unknown', 'wrong']);
    });

    it('accepts "non so" only on the exercises of a sprint lesson', async () => {
      const id = await sprintSession();
      const { exercises, retries } = await addExercises(id);
      await expect(mark(id, retries[0]!, 'unknown')).rejects.toThrow(ConflictError);
      await expect(
        updateSessionItem(db, slug, id, retries[0]!, { state: 'correct' }),
      ).resolves.toMatchObject({ state: 'correct' });
      expect((await mark(id, exercises[0]!, 'unknown')).state).toBe('unknown');

      // A standard session's exercise is open, correct or wrong only, and has no solution to reveal.
      const standardId = (await startSession(db, slug, { taskId: await addTask('standard') })).id;
      const std = randomUUID();
      await db.insert(sessionItems).values({
        id: std,
        sessionId: standardId,
        kind: 'exercise',
        orderIndex: 0,
        title: 'Esercizio',
        body: 'Soluzione',
      });
      await expect(mark(standardId, std, 'unknown')).rejects.toThrow(ConflictError);
      await expect(
        updateSessionItem(db, slug, standardId, std, { revealSolution: true }),
      ).rejects.toThrow(/lezione sprint/);
      const dto = await updateSessionItem(db, slug, standardId, std, { state: 'wrong' });
      expect(dto).toMatchObject({ body: 'Soluzione', solutionVisible: true, concepts: [] });
    });

    it('keeps the retries out of the standard briefing list', async () => {
      const id = await sprintSession();
      await addExercises(id);
      const briefing = await getBriefing(db, slug, id);
      expect(briefing.items.map((i) => i.kind)).toEqual(['exercise', 'exercise', 'exercise']);
    });
  });

  describe('retries', () => {
    it('are the retries of the exercises that were not solved, in order', async () => {
      const id = await sprintSession();
      const { exercises, retries } = await addExercises(id);
      await mark(id, exercises[0]!, 'correct');
      await mark(id, exercises[1]!, 'unknown');
      await mark(id, exercises[2]!, 'wrong');
      const state = await getSprint(db, slug, id);
      expect(state.retries.map((r) => r.id)).toEqual([retries[1], retries[2]]);
      expect(state.retries.map((r) => r.parentItemId)).toEqual([exercises[1], exercises[2]]);
      expect(state.retries.every((r) => r.kind === 'retry_exercise')).toBe(true);
    });

    it('are just the first one when every exercise was right', async () => {
      const id = await sprintSession();
      const { exercises, retries } = await addExercises(id);
      for (const e of exercises) await mark(id, e, 'correct');
      const state = await getSprint(db, slug, id);
      expect(state.retries.map((r) => r.id)).toEqual([retries[0]]);
    });

    it('are corrected with the existing grading, answer in, state out', async () => {
      const id = await sprintSession();
      const { retries } = await addExercises(id);
      const grader: AiProvider = Object.assign(Object.create(new FakeProvider()), {
        async gradeAnswer() {
          return {
            data: {
              criteria: [{ criterion: 'Risposta', awarded: 0.9, max: 1, feedback: 'Ci sei.' }],
              missing: [],
            },
            usage: { inputTokens: 10, outputTokens: 5 },
            model: 'claude-sonnet-5-5',
            promptVersion: 'grading/v1',
          };
        },
      });
      await expect(gradeSessionItem(db, grader, slug, id, retries[0]!, {})).rejects.toThrow(
        /Scrivi prima la tua risposta/,
      );
      await updateSessionItem(db, slug, id, retries[0]!, { answer: 'Applico la definizione' });
      const graded = await gradeSessionItem(db, grader, slug, id, retries[0]!, {});
      expect(graded).toMatchObject({ state: 'correct', kind: 'retry_exercise' });
      expect(graded.feedback?.score).toBe(0.9);
      expect(graded.solutionVisible).toBe(true);
      expect((await getSprint(db, slug, id)).costEur).toBeGreaterThanOrEqual(0);
    });
  });

  describe('theory', () => {
    it('needs the exercises first, and has nothing to do before any is marked', async () => {
      const id = await sprintSession();
      await expect(startSprintTheory(db, queue, slug, id, { force: false })).rejects.toThrow(
        /Genera prima gli esercizi/,
      );
      await addExercises(id);
      expect(await startSprintTheory(db, queue, slug, id, { force: false })).toEqual({
        jobIds: [],
        blockCount: 0,
      });
      expect((await getSprint(db, slug, id)).theory).toEqual({
        state: 'idle',
        concepts: [],
        error: null,
      });
    });

    it('queues one focused block per concept of the wrong exercises, deduplicated, in order', async () => {
      const id = await sprintSession();
      const { exercises } = await addExercises(id);
      await mark(id, exercises[0]!, 'wrong');
      await mark(id, exercises[1]!, 'unknown');
      await mark(id, exercises[2]!, 'correct'); // its concept is not reviewed

      const result = await startSprintTheory(db, queue, slug, id, { force: false, model: 'm' });
      // Lavoro di una forza (twice, once with another spelling) + Energia cinetica.
      expect(result.jobIds).toHaveLength(2);
      expect(result.blockCount).toBe(2);
      const queued = await jobsOf('generate_lesson_block');
      expect(queued.map((j) => j.input)).toEqual([
        {
          subjectId,
          sessionId: id,
          blockIndex: 0,
          regenerate: false,
          force: false,
          model: 'm',
          focus: { concept: 'Lavoro di una forza', exercise: 'Esercizio 1' },
        },
        {
          subjectId,
          sessionId: id,
          blockIndex: 1,
          regenerate: false,
          force: false,
          model: 'm',
          focus: { concept: 'Energia cinetica', exercise: 'Esercizio 2' },
        },
      ]);
      expect(queue.add).toHaveBeenCalledTimes(2);
      const [session] = await db.select().from(studySessions).where(eq(studySessions.id, id));
      expect(session?.blockCount).toBe(2);

      const state = await getSprint(db, slug, id);
      expect(state.theory.state).toBe('generating');
      expect(state.theory.concepts).toEqual([
        { title: 'Lavoro di una forza', exerciseIds: [exercises[0], exercises[1]], blockId: null },
        { title: 'Energia cinetica', exerciseIds: [exercises[1]], blockId: null },
      ]);
    });

    it('is idempotent and safe against concurrent requests', async () => {
      const id = await sprintSession();
      const { exercises } = await addExercises(id);
      await mark(id, exercises[0]!, 'wrong');
      await Promise.all([
        startSprintTheory(db, queue, slug, id, { force: false }),
        startSprintTheory(db, queue, slug, id, { force: false }),
      ]);
      expect(queue.add).toHaveBeenCalledTimes(1);
      const again = await startSprintTheory(db, queue, slug, id, { force: false });
      expect(again).toEqual({ jobIds: [], blockCount: 1 });
      expect(queue.add).toHaveBeenCalledTimes(1);
      expect(await jobsOf('generate_lesson_block')).toHaveLength(1);
    });

    it('appends new concepts after the existing blocks and links the ones that exist', async () => {
      const id = await sprintSession();
      const { exercises } = await addExercises(id);
      await mark(id, exercises[0]!, 'wrong');
      await startSprintTheory(db, queue, slug, id, { force: false });
      // The worker has made block 0 (and linked it to its exercise).
      const blockId = randomUUID();
      await db.insert(lessonBlocks).values({
        id: blockId,
        sessionId: id,
        orderIndex: 0,
        title: 'Il lavoro',
        body: 'Spiegazione',
        concept: 'lavoro di una forza',
        state: 'open',
      });
      await db
        .update(jobs)
        .set({ status: 'succeeded' })
        .where(eq(jobs.type, 'generate_lesson_block'));

      // Another exercise goes wrong afterwards: its second concept gets the next index, the shared
      // concept reuses block 0 and the exercise is linked to it right away.
      await mark(id, exercises[1]!, 'wrong');
      const result = await startSprintTheory(db, queue, slug, id, { force: false });
      expect(result.jobIds).toHaveLength(1);
      expect(result.blockCount).toBe(2);
      const queued = await jobsOf('generate_lesson_block');
      expect(queued[1]?.input).toMatchObject({
        blockIndex: 1,
        focus: { concept: 'Energia cinetica' },
      });

      const [second] = await db
        .select()
        .from(sessionItems)
        .where(eq(sessionItems.id, exercises[1]!));
      expect(second?.linkedBlockIds).toEqual([blockId]);

      const state = await getSprint(db, slug, id);
      expect(state.theory.state).toBe('generating');
      expect(state.theory.concepts.map((c) => [c.title, c.blockId])).toEqual([
        ['Lavoro di una forza', blockId],
        ['Energia cinetica', null],
      ]);
    });

    it('reports ready, failed and empty, and retries a failed block with the same index', async () => {
      const id = await sprintSession();
      const { exercises } = await addExercises(id);
      await mark(id, exercises[2]!, 'wrong'); // Potenza
      const first = await startSprintTheory(db, queue, slug, id, { force: false });
      await db
        .update(jobs)
        .set({ status: 'failed', error: { message: 'Modello non raggiungibile' } })
        .where(eq(jobs.id, first.jobIds[0]!));
      expect((await getSprint(db, slug, id)).theory).toMatchObject({
        state: 'failed',
        error: 'Modello non raggiungibile',
      });

      const retried = await startSprintTheory(db, queue, slug, id, { force: false });
      expect(retried.jobIds).toHaveLength(1);
      expect(retried.blockCount).toBe(1);
      const queued = await jobsOf('generate_lesson_block');
      expect(queued.map((j) => (j.input as { blockIndex: number }).blockIndex)).toEqual([0, 0]);
      expect((await getSprint(db, slug, id)).theory.state).toBe('generating');

      await db.insert(lessonBlocks).values({
        id: randomUUID(),
        sessionId: id,
        orderIndex: 0,
        title: 'Potenza',
        body: 'x',
        concept: 'potenza',
      });
      expect((await getSprint(db, slug, id)).theory.state).toBe('ready');

      for (const e of exercises) await mark(id, e, 'correct');
      expect((await getSprint(db, slug, id)).theory).toEqual({
        state: 'empty',
        concepts: [],
        error: null,
      });
    });

    it('two concurrent requests retry a failed block only once', async () => {
      const id = await sprintSession();
      const { exercises } = await addExercises(id);
      await mark(id, exercises[2]!, 'wrong');
      const first = await startSprintTheory(db, queue, slug, id, { force: false });
      await db
        .update(jobs)
        .set({ status: 'failed', error: { message: 'x' } })
        .where(eq(jobs.id, first.jobIds[0]!));
      queue.add.mockClear();
      await Promise.all([
        startSprintTheory(db, queue, slug, id, { force: false }),
        startSprintTheory(db, queue, slug, id, { force: false }),
      ]);
      expect(queue.add).toHaveBeenCalledTimes(1);
      expect(await jobsOf('generate_lesson_block')).toHaveLength(2);
    });

    it('marks the job failed when it cannot be queued', async () => {
      const id = await sprintSession();
      const { exercises } = await addExercises(id);
      await mark(id, exercises[0]!, 'wrong');
      queue.add.mockRejectedValueOnce(new Error('Redis non risponde'));
      await expect(startSprintTheory(db, queue, slug, id, { force: false })).rejects.toThrow(
        /Redis/,
      );
      const [row] = await jobsOf('generate_lesson_block');
      expect(row?.status).toBe('failed');
    });

    it('the blocks are read from the guided-lesson route, and checking one keeps its focus', async () => {
      const id = await sprintSession();
      const { exercises } = await addExercises(id);
      await mark(id, exercises[0]!, 'wrong');
      await mark(id, exercises[1]!, 'wrong');
      await startSprintTheory(db, queue, slug, id, { force: false });
      queue.add.mockClear();

      const b0 = randomUUID();
      await db.insert(lessonBlocks).values({
        id: b0,
        sessionId: id,
        orderIndex: 0,
        title: 'Il lavoro',
        body: 'Spiegazione',
        checkQuestion: 'Che cos’è il lavoro?',
        checkAnswer: 'Forza per spostamento',
        citations: [{ docId, page: 1, quote: 'Il lavoro di una forza' }],
        concept: 'lavoro di una forza',
        state: 'open',
      });
      // Block 1 failed meanwhile: answering block 0 queues it again, with its own focus.
      await db
        .update(jobs)
        .set({ status: 'failed', error: { message: 'x' } })
        .where(eq(jobs.type, 'generate_lesson_block'));
      expect((await getLesson(db, slug, id)).blocks.map((b) => b.id)).toEqual([b0]);

      const checker = new FakeProvider();
      await checkLessonBlock(db, checker, queue, slug, id, 0, { answer: 'Forza per spostamento' });
      expect(queue.add).toHaveBeenCalledTimes(1);
      expect(queue.add.mock.calls[0]![1]).toMatchObject({
        blockIndex: 1,
        focus: { concept: 'Energia cinetica' },
      });
    });
  });
});
