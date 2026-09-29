import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { createTestDb } from '@studyhub/db/testDb';
import { chunks, documentTopics, documents, settings, subjects, topics } from '@studyhub/db';
import { createManifest, scaffoldSubject } from '@studyhub/core';
import {
  FakeProvider,
  type AiProvider,
  type ExtractTopicsOutput,
  type GeneratedWithMeta,
} from '@studyhub/ai';
import { processExtractTopics } from '../src/processors/generation/extractTopics.js';
import { BudgetExceededError } from '../src/processors/generation/shared.js';
import { runJob } from '../src/jobRunner.js';

describe('processExtractTopics', () => {
  let dataRoot: string;
  let db: Awaited<ReturnType<typeof createTestDb>>;
  let subjectId: string;
  let docId: string;
  let secondDocId: string;

  beforeEach(async () => {
    dataRoot = await mkdtemp(join(tmpdir(), 'studyhub-extopics-'));
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
    secondDocId = randomUUID();
    await db.insert(documents).values([
      {
        id: docId,
        subjectId,
        type: 'appunti',
        originalName: 'entropia.pdf',
        storedPath: '/irrelevant',
        mime: 'application/pdf',
        bytes: 10,
        sha256: 'a'.repeat(64),
        status: 'parsed',
      },
      {
        id: secondDocId,
        subjectId,
        type: 'appunti',
        originalName: 'entropia-2.pdf',
        storedPath: '/irrelevant',
        mime: 'application/pdf',
        bytes: 10,
        sha256: 'b'.repeat(64),
        status: 'parsed',
      },
    ]);
    await db.insert(chunks).values([
      {
        id: randomUUID(),
        documentId: docId,
        pageFrom: 1,
        pageTo: 1,
        ord: 0,
        text: "L'entropia di un sistema isolato non diminuisce mai.",
        tokens: 10,
      },
      {
        id: randomUUID(),
        documentId: secondDocId,
        pageFrom: 1,
        pageTo: 1,
        ord: 0,
        text: "L'entropia è centrale nel secondo principio della termodinamica.",
        tokens: 10,
      },
    ]);
  });

  afterEach(async () => {
    await rm(dataRoot, { recursive: true, force: true });
  });

  it('creates AI-sourced topics and tags the documents', async () => {
    const result = await processExtractTopics(
      db,
      dataRoot,
      { subjectId, docIds: [docId, secondDocId], force: false },
      new FakeProvider(),
    );

    expect(result.topicsCreated).toBeGreaterThan(0);
    expect(result.linksCreated).toBeGreaterThan(0);

    const topicRows = await db.select().from(topics).where(eq(topics.subjectId, subjectId));
    expect(topicRows.length).toBe(result.topicsCreated);
    for (const t of topicRows) {
      expect(t.source).toBe('ai');
      expect(t.confidence).toBeGreaterThan(0);
    }

    const linkRows = await db
      .select()
      .from(documentTopics)
      .where(eq(documentTopics.documentId, docId));
    expect(linkRows.length).toBeGreaterThan(0);
    expect(linkRows[0]?.source).toBe('ai');
  });

  it('reuses an existing topic by name instead of duplicating it', async () => {
    const existingId = randomUUID();
    await db.insert(topics).values({
      id: existingId,
      subjectId,
      name: 'Entropia',
      slug: 'entropia',
      source: 'user',
    });

    const fakeProvider: AiProvider = {
      name: 'test-fixed',
      async extractTopics(): Promise<GeneratedWithMeta<ExtractTopicsOutput>> {
        return {
          data: { topics: [{ name: 'Entropia', docIds: [docId], confidence: 0.9 }] },
          usage: { inputTokens: 5, outputTokens: 5 },
          model: 'test-model',
          promptVersion: 'extract_topics/v1',
        };
      },
      async generateFlashcards(): Promise<never> {
        throw new Error('not used');
      },
      async generateSummary(): Promise<never> {
        throw new Error('not used');
      },
      async generateSchema(): Promise<never> {
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

    const result = await processExtractTopics(
      db,
      dataRoot,
      { subjectId, docIds: [docId], force: false },
      fakeProvider,
    );

    expect(result.topicsCreated).toBe(0); // reused, not created
    expect(result.linksCreated).toBe(1);

    const topicRows = await db.select().from(topics).where(eq(topics.subjectId, subjectId));
    expect(topicRows).toHaveLength(1);
    expect(topicRows[0]?.id).toBe(existingId);
    expect(topicRows[0]?.source).toBe('user'); // never downgraded by a later AI proposal
  });

  it('drops a proposed topic whose docId was never in the requested scope (anti-hallucination gate)', async () => {
    const fakeCorruptingProvider: AiProvider = {
      name: 'test-corrupting',
      async extractTopics(): Promise<GeneratedWithMeta<ExtractTopicsOutput>> {
        return {
          data: {
            topics: [
              { name: 'Valido', docIds: [docId], confidence: 0.8 },
              { name: 'Allucinato', docIds: [randomUUID()], confidence: 0.8 },
            ],
          },
          usage: { inputTokens: 5, outputTokens: 5 },
          model: 'test-model',
          promptVersion: 'extract_topics/v1',
        };
      },
      async generateFlashcards(): Promise<never> {
        throw new Error('not used');
      },
      async generateSummary(): Promise<never> {
        throw new Error('not used');
      },
      async generateSchema(): Promise<never> {
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

    const result = await processExtractTopics(
      db,
      dataRoot,
      { subjectId, docIds: [docId], force: false },
      fakeCorruptingProvider,
    );

    expect(result.topicsCreated).toBe(1);
    expect(result.discardedCount).toBe(1);
    const topicRows = await db.select().from(topics).where(eq(topics.subjectId, subjectId));
    expect(topicRows.map((t) => t.name)).toEqual(['Valido']);
  });

  it('sets parentId when a proposed topic names an existing topic as parent', async () => {
    const parentId = randomUUID();
    await db.insert(topics).values({
      id: parentId,
      subjectId,
      name: 'Termodinamica',
      slug: 'termodinamica',
      source: 'user',
    });

    const fakeProvider: AiProvider = {
      name: 'test-fixed',
      async extractTopics(): Promise<GeneratedWithMeta<ExtractTopicsOutput>> {
        return {
          data: {
            topics: [
              { name: 'Entropia', docIds: [docId], confidence: 0.9, parentName: 'Termodinamica' },
            ],
          },
          usage: { inputTokens: 5, outputTokens: 5 },
          model: 'test-model',
          promptVersion: 'extract_topics/v2',
        };
      },
      async generateFlashcards(): Promise<never> {
        throw new Error('not used');
      },
      async generateSummary(): Promise<never> {
        throw new Error('not used');
      },
      async generateSchema(): Promise<never> {
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

    const result = await processExtractTopics(
      db,
      dataRoot,
      { subjectId, docIds: [docId], force: false },
      fakeProvider,
    );

    expect(result.topicsCreated).toBe(1);
    const topicRows = await db.select().from(topics).where(eq(topics.subjectId, subjectId));
    const child = topicRows.find((t) => t.name === 'Entropia');
    expect(child?.parentId).toBe(parentId);
  });

  it('sets parentId when a proposed topic names a top-level sibling proposed in the same batch', async () => {
    const fakeProvider: AiProvider = {
      name: 'test-fixed',
      async extractTopics(): Promise<GeneratedWithMeta<ExtractTopicsOutput>> {
        return {
          data: {
            topics: [
              { name: 'Termodinamica', docIds: [secondDocId], confidence: 0.9, parentName: null },
              { name: 'Entropia', docIds: [docId], confidence: 0.9, parentName: 'Termodinamica' },
            ],
          },
          usage: { inputTokens: 5, outputTokens: 5 },
          model: 'test-model',
          promptVersion: 'extract_topics/v2',
        };
      },
      async generateFlashcards(): Promise<never> {
        throw new Error('not used');
      },
      async generateSummary(): Promise<never> {
        throw new Error('not used');
      },
      async generateSchema(): Promise<never> {
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

    const result = await processExtractTopics(
      db,
      dataRoot,
      { subjectId, docIds: [docId, secondDocId], force: false },
      fakeProvider,
    );

    expect(result.topicsCreated).toBe(2);
    const topicRows = await db.select().from(topics).where(eq(topics.subjectId, subjectId));
    const parent = topicRows.find((t) => t.name === 'Termodinamica');
    const child = topicRows.find((t) => t.name === 'Entropia');
    expect(parent?.parentId).toBeNull();
    expect(child?.parentId).toBe(parent?.id);
  });

  it('collapses a hallucinated or self-referencing parentName to top-level instead of trusting or rejecting it', async () => {
    const fakeProvider: AiProvider = {
      name: 'test-fixed',
      async extractTopics(): Promise<GeneratedWithMeta<ExtractTopicsOutput>> {
        return {
          data: {
            topics: [
              {
                name: 'Entropia',
                docIds: [docId],
                confidence: 0.9,
                parentName: 'Se stessa non esiste',
              },
              {
                name: 'Termodinamica',
                docIds: [secondDocId],
                confidence: 0.9,
                parentName: 'Termodinamica',
              },
            ],
          },
          usage: { inputTokens: 5, outputTokens: 5 },
          model: 'test-model',
          promptVersion: 'extract_topics/v2',
        };
      },
      async generateFlashcards(): Promise<never> {
        throw new Error('not used');
      },
      async generateSummary(): Promise<never> {
        throw new Error('not used');
      },
      async generateSchema(): Promise<never> {
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

    const result = await processExtractTopics(
      db,
      dataRoot,
      { subjectId, docIds: [docId, secondDocId], force: false },
      fakeProvider,
    );

    expect(result.topicsCreated).toBe(2);
    const topicRows = await db.select().from(topics).where(eq(topics.subjectId, subjectId));
    for (const t of topicRows) {
      expect(t.parentId).toBeNull();
    }
  });

  it('is idempotent end-to-end via runJob: second run does not re-tag or re-spend', async () => {
    const input = { subjectId, docIds: [docId, secondDocId], force: false };
    const first = (await runJob(db, dataRoot, {
      id: randomUUID(),
      name: 'extract_topics',
      data: input,
    })) as { idempotent: boolean; topicsCreated: number };
    const second = (await runJob(db, dataRoot, {
      id: randomUUID(),
      name: 'extract_topics',
      data: input,
    })) as { idempotent: boolean; topicsCreated: number };

    expect(first.idempotent).toBe(false);
    expect(second.idempotent).toBe(true);
    expect(second.topicsCreated).toBe(0);
  });

  it('enforces the daily budget cap unless force is set', async () => {
    // FakeProvider always reports zero cost (pricing.ts prices 'fake-v1' at zero) — a priced
    // stub with a real model name is needed to actually exercise the budget guard, same as
    // generateFlashcards.test.ts's "enforces the daily budget cap" case.
    const pricedProvider: AiProvider = {
      name: 'test-priced',
      async extractTopics(): Promise<GeneratedWithMeta<ExtractTopicsOutput>> {
        return {
          data: { topics: [{ name: 'Entropia', docIds: [docId], confidence: 0.7 }] },
          usage: { inputTokens: 1_000_000, outputTokens: 500_000 },
          model: 'claude-sonnet-5',
          promptVersion: 'extract_topics/v1',
        };
      },
      async generateFlashcards(): Promise<never> {
        throw new Error('not used');
      },
      async generateSummary(): Promise<never> {
        throw new Error('not used');
      },
      async generateSchema(): Promise<never> {
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

    await db.insert(settings).values({ key: 'budget.dailyCapEur', value: 0 });

    await expect(
      processExtractTopics(
        db,
        dataRoot,
        { subjectId, docIds: [docId], force: false },
        pricedProvider,
      ),
    ).rejects.toBeInstanceOf(BudgetExceededError);

    const result = await processExtractTopics(
      db,
      dataRoot,
      { subjectId, docIds: [docId], force: true },
      pricedProvider,
    );
    expect(result.topicsCreated).toBeGreaterThan(0);
  });

  it('throws for an unknown subject', async () => {
    await expect(
      processExtractTopics(
        db,
        dataRoot,
        { subjectId: randomUUID(), docIds: [docId], force: false },
        new FakeProvider(),
      ),
    ).rejects.toThrow(/subject not found/);
  });

  it('throws a clear error for a document that does not belong to the subject', async () => {
    const otherManifest = createManifest({ name: 'Chimica', slug: 'chimica', color: 'green' });
    await scaffoldSubject(dataRoot, otherManifest);
    await db.insert(subjects).values({
      id: otherManifest.id,
      slug: otherManifest.slug,
      name: otherManifest.name,
      color: otherManifest.color,
      folderPath: 'irrelevant',
    });
    const foreignDocId = randomUUID();
    await db.insert(documents).values({
      id: foreignDocId,
      subjectId: otherManifest.id,
      type: 'appunti',
      originalName: 'altro.pdf',
      storedPath: '/irrelevant',
      mime: 'application/pdf',
      bytes: 10,
      sha256: 'c'.repeat(64),
      status: 'parsed',
    });

    await expect(
      processExtractTopics(
        db,
        dataRoot,
        { subjectId, docIds: [foreignDocId], force: false },
        new FakeProvider(),
      ),
    ).rejects.toThrow(/non appartenenti alla materia/);
  });
});
