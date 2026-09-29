import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { createTestDb } from '@studyhub/db/testDb';
import { artifacts, flashcards, topics } from '@studyhub/db';
import { createSubject } from '../src/lib/subjects';
import {
  bulkFlashcards,
  createDeck,
  createFlashcard,
  deleteFlashcard,
  listTags,
  mergeDecks,
  updateFlashcard,
} from '../src/lib/deckEditor';
import { getReviewQueue, listFlashcards } from '../src/lib/review';
import { ConflictError, NotFoundError } from '../src/lib/examPrep';

type Db = Awaited<ReturnType<typeof createTestDb>>;

describe('deck editor', () => {
  let dataRoot: string;
  let db: Db;
  let subjectId: string;
  let slug: string;

  beforeEach(async () => {
    dataRoot = await mkdtemp(join(tmpdir(), 'studyhub-deck-editor-'));
    db = await createTestDb();
    const subject = await createSubject(db, dataRoot, { name: 'Fisica 1', color: 'blue' });
    subjectId = subject.id;
    slug = subject.slug;
  });

  afterEach(async () => {
    await rm(dataRoot, { recursive: true, force: true });
  });

  async function seedTopic(name = 'Cinematica') {
    const id = randomUUID();
    await db.insert(topics).values({ id, subjectId, name, slug: 'cinematica' });
    return id;
  }

  it('creates a hand-made card in a manual deck, with no source and normalized tags', async () => {
    const deck = await createDeck(db, slug, 'Mazzo manuale');
    expect(deck.status).toBe('approved');

    const card = await createFlashcard(db, slug, {
      deckId: deck.id,
      type: 'basic',
      front: 'Cos’è la velocità?',
      back: 'Spostamento / tempo',
      tags: ['Fisica', 'fisica', ' Cinematica '],
    });
    expect(card.sourceRef).toBeNull();
    expect(card.state).toBe('new');
    expect(card.tags).toEqual(['fisica', 'cinematica']);

    const queue = await getReviewQueue(db, slug);
    expect(queue.map((c) => c.id)).toEqual([card.id]);
  });

  it('refuses a deck or topic from another subject', async () => {
    const other = await createSubject(db, dataRoot, { name: 'Chimica', color: 'rose' });
    const foreignDeck = await createDeck(db, other.slug, 'Altro');
    await expect(
      createFlashcard(db, slug, { deckId: foreignDeck.id, type: 'basic', front: 'a', back: 'b' }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('editing text keeps the FSRS state and clears the stale embedding', async () => {
    const deck = await createDeck(db, slug, 'Manuale');
    const card = await createFlashcard(db, slug, {
      deckId: deck.id,
      type: 'basic',
      front: 'Vecchio',
      back: 'Retro',
    });
    await db
      .update(flashcards)
      .set({ state: 'review', reps: 4, stability: 12, embedding: new Array(384).fill(0.1) })
      .where(eq(flashcards.id, card.id));

    const updated = await updateFlashcard(db, slug, card.id, { front: 'Nuovo' });
    expect(updated.front).toBe('Nuovo');
    expect(updated.state).toBe('review');

    const [row] = await db.select().from(flashcards).where(eq(flashcards.id, card.id));
    expect(row!.reps).toBe(4);
    expect(row!.stability).toBe(12);
    expect(row!.embedding).toBeNull();
  });

  it('flagging a card ("segnala scadente") drops it from the queue but keeps it in the deck', async () => {
    const deck = await createDeck(db, slug, 'Manuale');
    const card = await createFlashcard(db, slug, {
      deckId: deck.id,
      type: 'basic',
      front: 'Brutta',
      back: 'Card',
    });

    const flagged = await updateFlashcard(db, slug, card.id, { flagged: true });
    expect(flagged.flaggedAt).not.toBeNull();
    expect(await getReviewQueue(db, slug)).toHaveLength(0);

    const inDeck = await listFlashcards(db, slug, { flagged: true });
    expect(inDeck.items.map((c) => c.id)).toEqual([card.id]);

    await updateFlashcard(db, slug, card.id, { flagged: false });
    expect(await getReviewQueue(db, slug)).toHaveLength(1);
  });

  it('moves a card between decks and re-tags it to a topic', async () => {
    const a = await createDeck(db, slug, 'A');
    const b = await createDeck(db, slug, 'B');
    const topicId = await seedTopic();
    const card = await createFlashcard(db, slug, {
      deckId: a.id,
      type: 'basic',
      front: 'f',
      back: 'b',
    });

    const moved = await updateFlashcard(db, slug, card.id, { deckId: b.id, topicId });
    expect(moved.deckId).toBe(b.id);
    expect(moved.topicId).toBe(topicId);
  });

  it('deletes a card', async () => {
    const deck = await createDeck(db, slug, 'A');
    const card = await createFlashcard(db, slug, {
      deckId: deck.id,
      type: 'basic',
      front: 'f',
      back: 'b',
    });
    await deleteFlashcard(db, slug, card.id);
    expect((await listFlashcards(db, slug)).items).toHaveLength(0);
    await expect(deleteFlashcard(db, slug, card.id)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('bulk actions: tag, untag, suspend, move, delete — scoped to the subject', async () => {
    const a = await createDeck(db, slug, 'A');
    const b = await createDeck(db, slug, 'B');
    const cards = [];
    for (const n of [1, 2, 3]) {
      cards.push(
        await createFlashcard(db, slug, {
          deckId: a.id,
          type: 'basic',
          front: `f${n}`,
          back: `b${n}`,
        }),
      );
    }
    const ids = cards.map((c) => c.id);

    await bulkFlashcards(db, slug, { ids, action: { type: 'addTag', tag: 'Esame' } });
    await bulkFlashcards(db, slug, { ids, action: { type: 'addTag', tag: 'esame' } }); // no duplicate
    expect(await listTags(db, slug)).toEqual([{ tag: 'esame', count: 3 }]);
    expect((await listFlashcards(db, slug, { tag: 'esame' })).items).toHaveLength(3);

    await bulkFlashcards(db, slug, {
      ids: ids.slice(0, 1),
      action: { type: 'removeTag', tag: 'esame' },
    });
    expect(await listTags(db, slug)).toEqual([{ tag: 'esame', count: 2 }]);

    await bulkFlashcards(db, slug, { ids, action: { type: 'suspend', suspended: true } });
    expect(await getReviewQueue(db, slug)).toHaveLength(0);

    const moved = await bulkFlashcards(db, slug, { ids, action: { type: 'move', deckId: b.id } });
    expect(moved.affected).toBe(3);
    expect((await listFlashcards(db, slug, { deckId: b.id })).items).toHaveLength(3);

    const removed = await bulkFlashcards(db, slug, { ids, action: { type: 'delete' } });
    expect(removed.affected).toBe(3);
    expect((await listFlashcards(db, slug)).items).toHaveLength(0);
  });

  it('bulk ignores cards of another subject', async () => {
    const other = await createSubject(db, dataRoot, { name: 'Chimica', color: 'rose' });
    const foreignDeck = await createDeck(db, other.slug, 'Altro');
    const foreign = await createFlashcard(db, other.slug, {
      deckId: foreignDeck.id,
      type: 'basic',
      front: 'x',
      back: 'y',
    });
    const res = await bulkFlashcards(db, slug, { ids: [foreign.id], action: { type: 'delete' } });
    expect(res.affected).toBe(0);
    expect((await listFlashcards(db, other.slug)).items).toHaveLength(1);
  });

  it('search filter matches front/back and treats % literally', async () => {
    const deck = await createDeck(db, slug, 'A');
    await createFlashcard(db, slug, {
      deckId: deck.id,
      type: 'basic',
      front: 'Sconto 100%',
      back: 'x',
    });
    await createFlashcard(db, slug, { deckId: deck.id, type: 'basic', front: 'Altro', back: 'y' });
    expect((await listFlashcards(db, slug, { q: '100%' })).items).toHaveLength(1);
    expect((await listFlashcards(db, slug, { q: '%' })).items).toHaveLength(1);
    expect((await listFlashcards(db, slug, { q: 'ALTRO' })).items).toHaveLength(1);
  });

  it('merges decks: cards move with their state, the source deck disappears', async () => {
    const a = await createDeck(db, slug, 'A');
    const b = await createDeck(db, slug, 'B');
    const card = await createFlashcard(db, slug, {
      deckId: a.id,
      type: 'basic',
      front: 'f',
      back: 'b',
    });
    await db.update(flashcards).set({ state: 'review', reps: 3 }).where(eq(flashcards.id, card.id));

    const res = await mergeDecks(db, slug, a.id, b.id);
    expect(res.moved).toBe(1);

    const [row] = await db.select().from(flashcards).where(eq(flashcards.id, card.id));
    expect(row!.deckId).toBe(b.id);
    expect(row!.reps).toBe(3);
    expect(await db.select().from(artifacts).where(eq(artifacts.id, a.id))).toHaveLength(0);
  });

  it('refuses to merge a draft deck', async () => {
    const a = await createDeck(db, slug, 'A');
    const b = await createDeck(db, slug, 'B');
    await db.update(artifacts).set({ status: 'draft' }).where(eq(artifacts.id, a.id));
    await expect(mergeDecks(db, slug, a.id, b.id)).rejects.toBeInstanceOf(ConflictError);
  });
});
