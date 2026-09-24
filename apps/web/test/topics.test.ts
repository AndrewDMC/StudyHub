import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTestDb } from '@studyhub/db/testDb';
import { createSubject } from '../src/lib/subjects';
import {
  createTopic,
  deleteTopic,
  listTopics,
  TopicNotFoundError,
  updateTopic,
} from '../src/lib/topics';
import { SubjectNotFoundError } from '../src/lib/errors';

describe('topics', () => {
  let dataRoot: string;
  let db: Awaited<ReturnType<typeof createTestDb>>;
  let subjectSlug: string;

  beforeEach(async () => {
    dataRoot = await mkdtemp(join(tmpdir(), 'studyhub-topics-'));
    db = await createTestDb();
    const subject = await createSubject(db, dataRoot, { name: 'Analisi 1', color: 'violet' });
    subjectSlug = subject.slug;
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
});
