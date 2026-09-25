import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { createTestDb } from '@studyhub/db/testDb';
import { artifactSources, artifacts, chunks, documents, subjects } from '@studyhub/db';
import { createManifest, scaffoldSubject } from '@studyhub/core';
import { FakeProvider, type AiProvider, type GeneratedWithMeta, type SchemaOutput } from '@studyhub/ai';
import { processGenerateSchema } from '../src/processors/generation/generateSchema.js';
import { runJob } from '../src/jobRunner.js';

describe('processGenerateSchema', () => {
  let dataRoot: string;
  let db: Awaited<ReturnType<typeof createTestDb>>;
  let subjectId: string;
  let docId: string;

  beforeEach(async () => {
    dataRoot = await mkdtemp(join(tmpdir(), 'studyhub-genschema-'));
    db = await createTestDb();
    const manifest = createManifest({ name: 'Fisica 1', slug: 'fisica-1', color: 'blue' });
    const folderPath = await scaffoldSubject(dataRoot, manifest);
    subjectId = manifest.id;
    await db.insert(subjects).values({
      id: subjectId,
      slug: manifest.slug,
      name: manifest.name,
      color: manifest.color,
      folderPath,
    });

    docId = randomUUID();
    await db.insert(documents).values({
      id: docId,
      subjectId,
      type: 'appunti',
      originalName: 'lezione.pdf',
      storedPath: '/irrelevant',
      mime: 'application/pdf',
      bytes: 10,
      sha256: 'a'.repeat(64),
      status: 'parsed',
    });
    await db.insert(chunks).values({
      id: randomUUID(),
      documentId: docId,
      pageFrom: 1,
      pageTo: 1,
      ord: 0,
      text: "L'entropia di un sistema isolato non diminuisce mai. Il secondo principio della termodinamica lo formalizza.",
      tokens: 30,
    });
  });

  afterEach(async () => {
    await rm(dataRoot, { recursive: true, force: true });
  });

  it('writes a JSON artifact with nodes and indexes it as draft', async () => {
    const result = await processGenerateSchema(
      db,
      dataRoot,
      { subjectId, scope: { docIds: [docId] }, depth: 2, style: 'gerarchico', force: false },
      new FakeProvider(),
    );

    const [artifact] = await db.select().from(artifacts).where(eq(artifacts.id, result.artifactId));
    expect(artifact?.kind).toBe('schema');
    expect(artifact?.status).toBe('draft');

    const contents = JSON.parse(await readFile(artifact!.path, 'utf-8'));
    expect(contents.promptVersion).toBe('schema/v1');
    expect(contents.nodes.length).toBeGreaterThan(0);
    expect(contents.markdown).toContain('# Schema');

    const sourceRows = await db
      .select()
      .from(artifactSources)
      .where(eq(artifactSources.artifactId, result.artifactId));
    expect(sourceRows.map((r) => r.documentId)).toEqual([docId]);
  });

  it('is idempotent end-to-end via runJob', async () => {
    const input = { subjectId, scope: { docIds: [docId] }, depth: 2, style: 'gerarchico', force: false };
    const first = (await runJob(db, dataRoot, {
      id: randomUUID(),
      name: 'generate_schema',
      data: input,
    })) as { artifactId: string; idempotent: boolean };
    const second = (await runJob(db, dataRoot, {
      id: randomUUID(),
      name: 'generate_schema',
      data: input,
    })) as { artifactId: string; idempotent: boolean };

    expect(first.idempotent).toBe(false);
    expect(second.idempotent).toBe(true);
    expect(second.artifactId).toBe(first.artifactId);

    const allSchemas = await db.select().from(artifacts);
    expect(allSchemas).toHaveLength(1);
  });

  it('discards a node whose citation does not appear verbatim in its chunk (anti-hallucination gate)', async () => {
    const fakeCorruptingProvider: AiProvider = {
      name: 'test-corrupting',
      async generateSchema(): Promise<GeneratedWithMeta<SchemaOutput>> {
        return {
          data: {
            markdown: '# Schema',
            nodes: [
              {
                nodeId: 'n1',
                label: 'Valido',
                sourceRef: {
                  docId,
                  page: 1,
                  quote: "L'entropia di un sistema isolato non diminuisce mai.",
                },
              },
              {
                nodeId: 'n2',
                label: 'Allucinato',
                sourceRef: { docId, page: 1, quote: 'Questa frase non esiste nel testo originale.' },
              },
            ],
          },
          usage: { inputTokens: 10, outputTokens: 10 },
          model: 'test-model',
          promptVersion: 'schema/v1',
        };
      },
      async generateFlashcards(): Promise<never> {
        throw new Error('not used');
      },
      async generateSummary(): Promise<never> {
        throw new Error('not used');
      },
      async extractExamProfile(): Promise<never> {
        throw new Error('not used');
      },
      async generateSimulation(): Promise<never> {
        throw new Error('not used');
      },
      async gradeAnswer(): Promise<never> {
        throw new Error('not used');
      },
      async estimateTopics(): Promise<never> {
        throw new Error('not used');
      },
    };

    const result = await processGenerateSchema(
      db,
      dataRoot,
      { subjectId, scope: { docIds: [docId] }, depth: 2, style: 'gerarchico', force: false },
      fakeCorruptingProvider,
    );

    expect(result.nodeCount).toBe(1);
    expect(result.discardedCount).toBe(1);
  });

  it('throws for an unknown subject', async () => {
    await expect(
      processGenerateSchema(
        db,
        dataRoot,
        { subjectId: randomUUID(), scope: { docIds: [docId] }, depth: 2, style: 'gerarchico', force: false },
        new FakeProvider(),
      ),
    ).rejects.toThrow(/subject not found/);
  });
});
