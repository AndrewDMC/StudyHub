import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createTestDb } from '@studyhub/db/testDb';
import { artifacts, flashcards, jobs, topics } from '@studyhub/db';
import { errorResponse } from '../src/lib/http';
import { createSubject } from '../src/lib/subjects';
import { listFlashcards } from '../src/lib/review';
import {
  enqueueSortFlashcards,
  getSortJobStatus,
  listDeckGroups,
} from '../src/lib/flashcardGroups';
import { ConflictError } from '../src/lib/examPrep';
import { SubjectNotFoundError } from '../src/lib/errors';

describe('flashcard groups and sort', () => {
  let dataRoot: string;
  let db: Awaited<ReturnType<typeof createTestDb>>;
  let subjectId: string;
  let slug: string;
  let deckId: string;
  const now = new Date('2026-05-10T10:00:00Z');

  beforeEach(async () => {
    dataRoot = await mkdtemp(join(tmpdir(), 'studyhub-groups-'));
    db = await createTestDb();
    const subject = await createSubject(db, dataRoot, { name: 'Fisica', color: 'blue' });
    subjectId = subject.id;
    slug = subject.slug;
    deckId = randomUUID();
    await db.insert(artifacts).values({
      id: deckId,
      subjectId,
      kind: 'flashcard_deck',
      title: 'Deck',
      path: '/d.json',
      model: 'fake-v1',
      promptVersion: 'flashcards/v1',
      status: 'approved',
    });
  });
  afterEach(async () => {
    await rm(dataRoot, { recursive: true, force: true });
  });

  async function addTopic(name: string, orderIndex: number) {
    const id = randomUUID();
    await db.insert(topics).values({
      id,
      subjectId,
      name,
      slug: name.toLowerCase(),
      orderIndex,
      source: 'user',
    });
    return id;
  }
  async function addCard(
    topicId: string | null,
    over: Partial<typeof flashcards.$inferInsert> = {},
  ) {
    await db.insert(flashcards).values({
      id: randomUUID(),
      deckId,
      topicId,
      type: 'basic',
      front: 'Q',
      back: 'A',
      ...over,
    });
  }

  it('groups by topic in topic order, loose cards last, with due/new/suspended counts', async () => {
    const b = await addTopic('B', 2);
    const a = await addTopic('A', 1);
    await addTopic('Vuoto', 3);
    await addCard(b); // new
    await addCard(b, { state: 'review', dueAt: new Date('2026-05-09T00:00:00Z'), reps: 3 }); // due
    await addCard(b, { state: 'review', dueAt: new Date('2026-06-01T00:00:00Z'), reps: 3 }); // not due
    await addCard(b, { suspended: true });
    await addCard(a);
    await addCard(null);

    const groups = await listDeckGroups(db, slug, now);
    expect(groups.map((g) => g.topicName)).toEqual(['A', 'B', null]);
    expect(groups[1]).toMatchObject({ topicId: b, total: 4, due: 1, new: 1, suspended: 1 });
    expect(groups[2]).toMatchObject({ topicId: null, parentTopicId: null, total: 1, new: 1 });
  });

  it('returns no group for a subject without cards and 404s for an unknown slug', async () => {
    await addTopic('A', 1);
    expect(await listDeckGroups(db, slug, now)).toEqual([]);
    await expect(listDeckGroups(db, 'nope', now)).rejects.toBeInstanceOf(SubjectNotFoundError);
  });

  it("listFlashcards topicId='none' returns only unsorted cards", async () => {
    const a = await addTopic('A', 1);
    await addCard(a);
    await addCard(null);
    const page = await listFlashcards(db, slug, { topicId: 'none', limit: 50 });
    expect(page.items).toHaveLength(1);
    expect(page.items[0]!.topicId).toBeNull();
  });

  it('409s with the jobId of a running sort row, and ignores other subjects', async () => {
    const queue = { add: vi.fn().mockResolvedValue({}), getJobs: vi.fn().mockResolvedValue([]) };
    const other = await createSubject(db, dataRoot, { name: 'Chimica', color: 'rose' });
    const runningId = randomUUID();
    await db
      .insert(jobs)
      .values({ id: runningId, type: 'sort_flashcards', subjectId, status: 'running' });
    const err = await enqueueSortFlashcards(db, queue, slug).catch((e) => e);
    expect(err).toBeInstanceOf(ConflictError);
    expect((err as ConflictError).jobId).toBe(runningId);
    expect(errorResponse(err).status).toBe(409);
    expect(await errorResponse(err).json()).toMatchObject({
      error: { code: 'conflict', jobId: runningId },
    });
    await expect(enqueueSortFlashcards(db, queue, other.slug)).resolves.toHaveProperty('jobId');
  });

  it('getSortJobStatus: queued without row, real status for own subject, queued for another', async () => {
    const other = await createSubject(db, dataRoot, { name: 'Chimica', color: 'rose' });
    const id = randomUUID();
    expect(await getSortJobStatus(db, slug, id)).toEqual({ status: 'queued' });
    await db.insert(jobs).values({
      id,
      type: 'sort_flashcards',
      subjectId,
      status: 'succeeded',
      output: { assigned: 2 },
    });
    expect(await getSortJobStatus(db, slug, id)).toMatchObject({
      status: 'succeeded',
      output: { assigned: 2 },
      error: null,
    });
    expect(await getSortJobStatus(db, other.slug, id)).toEqual({ status: 'queued' });
  });

  it('counts as new only reviewable cards (approved deck, not suspended)', async () => {
    const draftDeck = randomUUID();
    await db.insert(artifacts).values({
      id: draftDeck,
      subjectId,
      kind: 'flashcard_deck',
      title: 'Bozza',
      path: '/b.json',
      model: 'fake-v1',
      promptVersion: 'flashcards/v1',
      status: 'draft',
    });
    const a = await addTopic('A', 1);
    await addCard(a); // reviewable new
    await addCard(a, { suspended: true });
    await addCard(a, { deckId: draftDeck });
    const [g] = await listDeckGroups(db, slug, now);
    expect(g).toMatchObject({ total: 3, new: 1, suspended: 1 });
  });

  it('enqueues sort_flashcards, and 409s while one is already queued', async () => {
    const queue = {
      add: vi.fn().mockResolvedValue({}),
      getJobs: vi.fn().mockResolvedValue([]),
    };
    const { jobId } = await enqueueSortFlashcards(db, queue, slug);
    expect(queue.add).toHaveBeenCalledWith('sort_flashcards', { subjectId }, { jobId });

    queue.getJobs.mockResolvedValue([
      { id: 'queued-job', name: 'sort_flashcards', data: { subjectId } },
    ]);
    await expect(enqueueSortFlashcards(db, queue, slug)).rejects.toMatchObject({
      name: 'ConflictError',
      jobId: 'queued-job',
    });
    await expect(enqueueSortFlashcards(db, queue, 'nope')).rejects.toBeInstanceOf(
      SubjectNotFoundError,
    );
  });
});
