import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { createTestDb } from '@studyhub/db/testDb';
import { chunks, documents, documentTopics, jobs, sessionMessages, topics } from '@studyhub/db';
import {
  FakeProvider,
  type AiProvider,
  type ChatDelta,
  type SessionChatPromptInput,
} from '@studyhub/ai';
import type { SessionChatEvent } from '@studyhub/contracts';
import { createSubject } from '../src/lib/subjects';
import { endSession, startSession } from '../src/lib/sessions';
import { getSessionChat, readSessionTranscript, startChatTurn } from '../src/lib/sessionChat';
import { ConflictError, NotFoundError } from '../src/lib/examPrep';

// Full-text only: the embedding model is a native, downloaded dependency and would make this slow and flaky.
vi.mock('@studyhub/ai/embeddings', () => ({
  embedText: async () => {
    throw new Error('embeddings disabled in tests');
  },
}));

/** A provider that records what it was asked and answers with a fixed text. */
function scriptedProvider(answer: string) {
  const inputs: SessionChatPromptInput[] = [];
  const provider: AiProvider = Object.assign(new FakeProvider(), {
    async *chatStream(input: SessionChatPromptInput): AsyncIterable<ChatDelta> {
      inputs.push(input);
      yield { type: 'text', text: answer.slice(0, 5) };
      yield { type: 'text', text: answer.slice(5) };
      yield {
        type: 'done',
        usage: { inputTokens: 1_000, outputTokens: 200 },
        model: 'claude-haiku-4-5-20251001',
        promptVersion: 'session_chat/v1',
      };
    },
  });
  return { provider, inputs };
}

async function drain(turn: { run(): AsyncGenerator<SessionChatEvent> }) {
  const events: SessionChatEvent[] = [];
  for await (const event of turn.run()) events.push(event);
  return events;
}

describe('study session chat', () => {
  let dataRoot: string;
  let db: Awaited<ReturnType<typeof createTestDb>>;
  let slug: string;
  let subjectId: string;
  let topicId: string;
  let inDoc: string;
  let outDoc: string;
  let sessionId: string;

  async function addDoc(name: string, pageTexts: string[], tag: boolean) {
    const id = randomUUID();
    await db.insert(documents).values({
      id,
      subjectId,
      type: 'appunti',
      originalName: name,
      storedPath: '/x',
      mime: 'application/pdf',
      bytes: 1,
      sha256: randomUUID().replace(/-/g, '').padEnd(64, '0'),
      status: 'parsed',
      pages: pageTexts.length,
      mdPath: 'content.md',
    });
    await db.insert(chunks).values(
      pageTexts.map((text, i) => ({
        id: randomUUID(),
        documentId: id,
        pageFrom: i + 1,
        pageTo: i + 1,
        ord: i,
        text,
        tokens: 10,
      })),
    );
    if (tag) await db.insert(documentTopics).values({ documentId: id, topicId });
    return id;
  }

  beforeEach(async () => {
    dataRoot = await mkdtemp(join(tmpdir(), 'studyhub-chat-'));
    db = await createTestDb();
    const subject = await createSubject(db, dataRoot, { name: 'Analisi 2', color: 'violet' });
    slug = subject.slug;
    subjectId = subject.id;
    topicId = randomUUID();
    await db
      .insert(topics)
      .values({ id: topicId, subjectId, name: 'Integrali', slug: 'integrali' });

    inDoc = await addDoc(
      'Appunti cap.4.pdf',
      [
        'Il teorema di Fubini permette di scambiare l’ordine di integrazione negli integrali doppi.',
        'Un dominio normale rispetto all’asse x è delimitato da due funzioni continue.',
      ],
      true,
    );
    outDoc = await addDoc(
      'Fisica.pdf',
      ['La termodinamica studia l’entropia, e il teorema di Fubini non c’entra nulla qui.'],
      false,
    );
    sessionId = (await startSession(db, slug, { topicIds: [topicId] })).id;
  });

  afterEach(async () => {
    await rm(dataRoot, { recursive: true, force: true });
  });

  it('saves the question, streams the answer and keeps only valid citations', async () => {
    const { provider } = scriptedProvider('Perché il dominio è normale [2] e vale Fubini [1] [9].');
    const turn = await startChatTurn(
      db,
      slug,
      sessionId,
      { content: 'Cos’è un dominio normale e perché vale Fubini?' },
      provider,
    );
    expect(turn.userMessage).toMatchObject({
      role: 'user',
      content: 'Cos’è un dominio normale e perché vale Fubini?',
    });

    const events = await drain(turn);
    expect(events.filter((e) => e.type === 'delta')).toHaveLength(2);
    const done = events.at(-1)!;
    expect(done.type).toBe('done');
    if (done.type !== 'done') return;

    // `[9]` was never a provided source: dropped from the text, never a citation.
    expect(done.message.content).toBe('Perché il dominio è normale [2] e vale Fubini [1].');
    expect(done.message.citations.map((c) => c.ref)).toEqual([2, 1]);
    expect(done.message.citations.every((c) => c.docId === inDoc)).toBe(true);

    const chat = await getSessionChat(db, slug, sessionId);
    expect(chat.messages.map((m) => m.role)).toEqual(['user', 'assistant']);
    expect(chat.costEur).toBeGreaterThan(0);
  });

  it('never shows the model a chunk of a document outside the session', async () => {
    const { provider, inputs } = scriptedProvider('ok [1]');
    await drain(
      await startChatTurn(db, slug, sessionId, { content: 'teorema di Fubini' }, provider),
    );
    const sourceDocs = new Set(inputs[0]!.sources.map((s) => s.docId));
    expect(sourceDocs).toEqual(new Set([inDoc]));
    expect(inputs[0]!.sources.map((s) => s.ref)).toEqual([1]);
  });

  it('always includes the chunk of a selected passage, and passes the history window', async () => {
    const { provider, inputs } = scriptedProvider('Risposta [1].');
    await drain(
      await startChatTurn(db, slug, sessionId, { content: 'prima domanda su Fubini' }, provider),
    );
    await drain(
      await startChatTurn(
        db,
        slug,
        sessionId,
        {
          content: 'spiegami meglio questo',
          focus: { docId: inDoc, page: 2, text: 'dominio normale rispetto all’asse x' },
        },
        provider,
      ),
    );
    const second = inputs[1]!;
    // "spiegami meglio questo" matches nothing by itself; the page of the selection still comes in.
    expect(second.sources.some((s) => s.docId === inDoc && s.page === 2)).toBe(true);
    expect(second.focus).toMatchObject({ documentName: 'Appunti cap.4.pdf', page: 2 });
    expect(second.history.map((m) => m.role)).toEqual(['user', 'assistant']);
    expect(second.question).toBe('spiegami meglio questo');
  });

  it('refuses a passage from a document that is not in the session', async () => {
    const { provider } = scriptedProvider('x');
    await expect(
      startChatTurn(
        db,
        slug,
        sessionId,
        { content: 'q', focus: { docId: outDoc, page: 1, text: 't' } },
        provider,
      ),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(await db.select().from(sessionMessages)).toHaveLength(0);
  });

  it('the fake provider answers from the material, or says it is not there', async () => {
    const found = await drain(
      await startChatTurn(
        db,
        slug,
        sessionId,
        { content: 'integrazione degli integrali doppi' },
        new FakeProvider(),
      ),
    );
    const foundDone = found.at(-1)!;
    expect(foundDone.type === 'done' && foundDone.message.citations.length).toBeGreaterThan(0);

    const missing = await drain(
      await startChatTurn(
        db,
        slug,
        sessionId,
        { content: 'chitarra elettrica distorsione' },
        new FakeProvider(),
      ),
    );
    const missingDone = missing.at(-1)!;
    expect(missingDone.type).toBe('done');
    if (missingDone.type === 'done') {
      expect(missingDone.message.citations).toEqual([]);
      expect(missingDone.message.content).toContain('non è nel materiale');
    }
  });

  it('reports a provider failure as an event, keeping the question', async () => {
    const failing: AiProvider = Object.assign(new FakeProvider(), {
      // eslint-disable-next-line require-yield
      async *chatStream(): AsyncIterable<ChatDelta> {
        throw new Error('claude non risponde');
      },
    });
    const events = await drain(
      await startChatTurn(db, slug, sessionId, { content: 'ciao' }, failing),
    );
    expect(events.at(-1)).toEqual({ type: 'error', message: 'claude non risponde' });
    const chat = await getSessionChat(db, slug, sessionId);
    expect(chat.messages.map((m) => m.role)).toEqual(['user']);
  });

  it('records the cost of every turn like any other AI job', async () => {
    const { provider } = scriptedProvider('ok [1]');
    await drain(await startChatTurn(db, slug, sessionId, { content: 'Fubini' }, provider));
    const rows = await db.select().from(jobs).where(eq(jobs.type, 'session_chat'));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.subjectId).toBe(subjectId);
    expect(rows[0]!.cost).toMatchObject({ inputTokens: 1_000, outputTokens: 200 });
    expect(rows[0]!.cost!.eur).toBeGreaterThan(0);
  });

  it('writes the transcript on "Termina" and the chat becomes read-only', async () => {
    const { provider } = scriptedProvider('Perché il dominio è normale [1].');
    await drain(
      await startChatTurn(
        db,
        slug,
        sessionId,
        { content: 'Perché il dominio è normale?' },
        provider,
      ),
    );

    const ended = await endSession(db, slug, sessionId, { activeMs: 90_000 }, { dataRoot });
    expect(ended.status).toBe('ended');
    expect(ended.transcriptPath).toMatch(/^sessioni\/\d{4}-\d{2}-\d{2}-integrali-[0-9a-f]{8}\.md$/);

    const onDisk = await readFile(join(dataRoot, 'subjects', slug, ended.transcriptPath!), 'utf-8');
    expect(onDisk).toContain('# Integrali');
    expect(onDisk).toContain('## Tu');
    expect(onDisk).toContain('Perché il dominio è normale [1].');
    expect(onDisk).toContain('[[Appunti cap.4.pdf#p. ');
    expect(await readSessionTranscript(db, dataRoot, slug, sessionId)).toBe(onDisk);

    await expect(
      startChatTurn(db, slug, sessionId, { content: 'ancora' }, scriptedProvider('x').provider),
    ).rejects.toBeInstanceOf(ConflictError);
    // …but the conversation can still be read.
    expect((await getSessionChat(db, slug, sessionId)).messages).toHaveLength(2);
  });

  it('ends fine without a data root (no file) and without any chat', async () => {
    const ended = await endSession(db, slug, sessionId, {});
    expect(ended.transcriptPath).toBeNull();
    expect(await readSessionTranscript(db, dataRoot, slug, sessionId)).toBeNull();
  });
});
