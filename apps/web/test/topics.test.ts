import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { createTestDb } from '@studyhub/db/testDb';
import { artifacts, documentTopics, documents, flashcards, topics } from '@studyhub/db';
import { createSubject } from '../src/lib/subjects';
import {
  createTopic,
  deleteTopic,
  enqueueExtractTopics,
  listTopics,
  mergeTopics,
  TopicNotFoundError,
  updateTopic,
} from '../src/lib/topics';
import { SubjectNotFoundError } from '../src/lib/errors';

function fakeQueue() {
  return { add: vi.fn().mockResolvedValue({ id: 'job-123' }) };
}

describe('topics', () => {
  let dataRoot: string;
  let db: Awaited<ReturnType<typeof createTestDb>>;
  let subjectSlug: string;
  let subjectId: string;

  beforeEach(async () => {
    dataRoot = await mkdtemp(join(tmpdir(), 'studyhub-topics-'));
    db = await createTestDb();
    const subject = await createSubject(db, dataRoot, { name: 'Analisi 1', color: 'violet' });
    subjectSlug = subject.slug;
    subjectId = subject.id;
  });

  afterEach(async () => {
    await rm(dataRoot, { recursive: true, force: true });
  });

  it('creates a topic with source=user and null mastery', async () => {
    const topic = await createTopic(db, subjectSlug, { name: 'Limiti' });
    expect(topic.source).toBe('user');
    expect(topic.mastery).toBeNull();
    expect(topic.slug).toBe('limiti');
  });

  it('lists topics ordered by name', async () => {
    await createTopic(db, subjectSlug, { name: 'Serie' });
    await createTopic(db, subjectSlug, { name: 'Derivate' });
    const list = await listTopics(db, subjectSlug);
    expect(list.map((t) => t.name)).toEqual(['Derivate', 'Serie']);
  });

  it('builds a parent/child tree and rejects an unknown parent', async () => {
    const parent = await createTopic(db, subjectSlug, { name: 'Analisi' });
    const child = await createTopic(db, subjectSlug, { name: 'Limiti', parentId: parent.id });
    expect(child.parentId).toBe(parent.id);

    await expect(
      createTopic(db, subjectSlug, {
        name: 'Orfano',
        parentId: '11111111-1111-1111-1111-111111111111',
      }),
    ).rejects.toBeInstanceOf(TopicNotFoundError);
  });

  it('renames a topic and reparents it', async () => {
    const a = await createTopic(db, subjectSlug, { name: 'A' });
    const b = await createTopic(db, subjectSlug, { name: 'B' });
    const updated = await updateTopic(db, subjectSlug, b.id, {
      name: 'B rinominato',
      parentId: a.id,
    });
    expect(updated.name).toBe('B rinominato');
    expect(updated.parentId).toBe(a.id);
  });

  it('rejects a topic being its own parent', async () => {
    const a = await createTopic(db, subjectSlug, { name: 'A' });
    await expect(updateTopic(db, subjectSlug, a.id, { parentId: a.id })).rejects.toThrow(
      /genitore di sé stesso/,
    );
  });

  it('deleting a parent cascades to its children (DB-level cascade)', async () => {
    const parent = await createTopic(db, subjectSlug, { name: 'Analisi' });
    const child = await createTopic(db, subjectSlug, { name: 'Limiti', parentId: parent.id });

    await deleteTopic(db, subjectSlug, parent.id);

    const remaining = await listTopics(db, subjectSlug);
    expect(remaining.find((t) => t.id === child.id)).toBeUndefined();
  });

  it('throws for an unknown subject', async () => {
    await expect(listTopics(db, 'nope')).rejects.toBeInstanceOf(SubjectNotFoundError);
  });

  it('throws TopicNotFoundError when deleting a non-existent topic', async () => {
    await expect(
      deleteTopic(db, subjectSlug, '11111111-1111-1111-1111-111111111111'),
    ).rejects.toBeInstanceOf(TopicNotFoundError);
  });

  describe('mergeTopics', () => {
    it('reattaches flashcards and document tags, then deletes the source topic', async () => {
      const source = await createTopic(db, subjectSlug, { name: 'Limiti (duplicato)' });
      const target = await createTopic(db, subjectSlug, { name: 'Limiti' });

      const deckId = randomUUID();
      await db.insert(artifacts).values({
        id: deckId,
        subjectId,
        kind: 'flashcard_deck',
        title: 'Deck',
        path: '/x',
        model: 'fake-v1',
        promptVersion: 'flashcards/v1',
      });
      const cardId = randomUUID();
      await db.insert(flashcards).values({
        id: cardId,
        deckId,
        topicId: source.id,
        type: 'basic',
        front: 'F',
        back: 'B',
        sourceRef: { docId: randomUUID(), page: 1, quote: 'B' },
      });

      const docId = randomUUID();
      await db.insert(documents).values({
        id: docId,
        subjectId,
        type: 'appunti',
        originalName: 'doc.pdf',
        storedPath: '/irrelevant',
        mime: 'application/pdf',
        bytes: 10,
        sha256: 'a'.repeat(64),
        status: 'parsed',
      });
      await db.insert(documentTopics).values({ documentId: docId, topicId: source.id });

      const merged = await mergeTopics(db, subjectSlug, source.id, target.id);
      expect(merged.id).toBe(target.id);

      const [card] = await db.select().from(flashcards).where(eq(flashcards.id, cardId));
      expect(card?.topicId).toBe(target.id);

      const links = await db
        .select()
        .from(documentTopics)
        .where(eq(documentTopics.documentId, docId));
      expect(links).toHaveLength(1);
      expect(links[0]?.topicId).toBe(target.id);

      const remaining = await listTopics(db, subjectSlug);
      expect(remaining.find((t) => t.id === source.id)).toBeUndefined();
    });

    it('drops a duplicate document tag instead of violating the composite key when both topics already tag the same document', async () => {
      const source = await createTopic(db, subjectSlug, { name: 'Limiti (duplicato)' });
      const target = await createTopic(db, subjectSlug, { name: 'Limiti' });
      const docId = randomUUID();
      await db.insert(documents).values({
        id: docId,
        subjectId,
        type: 'appunti',
        originalName: 'doc.pdf',
        storedPath: '/irrelevant',
        mime: 'application/pdf',
        bytes: 10,
        sha256: 'a'.repeat(64),
        status: 'parsed',
      });
      await db.insert(documentTopics).values([
        { documentId: docId, topicId: source.id },
        { documentId: docId, topicId: target.id },
      ]);

      await mergeTopics(db, subjectSlug, source.id, target.id);

      const links = await db
        .select()
        .from(documentTopics)
        .where(eq(documentTopics.documentId, docId));
      expect(links).toHaveLength(1); // no duplicate, no crash
      expect(links[0]?.topicId).toBe(target.id);
    });

    it('reparents the source’s other children to the target', async () => {
      const source = await createTopic(db, subjectSlug, { name: 'Analisi (duplicato)' });
      const target = await createTopic(db, subjectSlug, { name: 'Analisi' });
      const child = await createTopic(db, subjectSlug, { name: 'Limiti', parentId: source.id });

      await mergeTopics(db, subjectSlug, source.id, target.id);

      const [row] = await db.select().from(topics).where(eq(topics.id, child.id));
      expect(row?.parentId).toBe(target.id);
    });

    it('promotes the target to the source’s own parent when the target was a direct child of the source (never its own parent)', async () => {
      const grandparent = await createTopic(db, subjectSlug, { name: 'Analisi' });
      const source = await createTopic(db, subjectSlug, {
        name: 'Limiti (duplicato)',
        parentId: grandparent.id,
      });
      const target = await createTopic(db, subjectSlug, { name: 'Limiti', parentId: source.id });

      await mergeTopics(db, subjectSlug, source.id, target.id);

      const [row] = await db.select().from(topics).where(eq(topics.id, target.id));
      expect(row?.parentId).toBe(grandparent.id);
    });

    it('rejects merging a topic into itself', async () => {
      const a = await createTopic(db, subjectSlug, { name: 'A' });
      await expect(mergeTopics(db, subjectSlug, a.id, a.id)).rejects.toThrow(/sé stesso/);
    });

    it('throws TopicNotFoundError for an unknown source or target', async () => {
      const a = await createTopic(db, subjectSlug, { name: 'A' });
      const unknown = '11111111-1111-1111-1111-111111111111';
      await expect(mergeTopics(db, subjectSlug, unknown, a.id)).rejects.toBeInstanceOf(
        TopicNotFoundError,
      );
      await expect(mergeTopics(db, subjectSlug, a.id, unknown)).rejects.toBeInstanceOf(
        TopicNotFoundError,
      );
    });
  });
});

describe('enqueueExtractTopics', () => {
  it('resolves the subject slug to an id and enqueues with it', async () => {
    const dataRoot = await mkdtemp(join(tmpdir(), 'studyhub-enqueue-'));
    try {
      const db = await createTestDb();
      const subject = await createSubject(db, dataRoot, { name: 'Fisica 1', color: 'blue' });
      const queue = fakeQueue();

      const result = await enqueueExtractTopics(db, queue, subject.slug, {
        docIds: [randomUUID()],
        force: false,
      });

      expect(result.jobId).toEqual(expect.any(String));
      expect(queue.add).toHaveBeenCalledWith(
        'extract_topics',
        expect.objectContaining({ subjectId: subject.id }),
        { jobId: result.jobId },
      );
    } finally {
      await rm(dataRoot, { recursive: true, force: true });
    }
  });

  it('throws SubjectNotFoundError for an unknown slug without touching the queue', async () => {
    const db = await createTestDb();
    const queue = fakeQueue();
    await expect(
      enqueueExtractTopics(db, queue, 'nope', { docIds: [randomUUID()], force: false }),
    ).rejects.toBeInstanceOf(SubjectNotFoundError);
    expect(queue.add).not.toHaveBeenCalled();
  });
});
