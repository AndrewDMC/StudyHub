import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createTestDb } from '@studyhub/db/testDb';
import { artifacts, simulationItems, simulations } from '@studyhub/db';
import { createSubject } from '../src/lib/subjects';
import { addAttemptPhoto, startOrResumeAttempt } from '../src/lib/examPrep';

const state = vi.hoisted(() => ({ db: null as unknown, dataRoot: '' }));
vi.mock('@/lib/db', () => ({ getDb: () => state.db }));
vi.mock('@/lib/dataRoot', () => ({ getDataRoot: () => state.dataRoot }));

import { GET } from '../src/app/api/subjects/[slug]/attempts/[attemptId]/items/[itemId]/photos/[photoId]/file/route';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 9, 9]);

describe('GET photo file route', () => {
  let dataRoot: string;

  beforeEach(async () => {
    dataRoot = await mkdtemp(join(tmpdir(), 'studyhub-photoroute-'));
    state.dataRoot = dataRoot;
    state.db = await createTestDb();
  });
  afterEach(async () => {
    await rm(dataRoot, { recursive: true, force: true });
  });

  it('serves the bytes with the sniffed Content-Type and nosniff; 404 for unknown photo', async () => {
    const db = state.db as Awaited<ReturnType<typeof createTestDb>>;
    const subject = await createSubject(db, dataRoot, { name: 'Fisica 1', color: 'blue' });
    const simulationId = randomUUID();
    await db.insert(artifacts).values({
      id: simulationId,
      subjectId: subject.id,
      kind: 'simulation',
      title: 'S',
      path: '/x.json',
      model: 'fake-v1',
      promptVersion: 'simulation/v1',
    });
    await db.insert(simulations).values({
      artifactId: simulationId,
      mode: 'esame_completo',
      timeBudgetMin: 60,
      totalPoints: 10,
    });
    const itemId = randomUUID();
    await db.insert(simulationItems).values({
      id: itemId,
      simulationId,
      ord: 0,
      prompt: 'Q',
      kind: 'open',
      points: 10,
      expectedPoints: ['p'],
      rubric: [{ criterion: 'p', points: 10 }],
      solution: 'S',
      sourceRef: { docId: randomUUID(), page: 1, quote: 'q' },
    });
    const queue = { add: vi.fn() };
    const attempt = await startOrResumeAttempt(db, queue, subject.slug, simulationId);
    const photo = await addAttemptPhoto(db, queue, dataRoot, subject.slug, attempt.id, itemId, PNG);

    const ok = await GET(new Request('http://x'), {
      params: Promise.resolve({
        slug: subject.slug,
        attemptId: attempt.id,
        itemId,
        photoId: photo.id,
      }),
    });
    expect(ok.status).toBe(200);
    expect(ok.headers.get('content-type')).toBe('image/png');
    expect(ok.headers.get('x-content-type-options')).toBe('nosniff');
    expect([...new Uint8Array(await ok.arrayBuffer())]).toEqual([...PNG]);

    const missing = await GET(new Request('http://x'), {
      params: Promise.resolve({
        slug: subject.slug,
        attemptId: attempt.id,
        itemId,
        photoId: randomUUID(),
      }),
    });
    expect(missing.status).toBe(404);
  });
});
