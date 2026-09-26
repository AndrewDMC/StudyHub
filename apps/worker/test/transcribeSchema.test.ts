import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { createTestDb } from '@studyhub/db/testDb';
import { documents, schemaEdges, schemaGroups, schemaNodes, subjects } from '@studyhub/db';
import { createManifest, scaffoldSubject } from '@studyhub/core';
import type { AiProvider, GeneratedWithMeta, SchemaGraphOutput } from '@studyhub/ai';
import { processTranscribeSchema } from '../src/processors/transcribeSchema.js';

function fakeVisionProvider(data: SchemaGraphOutput): AiProvider {
  return {
    name: 'fake-vision-test',
    generateFlashcards: vi.fn(),
    generateSummary: vi.fn(),
    generateSchema: vi.fn(),
    extractExamProfile: vi.fn(),
    generateSimulation: vi.fn(),
    gradeAnswer: vi.fn(),
    estimateTopics: vi.fn(),
    extractTopics: vi.fn(),
    ocrText: vi.fn(),
    classifyDocumentType: vi.fn(),
    distillHandwritingProfile: vi.fn(),
    transcribeSchema: vi.fn().mockResolvedValue({
      data,
      usage: { inputTokens: 100, outputTokens: 50 },
      model: 'claude-sonnet-5',
      promptVersion: 'schema_transcription/v2',
    } satisfies GeneratedWithMeta<SchemaGraphOutput>),
  };
}

describe('processTranscribeSchema', () => {
  let dataRoot: string;
  let db: Awaited<ReturnType<typeof createTestDb>>;
  let docId: string;

  beforeEach(async () => {
    dataRoot = await mkdtemp(join(tmpdir(), 'studyhub-transcribe-'));
    db = await createTestDb();
    const manifest = createManifest({ name: 'Chimica', slug: 'chimica', color: 'green' });
    const folderPath = await scaffoldSubject(dataRoot, manifest);
    await db.insert(subjects).values({
      id: manifest.id,
      slug: manifest.slug,
      name: manifest.name,
      color: manifest.color,
      folderPath,
    });

    docId = randomUUID();
    await db.insert(documents).values({
      id: docId,
      subjectId: manifest.id,
      type: 'schemi',
      originalName: 'schema_termodinamica.jpg',
      storedPath: join(folderPath, 'sources', 'schemi', 'schema.jpg'),
      mime: 'image/jpeg',
      bytes: 1000,
      sha256: 'a'.repeat(64),
      status: 'uploaded',
    });
  });

  afterEach(async () => {
    await rm(dataRoot, { recursive: true, force: true });
  });

  it('inserts one node per transcribed node, auto-verifying only the confident ones', async () => {
    const provider = fakeVisionProvider({
      nodes: [
        { key: 'n1', label: 'Sistema', kind: 'concetto', crop: null, confidence: 'ok' },
        { key: 'n2', label: 'Trasf. isobara', kind: 'caso', crop: null, confidence: 'uncertain' },
        { key: 'n3', label: '???', kind: 'concetto', crop: null, confidence: 'unreadable' },
      ],
      edges: [{ from: 'n1', to: 'n2', type: 'implica', label: null }],
      groups: [],
    });

    const result = await processTranscribeSchema(db, dataRoot, { documentId: docId }, provider);

    expect(result.nodeCount).toBe(3);
    expect(result.blockedCount).toBe(2);

    const nodes = await db
      .select()
      .from(schemaNodes)
      .where(eq(schemaNodes.documentId, docId))
      .orderBy(schemaNodes.nodeKey);
    expect(nodes).toHaveLength(3);
    expect(nodes[0]).toMatchObject({ label: 'Sistema', confidence: 'ok' });
    expect(nodes[0]?.verifiedAt).not.toBeNull();
    expect(nodes[1]).toMatchObject({ confidence: 'uncertain' });
    expect(nodes[1]?.verifiedAt).toBeNull();

    const edges = await db.select().from(schemaEdges).where(eq(schemaEdges.documentId, docId));
    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({ fromNode: 'n1', toNode: 'n2', type: 'implica' });

    const [doc] = await db.select().from(documents).where(eq(documents.id, docId));
    expect(doc?.status).toBe('parsed');
    expect(doc?.verificationStatus).toBe('pending');
    expect(doc?.blockedBlocks).toBe(2);
    expect(doc?.mdPath).toContain('content.md');

    const markdown = await readFile(doc!.mdPath!, 'utf-8');
    expect(markdown).toContain('kind: schema');
    expect(markdown).toContain('^n1');
  });

  it('marks verificationStatus verified when every node came back confident', async () => {
    const provider = fakeVisionProvider({
      nodes: [{ key: 'n1', label: 'Sistema', kind: 'concetto', crop: null, confidence: 'ok' }],
      edges: [],
      groups: [],
    });

    await processTranscribeSchema(db, dataRoot, { documentId: docId }, provider);

    const [doc] = await db.select().from(documents).where(eq(documents.id, docId));
    expect(doc?.verificationStatus).toBe('verified');
    expect(doc?.blockedBlocks).toBe(0);
  });

  it('re-running replaces the previous graph instead of appending', async () => {
    const first = fakeVisionProvider({
      nodes: [{ key: 'n1', label: 'A', kind: 'concetto', crop: null, confidence: 'ok' }],
      edges: [],
      groups: [],
    });
    await processTranscribeSchema(db, dataRoot, { documentId: docId }, first);

    const second = fakeVisionProvider({
      nodes: [
        { key: 'n1', label: 'B', kind: 'concetto', crop: null, confidence: 'ok' },
        { key: 'n2', label: 'C', kind: 'concetto', crop: null, confidence: 'uncertain' },
      ],
      edges: [],
      groups: [{ key: 'g1', label: 'Gruppo', nodeKeys: ['n2'] }],
    });
    await processTranscribeSchema(db, dataRoot, { documentId: docId }, second);

    const nodes = await db.select().from(schemaNodes).where(eq(schemaNodes.documentId, docId));
    expect(nodes).toHaveLength(2);
    expect(nodes.map((n) => n.label).sort()).toEqual(['B', 'C']);
    const groups = await db.select().from(schemaGroups).where(eq(schemaGroups.documentId, docId));
    expect(groups).toHaveLength(1);
  });

  it('sets the document to failed and rethrows when the provider call fails', async () => {
    const provider = fakeVisionProvider({ nodes: [], edges: [], groups: [] });
    provider.transcribeSchema = vi.fn().mockRejectedValue(new Error('claude cli non disponibile'));

    await expect(
      processTranscribeSchema(db, dataRoot, { documentId: docId }, provider),
    ).rejects.toThrow('claude cli non disponibile');

    const [doc] = await db.select().from(documents).where(eq(documents.id, docId));
    expect(doc?.status).toBe('failed');
  });

  it('throws for an unknown document id', async () => {
    const provider = fakeVisionProvider({ nodes: [], edges: [], groups: [] });
    await expect(
      processTranscribeSchema(db, dataRoot, { documentId: randomUUID() }, provider),
    ).rejects.toThrow('document not found');
  });

  it('never overwrites a content.md the user has edited — writes content.new.md and flags a conflict', async () => {
    const provider = fakeVisionProvider({
      nodes: [{ key: 'n1', label: 'A', kind: 'concetto', crop: null, confidence: 'ok' }],
      edges: [],
      groups: [],
    });
    await processTranscribeSchema(db, dataRoot, { documentId: docId }, provider);
    await db.update(documents).set({ mdEdited: true }).where(eq(documents.id, docId));

    const second = fakeVisionProvider({
      nodes: [{ key: 'n1', label: 'B', kind: 'concetto', crop: null, confidence: 'ok' }],
      edges: [],
      groups: [],
    });
    await processTranscribeSchema(db, dataRoot, { documentId: docId }, second);

    const [doc] = await db.select().from(documents).where(eq(documents.id, docId));
    expect(doc?.mdConflict).toBe(true);
    const original = await readFile(doc!.mdPath!, 'utf-8');
    expect(original).toContain('label: "A"');
    expect(original).not.toContain('label: "B"');
    const newVersion = await readFile(join(doc!.mdPath!, '..', 'content.new.md'), 'utf-8');
    expect(newVersion).toContain('label: "B"');
  });
});
