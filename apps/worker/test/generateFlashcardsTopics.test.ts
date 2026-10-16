import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { createTestDb } from '@studyhub/db/testDb';
import { chunks, documentTopics, documents, flashcards, subjects, topics } from '@studyhub/db';
import { createManifest, scaffoldSubject } from '@studyhub/core';
import { FakeProvider, type FlashcardsPromptInput } from '@studyhub/ai';
import {
  processGenerateFlashcards,
  resolveFlashcardTopicId,
} from '../src/processors/generation/generateFlashcards.js';

// The real embedder is an ONNX model: far too heavy here (see generateFlashcards.test.ts).
const distinctEmbed = async (texts: string[]): Promise<number[][]> =>
  texts.map((t, i) => {
    const v = new Array(384).fill(0);
    v[(t.length * 31 + i * 7) % 384] = 1;
    return v;
  });
vi.mock('@studyhub/ai/embeddings', () => ({
  embedTexts: (texts: string[]) => Promise.resolve(texts.map(() => new Array(384).fill(0))),
}));

const SENTENCES = [
  "L'entropia di un sistema isolato non diminuisce mai nella termodinamica.",
  'Boltzmann la collegò al disordine microscopico dei sistemi fisici.',
];

/** FakeProvider that forces every card's `topicName` (the model "answers" this for each card). */
class NamingProvider extends FakeProvider {
  seen: FlashcardsPromptInput[] = [];
  constructor(private readonly name: string | null | undefined) {
    super();
  }
  override async generateFlashcards(input: FlashcardsPromptInput, model: string) {
    this.seen.push(input);
    const result = await super.generateFlashcards(input, model);
    return {
      ...result,
      data: {
        cards: result.data.cards.map((c) => {
          const card = { ...c };
          delete card.topicName;
          return this.name === undefined ? card : { ...card, topicName: this.name };
        }),
      },
    };
  }
}

describe('processGenerateFlashcards — topic assignment', () => {
  let dataRoot: string;
  let db: Awaited<ReturnType<typeof createTestDb>>;
  let subjectId: string;
  let docId: string;
  let termoId: string;
  let otticaId: string;

  const input = (scope: { docIds?: string[]; topicIds?: string[] }) => ({
    subjectId,
    scope,
    count: 'auto' as const,
    types: ['basic' as const],
    difficulty: 2 as const,
    lang: 'it',
    force: false,
  });

  async function generated() {
    return db.select().from(flashcards);
  }

  beforeEach(async () => {
    dataRoot = await mkdtemp(join(tmpdir(), 'studyhub-genflash-topics-'));
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
      text: SENTENCES.join(' '),
      tokens: 50,
    });
    termoId = randomUUID();
    otticaId = randomUUID();
    await db.insert(topics).values([
      { id: termoId, subjectId, name: 'Termodinamica', slug: 'termodinamica', orderIndex: 1 },
      { id: otticaId, subjectId, name: 'Ottica', slug: 'ottica', orderIndex: 0 },
    ]);
  });

  afterEach(async () => {
    await rm(dataRoot, { recursive: true, force: true });
  });

  it('sends the subject topics (ordered) to the model, and none when the subject has none', async () => {
    const provider = new NamingProvider(null);
    await processGenerateFlashcards(
      db,
      dataRoot,
      input({ docIds: [docId] }),
      provider,
      distinctEmbed,
    );
    expect(provider.seen[0]!.topics).toEqual([{ name: 'Ottica' }, { name: 'Termodinamica' }]);

    await db.delete(topics).where(eq(topics.subjectId, subjectId));
    const bare = new NamingProvider(null);
    await processGenerateFlashcards(
      db,
      dataRoot,
      { ...input({ docIds: [docId] }), count: 1 },
      bare,
      distinctEmbed,
    );
    expect(bare.seen[0]!.topics).toBeUndefined();
  });

  it('(a) the model’s topicName wins, matched ignoring case, accents and spaces', async () => {
    // Even against a document topic and a single-topic scope pointing elsewhere.
    await db.insert(documentTopics).values({ documentId: docId, topicId: otticaId });
    await processGenerateFlashcards(
      db,
      dataRoot,
      input({ topicIds: [otticaId] }),
      new NamingProvider('  TERMODINAMICA '),
      distinctEmbed,
    );
    const cards = await generated();
    expect(cards.length).toBeGreaterThan(0);
    expect(cards.every((c) => c.topicId === termoId)).toBe(true);
  });

  it('(a) the FakeProvider tags only the cards that really mention a topic', async () => {
    await processGenerateFlashcards(
      db,
      dataRoot,
      input({ docIds: [docId] }),
      new FakeProvider(),
      distinctEmbed,
    );
    const byBack = new Map((await generated()).map((c) => [c.back, c.topicId]));
    expect(byBack.get(SENTENCES[0]!)).toBe(termoId); // mentions "termodinamica"
    expect(byBack.get(SENTENCES[1]!)).toBeNull(); // mentions no topic, no scope topic, no doc topic
  });

  it('(b) falls to the scope’s single topic when the model names none or an unknown one', async () => {
    // Two topics tagged on the document: the primary (lowest orderIndex) would be Ottica, but the
    // scope asks for Termodinamica specifically.
    await db.insert(documentTopics).values([
      { documentId: docId, topicId: otticaId },
      { documentId: docId, topicId: termoId },
    ]);
    for (const answer of [null, undefined, 'Meccanica quantistica']) {
      await db.delete(flashcards);
      await processGenerateFlashcards(
        db,
        dataRoot,
        input({ topicIds: [termoId] }),
        new NamingProvider(answer),
        distinctEmbed,
      );
      const cards = await generated();
      expect(cards.length).toBeGreaterThan(0);
      expect(cards.every((c) => c.topicId === termoId)).toBe(true);
    }
  });

  it('(b) does not apply with more than one topic in scope', async () => {
    await db.insert(documentTopics).values([
      { documentId: docId, topicId: otticaId },
      { documentId: docId, topicId: termoId },
    ]);
    await processGenerateFlashcards(
      db,
      dataRoot,
      input({ topicIds: [termoId, otticaId] }),
      new NamingProvider(null),
      distinctEmbed,
    );
    // Falls through to (c): the document's primary topic is the lowest orderIndex = Ottica.
    expect((await generated()).every((c) => c.topicId === otticaId)).toBe(true);
  });

  it('(c) falls to the cited document’s primary topic', async () => {
    await db.insert(documentTopics).values([
      { documentId: docId, topicId: termoId },
      { documentId: docId, topicId: otticaId },
    ]);
    await processGenerateFlashcards(
      db,
      dataRoot,
      input({ docIds: [docId] }),
      new NamingProvider('Argomento inesistente'),
      distinctEmbed,
    );
    const cards = await generated();
    expect(cards.length).toBeGreaterThan(0);
    expect(cards.every((c) => c.topicId === otticaId)).toBe(true); // lowest orderIndex
  });

  it('(d) leaves the card without topic when nothing resolves', async () => {
    await processGenerateFlashcards(
      db,
      dataRoot,
      input({ docIds: [docId] }),
      new NamingProvider(null),
      distinctEmbed,
    );
    const cards = await generated();
    expect(cards.length).toBeGreaterThan(0);
    expect(cards.every((c) => c.topicId === null)).toBe(true);
  });

  it('a subject without topics generates exactly as before (null topicId)', async () => {
    await db.delete(topics).where(eq(topics.subjectId, subjectId));
    await processGenerateFlashcards(
      db,
      dataRoot,
      input({ docIds: [docId] }),
      new FakeProvider(),
      distinctEmbed,
    );
    const cards = await generated();
    expect(cards.length).toBeGreaterThan(0);
    expect(cards.every((c) => c.topicId === null)).toBe(true);
  });
});

describe('resolveFlashcardTopicId (pure cascade)', () => {
  const topicIndex = new Map([['termodinamica', { id: 't-termo' }]]);
  const primaryTopicByDoc = new Map([['doc-1', { topicId: 't-doc' }]]);
  const card = (topicName: string | null | undefined, docId = 'doc-1') => ({
    topicName,
    sourceRef: { docId },
  });

  it('applies (a) > (b) > (c) > (d) in order', () => {
    const full = { topicIndex, scopeTopicId: 't-scope', primaryTopicByDoc };
    expect(resolveFlashcardTopicId(card('Termodinamica'), full)).toBe('t-termo');
    expect(resolveFlashcardTopicId(card('Altro'), full)).toBe('t-scope');
    expect(resolveFlashcardTopicId(card(null), { ...full, scopeTopicId: null })).toBe('t-doc');
    expect(resolveFlashcardTopicId(card(undefined, 'doc-2'), { ...full, scopeTopicId: null })).toBe(
      null,
    );
  });
});
