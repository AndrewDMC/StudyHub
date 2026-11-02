import { describe, expect, it, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { createTestDb } from '@studyhub/db/testDb';
import {
  chunks,
  documents,
  jobs,
  sessionItems,
  settings,
  studySessions,
  subjects,
} from '@studyhub/db';
import {
  FakeProvider,
  type AiProvider,
  type ExplainFeedbackOutput,
  type GeneratedWithMeta,
} from '@studyhub/ai';
import { ExplanationFeedbackDtoSchema } from '@studyhub/contracts';
import {
  buildExplanationFeedback,
  processExplainFeedback,
} from '../src/processors/generation/explainFeedback.js';

const PAGE_1 =
  "L'entropia di un sistema isolato non diminuisce mai nel tempo. Il secondo principio della termodinamica lo formalizza.";
const PAGE_2 =
  'Un integrale doppio su un dominio normale si calcola per iterazione secondo il teorema di Fubini.';

describe('processExplainFeedback', () => {
  let db: Awaited<ReturnType<typeof createTestDb>>;
  let subjectId: string;
  let docId: string;
  let chunk1: string;
  let sessionId: string;
  let itemId: string;

  beforeEach(async () => {
    db = await createTestDb();
    subjectId = randomUUID();
    await db.insert(subjects).values({
      id: subjectId,
      slug: 'fisica-1',
      name: 'Fisica 1',
      color: 'blue',
      folderPath: '/irrelevant',
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
    chunk1 = randomUUID();
    await db.insert(chunks).values([
      { id: chunk1, documentId: docId, pageFrom: 1, pageTo: 1, ord: 0, text: PAGE_1, tokens: 30 },
      {
        id: randomUUID(),
        documentId: docId,
        pageFrom: 2,
        pageTo: 2,
        ord: 1,
        text: PAGE_2,
        tokens: 30,
      },
    ]);
    sessionId = randomUUID();
    await db.insert(studySessions).values({
      id: sessionId,
      subjectId,
      kind: 'lesson',
      phase: 'rework',
      topicIds: [],
      documentIds: [docId],
    });
    itemId = randomUUID();
    await db.insert(sessionItems).values({
      id: itemId,
      sessionId,
      kind: 'explanation',
      orderIndex: 0,
      title: 'Spiegazione con parole tue',
      body: 'Limitropia di un sistema isolato non diminuisce mai, quindi il tempo ha una direzione.',
    });
  });

  const input = (extra: Record<string, unknown> = {}) => ({
    subjectId,
    sessionId,
    itemId,
    force: false,
    ...extra,
  });

  it('stores giusto / manca / attento on the item, with verified citations', async () => {
    const result = await processExplainFeedback(db, input(), new FakeProvider());
    expect(result.skipped).toBe(false);
    expect(result.costEur).toBeTypeOf('number');

    const [item] = await db.select().from(sessionItems).where(eq(sessionItems.id, itemId));
    const feedback = ExplanationFeedbackDtoSchema.parse(item?.feedback);
    expect(feedback.correct.length).toBeGreaterThan(0);
    expect(feedback.missing.length).toBeGreaterThan(0);
    expect(feedback.wrong.length).toBeGreaterThan(0);
    const cited = [...feedback.correct, ...feedback.missing, ...feedback.wrong].filter(
      (p) => p.citation,
    );
    expect(cited.length).toBeGreaterThan(0);
    for (const p of cited) {
      expect(p.citation).toMatchObject({ docId, documentName: 'lezione.pdf' });
      expect(`${PAGE_1} ${PAGE_2}`).toContain(p.citation!.quote);
    }
  });

  it('is idempotent: an item with feedback is skipped unless force', async () => {
    await processExplainFeedback(db, input(), new FakeProvider());
    const again = await processExplainFeedback(db, input(), new FakeProvider());
    expect(again.skipped).toBe(true);
    expect(again.costEur).toBeUndefined();
    const forced = await processExplainFeedback(db, input({ force: true }), new FakeProvider());
    expect(forced.skipped).toBe(false);
  });

  it('keeps a point without citation when the quote is not verbatim or the chunk is foreign', () => {
    const output: ExplainFeedbackOutput = {
      correct: [{ text: 'Giusto', chunkId: chunk1, quote: 'entropia di un sistema isolato' }],
      missing: [{ text: 'Manca', chunkId: chunk1, quote: 'frase inventata che non esiste' }],
      wrong: [{ text: 'Attento', chunkId: randomUUID(), quote: 'Fubini' }],
    };
    const { feedback, uncitedPoints } = buildExplanationFeedback(
      output,
      [{ id: chunk1, docId, page: 1, text: PAGE_1 }],
      new Map([[docId, 'lezione.pdf']]),
      'fake',
    );
    expect(uncitedPoints).toBe(2);
    expect(feedback.correct[0]?.citation).toMatchObject({ docId, page: 1 });
    expect(feedback.missing).toEqual([{ text: 'Manca', citation: null }]);
    expect(feedback.wrong).toEqual([{ text: 'Attento', citation: null }]);
  });

  it('saves a provider answer whose citations are all invalid, without losing the points', async () => {
    const provider = {
      gradeExplanation: async (): Promise<GeneratedWithMeta<ExplainFeedbackOutput>> => ({
        data: {
          correct: [{ text: 'Giusto', chunkId: chunk1, quote: 'non presente' }],
          missing: [{ text: 'Manca', chunkId: chunk1, quote: 'non presente' }],
          wrong: [],
        },
        model: 'fake',
        promptVersion: 1,
        usage: { inputTokens: 10, outputTokens: 10 },
      }),
    } as unknown as AiProvider;
    const result = await processExplainFeedback(db, input(), provider);
    expect(result.uncitedPoints).toBe(2);
    const [item] = await db.select().from(sessionItems).where(eq(sessionItems.id, itemId));
    const feedback = ExplanationFeedbackDtoSchema.parse(item?.feedback);
    expect(feedback.missing).toEqual([{ text: 'Manca', citation: null }]);
  });

  it('refuses a missing item, an exceeded budget (unless force) and an ended session', async () => {
    await expect(
      processExplainFeedback(db, input({ itemId: randomUUID() }), new FakeProvider()),
    ).rejects.toThrow(/non trovata/);

    await db.insert(settings).values({ key: 'budget.dailyCapEur', value: 0.0000001 });
    await db.insert(jobs).values({
      id: randomUUID(),
      type: 'generate_summary',
      status: 'succeeded',
      cost: { inputTokens: 1, outputTokens: 1, eur: 1 },
    });
    await expect(processExplainFeedback(db, input(), new FakeProvider())).rejects.toThrow(
      /Budget giornaliero/,
    );
    await processExplainFeedback(db, input({ force: true }), new FakeProvider());

    await db.update(studySessions).set({ status: 'ended' }).where(eq(studySessions.id, sessionId));
    await expect(
      processExplainFeedback(db, input({ force: true }), new FakeProvider()),
    ).rejects.toThrow(/terminata/);
  });
});
