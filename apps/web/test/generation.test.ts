import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { createTestDb } from '@studyhub/db/testDb';
import { artifacts, chunks, documentTopics, documents, flashcards, topics } from '@studyhub/db';
import { createSubject } from '../src/lib/subjects';
import {
  approveDeck,
  ArtifactNotFoundError,
  enqueueFlashcardsGeneration,
  enqueueSchemaGeneration,
  estimateGenerationCost,
  exportDeckCsv,
  FlashcardNotFoundError,
  getArtifact,
  listArtifacts,
  listDeckFlashcards,
  reviewFlashcard,
} from '../src/lib/generation';
import { SubjectNotFoundError } from '../src/lib/errors';

function fakeQueue() {
  return { add: vi.fn().mockResolvedValue({ id: 'job-123' }) };
}

describe('enqueueFlashcardsGeneration', () => {
  it('resolves the subject slug to an id and enqueues with it', async () => {
    const dataRoot = await mkdtemp(join(tmpdir(), 'studyhub-enqueue-'));
    try {
      const db = await createTestDb();
      const subject = await createSubject(db, dataRoot, { name: 'Fisica 1', color: 'blue' });
      const queue = fakeQueue();

      const result = await enqueueFlashcardsGeneration(db, queue, subject.slug, {
        scope: { docIds: [randomUUID()] },
        count: 'auto',
        types: ['basic'],
        difficulty: 2,
        lang: 'it',
        force: false,
      });

      expect(result.jobId).toEqual(expect.any(String));
      expect(queue.add).toHaveBeenCalledWith(
        'generate_flashcards',
        expect.objectContaining({ subjectId: subject.id }),
        { jobId: result.jobId },
      );
    } finally {
      await rm(dataRoot, { recursive: true, force: true });
    }
  });

  it('throws SubjectNotFoundError for an unknown slug without touching the queue', async () => {
    const db = await createTestDb();
    const queue = fakeQueue();
    await expect(
      enqueueFlashcardsGeneration(db, queue, 'nope', {
        scope: { docIds: [randomUUID()] },
        count: 'auto',
        types: ['basic'],
        difficulty: 2,
        lang: 'it',
        force: false,
      }),
    ).rejects.toBeInstanceOf(SubjectNotFoundError);
    expect(queue.add).not.toHaveBeenCalled();
  });
});

describe('enqueueSchemaGeneration', () => {
  it('resolves the subject slug to an id and enqueues with it', async () => {
    const dataRoot = await mkdtemp(join(tmpdir(), 'studyhub-enqueue-'));
    try {
      const db = await createTestDb();
      const subject = await createSubject(db, dataRoot, { name: 'Fisica 1', color: 'blue' });
      const queue = fakeQueue();

      const result = await enqueueSchemaGeneration(db, queue, subject.slug, {
        scope: { docIds: [randomUUID()] },
        depth: 2,
        style: 'gerarchico',
        force: false,
      });

      expect(result.jobId).toEqual(expect.any(String));
      expect(queue.add).toHaveBeenCalledWith(
        'generate_schema',
        expect.objectContaining({ subjectId: subject.id }),
        { jobId: result.jobId },
      );
    } finally {
      await rm(dataRoot, { recursive: true, force: true });
    }
  });

  it('throws SubjectNotFoundError for an unknown slug without touching the queue', async () => {
    const db = await createTestDb();
    const queue = fakeQueue();
    await expect(
      enqueueSchemaGeneration(db, queue, 'nope', {
        scope: { docIds: [randomUUID()] },
        depth: 2,
        style: 'gerarchico',
        force: false,
      }),
    ).rejects.toBeInstanceOf(SubjectNotFoundError);
    expect(queue.add).not.toHaveBeenCalled();
  });
});

describe('estimateGenerationCost', () => {
  let dataRoot: string;
  let db: Awaited<ReturnType<typeof createTestDb>>;
  let subjectSlug: string;
  let subjectId: string;
  let docId: string;
  let topicId: string;

  beforeEach(async () => {
    dataRoot = await mkdtemp(join(tmpdir(), 'studyhub-estimate-'));
    db = await createTestDb();
    const subject = await createSubject(db, dataRoot, { name: 'Fisica 1', color: 'blue' });
    subjectId = subject.id;
    subjectSlug = subject.slug;

    docId = randomUUID();
    await db.insert(documents).values({
      id: docId,
      subjectId,
      type: 'appunti',
      originalName: 'x.pdf',
      storedPath: '/x',
      mime: 'application/pdf',
      bytes: 1,
      sha256: 'a'.repeat(64),
    });
    await db.insert(chunks).values({
      id: randomUUID(),
      documentId: docId,
      pageFrom: 1,
      pageTo: 1,
      ord: 0,
      text: "L'entropia di un sistema isolato non diminuisce mai.".repeat(20),
      tokens: 200,
    });

    topicId = randomUUID();
    await db
      .insert(topics)
      .values({ id: topicId, subjectId, name: 'Termodinamica', slug: 'termodinamica' });
    await db.insert(documentTopics).values({ documentId: docId, topicId });
  });

  afterEach(async () => {
    await rm(dataRoot, { recursive: true, force: true });
  });

  it('estimates a positive cost per kind, proportional to input size', async () => {
    const estimate = await estimateGenerationCost(db, subjectSlug, {
      scope: { docIds: [docId] },
      model: 'claude-sonnet-5-5',
    });

    expect(estimate.inputTokens).toBeGreaterThan(0);
    expect(estimate.perKind.flashcards!.costEur).toBeGreaterThan(0);
    expect(estimate.perKind.schema!.costEur).toBeGreaterThan(0);
    expect(estimate.perKind.summary!.costEur).toBeGreaterThan(0);
  });

  it('estimates a positive cost for simulation and extract_topics too (docs/fasi/F3-ai-core.md "Stato")', async () => {
    const estimate = await estimateGenerationCost(db, subjectSlug, {
      scope: { docIds: [docId] },
      model: 'claude-sonnet-5-5',
    });

    expect(estimate.perKind.simulation!.costEur).toBeGreaterThan(0);
    expect(estimate.perKind.extract_topics!.costEur).toBeGreaterThan(0);
  });

  it('resolves a topicIds-only scope to the tagged document, same as generation itself', async () => {
    const byDoc = await estimateGenerationCost(db, subjectSlug, {
      scope: { docIds: [docId] },
      model: 'claude-sonnet-5-5',
    });
    const byTopic = await estimateGenerationCost(db, subjectSlug, {
      scope: { topicIds: [topicId] },
      model: 'claude-sonnet-5-5',
    });
    expect(byTopic.inputTokens).toBe(byDoc.inputTokens);
  });

  it('is zero for a scope resolving to no chunks (e.g. an unrelated document id)', async () => {
    const estimate = await estimateGenerationCost(db, subjectSlug, {
      scope: { docIds: [randomUUID()] },
      model: 'claude-sonnet-5-5',
    });
    expect(estimate.inputTokens).toBe(0);
    expect(estimate.perKind.flashcards!.costEur).toBe(0);
  });

  it('throws SubjectNotFoundError for an unknown slug', async () => {
    await expect(
      estimateGenerationCost(db, 'nope', {
        scope: { docIds: [docId] },
        model: 'claude-sonnet-5-5',
      }),
    ).rejects.toBeInstanceOf(SubjectNotFoundError);
  });
});

describe('artifacts + review queue', () => {
  let dataRoot: string;
  let db: Awaited<ReturnType<typeof createTestDb>>;
  let subjectId: string;
  let subjectSlug: string;
  let deckId: string;
  let cardId: string;

  beforeEach(async () => {
    dataRoot = await mkdtemp(join(tmpdir(), 'studyhub-review-'));
    db = await createTestDb();
    const subject = await createSubject(db, dataRoot, { name: 'Fisica 1', color: 'blue' });
    subjectId = subject.id;
    subjectSlug = subject.slug;

    const docId = randomUUID();
    await db.insert(documents).values({
      id: docId,
      subjectId,
      type: 'appunti',
      originalName: 'x.pdf',
      storedPath: '/x',
      mime: 'application/pdf',
      bytes: 1,
      sha256: 'a'.repeat(64),
    });
    await db.insert(chunks).values({
      id: randomUUID(),
      documentId: docId,
      pageFrom: 1,
      pageTo: 1,
      ord: 0,
      text: 'Testo.',
      tokens: 5,
    });

    deckId = randomUUID();
    await db.insert(artifacts).values({
      id: deckId,
      subjectId,
      kind: 'flashcard_deck',
      title: 'Deck di prova',
      path: '/irrelevant/deck.json',
      model: 'fake-v1',
      promptVersion: 'flashcards/v1',
    });
    cardId = randomUUID();
    await db.insert(flashcards).values({
      id: cardId,
      deckId,
      type: 'basic',
      front: 'Domanda?',
      back: 'Risposta.',
      sourceRef: { docId, page: 1, quote: 'Risposta.' },
    });
  });

  afterEach(async () => {
    await rm(dataRoot, { recursive: true, force: true });
  });

  it('listArtifacts and getArtifact see the seeded deck', async () => {
    const list = await listArtifacts(db, subjectSlug);
    expect(list.map((a) => a.id)).toEqual([deckId]);
    expect(list[0]?.status).toBe('draft');

    const single = await getArtifact(db, subjectSlug, deckId);
    expect(single.id).toBe(deckId);
  });

  it('listDeckFlashcards returns the seeded card', async () => {
    const cards = await listDeckFlashcards(db, subjectSlug, deckId);
    expect(cards).toHaveLength(1);
    expect(cards[0]?.front).toBe('Domanda?');
  });

  it('exportDeckCsv writes a header + one row per card, importable filename from the deck title', async () => {
    const { filename, csv } = await exportDeckCsv(db, subjectSlug, deckId);
    expect(filename).toBe('deck-di-prova.csv');
    expect(csv).toBe('front,back,type,hint,tags\r\nDomanda?,Risposta.,basic,,\r\n');
  });

  it('exportDeckCsv quotes a field containing a comma', async () => {
    await db
      .update(flashcards)
      .set({ front: 'Domanda, con virgola?' })
      .where(eq(flashcards.id, cardId));
    const { csv } = await exportDeckCsv(db, subjectSlug, deckId);
    expect(csv).toContain('"Domanda, con virgola?"');
  });

  it('exportDeckCsv throws ArtifactNotFoundError for a deck outside the subject', async () => {
    await expect(exportDeckCsv(db, subjectSlug, randomUUID())).rejects.toBeInstanceOf(
      ArtifactNotFoundError,
    );
  });

  it('reviewFlashcard(discard) removes the card', async () => {
    const result = await reviewFlashcard(db, subjectSlug, deckId, cardId, { action: 'discard' });
    expect(result).toBeNull();
    expect(await listDeckFlashcards(db, subjectSlug, deckId)).toEqual([]);
  });

  it('reviewFlashcard(edit) updates front/back', async () => {
    const result = await reviewFlashcard(db, subjectSlug, deckId, cardId, {
      action: 'edit',
      front: 'Domanda modificata?',
    });
    expect(result?.front).toBe('Domanda modificata?');
    expect(result?.back).toBe('Risposta.'); // untouched
  });

  it('reviewFlashcard(approve) keeps the card unchanged', async () => {
    const result = await reviewFlashcard(db, subjectSlug, deckId, cardId, { action: 'approve' });
    expect(result?.front).toBe('Domanda?');
  });

  it('throws FlashcardNotFoundError for an unknown card id', async () => {
    await expect(
      reviewFlashcard(db, subjectSlug, deckId, randomUUID(), { action: 'discard' }),
    ).rejects.toBeInstanceOf(FlashcardNotFoundError);
  });

  it('throws ArtifactNotFoundError for a deck that does not belong to the subject', async () => {
    await expect(getArtifact(db, subjectSlug, randomUUID())).rejects.toBeInstanceOf(
      ArtifactNotFoundError,
    );
  });

  it('approveDeck sets status=approved and approvedAt', async () => {
    const approved = await approveDeck(db, subjectSlug, deckId);
    expect(approved.status).toBe('approved');
    expect(approved.approvedAt).not.toBeNull();

    const [row] = await db.select().from(artifacts).where(eq(artifacts.id, deckId));
    expect(row?.status).toBe('approved');
  });
});
