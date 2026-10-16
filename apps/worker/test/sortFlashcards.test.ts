import { beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { createTestDb } from '@studyhub/db/testDb';
import {
  artifacts,
  documentTopics,
  documents,
  flashcards,
  jobs,
  settings,
  subjects,
  topics,
} from '@studyhub/db';
import {
  FakeProvider,
  type GeneratedWithMeta,
  type SortFlashcardsAiOutput,
  type SortFlashcardsPromptInput,
} from '@studyhub/ai';
import {
  processSortFlashcards,
  SORT_BATCH_SIZE,
} from '../src/processors/generation/sortFlashcards.js';
import { runJob } from '../src/jobRunner.js';

/** FakeProvider that records every sort call, with an optional answer override. */
class SpyProvider extends FakeProvider {
  calls: SortFlashcardsPromptInput[] = [];
  constructor(
    private readonly override?: (
      input: SortFlashcardsPromptInput,
    ) => GeneratedWithMeta<SortFlashcardsAiOutput>,
  ) {
    super();
  }
  override async sortFlashcards(input: SortFlashcardsPromptInput, model: string) {
    this.calls.push(input);
    return this.override ? this.override(input) : super.sortFlashcards(input, model);
  }
}

describe('processSortFlashcards', () => {
  let db: Awaited<ReturnType<typeof createTestDb>>;
  let subjectId: string;
  let deckId: string;
  let termoId: string;
  let otticaId: string;
  let docOttica: string;
  let docUntagged: string;

  async function addSubject(slug: string): Promise<string> {
    const id = randomUUID();
    await db.insert(subjects).values({
      id,
      slug,
      name: slug,
      color: 'blue',
      folderPath: `/data/subjects/${slug}`,
    });
    return id;
  }

  async function addDeck(forSubject: string): Promise<string> {
    const id = randomUUID();
    await db.insert(artifacts).values({
      id,
      subjectId: forSubject,
      kind: 'flashcard_deck',
      title: 'Deck',
      path: '/x.json',
      model: 'fake-v1',
      promptVersion: 'flashcards/v2',
    });
    return id;
  }

  async function addCard(
    front: string,
    opts: { back?: string; topicId?: string | null; docId?: string; deck?: string } = {},
  ): Promise<string> {
    const id = randomUUID();
    await db.insert(flashcards).values({
      id,
      deckId: opts.deck ?? deckId,
      topicId: opts.topicId ?? null,
      type: 'basic',
      front,
      back: opts.back ?? 'Risposta.',
      sourceRef: opts.docId ? { docId: opts.docId, page: 1, quote: 'Risposta.' } : null,
    });
    return id;
  }

  async function spendToday(eur: number, cap: number): Promise<void> {
    await db.insert(settings).values({ key: 'budget.dailyCapEur', value: cap });
    await db.insert(jobs).values({
      id: randomUUID(),
      type: 'generate_flashcards',
      input: {},
      status: 'succeeded',
      cost: { inputTokens: 1, outputTokens: 1, eur },
    });
  }

  async function topicOf(cardId: string): Promise<string | null> {
    const [row] = await db.select().from(flashcards).where(eq(flashcards.id, cardId));
    return row!.topicId;
  }

  async function addDocument(forSubject: string): Promise<string> {
    const id = randomUUID();
    await db.insert(documents).values({
      id,
      subjectId: forSubject,
      type: 'appunti',
      originalName: 'x.pdf',
      storedPath: '/irrelevant',
      mime: 'application/pdf',
      bytes: 10,
      sha256: 'a'.repeat(64),
      status: 'parsed',
    });
    return id;
  }

  beforeEach(async () => {
    db = await createTestDb();
    subjectId = await addSubject('fisica-1');
    deckId = await addDeck(subjectId);
    termoId = randomUUID();
    otticaId = randomUUID();
    await db.insert(topics).values([
      { id: termoId, subjectId, name: 'Termodinamica', slug: 'termodinamica', orderIndex: 0 },
      { id: otticaId, subjectId, name: 'Ottica geometrica', slug: 'ottica', orderIndex: 1 },
    ]);
    docOttica = await addDocument(subjectId);
    docUntagged = await addDocument(subjectId);
    await db.insert(documentTopics).values({ documentId: docOttica, topicId: otticaId });
  });

  it('sorts by document first (no AI), then by AI, leaves the unplaceable and never touches sorted cards', async () => {
    const byDoc = await addCard('Domanda neutra?', { docId: docOttica });
    const byAi = await addCard('Cosa dice il secondo principio della termodinamica?');
    const unplaceable = await addCard('Capitale della Francia?');
    const alreadySorted = await addCard('Legge di riflessione ottica geometrica', {
      topicId: termoId,
    });
    const provider = new SpyProvider();

    const result = await processSortFlashcards(db, { subjectId }, provider);

    expect(result).toMatchObject({
      assigned: 2,
      assignedByDocument: 1,
      assignedByAi: 1,
      unassigned: 1,
      noTopics: false,
      costEur: 0,
    });
    expect(await topicOf(byDoc)).toBe(otticaId);
    expect(await topicOf(byAi)).toBe(termoId);
    expect(await topicOf(unplaceable)).toBeNull();
    expect(await topicOf(alreadySorted)).toBe(termoId); // untouched even if the text says ottica

    // The model only saw the two cards that still needed it.
    expect(provider.calls).toHaveLength(1);
    expect(provider.calls[0]!.cards.map((c) => c.id).sort()).toEqual([byAi, unplaceable].sort());
    expect(provider.calls[0]!.topics.map((t) => t.name)).toEqual([
      'Termodinamica',
      'Ottica geometrica',
    ]);
  });

  it('a card citing an untagged document goes to the AI, not to a guess', async () => {
    const card = await addCard('Domanda?', { docId: docUntagged });
    const provider = new SpyProvider();
    const result = await processSortFlashcards(db, { subjectId }, provider);
    expect(provider.calls).toHaveLength(1);
    expect(result.unassigned).toBe(1);
    expect(await topicOf(card)).toBeNull();
  });

  it('makes no AI call when every card resolves through its document', async () => {
    await addCard('A?', { docId: docOttica });
    await addCard('B?', { docId: docOttica });
    const provider = new SpyProvider();
    const result = await processSortFlashcards(db, { subjectId }, provider);
    expect(provider.calls).toHaveLength(0);
    expect(result).toMatchObject({ assigned: 2, assignedByDocument: 2, assignedByAi: 0 });
  });

  it('a subject without topics reports noTopics and never calls the AI', async () => {
    const bare = await addSubject('chimica-1');
    const bareDeck = await addDeck(bare);
    const card = await addCard('Domanda?', { deck: bareDeck });
    const provider = new SpyProvider();

    const result = await processSortFlashcards(db, { subjectId: bare }, provider);

    expect(result).toMatchObject({ noTopics: true, assigned: 0, unassigned: 1, costEur: 0 });
    expect(provider.calls).toHaveLength(0);
    expect(await topicOf(card)).toBeNull();
  });

  it('nothing to sort is a clean no-op', async () => {
    await addCard('Già ordinata', { topicId: termoId });
    const provider = new SpyProvider();
    const result = await processSortFlashcards(db, { subjectId }, provider);
    expect(result).toMatchObject({ assigned: 0, unassigned: 0, noTopics: false });
    expect(provider.calls).toHaveLength(0);
  });

  it('cardIds restricts the job, and still skips cards that already have a topic', async () => {
    const wanted = await addCard('Domanda sulla termodinamica?');
    const notWanted = await addCard('Altra domanda sulla termodinamica?');
    const sorted = await addCard('Ancora termodinamica', { topicId: otticaId });
    const provider = new SpyProvider();

    await processSortFlashcards(db, { subjectId, cardIds: [wanted, sorted] }, provider);

    expect(await topicOf(wanted)).toBe(termoId);
    expect(await topicOf(notWanted)).toBeNull();
    expect(await topicOf(sorted)).toBe(otticaId);
    expect(provider.calls[0]!.cards.map((c) => c.id)).toEqual([wanted]);
  });

  it('ignores cards of other subjects, even if listed in cardIds', async () => {
    const other = await addSubject('chimica-1');
    const foreign = await addCard('Domanda sulla termodinamica?', { deck: await addDeck(other) });
    const provider = new SpyProvider();

    const result = await processSortFlashcards(db, { subjectId, cardIds: [foreign] }, provider);

    expect(result.assigned).toBe(0);
    expect(provider.calls).toHaveLength(0);
    expect(await topicOf(foreign)).toBeNull();
  });

  it('processes in batches of SORT_BATCH_SIZE', async () => {
    const total = SORT_BATCH_SIZE * 2 + 5;
    const ids: string[] = [];
    for (let i = 0; i < total; i += 1) ids.push(await addCard(`Domanda ${i} sulla termodinamica`));
    const provider = new SpyProvider();

    const result = await processSortFlashcards(db, { subjectId }, provider);

    expect(provider.calls.map((c) => c.cards.length)).toEqual([
      SORT_BATCH_SIZE,
      SORT_BATCH_SIZE,
      5,
    ]);
    expect(result).toMatchObject({ assigned: total, assignedByAi: total, unassigned: 0 });
    expect(await topicOf(ids[total - 1]!)).toBe(termoId);
  });

  it('matches names ignoring case/accents and drops hallucinated names and unknown cardIds', async () => {
    const good = await addCard('Domanda 1?');
    const hallucinated = await addCard('Domanda 2?');
    const unanswered = await addCard('Domanda 3?');
    const provider = new SpyProvider((input) => ({
      data: {
        assignments: [
          { cardId: good, topicName: '  OTTICA   geometrica ' },
          { cardId: hallucinated, topicName: 'Meccanica quantistica' },
          { cardId: randomUUID(), topicName: 'Termodinamica' }, // not a card we sent
          { cardId: good, topicName: 'Termodinamica' }, // second answer for the same card: ignored
        ],
      },
      usage: { inputTokens: input.cards.length, outputTokens: 1 },
      model: 'fake-v1',
      promptVersion: 'sort_flashcards/v1',
    }));

    const result = await processSortFlashcards(db, { subjectId }, provider);

    expect(await topicOf(good)).toBe(otticaId);
    expect(await topicOf(hallucinated)).toBeNull();
    expect(await topicOf(unanswered)).toBeNull();
    expect(result).toMatchObject({ assigned: 1, assignedByAi: 1, unassigned: 2 });
  });

  it('does not overwrite a topic the student set while the AI was working', async () => {
    const card = await addCard('Domanda sulla termodinamica?');
    const racing = new (class extends SpyProvider {
      override async sortFlashcards(input: SortFlashcardsPromptInput, model: string) {
        // The student files the card by hand while the model is still answering.
        await db.update(flashcards).set({ topicId: otticaId }).where(eq(flashcards.id, card));
        return super.sortFlashcards(input, model);
      }
    })();

    const result = await processSortFlashcards(db, { subjectId }, racing);

    expect(await topicOf(card)).toBe(otticaId);
    expect(result.assigned).toBe(0); // the guarded UPDATE matched nothing: not counted as the job's work
  });

  it('stops at the daily budget after applying the batch already paid for, with partial output and its cost', async () => {
    const total = SORT_BATCH_SIZE + 3;
    const ids: string[] = [];
    for (let i = 0; i < total; i += 1) ids.push(await addCard(`Domanda ${i} sulla termodinamica`));
    await spendToday(0.5, 1);
    const expensive = new SpyProvider((input) => ({
      data: { assignments: input.cards.map((c) => ({ cardId: c.id, topicName: 'Termodinamica' })) },
      usage: { inputTokens: 1_000_000, outputTokens: 1_000_000 },
      model: 'claude-haiku-4-5-20251001',
      promptVersion: 'sort_flashcards/v1',
    }));

    const result = await processSortFlashcards(db, { subjectId }, expensive);

    expect(expensive.calls).toHaveLength(1); // the second batch is never paid for
    expect(result).toMatchObject({
      assigned: SORT_BATCH_SIZE,
      assignedByAi: SORT_BATCH_SIZE,
      unassigned: 3,
      stoppedByBudget: true,
    });
    expect(result.costEur).toBeGreaterThan(0);
    expect(result.usage.inputTokens).toBe(1_000_000);
    const sorted = await Promise.all(ids.map((id) => topicOf(id)));
    expect(sorted.filter((t) => t === termoId)).toHaveLength(SORT_BATCH_SIZE);
  });

  it.each([
    ['over the cap', 0.5],
    ['exactly at the cap', 1],
  ])('makes no AI call when the day’s spend is already %s', async (_label, cap) => {
    const byDoc = await addCard('A?', { docId: docOttica });
    const needsAi = await addCard('Domanda sulla termodinamica?');
    await spendToday(1, cap);
    const provider = new SpyProvider();

    const result = await processSortFlashcards(db, { subjectId }, provider);

    expect(provider.calls).toHaveLength(0);
    expect(result).toMatchObject({
      assignedByDocument: 1,
      assignedByAi: 0,
      stoppedByBudget: true,
      costEur: 0,
    });
    expect(await topicOf(byDoc)).toBe(otticaId); // the free fallback is not blocked by the budget
    expect(await topicOf(needsAi)).toBeNull();
  });

  it('the budget does not flag a job whose only batch ran', async () => {
    await addCard('Domanda sulla termodinamica?');
    await spendToday(0.5, 1);
    const result = await processSortFlashcards(
      db,
      { subjectId },
      new SpyProvider((input) => ({
        data: {
          assignments: input.cards.map((c) => ({ cardId: c.id, topicName: 'Termodinamica' })),
        },
        usage: { inputTokens: 1_000_000, outputTokens: 0 },
        model: 'claude-haiku-4-5-20251001',
        promptVersion: 'sort_flashcards/v1',
      })),
    );
    expect(result).toMatchObject({ assigned: 1, stoppedByBudget: false });
  });

  it('recomputes mastery of the topics that gained cards (and only those)', async () => {
    const reviewed = randomUUID();
    await db.insert(flashcards).values({
      id: reviewed,
      deckId,
      type: 'basic',
      front: 'Cosa dice la termodinamica?',
      back: 'Risposta.',
      state: 'review',
      stability: 10,
      difficulty: 5,
      reps: 3,
      lastReviewAt: new Date(),
      dueAt: new Date(Date.now() + 5 * 86_400_000),
    });
    const [before] = await db.select().from(topics).where(eq(topics.id, termoId));
    expect(before!.mastery).toBeNull();

    await processSortFlashcards(db, { subjectId }, new SpyProvider());

    expect(await topicOf(reviewed)).toBe(termoId);
    const [termo] = await db.select().from(topics).where(eq(topics.id, termoId));
    const [ottica] = await db.select().from(topics).where(eq(topics.id, otticaId));
    expect(termo!.mastery).toBeGreaterThan(0);
    expect(ottica!.mastery).toBeNull();
  });

  it('runs through runJob: dispatches sort_flashcards and records output and a zero cost with the fake provider', async () => {
    const card = await addCard('Cosa dice la termodinamica?');
    const jobId = randomUUID();

    const output = (await runJob(db, '/unused', {
      id: jobId,
      name: 'sort_flashcards',
      data: { subjectId },
    })) as { assigned: number };

    expect(output.assigned).toBe(1);
    expect(await topicOf(card)).toBe(termoId);
    const [job] = await db.select().from(jobs).where(eq(jobs.id, jobId));
    expect(job?.status).toBe('succeeded');
    expect(job?.subjectId).toBe(subjectId);
    expect(job?.output).toMatchObject({ assigned: 1, assignedByAi: 1, noTopics: false });
    expect(job?.cost?.eur).toBe(0);
  });
});
