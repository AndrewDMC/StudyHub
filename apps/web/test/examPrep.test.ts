import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { createTestDb } from '@studyhub/db/testDb';
import {
  artifacts,
  attemptItemResults,
  examProfiles,
  simulationAttempts,
  simulationItems,
  simulations,
} from '@studyhub/db';
import { createSubject } from '../src/lib/subjects';
import {
  ConflictError,
  NotFoundError,
  enqueueSimulation,
  getAttempt,
  getAttemptResults,
  getExamProfile,
  listSimulations,
  saveAnswers,
  startOrResumeAttempt,
  submitAttempt,
  updateExamProfile,
} from '../src/lib/examPrep';

const PROFILE = {
  itemCount: 2,
  durationMin: 60,
  totalPoints: 20,
  kindDistribution: { open: 1 },
  avgMinutesPerItem: 30,
  verbosity: 'media' as const,
  recurringTopics: ['entropia'],
  notes: '',
};

function fakeQueue() {
  return { add: vi.fn().mockResolvedValue({ id: 'job-1' }) };
}

describe('exam prep (web)', () => {
  let dataRoot: string;
  let db: Awaited<ReturnType<typeof createTestDb>>;
  let subjectId: string;
  let slug: string;
  let simulationId: string;
  let itemIds: string[];

  beforeEach(async () => {
    dataRoot = await mkdtemp(join(tmpdir(), 'studyhub-examprep-'));
    db = await createTestDb();
    const subject = await createSubject(db, dataRoot, { name: 'Fisica 1', color: 'blue' });
    subjectId = subject.id;
    slug = subject.slug;

    simulationId = randomUUID();
    await db.insert(artifacts).values({
      id: simulationId,
      subjectId,
      kind: 'simulation',
      title: "Simulazione d'esame — 2 esercizi",
      path: '/x.json',
      model: 'fake-v1',
      promptVersion: 'simulation/v1',
    });
    await db
      .insert(simulations)
      .values({
        artifactId: simulationId,
        mode: 'esame_completo',
        timeBudgetMin: 60,
        totalPoints: 20,
      });
    itemIds = [randomUUID(), randomUUID()];
    for (const [ord, id] of itemIds.entries()) {
      await db.insert(simulationItems).values({
        id,
        simulationId,
        ord,
        prompt: `Domanda ${ord + 1}`,
        kind: 'open',
        points: 10,
        expectedPoints: ['punto'],
        rubric: [{ criterion: 'Punto', points: 10 }],
        solution: 'SOLUZIONE SEGRETA',
        sourceRef: { docId: randomUUID(), page: 7, quote: 'citazione' },
      });
    }
  });

  afterEach(async () => {
    await rm(dataRoot, { recursive: true, force: true });
  });

  describe('exam profile', () => {
    it('is null before extraction; a user edit marks it as edited (re-extraction will respect it)', async () => {
      expect(await getExamProfile(db, slug)).toBeNull();
      await expect(updateExamProfile(db, slug, PROFILE)).rejects.toBeInstanceOf(NotFoundError);

      await db.insert(examProfiles).values({
        id: randomUUID(),
        subjectId,
        sourceDocIds: [],
        profile: PROFILE,
        model: 'fake-v1',
        promptVersion: 'exam_profile/v1',
      });
      const updated = await updateExamProfile(db, slug, { ...PROFILE, durationMin: 90 });
      expect(updated.edited).toBe(true);
      expect(updated.profile.durationMin).toBe(90);
    });
  });

  describe('simulations', () => {
    it('enqueues generation with the subject id resolved from the slug', async () => {
      const queue = fakeQueue();
      await enqueueSimulation(db, queue, slug, {
        mode: 'esame_completo',
        difficulty: 2,
        force: false,
      });
      expect(queue.add).toHaveBeenCalledWith(
        'generate_simulation',
        expect.objectContaining({ subjectId }),
        { jobId: expect.any(String) },
      );
    });

    it('lists simulations with item count and the history trend (last graded score)', async () => {
      const before = await listSimulations(db, slug);
      expect(before[0]).toMatchObject({ itemCount: 2, attemptCount: 0, lastScoreRatio: null });

      await db.insert(simulationAttempts).values({
        id: randomUUID(),
        simulationId,
        durationMin: 60,
        status: 'graded',
        totalAwarded: 15,
        totalMax: 20,
      });
      const after = await listSimulations(db, slug);
      expect(after[0]?.attemptCount).toBe(1);
      expect(after[0]?.lastScoreRatio).toBeCloseTo(0.75, 6);
    });
  });

  describe('exam mode', () => {
    it('starting shows prompts and points but never the solution or rubric', async () => {
      const attempt = await startOrResumeAttempt(db, fakeQueue(), slug, simulationId);
      expect(attempt.items).toHaveLength(2);
      expect(JSON.stringify(attempt)).not.toContain('SOLUZIONE SEGRETA');
      expect(attempt.items[0]).not.toHaveProperty('rubric');
      expect(attempt.remainingSeconds).toBe(3600);
    });

    it('resumes the in-progress attempt instead of starting a new one', async () => {
      const first = await startOrResumeAttempt(db, fakeQueue(), slug, simulationId);
      const second = await startOrResumeAttempt(db, fakeQueue(), slug, simulationId);
      expect(second.id).toBe(first.id);
    });

    it('"chiudo la tab e riapro": answers are there and the timer is derived from the server start time', async () => {
      const start = new Date('2026-01-15T09:00:00.000Z');
      const attempt = await startOrResumeAttempt(db, fakeQueue(), slug, simulationId, start);
      await saveAnswers(
        db,
        fakeQueue(),
        slug,
        attempt.id,
        { [itemIds[0]!]: 'prima risposta' },
        new Date(start.getTime() + 5 * 60_000),
      );

      const reopened = await getAttempt(
        db,
        fakeQueue(),
        slug,
        attempt.id,
        new Date(start.getTime() + 20 * 60_000),
      );
      expect(reopened.answers[itemIds[0]!]).toBe('prima risposta');
      expect(reopened.remainingSeconds).toBe(40 * 60);
    });

    it('autosave merges answers, and rejects ids that are not items of this simulation', async () => {
      const attempt = await startOrResumeAttempt(db, fakeQueue(), slug, simulationId);
      await saveAnswers(db, fakeQueue(), slug, attempt.id, { [itemIds[0]!]: 'a' });
      const merged = await saveAnswers(db, fakeQueue(), slug, attempt.id, { [itemIds[1]!]: 'b' });
      expect(merged.answers).toEqual({ [itemIds[0]!]: 'a', [itemIds[1]!]: 'b' });

      await expect(
        saveAnswers(db, fakeQueue(), slug, attempt.id, { [randomUUID()]: 'x' }),
      ).rejects.toBeInstanceOf(ConflictError);
    });

    it('past the deadline, saving is refused and the attempt is auto-submitted and queued for grading', async () => {
      const start = new Date('2026-01-15T09:00:00.000Z');
      const attempt = await startOrResumeAttempt(db, fakeQueue(), slug, simulationId, start);
      await saveAnswers(db, fakeQueue(), slug, attempt.id, { [itemIds[0]!]: 'in tempo' }, start);

      const queue = fakeQueue();
      const late = new Date(start.getTime() + 61 * 60_000);
      await expect(
        saveAnswers(db, queue, slug, attempt.id, { [itemIds[0]!]: 'fuori tempo' }, late),
      ).rejects.toBeInstanceOf(ConflictError);
      expect(queue.add).toHaveBeenCalledWith('grade_attempt', { attemptId: attempt.id }, {
        jobId: expect.any(String),
      });

      const [row] = await db
        .select()
        .from(simulationAttempts)
        .where(eq(simulationAttempts.id, attempt.id));
      expect(row?.status).toBe('submitted');
      expect(row?.answers[itemIds[0]!]).toBe('in tempo');
      expect(row?.submittedAt?.getTime()).toBe(start.getTime() + 60 * 60_000); // submitted at the deadline, not "late"
    });

    it('submit queues grading exactly once, even if clicked twice', async () => {
      const attempt = await startOrResumeAttempt(db, fakeQueue(), slug, simulationId);
      const queue = fakeQueue();
      await submitAttempt(db, queue, slug, attempt.id);
      const again = await submitAttempt(db, queue, slug, attempt.id);
      expect(again.status).toBe('submitted');
      expect(queue.add).toHaveBeenCalledTimes(1);
    });

    it('an attempt from another subject is not reachable through this subject', async () => {
      const other = await createSubject(db, dataRoot, { name: 'Chimica', color: 'green' });
      const attempt = await startOrResumeAttempt(db, fakeQueue(), slug, simulationId);
      await expect(getAttempt(db, fakeQueue(), other.slug, attempt.id)).rejects.toBeInstanceOf(
        NotFoundError,
      );
    });
  });

  describe('results', () => {
    it('are empty until graded, then reveal solution and the citation to re-study', async () => {
      const attempt = await startOrResumeAttempt(db, fakeQueue(), slug, simulationId);
      expect(await getAttemptResults(db, slug, attempt.id)).toEqual([]);

      await db
        .update(simulationAttempts)
        .set({ status: 'graded', totalAwarded: 6, totalMax: 20 })
        .where(eq(simulationAttempts.id, attempt.id));
      await db.insert(attemptItemResults).values({
        id: randomUUID(),
        attemptId: attempt.id,
        itemId: itemIds[0]!,
        awarded: 6,
        max: 10,
        criteria: [{ criterion: 'Punto', awarded: 6, max: 10, feedback: 'Parziale.' }],
        missing: ['bilancio energetico'],
        sourceRef: { docId: randomUUID(), page: 73, quote: 'bilancio energetico' },
      });

      const results = await getAttemptResults(db, slug, attempt.id);
      expect(results).toHaveLength(1);
      expect(results[0]?.solution).toBe('SOLUZIONE SEGRETA');
      expect(results[0]?.sourceRef.page).toBe(73);
      expect(results[0]?.missing).toEqual(['bilancio energetico']);
    });
  });
});
