import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { createTestDb } from '@studyhub/db/testDb';
import {
  artifacts,
  chunks,
  documentTopics,
  documents,
  flashcards,
  sessionItems,
  simulationItems,
  simulations,
  topics,
} from '@studyhub/db';
import { createSubject } from '../src/lib/subjects';
import { endSession, startSession } from '../src/lib/sessions';
import { createDrillFromWrongExercises, createKeyPointDeck } from '../src/lib/sessionClosing';
import { ConflictError, startOrResumeAttempt } from '../src/lib/examPrep';

describe('session closing (flashcards from key points, drill from wrong exercises)', () => {
  let dataRoot: string;
  let db: Awaited<ReturnType<typeof createTestDb>>;
  let slug: string;
  let subjectId: string;
  let docId: string;
  let topicId: string;
  let sessionId: string;

  async function addItem(
    kind: 'key_point' | 'exercise',
    orderIndex: number,
    title: string,
    state: 'open' | 'done' | 'correct' | 'wrong' = 'open',
    forSession: string = sessionId,
  ) {
    await db.insert(sessionItems).values({
      id: randomUUID(),
      sessionId: forSession,
      kind,
      orderIndex,
      title,
      body: `Spiegazione di ${title}`,
      difficulty: kind === 'exercise' ? 2 : null,
      citations: [{ docId, page: 1, quote: 'Il teorema di Fubini' }],
      topicId,
      state,
    });
  }

  beforeEach(async () => {
    dataRoot = await mkdtemp(join(tmpdir(), 'studyhub-closing-'));
    db = await createTestDb();
    const subject = await createSubject(db, dataRoot, { name: 'Analisi 2', color: 'violet' });
    slug = subject.slug;
    subjectId = subject.id;

    topicId = randomUUID();
    await db
      .insert(topics)
      .values({ id: topicId, subjectId, name: 'Integrali', slug: 'integrali' });
    docId = randomUUID();
    await db.insert(documents).values({
      id: docId,
      subjectId,
      type: 'appunti',
      originalName: 'Appunti cap.4.pdf',
      storedPath: '/x',
      mime: 'application/pdf',
      bytes: 1,
      sha256: 'c'.repeat(64),
      status: 'parsed',
      pages: 1,
      mdPath: 'content.md',
    });
    await db.insert(chunks).values({
      id: randomUUID(),
      documentId: docId,
      pageFrom: 1,
      pageTo: 1,
      ord: 0,
      text: 'Il teorema di Fubini permette di scambiare l’ordine di integrazione.',
      tokens: 12,
    });
    await db.insert(documentTopics).values({ documentId: docId, topicId });
    sessionId = (await startSession(db, slug, { topicIds: [topicId] })).id;
  });

  afterEach(async () => {
    await rm(dataRoot, { recursive: true, force: true });
  });

  describe('createKeyPointDeck', () => {
    it('refuses while the session is still running', async () => {
      await addItem('key_point', 0, 'Fubini');
      await expect(createKeyPointDeck(db, dataRoot, slug, sessionId)).rejects.toThrow(
        /Termina prima/,
      );
    });

    it('turns every key point into a cited draft card and writes the deck file', async () => {
      await addItem('key_point', 0, 'Fubini');
      await addItem('key_point', 1, 'Dominio normale');
      await addItem('exercise', 0, 'Calcola');
      await endSession(db, slug, sessionId);

      const deck = await createKeyPointDeck(db, dataRoot, slug, sessionId);
      expect(deck).toMatchObject({ cardCount: 2, created: true });

      const [artifact] = await db.select().from(artifacts).where(eq(artifacts.id, deck.deckId));
      expect(artifact).toMatchObject({ kind: 'flashcard_deck', status: 'draft', costEur: 0 });
      const cards = await db.select().from(flashcards).where(eq(flashcards.deckId, deck.deckId));
      expect(cards.map((c) => c.front).sort()).toEqual(['Dominio normale', 'Fubini']);
      expect(cards[0]!.sourceRef).toMatchObject({ docId, page: 1 });
      expect(cards[0]!.topicId).toBe(topicId);
      const file = JSON.parse(await readFile(artifact!.path, 'utf-8'));
      expect(file.cards).toHaveLength(2);
    });

    it('returns the same deck when asked twice, and refuses a session without key points', async () => {
      await addItem('key_point', 0, 'Fubini');
      await endSession(db, slug, sessionId);
      const first = await createKeyPointDeck(db, dataRoot, slug, sessionId);
      const again = await createKeyPointDeck(db, dataRoot, slug, sessionId);
      expect(again).toMatchObject({ deckId: first.deckId, created: false, cardCount: 1 });
      expect(await db.select().from(flashcards)).toHaveLength(1);

      const other = (await startSession(db, slug, { topicIds: [topicId] })).id;
      await endSession(db, slug, other);
      await expect(createKeyPointDeck(db, dataRoot, slug, other)).rejects.toThrow(ConflictError);
    });
  });

  describe('createDrillFromWrongExercises', () => {
    it('builds a drill from the wrong exercises only, that can be attempted right away', async () => {
      await addItem('exercise', 0, 'Giusto', 'correct');
      await addItem('exercise', 1, 'Sbagliato uno', 'wrong');
      await addItem('exercise', 2, 'Aperto', 'open');
      await addItem('exercise', 3, 'Sbagliato due', 'wrong');
      await endSession(db, slug, sessionId);

      const drill = await createDrillFromWrongExercises(db, dataRoot, slug, sessionId);
      expect(drill).toMatchObject({ itemCount: 2, created: true });

      const [sim] = await db
        .select()
        .from(simulations)
        .where(eq(simulations.artifactId, drill.simulationId));
      expect(sim).toMatchObject({
        mode: 'drill_argomento',
        topicId,
        totalPoints: 2,
        timeBudgetMin: 10,
      });
      const items = await db
        .select()
        .from(simulationItems)
        .where(eq(simulationItems.simulationId, drill.simulationId))
        .orderBy(simulationItems.ord);
      expect(items.map((i) => i.prompt)).toEqual(['Sbagliato uno', 'Sbagliato due']);
      expect(items[0]).toMatchObject({
        points: 1,
        solution: 'Spiegazione di Sbagliato uno',
        topicId,
      });
      expect(items[0]!.sourceRef).toMatchObject({ docId, page: 1 });

      const queue = { add: vi.fn() };
      const attempt = await startOrResumeAttempt(db, queue as never, slug, drill.simulationId);
      expect(attempt.items).toHaveLength(2);
    });

    it('is idempotent, and needs at least one wrong exercise', async () => {
      await endSession(db, slug, sessionId);
      await expect(createDrillFromWrongExercises(db, dataRoot, slug, sessionId)).rejects.toThrow(
        /Nessun esercizio sbagliato/,
      );

      const other = (await startSession(db, slug, { topicIds: [topicId] })).id;
      await addItem('exercise', 0, 'Da rifare', 'wrong', other);
      await endSession(db, slug, other);
      const first = await createDrillFromWrongExercises(db, dataRoot, slug, other);
      const again = await createDrillFromWrongExercises(db, dataRoot, slug, other);
      expect(again).toMatchObject({
        simulationId: first.simulationId,
        created: false,
        itemCount: 1,
      });
      expect(await db.select().from(simulations)).toHaveLength(1);
    });
  });
});
