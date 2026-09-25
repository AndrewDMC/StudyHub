import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createTestDb } from '@studyhub/db/testDb';
import { jobs } from '@studyhub/db';
import { createSubject } from '../src/lib/subjects';
import { enqueueReconcile, getAdminOverview, listAdminJobs } from '../src/lib/admin';

function fakeQueue() {
  return { add: vi.fn().mockResolvedValue({ id: 'job-123' }) };
}

describe('listAdminJobs', () => {
  let dataRoot: string;
  let db: Awaited<ReturnType<typeof createTestDb>>;

  beforeEach(async () => {
    dataRoot = await mkdtemp(join(tmpdir(), 'studyhub-admin-'));
    db = await createTestDb();
  });

  afterEach(async () => {
    await rm(dataRoot, { recursive: true, force: true });
  });

  it('lists jobs newest first, with subject identity when scoped to one', async () => {
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

    const result = await listAdminJobs(db, { limit: 50, offset: 0 });
    expect(result.total).toBe(2);
    expect(result.jobs[0]).toMatchObject({ type: 'generate_flashcards', subjectSlug: subject.slug });
    expect(result.jobs[1]).toMatchObject({ type: 'reconcile', subjectSlug: null });
  });

  it('filters by status', async () => {
    await db.insert(jobs).values({ id: randomUUID(), type: 'reconcile', status: 'succeeded' });
    await db.insert(jobs).values({ id: randomUUID(), type: 'reconcile', status: 'failed' });

    const result = await listAdminJobs(db, { status: 'failed', limit: 50, offset: 0 });
    expect(result.total).toBe(1);
    expect(result.jobs[0]?.status).toBe('failed');
  });

  it('paginates with limit/offset, total reflecting the full filtered count', async () => {
    for (let i = 0; i < 5; i += 1) {
      await db.insert(jobs).values({ id: randomUUID(), type: 'reconcile', status: 'succeeded' });
    }

    const page = await listAdminJobs(db, { limit: 2, offset: 0 });
    expect(page.jobs).toHaveLength(2);
    expect(page.total).toBe(5);
  });

  it('surfaces the error message of a failed job', async () => {
    await db.insert(jobs).values({
      id: randomUUID(),
      type: 'generate_summary',
      status: 'failed',
      error: { code: 'job_failed', message: 'boom', retryable: true },
    });

    const result = await listAdminJobs(db, { limit: 50, offset: 0 });
    expect(result.jobs[0]?.errorMessage).toBe('boom');
  });
});

describe('getAdminOverview', () => {
  let db: Awaited<ReturnType<typeof createTestDb>>;

  beforeEach(async () => {
    db = await createTestDb();
  });

  it('sums costs per UTC month across jobs', async () => {
    await db.insert(jobs).values({
      id: randomUUID(),
      type: 'generate_flashcards',
      status: 'succeeded',
      createdAt: new Date('2026-01-15T10:00:00Z'),
      cost: { inputTokens: 100, outputTokens: 50, eur: 0.01 },
    });
    await db.insert(jobs).values({
      id: randomUUID(),
      type: 'generate_summary',
      status: 'succeeded',
      createdAt: new Date('2026-01-20T10:00:00Z'),
      cost: { inputTokens: 200, outputTokens: 100, eur: 0.02 },
    });
    await db.insert(jobs).values({
      id: randomUUID(),
      type: 'generate_schema',
      status: 'succeeded',
      createdAt: new Date('2026-02-01T10:00:00Z'),
      cost: { inputTokens: 100, outputTokens: 50, eur: 0.05 },
    });
    // No cost (e.g. a non-AI job, or an AI job that never reached a priced provider) — excluded.
    await db.insert(jobs).values({
      id: randomUUID(),
      type: 'reconcile',
      status: 'succeeded',
      createdAt: new Date('2026-01-10T10:00:00Z'),
    });

    const overview = await getAdminOverview(db);
    expect(overview.costsByMonth).toEqual([
      { month: '2026-02', costEur: 0.05, jobCount: 1 },
      { month: '2026-01', costEur: 0.03, jobCount: 2 },
    ]);
  });

  it('reports the most recent reconcile job as the FS sync status', async () => {
    await db.insert(jobs).values({
      id: randomUUID(),
      type: 'reconcile',
      status: 'succeeded',
      output: {
        imported: ['fisica-1'],
        alreadyIndexed: ['chimica'],
        skippedInvalid: [{ slug: 'broken', reason: 'missing subject.json' }],
      },
    });

    const overview = await getAdminOverview(db);
    expect(overview.fsSync.status).toBe('succeeded');
    expect(overview.fsSync.imported).toEqual(['fisica-1']);
    expect(overview.fsSync.alreadyIndexed).toEqual(['chimica']);
    expect(overview.fsSync.skippedInvalid).toEqual([
      { slug: 'broken', reason: 'missing subject.json' },
    ]);
  });

  it('reports null FS sync status when no reconcile job has ever run', async () => {
    const overview = await getAdminOverview(db);
    expect(overview.fsSync).toEqual({
      lastRunAt: null,
      status: null,
      imported: [],
      alreadyIndexed: [],
      skippedInvalid: [],
    });
  });
});

describe('enqueueReconcile', () => {
  it('enqueues a full-scope reconcile job', async () => {
    const queue = fakeQueue();
    const result = await enqueueReconcile(queue);
    expect(result.jobId).toEqual(expect.any(String));
    expect(queue.add).toHaveBeenCalledWith('reconcile', {}, { jobId: result.jobId });
  });
});
