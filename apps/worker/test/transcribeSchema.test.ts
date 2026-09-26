import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { createTestDb } from '@studyhub/db/testDb';
import { documents, schemaBlocks, subjects } from '@studyhub/db';
import { createManifest, scaffoldSubject } from '@studyhub/core';
import type { AiProvider, GeneratedWithMeta, SchemaTranscriptionOutput } from '@studyhub/ai';
import { processTranscribeSchema } from '../src/processors/transcribeSchema.js';

function fakeVisionProvider(data: SchemaTranscriptionOutput): AiProvider {
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
    transcribeSchema: vi
      .fn()
      .mockResolvedValue({
        data,
        usage: { inputTokens: 100, outputTokens: 50 },
        model: 'claude-sonnet-5',
        promptVersion: 'schema_transcription/v1',
      } satisfies GeneratedWithMeta<SchemaTranscriptionOutput>),
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

  it('inserts one block per transcribed block, auto-verifying only the confident ones', async () => {
    const provider = fakeVisionProvider({
      blocks: [
        { text: 'Sistema', confidence: 'ok', note: null },
        { text: 'Trasformazione isobara', confidence: 'uncertain', note: 'bassa confidenza' },
        { text: '???', confidence: 'illegible', note: 'grafia sovrapposta' },
      ],
    });

    const result = await processTranscribeSchema(db, { documentId: docId }, provider);

    expect(result.blockCount).toBe(3);
    expect(result.blockedCount).toBe(2);

    const blocks = await db
      .select()
      .from(schemaBlocks)
      .where(eq(schemaBlocks.documentId, docId))
      .orderBy(schemaBlocks.ord);
    expect(blocks).toHaveLength(3);
    expect(blocks[0]).toMatchObject({ text: 'Sistema', confidence: 'ok', verified: true });
    expect(blocks[1]).toMatchObject({ confidence: 'uncertain', verified: false });
    expect(blocks[2]).toMatchObject({ confidence: 'illegible', verified: false });

    const [doc] = await db.select().from(documents).where(eq(documents.id, docId));
    expect(doc?.status).toBe('parsed');
    expect(doc?.verificationStatus).toBe('pending');
    expect(doc?.blockedBlocks).toBe(2);
  });

  it('marks verificationStatus verified when every block came back confident', async () => {
    const provider = fakeVisionProvider({
      blocks: [{ text: 'Sistema', confidence: 'ok', note: null }],
    });

    await processTranscribeSchema(db, { documentId: docId }, provider);

    const [doc] = await db.select().from(documents).where(eq(documents.id, docId));
    expect(doc?.verificationStatus).toBe('verified');
    expect(doc?.blockedBlocks).toBe(0);
  });

  it('re-running replaces the previous blocks instead of appending', async () => {
    const first = fakeVisionProvider({ blocks: [{ text: 'A', confidence: 'ok', note: null }] });
    await processTranscribeSchema(db, { documentId: docId }, first);

    const second = fakeVisionProvider({
      blocks: [
        { text: 'B', confidence: 'ok', note: null },
        { text: 'C', confidence: 'uncertain', note: 'dubbio' },
      ],
    });
    await processTranscribeSchema(db, { documentId: docId }, second);

    const blocks = await db.select().from(schemaBlocks).where(eq(schemaBlocks.documentId, docId));
    expect(blocks).toHaveLength(2);
    expect(blocks.map((b) => b.text).sort()).toEqual(['B', 'C']);
  });

  it('sets the document to failed and rethrows when the provider call fails', async () => {
    const provider = fakeVisionProvider({ blocks: [] });
    provider.transcribeSchema = vi.fn().mockRejectedValue(new Error('claude cli non disponibile'));

    await expect(processTranscribeSchema(db, { documentId: docId }, provider)).rejects.toThrow(
      'claude cli non disponibile',
    );

    const [doc] = await db.select().from(documents).where(eq(documents.id, docId));
    expect(doc?.status).toBe('failed');
  });

  it('throws for an unknown document id', async () => {
    const provider = fakeVisionProvider({ blocks: [] });
    await expect(
      processTranscribeSchema(db, { documentId: randomUUID() }, provider),
    ).rejects.toThrow('document not found');
  });
});
