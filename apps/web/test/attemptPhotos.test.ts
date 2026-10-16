import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { createTestDb } from '@studyhub/db/testDb';
import {
  artifacts,
  attemptAnswerPhotos,
  attemptItemResults,
  simulationAttempts,
  simulationItems,
  simulations,
} from '@studyhub/db';
import { resolveSubjectPath } from '@studyhub/core';
import { createSubject } from '../src/lib/subjects';
import {
  AttemptPhotoError,
  ConflictError,
  NotFoundError,
  addAttemptPhoto,
  deleteAttemptPhoto,
  getAttempt,
  getAttemptResults,
  listAttemptPhotos,
  readAttemptPhotoFile,
  startOrResumeAttempt,
  submitAttempt,
} from '../src/lib/examPrep';

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 9, 9]);
const HEIC = new Uint8Array([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63, 0, 0]);

function fakeQueue() {
  return { add: vi.fn().mockResolvedValue({ id: 'job-1' }) };
}

describe('attempt answer photos (web)', () => {
  let dataRoot: string;
  let db: Awaited<ReturnType<typeof createTestDb>>;
  let slug: string;
  let simulationId: string;
  let itemIds: string[];
  let attemptId: string;
  const queue = fakeQueue();

  beforeEach(async () => {
    dataRoot = await mkdtemp(join(tmpdir(), 'studyhub-photos-'));
    db = await createTestDb();
    const subject = await createSubject(db, dataRoot, { name: 'Fisica 1', color: 'blue' });
    slug = subject.slug;
    simulationId = randomUUID();
    await db.insert(artifacts).values({
      id: simulationId,
      subjectId: subject.id,
      kind: 'simulation',
      title: 'Simulazione',
      path: '/x.json',
      model: 'fake-v1',
      promptVersion: 'simulation/v1',
    });
    await db.insert(simulations).values({
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
        solution: 'S',
        sourceRef: { docId: randomUUID(), page: 1, quote: 'q' },
      });
    }
    attemptId = (await startOrResumeAttempt(db, queue, slug, simulationId)).id;
  });

  afterEach(async () => {
    await rm(dataRoot, { recursive: true, force: true });
  });

  it('stores a jpeg under the subject folder and exposes it in the attempt DTO', async () => {
    const photo = await addAttemptPhoto(db, queue, dataRoot, slug, attemptId, itemIds[0]!, JPEG);
    expect(photo).toMatchObject({ itemId: itemIds[0], mime: 'image/jpeg', size: JPEG.length });
    expect(photo.url).toBe(
      `/api/subjects/${slug}/attempts/${attemptId}/items/${itemIds[0]}/photos/${photo.id}/file`,
    );

    const [row] = await db.select().from(attemptAnswerPhotos);
    expect(row!.relPath).toBe(`.studyhub/attempts/${attemptId}/${photo.id}.jpg`);
    expect(existsSync(join(resolveSubjectPath(slug, dataRoot), ...row!.relPath.split('/')))).toBe(
      true,
    );

    const dto = await getAttempt(db, queue, slug, attemptId);
    expect(dto.photos[itemIds[0]!]).toHaveLength(1);
    expect(dto.photos[itemIds[1]!]).toBeUndefined();
    expect(await listAttemptPhotos(db, slug, attemptId, itemIds[0]!)).toHaveLength(1);

    const file = await readAttemptPhotoFile(db, dataRoot, slug, attemptId, itemIds[0]!, photo.id);
    expect(file.mime).toBe('image/jpeg');
    expect([...file.bytes]).toEqual([...JPEG]);
  });

  it('returns already uploaded photos when the open attempt is resumed', async () => {
    const photo = await addAttemptPhoto(db, queue, dataRoot, slug, attemptId, itemIds[0]!, JPEG);
    const resumed = await startOrResumeAttempt(db, queue, slug, simulationId);
    expect(resumed.id).toBe(attemptId);
    expect(resumed.photos[itemIds[0]!]?.map((p) => p.id)).toEqual([photo.id]);
  });

  it('accepts png, rejects heic, pdf, text and empty files', async () => {
    const item = itemIds[0]!;
    expect((await addAttemptPhoto(db, queue, dataRoot, slug, attemptId, item, PNG)).mime).toBe(
      'image/png',
    );
    for (const bad of [
      HEIC,
      new TextEncoder().encode('%PDF-1.4 x'),
      new TextEncoder().encode('ciao'),
      new Uint8Array(),
    ]) {
      await expect(
        addAttemptPhoto(db, queue, dataRoot, slug, attemptId, item, bad),
      ).rejects.toBeInstanceOf(AttemptPhotoError);
    }
  });

  it('rejects files over 5 MB with a 413-style error', async () => {
    const big = new Uint8Array(5 * 1024 * 1024 + 1);
    big.set(JPEG);
    await expect(
      addAttemptPhoto(db, queue, dataRoot, slug, attemptId, itemIds[0]!, big),
    ).rejects.toMatchObject({ status: 413 });
  });

  it('allows at most 4 photos per item (other items unaffected)', async () => {
    for (let i = 0; i < 4; i++) {
      await addAttemptPhoto(db, queue, dataRoot, slug, attemptId, itemIds[0]!, JPEG);
    }
    await expect(
      addAttemptPhoto(db, queue, dataRoot, slug, attemptId, itemIds[0]!, JPEG),
    ).rejects.toBeInstanceOf(ConflictError);
    await addAttemptPhoto(db, queue, dataRoot, slug, attemptId, itemIds[1]!, JPEG);
  });

  it('never exceeds 4 photos per item under concurrent uploads', async () => {
    for (let i = 0; i < 3; i++) {
      await addAttemptPhoto(db, queue, dataRoot, slug, attemptId, itemIds[0]!, JPEG);
    }
    const results = await Promise.allSettled([
      addAttemptPhoto(db, queue, dataRoot, slug, attemptId, itemIds[0]!, JPEG),
      addAttemptPhoto(db, queue, dataRoot, slug, attemptId, itemIds[0]!, PNG),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(rejected.reason).toBeInstanceOf(ConflictError);
    expect(await listAttemptPhotos(db, slug, attemptId, itemIds[0]!)).toHaveLength(4);
  });

  it('exposes transcriptStatus (null until the grader transcribes the photo)', async () => {
    const photo = await addAttemptPhoto(db, queue, dataRoot, slug, attemptId, itemIds[0]!, JPEG);
    expect(photo.transcriptStatus).toBeNull();
    await db
      .update(attemptAnswerPhotos)
      .set({ transcript: 'x = 2', transcriptStatus: 'ok', transcribedAt: new Date() })
      .where(eq(attemptAnswerPhotos.id, photo.id));
    const [again] = await listAttemptPhotos(db, slug, attemptId, itemIds[0]!);
    expect(again?.transcriptStatus).toBe('ok');
  });

  it('refuses to read a photo file that is a symlink pointing outside the subject', async () => {
    const photo = await addAttemptPhoto(db, queue, dataRoot, slug, attemptId, itemIds[0]!, JPEG);
    const [row] = await db.select().from(attemptAnswerPhotos);
    const abs = join(resolveSubjectPath(slug, dataRoot), ...row!.relPath.split('/'));
    const outside = join(dataRoot, 'outside.jpg');
    await writeFile(outside, JPEG);
    await rm(abs);
    try {
      await symlink(outside, abs);
    } catch {
      return; // symlinks not permitted on this host: nothing to assert
    }
    await expect(
      readAttemptPhotoFile(db, dataRoot, slug, attemptId, itemIds[0]!, photo.id),
    ).rejects.toThrow();
  });

  it('refuses upload and delete once the attempt is submitted (409), but still serves the file', async () => {
    const photo = await addAttemptPhoto(db, queue, dataRoot, slug, attemptId, itemIds[0]!, JPEG);
    await submitAttempt(db, queue, slug, attemptId);
    await expect(
      addAttemptPhoto(db, queue, dataRoot, slug, attemptId, itemIds[0]!, JPEG),
    ).rejects.toBeInstanceOf(ConflictError);
    await expect(
      deleteAttemptPhoto(db, queue, dataRoot, slug, attemptId, itemIds[0]!, photo.id),
    ).rejects.toBeInstanceOf(ConflictError);
    await expect(
      readAttemptPhotoFile(db, dataRoot, slug, attemptId, itemIds[0]!, photo.id),
    ).resolves.toMatchObject({ mime: 'image/jpeg' });
  });

  it('delete removes the row and the file', async () => {
    const photo = await addAttemptPhoto(db, queue, dataRoot, slug, attemptId, itemIds[0]!, JPEG);
    const [row] = await db.select().from(attemptAnswerPhotos);
    const abs = join(resolveSubjectPath(slug, dataRoot), ...row!.relPath.split('/'));
    expect(existsSync(abs)).toBe(true);

    await deleteAttemptPhoto(db, queue, dataRoot, slug, attemptId, itemIds[0]!, photo.id);
    expect(existsSync(abs)).toBe(false);
    expect(await db.select().from(attemptAnswerPhotos)).toHaveLength(0);
    await expect(
      deleteAttemptPhoto(db, queue, dataRoot, slug, attemptId, itemIds[0]!, photo.id),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('404s for an attempt or item of another subject, and for traversal-looking ids', async () => {
    const other = await createSubject(db, dataRoot, { name: 'Chimica', color: 'green' });
    await expect(
      addAttemptPhoto(db, queue, dataRoot, other.slug, attemptId, itemIds[0]!, JPEG),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      addAttemptPhoto(db, queue, dataRoot, slug, attemptId, randomUUID(), JPEG),
    ).rejects.toBeInstanceOf(NotFoundError);
    for (const evil of ['../../etc/passwd', '..', '%2e%2e', 'a/b']) {
      await expect(
        addAttemptPhoto(db, queue, dataRoot, slug, evil, itemIds[0]!, JPEG),
      ).rejects.toBeInstanceOf(NotFoundError);
      await expect(
        addAttemptPhoto(db, queue, dataRoot, slug, attemptId, evil, JPEG),
      ).rejects.toBeInstanceOf(NotFoundError);
      await expect(
        readAttemptPhotoFile(db, dataRoot, slug, attemptId, itemIds[0]!, evil),
      ).rejects.toBeInstanceOf(NotFoundError);
    }
    // A hostile subject slug is rejected by the path-safety helpers, not resolved.
    await expect(
      addAttemptPhoto(db, queue, dataRoot, '../x', attemptId, itemIds[0]!, JPEG),
    ).rejects.toBeDefined();
  });

  it('refuses to read a photo whose stored path escapes the subject folder', async () => {
    const photo = await addAttemptPhoto(db, queue, dataRoot, slug, attemptId, itemIds[0]!, JPEG);
    await db
      .update(attemptAnswerPhotos)
      .set({ relPath: '../../outside.jpg' })
      .where(eq(attemptAnswerPhotos.id, photo.id));
    await expect(
      readAttemptPhotoFile(db, dataRoot, slug, attemptId, itemIds[0]!, photo.id),
    ).rejects.toThrow();
  });

  it('includes photos per item in the graded results', async () => {
    await addAttemptPhoto(db, queue, dataRoot, slug, attemptId, itemIds[0]!, JPEG);
    await db
      .update(simulationAttempts)
      .set({ status: 'graded', totalAwarded: 6, totalMax: 20 })
      .where(eq(simulationAttempts.id, attemptId));
    for (const id of itemIds) {
      await db.insert(attemptItemResults).values({
        id: randomUUID(),
        attemptId,
        itemId: id,
        awarded: 5,
        max: 10,
        criteria: [],
        missing: [],
        sourceRef: { docId: randomUUID(), page: 1, quote: 'q' },
      });
    }
    const results = await getAttemptResults(db, slug, attemptId);
    expect(results[0]?.photos).toHaveLength(1);
    expect(results[1]?.photos).toEqual([]);
  });
});
