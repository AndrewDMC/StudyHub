import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { createTestDb } from '@studyhub/db/testDb';
import {
  chunks,
  documentTopics,
  documents,
  jobs,
  sessionItems,
  studySessions,
  topics,
} from '@studyhub/db';
import { createSubject } from '../src/lib/subjects';
import { endSession, startSession } from '../src/lib/sessions';
import {
  estimateBriefing,
  getBriefing,
  startBriefing,
  updateSessionItem,
} from '../src/lib/sessionBriefing';
import { ConflictError, NotFoundError } from '../src/lib/examPrep';

describe('session briefing (key points + exercises)', () => {
  let dataRoot: string;
  let db: Awaited<ReturnType<typeof createTestDb>>;
  let slug: string;
  let subjectId: string;
  let docId: string;
  let sessionId: string;
  const queue = { add: vi.fn().mockResolvedValue({ id: 'job-123' }) };

  async function addItem(kind: 'key_point' | 'exercise', orderIndex: number, title: string) {
    const id = randomUUID();
    await db.insert(sessionItems).values({
      id,
      sessionId,
      kind,
      orderIndex,
      title,
      body: 'Spiegazione',
      difficulty: kind === 'exercise' ? 2 : null,
      citations: [{ docId, page: 1, quote: 'Il teorema di Fubini' }],
    });
    return id;
  }

  beforeEach(async () => {
    queue.add.mockClear();
    dataRoot = await mkdtemp(join(tmpdir(), 'studyhub-briefing-'));
    db = await createTestDb();
    const subject = await createSubject(db, dataRoot, { name: 'Analisi 2', color: 'violet' });
    slug = subject.slug;
    subjectId = subject.id;

    const topicId = randomUUID();
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
      sha256: 'b'.repeat(64),
      status: 'parsed',
      pages: 1,
      mdPath: 'content.md',
    });
    await db.insert(chunks).values({
      id: randomUUID(),
      documentId: docId,
      pageFrom: 1,
      pageTo: 1,
      ord: 0,
      text: 'Il teorema di Fubini permette di scambiare l’ordine di integrazione negli integrali doppi.',
      tokens: 20,
    });
    await db.insert(documentTopics).values({ documentId: docId, topicId });
    sessionId = (await startSession(db, slug, { topicIds: [topicId] })).id;
  });

  afterEach(async () => {
    await rm(dataRoot, { recursive: true, force: true });
  });

  describe('startBriefing', () => {
    it('enqueues prepare_session with the chosen model and remembers the job on the session', async () => {
      const { jobId } = await startBriefing(db, queue, slug, sessionId, {
        mode: 'all',
        model: 'claude-haiku-4-5-20251001',
        force: false,
      });
      expect(queue.add).toHaveBeenCalledWith(
        'prepare_session',
        {
          subjectId,
          sessionId,
          mode: 'all',
          force: false,
          model: 'claude-haiku-4-5-20251001',
        },
        { jobId },
      );
      const brief = await getBriefing(db, slug, sessionId);
      expect(brief.job).toEqual({ id: jobId, mode: 'all', status: 'queued', error: null });
    });

    it('does not start a second generation while one is waiting or running', async () => {
      await startBriefing(db, queue, slug, sessionId, { mode: 'all', force: false });
      await expect(
        startBriefing(db, queue, slug, sessionId, { mode: 'all', force: false }),
      ).rejects.toThrow(ConflictError);
      expect(queue.add).toHaveBeenCalledTimes(1);
    });

    it('allows "all" only once, but "more exercises" after it', async () => {
      await addItem('key_point', 0, 'Fubini');
      await expect(
        startBriefing(db, queue, slug, sessionId, { mode: 'all', force: false }),
      ).rejects.toThrow(/già stati generati/);
      await expect(
        startBriefing(db, queue, slug, sessionId, { mode: 'exercises', force: false }),
      ).resolves.toHaveProperty('jobId');
    });

    it('refuses an ended session and a session without documents', async () => {
      await db
        .update(studySessions)
        .set({ documentIds: [] })
        .where(eq(studySessions.id, sessionId));
      await expect(
        startBriefing(db, queue, slug, sessionId, { mode: 'all', force: false }),
      ).rejects.toThrow(/non ha documenti/);

      await endSession(db, slug, sessionId);
      await expect(
        startBriefing(db, queue, slug, sessionId, { mode: 'all', force: false }),
      ).rejects.toThrow(/già terminata/);
    });

    it('404s for a session of another subject', async () => {
      const other = await createSubject(db, dataRoot, { name: 'Fisica', color: 'blue' });
      await expect(
        startBriefing(db, queue, other.slug, sessionId, { mode: 'all', force: false }),
      ).rejects.toThrow(NotFoundError);
    });
  });

  describe('getBriefing', () => {
    it('lists key points and exercises in order, with the cited document name', async () => {
      await addItem('exercise', 1, 'Secondo');
      await addItem('key_point', 0, 'Fubini');
      await addItem('exercise', 0, 'Primo');
      const { items } = await getBriefing(db, slug, sessionId);
      expect(items.map((i) => `${i.kind}:${i.title}`)).toEqual([
        'exercise:Primo',
        'exercise:Secondo',
        'key_point:Fubini',
      ]);
      expect(items[0]!.citations[0]).toMatchObject({
        documentName: 'Appunti cap.4.pdf',
        page: 1,
      });
    });

    it('reports a failed job with its real error, and sums the cost of succeeded ones', async () => {
      const { jobId } = await startBriefing(db, queue, slug, sessionId, {
        mode: 'all',
        force: false,
      });
      await db.insert(jobs).values({
        id: jobId,
        type: 'prepare_session',
        subjectId,
        status: 'failed',
        input: { sessionId, mode: 'all' },
        error: {
          code: 'job_failed',
          message: 'Nessun elemento con una citazione',
          retryable: true,
        },
      });
      await db.insert(jobs).values([
        {
          id: randomUUID(),
          type: 'prepare_session',
          subjectId,
          status: 'succeeded',
          input: { sessionId, mode: 'all' },
          cost: { inputTokens: 1, outputTokens: 1, eur: 0.25 },
        },
        {
          id: randomUUID(),
          type: 'prepare_session',
          subjectId,
          status: 'succeeded',
          input: { sessionId: randomUUID(), mode: 'all' },
          cost: { inputTokens: 1, outputTokens: 1, eur: 9 },
        },
      ]);
      const brief = await getBriefing(db, slug, sessionId);
      expect(brief.job).toMatchObject({
        status: 'failed',
        error: 'Nessun elemento con una citazione',
      });
      expect(brief.costEur).toBeCloseTo(0.25);

      // a failed run can be retried
      await expect(
        startBriefing(db, queue, slug, sessionId, { mode: 'all', force: false }),
      ).resolves.toHaveProperty('jobId');
    });
  });

  describe('estimateBriefing', () => {
    it('counts the session material and prices it for the chosen model', async () => {
      const sonnet = await estimateBriefing(db, slug, sessionId, {
        mode: 'all',
        model: 'claude-sonnet-5-5',
      });
      expect(sonnet.inputTokens).toBeGreaterThan(0);
      expect(sonnet.costEur).toBeGreaterThan(0);

      const more = await estimateBriefing(db, slug, sessionId, {
        mode: 'exercises',
        model: 'claude-sonnet-5-5',
      });
      expect(more.outputTokens).toBeLessThan(sonnet.outputTokens);
    });
  });

  describe('updateSessionItem', () => {
    it('checks a key point and saves an exercise answer with a self-assessment', async () => {
      const kp = await addItem('key_point', 0, 'Fubini');
      const ex = await addItem('exercise', 0, 'Calcola');
      expect(await updateSessionItem(db, slug, sessionId, kp, { state: 'done' })).toMatchObject({
        state: 'done',
      });
      expect(
        await updateSessionItem(db, slug, sessionId, ex, { answer: 'Il risultato è 2' }),
      ).toMatchObject({ answer: 'Il risultato è 2', state: 'open' });
      expect(await updateSessionItem(db, slug, sessionId, ex, { state: 'wrong' })).toMatchObject({
        state: 'wrong',
        answer: 'Il risultato è 2',
      });
    });

    it('rejects a state that does not fit the kind, and an answer on a key point', async () => {
      const kp = await addItem('key_point', 0, 'Fubini');
      const ex = await addItem('exercise', 0, 'Calcola');
      await expect(updateSessionItem(db, slug, sessionId, kp, { state: 'wrong' })).rejects.toThrow(
        ConflictError,
      );
      await expect(updateSessionItem(db, slug, sessionId, ex, { state: 'done' })).rejects.toThrow(
        ConflictError,
      );
      await expect(updateSessionItem(db, slug, sessionId, kp, { answer: 'x' })).rejects.toThrow(
        /Solo gli esercizi/,
      );
    });

    it('404s for an unknown item and refuses edits once the session has ended', async () => {
      const kp = await addItem('key_point', 0, 'Fubini');
      await expect(
        updateSessionItem(db, slug, sessionId, randomUUID(), { state: 'done' }),
      ).rejects.toThrow(NotFoundError);
      await endSession(db, slug, sessionId);
      await expect(updateSessionItem(db, slug, sessionId, kp, { state: 'done' })).rejects.toThrow(
        /già terminata/,
      );
    });
  });
});
