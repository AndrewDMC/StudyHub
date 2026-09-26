import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import {
  documents,
  schemaEdges,
  schemaGroups,
  schemaNodes,
  transcriptionCorrections,
} from '@studyhub/db';
import { createTestDb } from '@studyhub/db/testDb';
import { createSubject } from '../src/lib/subjects';
import { getSchemaGraph, updateSchemaNode, SchemaNodeNotFoundError } from '../src/lib/schemaGraph';
import { SubjectNotFoundError } from '../src/lib/errors';
import { DocumentNotFoundError } from '../src/lib/documentTopics';

describe('schemaGraph', () => {
  let dataRoot: string;
  let db: Awaited<ReturnType<typeof createTestDb>>;
  let subjectSlug: string;
  let documentId: string;
  let nodeId: string;

  beforeEach(async () => {
    dataRoot = await mkdtemp(join(tmpdir(), 'studyhub-schemagraph-'));
    db = await createTestDb();
    const subject = await createSubject(db, dataRoot, { name: 'Chimica', color: 'green' });
    subjectSlug = subject.slug;

    documentId = randomUUID();
    await db.insert(documents).values({
      id: documentId,
      subjectId: subject.id,
      type: 'schemi',
      originalName: 'schema.jpg',
      storedPath: '/irrelevant',
      mime: 'image/jpeg',
      bytes: 10,
      sha256: 'a'.repeat(64),
    });

    nodeId = randomUUID();
    await db.insert(schemaNodes).values([
      {
        id: nodeId,
        documentId,
        nodeKey: 'n1',
        label: 'Primo principio',
        kind: 'principio',
        confidence: 'ok',
        verifiedAt: new Date(),
      },
      {
        id: randomUUID(),
        documentId,
        nodeKey: 'n2',
        label: 'Trasf. adiabatica',
        kind: 'caso',
        confidence: 'uncertain',
      },
    ]);
    await db.insert(schemaEdges).values({
      id: randomUUID(),
      documentId,
      fromNode: 'n1',
      toNode: 'n2',
      type: 'implica',
      label: null,
    });
    await db.insert(schemaGroups).values({
      id: randomUUID(),
      documentId,
      groupKey: 'g1',
      label: 'Trasformazioni',
      nodeKeys: ['n2'],
    });
  });

  afterEach(async () => {
    await rm(dataRoot, { recursive: true, force: true });
  });

  it('returns nodes, edges and groups for the document', async () => {
    const graph = await getSchemaGraph(db, subjectSlug, documentId);
    expect(graph.nodes).toHaveLength(2);
    expect(graph.edges).toEqual([
      { id: expect.any(String), from: 'n1', to: 'n2', type: 'implica', label: null },
    ]);
    expect(graph.groups[0]).toMatchObject({ groupKey: 'g1', nodeKeys: ['n2'] });
  });

  it('throws SubjectNotFoundError/DocumentNotFoundError appropriately', async () => {
    await expect(getSchemaGraph(db, 'nope', documentId)).rejects.toThrow(SubjectNotFoundError);
    await expect(getSchemaGraph(db, subjectSlug, randomUUID())).rejects.toThrow(
      DocumentNotFoundError,
    );
  });

  it('updateSchemaNode sets verifiedAt and clears blockedBlocks when confirming the last uncertain node', async () => {
    const uncertainNode = (await getSchemaGraph(db, subjectSlug, documentId)).nodes.find(
      (n) => n.nodeKey === 'n2',
    )!;
    const updated = await updateSchemaNode(db, subjectSlug, documentId, uncertainNode.id, {
      verified: true,
    });
    expect(updated.verifiedAt).not.toBeNull();

    const [doc] = await db.select().from(documents).where(eq(documents.id, documentId));
    expect(doc?.blockedBlocks).toBe(0);
    expect(doc?.verificationStatus).toBe('verified');
  });

  it('logs a transcription_correction when the label actually changes', async () => {
    await updateSchemaNode(db, subjectSlug, documentId, nodeId, {
      label: 'Primo principio corretto',
    });
    const corrections = await db
      .select()
      .from(transcriptionCorrections)
      .where(eq(transcriptionCorrections.documentId, documentId));
    expect(corrections).toHaveLength(1);
    expect(corrections[0]).toMatchObject({
      before: 'Primo principio',
      after: 'Primo principio corretto',
    });
  });

  it('does not log a correction when the label is unchanged', async () => {
    await updateSchemaNode(db, subjectSlug, documentId, nodeId, { label: 'Primo principio' });
    const corrections = await db.select().from(transcriptionCorrections);
    expect(corrections).toHaveLength(0);
  });

  it('throws SchemaNodeNotFoundError for an unknown node id', async () => {
    await expect(
      updateSchemaNode(db, subjectSlug, documentId, randomUUID(), { verified: true }),
    ).rejects.toThrow(SchemaNodeNotFoundError);
  });
});
