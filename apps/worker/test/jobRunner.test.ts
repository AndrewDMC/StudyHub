import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { createTestDb } from '@studyhub/db/testDb';
import { jobs, subjects } from '@studyhub/db';
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

  it('attributes a job to its subject when the input carries a subjectId', async () => {
    const subjectId = randomUUID();
    await db.insert(subjects).values({
      id: subjectId,
      slug: 'fisica-1',
      name: 'Fisica 1',
      color: 'blue',
      folderPath: '/irrelevant',
    });

    const id = randomUUID();
    // Fails past attribution (no chunks for a doc that doesn't exist) — attribution only needs
    // upsertJobRow, run before dispatch, so the exact failure reason doesn't matter here.
    await expect(
      runJob(db, dataRoot, {
        id,
        name: 'generate_flashcards',
        data: {
          subjectId,
          scope: { docIds: [randomUUID()] },
          count: 'auto',
          types: ['basic'],
          difficulty: 2,
          lang: 'it',
          force: false,
        },
      }),
    ).rejects.toThrow();

    const [row] = await db.select().from(jobs).where(eq(jobs.id, id));
    expect(row?.subjectId).toBe(subjectId);
    expect(row?.status).toBe('failed');
  });

  it('leaves subjectId null for a job whose input has none (e.g. reconcile)', async () => {
    const id = randomUUID();
    await runJob(db, dataRoot, { id, name: 'reconcile', data: {} });

    const [row] = await db.select().from(jobs).where(eq(jobs.id, id));
    expect(row?.subjectId).toBeNull();
  });

  it('still creates a trackable job row when subjectId references no real subject', async () => {
    const id = randomUUID();
    const bogusSubjectId = randomUUID(); // never inserted into `subjects`
    await expect(
      runJob(db, dataRoot, {
        id,
        name: 'generate_flashcards',
        data: {
          subjectId: bogusSubjectId,
          scope: { docIds: [randomUUID()] },
          count: 'auto',
          types: ['basic'],
          difficulty: 2,
          lang: 'it',
          force: false,
        },
      }),
    ).rejects.toThrow(/subject not found/);

    const [row] = await db.select().from(jobs).where(eq(jobs.id, id));
    expect(row?.subjectId).toBeNull(); // FK violation falls back to no attribution, not a lost row
    expect(row?.status).toBe('failed');
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
