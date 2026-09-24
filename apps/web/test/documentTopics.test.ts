import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { createTestDb } from '@studyhub/db/testDb';
import { documentTopics, topics } from '@studyhub/db';
import { createSubject } from '../src/lib/subjects';
import { uploadDocument, listDocuments } from '../src/lib/documents';
import { createTopic } from '../src/lib/topics';
import {
  DocumentNotFoundError,
  setDocumentTopics,
  TopicsNotFoundError,
} from '../src/lib/documentTopics';
import { SubjectNotFoundError } from '../src/lib/errors';

const PDF_BYTES = new TextEncoder().encode('%PDF-1.7\n%%mock pdf%%');

describe('setDocumentTopics', () => {
  let dataRoot: string;
  let db: Awaited<ReturnType<typeof createTestDb>>;
  let subjectSlug: string;
  let documentId: string;

  beforeEach(async () => {
    dataRoot = await mkdtemp(join(tmpdir(), 'studyhub-doctopics-'));
    db = await createTestDb();
    const subject = await createSubject(db, dataRoot, { name: 'Fisica 1', color: 'blue' });
    subjectSlug = subject.slug;
    const upload = await uploadDocument(db, dataRoot, subjectSlug, {
      type: 'appunti',
      originalName: 'x.pdf',
      bytes: PDF_BYTES,
    });
    documentId = upload.document.id;
  });

  afterEach(async () => {
    await rm(dataRoot, { recursive: true, force: true });
  });

  it('a freshly uploaded document has no topics', async () => {
    const docs = await listDocuments(db, subjectSlug);
    expect(docs[0]!.topicIds).toEqual([]);
  });

  it('tags a document with one or more topics, and listDocuments reflects it', async () => {
    const a = await createTopic(db, subjectSlug, { name: 'Meccanica' });
    const b = await createTopic(db, subjectSlug, { name: 'Termodinamica' });

    const result = await setDocumentTopics(db, subjectSlug, documentId, [a.id, b.id]);
    expect(result.sort()).toEqual([a.id, b.id].sort());

    const docs = await listDocuments(db, subjectSlug);
    expect(docs[0]!.topicIds.sort()).toEqual([a.id, b.id].sort());
  });

  it('replaces the full set rather than adding to it', async () => {
    const a = await createTopic(db, subjectSlug, { name: 'Meccanica' });
    const b = await createTopic(db, subjectSlug, { name: 'Termodinamica' });
    await setDocumentTopics(db, subjectSlug, documentId, [a.id]);
    await setDocumentTopics(db, subjectSlug, documentId, [b.id]);

    const rows = await db.select().from(documentTopics);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.topicId).toBe(b.id);
  });

  it('clears all topics when given an empty array', async () => {
    const a = await createTopic(db, subjectSlug, { name: 'Meccanica' });
    await setDocumentTopics(db, subjectSlug, documentId, [a.id]);
    await setDocumentTopics(db, subjectSlug, documentId, []);
    expect(await db.select().from(documentTopics)).toEqual([]);
  });

  it('dedups repeated topic ids in the request', async () => {
    const a = await createTopic(db, subjectSlug, { name: 'Meccanica' });
    const result = await setDocumentTopics(db, subjectSlug, documentId, [a.id, a.id]);
    expect(result).toEqual([a.id]);
    expect(await db.select().from(documentTopics)).toHaveLength(1);
  });

  it('throws TopicsNotFoundError for a topic id that does not exist, and links nothing', async () => {
    await expect(setDocumentTopics(db, subjectSlug, documentId, [randomUUID()])).rejects.toThrow(
      TopicsNotFoundError,
    );
    expect(await db.select().from(documentTopics)).toEqual([]);
  });

  it('throws TopicsNotFoundError for a topic belonging to another subject', async () => {
    const other = await createSubject(db, dataRoot, { name: 'Chimica 1', color: 'green' });
    const foreignTopic = await createTopic(db, other.slug, { name: 'Stechiometria' });
    await expect(setDocumentTopics(db, subjectSlug, documentId, [foreignTopic.id])).rejects.toThrow(
      TopicsNotFoundError,
    );
  });

  it('throws DocumentNotFoundError for a document belonging to another subject', async () => {
    const other = await createSubject(db, dataRoot, { name: 'Chimica 1', color: 'green' });
    await expect(setDocumentTopics(db, other.slug, documentId, [])).rejects.toThrow(
      DocumentNotFoundError,
    );
  });

  it('throws SubjectNotFoundError for an unknown slug', async () => {
    await expect(setDocumentTopics(db, 'nope', documentId, [])).rejects.toThrow(
      SubjectNotFoundError,
    );
  });

  it('cascades: deleting a topic removes it from a tagged document without deleting the document', async () => {
    const a = await createTopic(db, subjectSlug, { name: 'Meccanica' });
    await setDocumentTopics(db, subjectSlug, documentId, [a.id]);
    await db.delete(topics).where(eq(topics.id, a.id));

    const docs = await listDocuments(db, subjectSlug);
    expect(docs).toHaveLength(1);
    expect(docs[0]!.topicIds).toEqual([]);
  });
});
