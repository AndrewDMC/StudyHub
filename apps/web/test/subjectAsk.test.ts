import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createTestDb } from '@studyhub/db/testDb';
import {
  chunks,
  documents,
  documentTopics,
  jobs,
  sessionMessages,
  settings,
  topics,
} from '@studyhub/db';
import {
  FakeProvider,
  type AiProvider,
  type ChatDelta,
  type SubjectAskPromptInput,
} from '@studyhub/ai';
import { AskSubjectRequestSchema, type AskSubjectEvent } from '@studyhub/contracts';
import { createSubject } from '../src/lib/subjects';
import { INSUFFICIENT_SOURCES_ANSWER, askSubject } from '../src/lib/subjectAsk';
import { BudgetExceededError, SubjectNotFoundError } from '../src/lib/errors';
import { InvalidRequestError } from '../src/lib/examPrep';
import { errorResponse } from '../src/lib/http';

// Full-text only: the embedding model is a native, downloaded dependency and would make this slow and flaky.
vi.mock('@studyhub/ai/embeddings', () => ({
  embedText: async () => {
    throw new Error('embeddings disabled in tests');
  },
}));

function scriptedProvider(answer: string) {
  const inputs: SubjectAskPromptInput[] = [];
  const provider: AiProvider = Object.assign(new FakeProvider(), {
    async *askStream(input: SubjectAskPromptInput): AsyncIterable<ChatDelta> {
      inputs.push(input);
      yield { type: 'text', text: answer.slice(0, 5) };
      yield { type: 'text', text: answer.slice(5) };
      yield {
        type: 'done',
        usage: { inputTokens: 1_000, outputTokens: 200 },
        model: 'claude-haiku-4-5-20251001',
        promptVersion: 'subject_ask/v1',
      };
    },
  });
  return { provider, inputs };
}

async function drain(ask: { run(): AsyncGenerator<AskSubjectEvent> }) {
  const events: AskSubjectEvent[] = [];
  for await (const event of ask.run()) events.push(event);
  return events;
}

describe('subject-level ask ("Chiedi")', () => {
  let dataRoot: string;
  let db: Awaited<ReturnType<typeof createTestDb>>;
  let slug: string;
  let subjectId: string;
  let topicId: string;
  let taggedDoc: string;
  let otherDoc: string;

  async function addDoc(forSubject: string, name: string, text: string, tag: boolean) {
    const id = randomUUID();
    await db.insert(documents).values({
      id,
      subjectId: forSubject,
      type: 'appunti',
      originalName: name,
      storedPath: '/x',
      mime: 'application/pdf',
      bytes: 1,
      sha256: randomUUID().replace(/-/g, '').padEnd(64, '0'),
      status: 'parsed',
      pages: 1,
      mdPath: 'content.md',
    });
    await db
      .insert(chunks)
      .values({
        id: randomUUID(),
        documentId: id,
        pageFrom: 1,
        pageTo: 1,
        ord: 0,
        text,
        tokens: 10,
      });
    if (tag) await db.insert(documentTopics).values({ documentId: id, topicId });
    return id;
  }

  const QUESTION = 'Cosa dice il teorema di Fubini?';

  beforeEach(async () => {
    dataRoot = await mkdtemp(join(tmpdir(), 'studyhub-ask-'));
    db = await createTestDb();
    const subject = await createSubject(db, dataRoot, { name: 'Analisi 2', color: 'violet' });
    slug = subject.slug;
    subjectId = subject.id;
    topicId = randomUUID();
    await db
      .insert(topics)
      .values({ id: topicId, subjectId, name: 'Integrali', slug: 'integrali' });
    taggedDoc = await addDoc(
      subjectId,
      'Integrali.pdf',
      'Il teorema di Fubini permette di scambiare l’ordine di integrazione.',
      true,
    );
    otherDoc = await addDoc(
      subjectId,
      'Serie.pdf',
      'Il teorema di Fubini per le serie doppie richiede la convergenza assoluta.',
      false,
    );
  });

  afterEach(async () => {
    await rm(dataRoot, { recursive: true, force: true });
  });

  const sourceDocs = (inputs: SubjectAskPromptInput[]) =>
    new Set(inputs[0]!.sources.map((s) => s.docId));

  it('validates the request body', () => {
    expect(AskSubjectRequestSchema.safeParse({ question: '   ' }).success).toBe(false);
    expect(AskSubjectRequestSchema.safeParse({ question: 'x'.repeat(2001) }).success).toBe(false);
    expect(AskSubjectRequestSchema.parse({ question: '  ciao ' }).question).toBe('ciao');
  });

  it('answers over the whole subject, keeps only valid citations, saves no message, records the cost', async () => {
    const { provider, inputs } = scriptedProvider('Vale lo scambio [1] [9].');
    const events = await drain(await askSubject(db, slug, { question: QUESTION }, provider));

    expect(sourceDocs(inputs)).toEqual(new Set([taggedDoc, otherDoc]));
    expect(inputs[0]).toMatchObject({ subjectName: 'Analisi 2', question: QUESTION });
    expect(events.filter((e) => e.type === 'delta')).toHaveLength(2);
    const done = events.at(-1)!;
    expect(done.type).toBe('done');
    if (done.type !== 'done') return;
    expect(done.answer).toBe('Vale lo scambio [1].');
    expect(done.citations.map((c) => c.ref)).toEqual([1]);
    expect(done.citations[0]).toMatchObject({ page: 1, documentName: expect.any(String) });

    expect(await db.select().from(sessionMessages)).toHaveLength(0);
    const ledger = await db.select().from(jobs);
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({ type: 'subject_ask', subjectId, status: 'succeeded' });
    expect(ledger[0]!.cost!.eur).toBeGreaterThan(0);
  });

  it('limits sources to the topic documents when only topicIds are given', async () => {
    const { provider, inputs } = scriptedProvider('ok [1]');
    await drain(await askSubject(db, slug, { question: QUESTION, topicIds: [topicId] }, provider));
    expect(sourceDocs(inputs)).toEqual(new Set([taggedDoc]));
  });

  it('docIds win over topicIds', async () => {
    const { provider, inputs } = scriptedProvider('ok [1]');
    await drain(
      await askSubject(
        db,
        slug,
        { question: QUESTION, docIds: [otherDoc], topicIds: [topicId] },
        provider,
      ),
    );
    expect(sourceDocs(inputs)).toEqual(new Set([otherDoc]));
  });

  it('refuses ids of another subject with 400 and an unknown subject with 404', async () => {
    const other = await createSubject(db, dataRoot, { name: 'Chimica', color: 'rose' });
    const foreignDoc = await addDoc(other.id, 'Chimica.pdf', 'Fubini non c’entra', false);
    const foreignTopic = randomUUID();
    await db
      .insert(topics)
      .values({ id: foreignTopic, subjectId: other.id, name: 'Acidi', slug: 'acidi' });
    const { provider } = scriptedProvider('ok');

    const docErr = await askSubject(
      db,
      slug,
      { question: QUESTION, docIds: [taggedDoc, foreignDoc] },
      provider,
    ).catch((e) => e);
    expect(docErr).toBeInstanceOf(InvalidRequestError);
    expect(errorResponse(docErr).status).toBe(400);

    await expect(
      askSubject(db, slug, { question: QUESTION, topicIds: [foreignTopic] }, provider),
    ).rejects.toBeInstanceOf(InvalidRequestError);
    await expect(
      askSubject(db, 'non-esiste', { question: QUESTION }, provider),
    ).rejects.toBeInstanceOf(SubjectNotFoundError);
    expect(await db.select().from(jobs)).toHaveLength(0);
  });

  it('returns 429 before calling the model when the daily cap is used up', async () => {
    await db.insert(settings).values({ key: 'budget.dailyCapEur', value: 0 });
    const { provider, inputs } = scriptedProvider('ok');
    const err = await askSubject(db, slug, { question: QUESTION }, provider).catch((e) => e);
    expect(err).toBeInstanceOf(BudgetExceededError);
    const res = errorResponse(err);
    expect(res.status).toBe(429);
    expect((await res.json()).error.code).toBe('budget_exceeded');
    expect(inputs).toHaveLength(0);
  });

  it('turns a provider failure into an error event and records no cost', async () => {
    const failing: AiProvider = Object.assign(new FakeProvider(), {
      // eslint-disable-next-line require-yield
      async *askStream(): AsyncIterable<ChatDelta> {
        throw new Error('boom');
      },
    });
    const events = await drain(await askSubject(db, slug, { question: QUESTION }, failing));
    expect(events).toEqual([{ type: 'error', message: 'boom' }]);
    expect(await db.select().from(jobs)).toHaveLength(0);
  });

  it('records the cost of a call aborted mid-stream (estimated from prompt and partial answer)', async () => {
    const { provider } = scriptedProvider('Risposta lunga che il client interrompe [1].');
    const ask = await askSubject(db, slug, { question: QUESTION }, provider);
    const gen = ask.run();
    const first = await gen.next();
    expect(first.value).toMatchObject({ type: 'delta' });
    await gen.return(undefined);

    const ledger = await db.select().from(jobs);
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({ type: 'subject_ask', status: 'cancelled' });
    expect(ledger[0]!.cost!.eur).toBeGreaterThan(0);
    expect(ledger[0]!.cost!.inputTokens).toBeGreaterThan(0);
  });

  it('does not call the model nor record a cost when the scope has no documents', async () => {
    const emptyTopic = randomUUID();
    await db.insert(topics).values({ id: emptyTopic, subjectId, name: 'Vuoto', slug: 'vuoto' });
    const { provider, inputs } = scriptedProvider('ok');
    const events = await drain(
      await askSubject(db, slug, { question: QUESTION, topicIds: [emptyTopic] }, provider),
    );
    expect(events).toEqual([{ type: 'done', answer: INSUFFICIENT_SOURCES_ANSWER, citations: [] }]);
    expect(inputs).toHaveLength(0);
    expect(await db.select().from(jobs)).toHaveLength(0);
  });

  it('only counts AI job types (chat included) toward the daily cap', async () => {
    await db.insert(settings).values({ key: 'budget.dailyCapEur', value: 1 });
    await db.insert(jobs).values({
      id: randomUUID(),
      type: 'extract_text',
      status: 'succeeded',
      cost: { inputTokens: 0, outputTokens: 0, eur: 50 },
    });
    const { provider } = scriptedProvider('ok [1]');
    await drain(await askSubject(db, slug, { question: QUESTION }, provider));

    await db.insert(jobs).values({
      id: randomUUID(),
      type: 'session_chat',
      status: 'succeeded',
      cost: { inputTokens: 0, outputTokens: 0, eur: 50 },
    });
    await expect(askSubject(db, slug, { question: QUESTION }, provider)).rejects.toBeInstanceOf(
      BudgetExceededError,
    );
  });

  it('rejects unknown models and oversized id lists', () => {
    expect(AskSubjectRequestSchema.safeParse({ question: 'x', model: 'gpt-4' }).success).toBe(
      false,
    );
    expect(
      AskSubjectRequestSchema.safeParse({ question: 'x', model: 'claude-sonnet-5-5' }).success,
    ).toBe(true);
    const many = Array.from({ length: 51 }, () => randomUUID());
    expect(AskSubjectRequestSchema.safeParse({ question: 'x', docIds: many }).success).toBe(false);
    expect(AskSubjectRequestSchema.safeParse({ question: 'x', topicIds: many }).success).toBe(
      false,
    );
  });
});
