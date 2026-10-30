import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { createTestDb } from '@studyhub/db/testDb';
import { jobs, sessionItems, studySessions, topics } from '@studyhub/db';
import { createSubject } from '../src/lib/subjects';
import { endSession, startSession } from '../src/lib/sessions';
import { getExplanation, submitExplanation } from '../src/lib/explanation';
import { ConflictError, InvalidRequestError, NotFoundError } from '../src/lib/examPrep';

const state = vi.hoisted(() => ({ db: null as unknown }));
vi.mock('@/lib/db', () => ({ getDb: () => state.db }));
const queue = vi.hoisted(() => ({ add: vi.fn().mockResolvedValue({ id: 'job' }) }));
vi.mock('@/lib/queue', () => ({ getJobQueue: () => queue }));

import {
  GET as getRoute,
  POST as postRoute,
} from '../src/app/api/subjects/[slug]/sessions/[sessionId]/explanation/route';

const TEXT = 'Il secondo principio dice che entropia di un sistema isolato non diminuisce.';

describe('explanation (Rielabora)', () => {
  let dataRoot: string;
  let db: Awaited<ReturnType<typeof createTestDb>>;
  let slug: string;
  let sessionId: string;
  let topicId: string;

  beforeEach(async () => {
    queue.add.mockClear();
    dataRoot = await mkdtemp(join(tmpdir(), 'studyhub-explanation-'));
    db = await createTestDb();
    state.db = db;
    const subject = await createSubject(db, dataRoot, { name: 'Fisica', color: 'blue' });
    slug = subject.slug;
    topicId = randomUUID();
    await db
      .insert(topics)
      .values({ id: topicId, subjectId: subject.id, name: 'Entropia', slug: 'entropia' });
    const session = await startSession(db, slug, { topicIds: [topicId] });
    sessionId = session.id;
    // A free session has no phase: give it one, as a lesson would have.
    await db.update(studySessions).set({ phase: 'rework' }).where(eq(studySessions.id, sessionId));
  });

  afterEach(async () => {
    await rm(dataRoot, { recursive: true, force: true });
  });

  it('starts empty', async () => {
    expect(await getExplanation(db, slug, sessionId)).toEqual({ latest: null, job: null });
  });

  it('stores the text as an item, records a queued job and enqueues it', async () => {
    const { itemId, jobId } = await submitExplanation(db, queue, slug, sessionId, {
      text: TEXT,
      model: 'm1',
    });
    const [item] = await db.select().from(sessionItems).where(eq(sessionItems.id, itemId));
    expect(item).toMatchObject({ kind: 'explanation', body: TEXT, orderIndex: 0 });
    const [job] = await db.select().from(jobs).where(eq(jobs.id, jobId));
    expect(job).toMatchObject({ type: 'explain_feedback', status: 'queued' });
    expect(queue.add).toHaveBeenCalledWith(
      'explain_feedback',
      expect.objectContaining({ sessionId, itemId, model: 'm1', force: false }),
      { jobId },
    );

    const current = await getExplanation(db, slug, sessionId);
    expect(current.latest).toMatchObject({ id: itemId, text: TEXT, feedback: null });
    expect(current.job).toEqual({ id: jobId, status: 'queued', error: null });
  });

  it('returns the feedback once the worker has saved it, and the newest rewrite wins', async () => {
    const first = await submitExplanation(db, queue, slug, sessionId, { text: TEXT });
    const feedback = {
      correct: [{ text: 'Bene', citation: null }],
      missing: [],
      wrong: [],
      model: 'fake',
      gradedAt: new Date().toISOString(),
    };
    await db
      .update(sessionItems)
      .set({ feedback: feedback as never })
      .where(eq(sessionItems.id, first.itemId));
    expect((await getExplanation(db, slug, sessionId)).latest?.feedback).toMatchObject({
      correct: [{ text: 'Bene' }],
    });

    await db.update(jobs).set({ status: 'succeeded' }).where(eq(jobs.id, first.jobId));
    const second = await submitExplanation(db, queue, slug, sessionId, { text: `${TEXT} Ancora.` });
    const again = await getExplanation(db, slug, sessionId);
    expect(again.latest).toMatchObject({ id: second.itemId, feedback: null });
    expect(again.job?.id).toBe(second.jobId);
  });

  it('reports a failed job with its error', async () => {
    const { jobId } = await submitExplanation(db, queue, slug, sessionId, { text: TEXT });
    await db
      .update(jobs)
      .set({ status: 'failed', error: { message: 'Budget giornaliero superato' } })
      .where(eq(jobs.id, jobId));
    expect((await getExplanation(db, slug, sessionId)).job).toEqual({
      id: jobId,
      status: 'failed',
      error: 'Budget giornaliero superato',
    });
  });

  it('refuses a session without phases (400) and an ended one (409)', async () => {
    await db.update(studySessions).set({ phase: null }).where(eq(studySessions.id, sessionId));
    await expect(
      submitExplanation(db, queue, slug, sessionId, { text: TEXT }),
    ).rejects.toBeInstanceOf(InvalidRequestError);

    await db.update(studySessions).set({ phase: 'rework' }).where(eq(studySessions.id, sessionId));
    await endSession(db, slug, sessionId);
    await expect(
      submitExplanation(db, queue, slug, sessionId, { text: TEXT }),
    ).rejects.toBeInstanceOf(ConflictError);
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('marks the job failed when it cannot be queued, and rethrows', async () => {
    queue.add.mockRejectedValueOnce(new Error('Redis non raggiungibile'));
    await expect(submitExplanation(db, queue, slug, sessionId, { text: TEXT })).rejects.toThrow(
      /Redis/,
    );
    const current = await getExplanation(db, slug, sessionId);
    expect(current.job).toMatchObject({ status: 'failed', error: 'Redis non raggiungibile' });
    // The failure frees the slot: the student can try again.
    await expect(
      submitExplanation(db, queue, slug, sessionId, { text: TEXT }),
    ).resolves.toHaveProperty('jobId');
  });

  it('refuses a second submit while the previous one is still being corrected (409)', async () => {
    await submitExplanation(db, queue, slug, sessionId, { text: TEXT });
    await expect(submitExplanation(db, queue, slug, sessionId, { text: TEXT })).rejects.toThrow(
      /già correggendo/,
    );
    expect(await db.select().from(sessionItems)).toHaveLength(1);
  });

  it('404s for an unknown session', async () => {
    await expect(getExplanation(db, slug, randomUUID())).rejects.toBeInstanceOf(NotFoundError);
  });

  describe('routes', () => {
    const ctx = () => ({ params: Promise.resolve({ slug, sessionId }) });
    const post = (body: unknown) =>
      postRoute(
        new Request('http://localhost/x', { method: 'POST', body: JSON.stringify(body) }),
        ctx(),
      );

    it('POST answers 202 with { itemId, jobId }, GET returns the state', async () => {
      const res = await post({ text: TEXT });
      expect(res.status).toBe(202);
      const body = await res.json();
      expect(body).toEqual({ itemId: expect.any(String), jobId: expect.any(String) });
      const got = await (await getRoute(new Request('http://localhost/x'), ctx())).json();
      expect(got.latest.id).toBe(body.itemId);
      expect(got.job.status).toBe('queued');
    });

    it('POST validates the text (400); an ended session is 409', async () => {
      expect((await post({ text: 'troppo corto' })).status).toBe(400);
      await endSession(db, slug, sessionId);
      expect((await post({ text: TEXT })).status).toBe(409);
    });
  });
});
