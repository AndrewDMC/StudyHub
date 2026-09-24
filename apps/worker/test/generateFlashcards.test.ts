import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { createTestDb } from '@studyhub/db/testDb';
import {
  artifactSources,
  artifacts,
  chunks,
  documentTopics,
  documents,
  flashcards,
  settings,
  subjects,
  topics,
} from '@studyhub/db';
import { createManifest, scaffoldSubject } from '@studyhub/core';
import {
  FakeProvider,
  type AiProvider,
  type FlashcardsPromptInput,
  type GeneratedWithMeta,
} from '@studyhub/ai';
import type { FlashcardsOutput, SummaryOutput } from '@studyhub/ai';
import { processGenerateFlashcards } from '../src/processors/generation/generateFlashcards.js';
import { BudgetExceededError } from '../src/processors/generation/shared.js';
import { runJob } from '../src/jobRunner.js';

const SAMPLE_TEXT =
  "L'entropia di un sistema isolato non diminuisce mai. Il secondo principio della termodinamica lo formalizza. Boltzmann la collegò al disordine microscopico dei sistemi fisici.";

describe('processGenerateFlashcards', () => {
  let dataRoot: string;
  let db: Awaited<ReturnType<typeof createTestDb>>;
  let subjectId: string;
  let subjectSlug: string;
  let docId: string;

  beforeEach(async () => {
    dataRoot = await mkdtemp(join(tmpdir(), 'studyhub-genflash-'));
    db = await createTestDb();
    const manifest = createManifest({ name: 'Fisica 1', slug: 'fisica-1', color: 'blue' });
    const folderPath = await scaffoldSubject(dataRoot, manifest);
    subjectId = manifest.id;
    subjectSlug = manifest.slug;
    await db.insert(subjects).values({
      id: subjectId,
      slug: subjectSlug,
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
      text: SAMPLE_TEXT,
      tokens: 50,
    });
  });

  afterEach(async () => {
    await rm(dataRoot, { recursive: true, force: true });
  });

  it('generates cards, writes the artifact file, and indexes deck + cards in the DB', async () => {
    const result = await processGenerateFlashcards(
      db,
      dataRoot,
      {
        subjectId,
        scope: { docIds: [docId] },
        count: 'auto',
        types: ['basic'],
        difficulty: 2,
        lang: 'it',
        force: false,
      },
      new FakeProvider(),
    );

    expect(result.cardCount).toBeGreaterThan(0);
    expect(result.idempotent).toBe(false);

    const [artifact] = await db.select().from(artifacts).where(eq(artifacts.id, result.artifactId));
    expect(artifact?.status).toBe('draft');
    expect(artifact?.kind).toBe('flashcard_deck');

    const cardRows = await db
      .select()
      .from(flashcards)
      .where(eq(flashcards.deckId, result.artifactId));
    expect(cardRows).toHaveLength(result.cardCount);

    const sourceRows = await db
      .select()
      .from(artifactSources)
      .where(eq(artifactSources.artifactId, result.artifactId));
    expect(sourceRows.map((r) => r.documentId)).toEqual([docId]);

    const fileContents = JSON.parse(await readFile(artifact!.path, 'utf-8'));
    expect(fileContents.sourceDocIds).toEqual([docId]);
    expect(fileContents.promptVersion).toBe('flashcards/v1');
    expect(fileContents.cards).toHaveLength(result.cardCount);
  });

  it('is idempotent end-to-end: two job runs with the same input reuse the artifact (docs/fasi/F3 "jobKey")', async () => {
    // Idempotency is keyed off the `jobs` table (jobRunner persists jobKey +
    // status on success), so it only shows up when going through runJob —
    // calling the processor directly twice, as in the other tests here,
    // never records a "succeeded" job to look up.
    const input = {
      subjectId,
      scope: { docIds: [docId] },
      count: 3,
      types: ['basic'],
      difficulty: 2,
      lang: 'it',
      force: false,
    };

    const firstOutput = (await runJob(db, dataRoot, {
      id: randomUUID(),
      name: 'generate_flashcards',
      data: input,
    })) as { artifactId: string; idempotent: boolean };
    const secondOutput = (await runJob(db, dataRoot, {
      id: randomUUID(),
      name: 'generate_flashcards',
      data: input,
    })) as { artifactId: string; idempotent: boolean };

    expect(firstOutput.idempotent).toBe(false);
    expect(secondOutput.idempotent).toBe(true);
    expect(secondOutput.artifactId).toBe(firstOutput.artifactId);

    const allDecks = await db.select().from(artifacts);
    expect(allDecks).toHaveLength(1);
  });

  it('discards a card whose citation does not appear verbatim in its chunk (anti-hallucination gate)', async () => {
    const fakeCorruptingProvider: AiProvider = {
      name: 'test-corrupting',
      async generateFlashcards(): Promise<GeneratedWithMeta<FlashcardsOutput>> {
        return {
          data: {
            cards: [
              {
                type: 'basic',
                front: 'Valida',
                back: 'Boltzmann la collegò al disordine microscopico dei sistemi fisici.',
                sourceRef: {
                  docId,
                  page: 1,
                  quote: 'Boltzmann la collegò al disordine microscopico dei sistemi fisici.',
                },
              },
              {
                type: 'basic',
                front: 'Allucinata',
                back: 'Questa frase non esiste nel testo originale.',
                sourceRef: {
                  docId,
                  page: 1,
                  quote: 'Questa frase non esiste nel testo originale.',
                },
              },
            ],
          },
          usage: { inputTokens: 10, outputTokens: 10 },
          model: 'test-model',
          promptVersion: 'flashcards/v1',
        };
      },
      async generateSummary(): Promise<GeneratedWithMeta<SummaryOutput>> {
        throw new Error('not used');
      },
    };

    const result = await processGenerateFlashcards(
      db,
      dataRoot,
      {
        subjectId,
        scope: { docIds: [docId] },
        count: 2,
        types: ['basic'],
        difficulty: 2,
        lang: 'it',
        force: false,
      },
      fakeCorruptingProvider,
    );

    expect(result.cardCount).toBe(1);
    expect(result.discardedCount).toBe(1);
    const cardRows = await db
      .select()
      .from(flashcards)
      .where(eq(flashcards.deckId, result.artifactId));
    expect(cardRows[0]?.front).toBe('Valida');
  });

  it('dedups cards with an identical front within one deck', async () => {
    const duplicatingProvider: AiProvider = {
      name: 'test-duplicating',
      async generateFlashcards(
        input: FlashcardsPromptInput,
      ): Promise<GeneratedWithMeta<FlashcardsOutput>> {
        const quote = input.chunks[0]!.text.split('. ')[0]! + '.';
        const card = {
          type: 'basic' as const,
          front: 'Stessa domanda',
          back: quote,
          sourceRef: { docId: input.chunks[0]!.docId, page: input.chunks[0]!.page, quote },
        };
        return {
          data: { cards: [card, { ...card }] },
          usage: { inputTokens: 10, outputTokens: 10 },
          model: 'test-model',
          promptVersion: 'flashcards/v1',
        };
      },
      async generateSummary(): Promise<GeneratedWithMeta<SummaryOutput>> {
        throw new Error('not used');
      },
    };

    const result = await processGenerateFlashcards(
      db,
      dataRoot,
      {
        subjectId,
        scope: { docIds: [docId] },
        count: 2,
        types: ['basic'],
        difficulty: 2,
        lang: 'it',
        force: false,
      },
      duplicatingProvider,
    );

    expect(result.cardCount).toBe(1);
  });

  it('resolves a topicIds-only scope via document_topics to the tagged documents’ chunks', async () => {
    const topicId = randomUUID();
    await db
      .insert(topics)
      .values({ id: topicId, subjectId, name: 'Termodinamica', slug: 'termodinamica' });
    await db.insert(documentTopics).values({ documentId: docId, topicId });

    const result = await processGenerateFlashcards(
      db,
      dataRoot,
      {
        subjectId,
        scope: { topicIds: [topicId] },
        count: 1,
        types: ['basic'],
        difficulty: 2,
        lang: 'it',
        force: false,
      },
      new FakeProvider(),
    );

    expect(result.cardCount).toBeGreaterThan(0);
  });

  it('rejects a topicIds scope for a topic with no documents tagged', async () => {
    const topicId = randomUUID();
    await db
      .insert(topics)
      .values({ id: topicId, subjectId, name: 'Elettromagnetismo', slug: 'elettromagnetismo' });

    await expect(
      processGenerateFlashcards(
        db,
        dataRoot,
        {
          subjectId,
          scope: { topicIds: [topicId] },
          count: 1,
          types: ['basic'],
          difficulty: 2,
          lang: 'it',
          force: false,
        },
        new FakeProvider(),
      ),
    ).rejects.toThrow(/Nessun documento collegato/);
  });

  it('rejects a topicIds scope for an unknown topic id', async () => {
    await expect(
      processGenerateFlashcards(
        db,
        dataRoot,
        {
          subjectId,
          scope: { topicIds: [randomUUID()] },
          count: 1,
          types: ['basic'],
          difficulty: 2,
          lang: 'it',
          force: false,
        },
        new FakeProvider(),
      ),
    ).rejects.toThrow(/Argomenti non trovati/);
  });

  it('throws for an unknown subject', async () => {
    await expect(
      processGenerateFlashcards(
        db,
        dataRoot,
        {
          subjectId: randomUUID(),
          scope: { docIds: [docId] },
          count: 1,
          types: ['basic'],
          difficulty: 2,
          lang: 'it',
          force: false,
        },
        new FakeProvider(),
      ),
    ).rejects.toThrow(/subject not found/);
  });

  it('enforces the daily budget cap unless force is set', async () => {
    // FakeProvider ("fake-v1") is priced at €0, so it can never trip the
    // guard — use a double with a priced model name to exercise it.
    const pricedProvider: AiProvider = {
      name: 'test-priced',
      async generateFlashcards(
        input: FlashcardsPromptInput,
      ): Promise<GeneratedWithMeta<FlashcardsOutput>> {
        const quote = input.chunks[0]!.text.split('. ')[0]! + '.';
        return {
          data: {
            cards: [
              {
                type: 'basic',
                front: 'Domanda',
                back: quote,
                sourceRef: { docId: input.chunks[0]!.docId, page: input.chunks[0]!.page, quote },
              },
            ],
          },
          usage: { inputTokens: 1_000_000, outputTokens: 500_000 },
          model: 'claude-sonnet-5',
          promptVersion: 'flashcards/v1',
        };
      },
      async generateSummary(): Promise<GeneratedWithMeta<SummaryOutput>> {
        throw new Error('not used');
      },
    };

    await db.insert(settings).values({ key: 'budget.dailyCapEur', value: 0 });

    await expect(
      processGenerateFlashcards(
        db,
        dataRoot,
        {
          subjectId,
          scope: { docIds: [docId] },
          count: 1,
          types: ['basic'],
          difficulty: 2,
          lang: 'it',
          force: false,
        },
        pricedProvider,
      ),
    ).rejects.toBeInstanceOf(BudgetExceededError);

    const forced = await processGenerateFlashcards(
      db,
      dataRoot,
      {
        subjectId,
        scope: { docIds: [docId] },
        count: 1,
        types: ['basic'],
        difficulty: 2,
        lang: 'it',
        force: true,
      },
      pricedProvider,
    );
    expect(forced.idempotent).toBe(false);
    expect(forced.costEur).toBeGreaterThan(0);
  });
});
