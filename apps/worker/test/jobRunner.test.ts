import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { createTestDb } from '@studyhub/db/testDb';
import { jobs } from '@studyhub/db';
import { runJob } from '../src/jobRunner.js';

describe('runJob', () => {
  let dataRoot: string;
  let db: Awaited<ReturnType<typeof createTestDb>>;

  beforeEach(async () => {
    dataRoot = await mkdtemp(join(tmpdir(), 'studyhub-jobrunner-'));
    db = await createTestDb();
  });

  afterEach(async () => {
    await rm(dataRoot, { recursive: true, force: true });
  });

  it('runs a ping job and marks it succeeded with output', async () => {
    const id = randomUUID();
    const output = await runJob(db, dataRoot, { id, name: 'ping', data: { message: 'hi' } });

    expect((output as { message: string }).message).toBe('pong: hi');

    const [row] = await db.select().from(jobs).where(eq(jobs.id, id));
    expect(row?.status).toBe('succeeded');
    expect(row?.progressPct).toBe(100);
    expect(row?.finishedAt).toBeInstanceOf(Date);
  });

  it('runs a reconcile job against an empty data root and succeeds', async () => {
    const id = randomUUID();
    await runJob(db, dataRoot, { id, name: 'reconcile', data: {} });

    const [row] = await db.select().from(jobs).where(eq(jobs.id, id));
    expect(row?.status).toBe('succeeded');
    expect(row?.output).toEqual({ imported: [], alreadyIndexed: [], skippedInvalid: [] });
  });

  it('rejects an unknown job type without creating a jobs row', async () => {
    const id = randomUUID();
    await expect(runJob(db, dataRoot, { id, name: 'not-a-real-job', data: {} })).rejects.toThrow(
      /unknown job type/,
    );

    const rows = await db.select().from(jobs).where(eq(jobs.id, id));
    expect(rows).toHaveLength(0);
  });
});
