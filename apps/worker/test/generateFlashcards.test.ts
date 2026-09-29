import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
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

// Deterministic stand-in for the real (ONNX, slow, network-on-first-use) embedding model —
// distinct strings land on near-orthogonal random vectors, so unrelated cards never collide as
// semantic duplicates by accident. The dedicated "semantic dedup" tests below override this
// per-string, via the injectable `embed` parameter, where they need precise control.
function mulberry32(seed: number): () => number {
  let s = seed;
  return () => {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hashSeed(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
function fakeEmbedOne(text: string, dims = 384): number[] {
  const rng = mulberry32(hashSeed(text));
  return Array.from({ length: dims }, () => rng() * 2 - 1);
}
const distinctFakeEmbed = async (texts: string[]): Promise<number[][]> =>
  texts.map((t) => fakeEmbedOne(t));

// `runJob` (used by the idempotency test below) calls `processGenerateFlashcards` without the
// injectable `embed` parameter — it always resolves to the real, ONNX-backed `embedTexts`. Mocking
// the module is the only seam available there; every *direct* call in this file still passes
// `distinctFakeEmbed` explicitly (redundant with this mock, but self-documenting).
vi.mock('@studyhub/ai/embeddings', () => ({
  embedTexts: (texts: string[]) => Promise.resolve(texts.map((t) => fakeEmbedOne(t))),
}));

// `flashcards.embedding` is a fixed `vector(384)` column (matching the real embedding model's
// dimensionality) — pgvector rejects any other length, so semantic-dedup tests need real
// 384-dim vectors, not toy 2-d ones. One-hot on a chosen axis: same `seed` → cosine 1 (duplicate),
// different `seed` → cosine 0 (orthogonal, never a false-positive duplicate).
function unitVector(seed: number, dims = 384): number[] {
  const v = new Array(dims).fill(0);
  v[seed % dims] = 1;
  return v;
}

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
      distinctFakeEmbed,
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
      distinctFakeEmbed,
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
      distinctFakeEmbed,
    );

    expect(result.cardCount).toBe(1);
  });

  describe('semantic dedup (docs/fasi/F3-ai-core.md "Stato")', () => {
    it('drops a paraphrase within the same batch but keeps a genuinely different card, in order', async () => {
      const sentences = SAMPLE_TEXT.split('. ').map((s) => (s.endsWith('.') ? s : `${s}.`));
      const paraphrasingProvider: AiProvider = {
        name: 'test-paraphrasing',
        async generateFlashcards(): Promise<GeneratedWithMeta<FlashcardsOutput>> {
          return {
            data: {
              cards: [
                {
                  type: 'basic',
                  front: 'Domanda A',
                  back: sentences[0]!,
                  sourceRef: { docId, page: 1, quote: sentences[0]! },
                },
                {
                  type: 'basic',
                  front: 'Domanda A bis', // a paraphrase, not an exact-text repeat
                  back: sentences[1]!,
                  sourceRef: { docId, page: 1, quote: sentences[1]! },
                },
                {
                  type: 'basic',
                  front: 'Domanda B', // a genuinely different fact
                  back: sentences[2]!,
                  sourceRef: { docId, page: 1, quote: sentences[2]! },
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
      // "Domanda A"/"Domanda A bis" collide (same direction, cosine 1 > 0.92); "Domanda B" is orthogonal.
      const embed = async (texts: string[]) =>
        texts.map((t) => (t === 'Domanda B' ? unitVector(1) : unitVector(0)));

      const result = await processGenerateFlashcards(
        db,
        dataRoot,
        {
          subjectId,
          scope: { docIds: [docId] },
          count: 3,
          types: ['basic'],
          difficulty: 2,
          lang: 'it',
          force: false,
        },
        paraphrasingProvider,
        embed,
      );

      expect(result.cardCount).toBe(2);
      expect(result.semanticDuplicateCount).toBe(1);
      const cardRows = await db
        .select()
        .from(flashcards)
        .where(eq(flashcards.deckId, result.artifactId));
      expect(cardRows.map((c) => c.front).sort()).toEqual(['Domanda A', 'Domanda B']);
    });

    it('drops a new card that duplicates an existing flashcard already embedded in the subject', async () => {
      const deckId = randomUUID();
      await db.insert(artifacts).values({
        id: deckId,
        subjectId,
        kind: 'flashcard_deck',
        title: 'Deck precedente',
        path: '/x.json',
        model: 'fake-v1',
        promptVersion: 'flashcards/v1',
      });
      await db.insert(flashcards).values({
        id: randomUUID(),
        deckId,
        type: 'basic',
        front: 'Vecchia domanda',
        back: 'x',
        sourceRef: { docId, page: 1, quote: 'x' },
        embedding: unitVector(0),
      });

      const quote = SAMPLE_TEXT.split('. ')[0]! + '.';
      const repeatingProvider: AiProvider = {
        name: 'test-repeating',
        async generateFlashcards(): Promise<GeneratedWithMeta<FlashcardsOutput>> {
          return {
            data: {
              cards: [
                {
                  type: 'basic',
                  front: 'Nuova ma uguale',
                  back: quote,
                  sourceRef: { docId, page: 1, quote },
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
      const embed = async () => [unitVector(0)]; // same direction as the pre-existing card's embedding

      const result = await processGenerateFlashcards(
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
        repeatingProvider,
        embed,
      );

      expect(result.cardCount).toBe(0);
      expect(result.semanticDuplicateCount).toBe(1);
    });
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
      distinctFakeEmbed,
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
        distinctFakeEmbed,
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
        distinctFakeEmbed,
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
        distinctFakeEmbed,
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
        distinctFakeEmbed,
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
      distinctFakeEmbed,
    );
    expect(forced.idempotent).toBe(false);
    expect(forced.costEur).toBeGreaterThan(0);
  });
});
