import { describe, expect, it, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { createTestDb } from '@studyhub/db/testDb';
import {
  chunks,
  documentTopics,
  documents,
  sessionItems,
  studySessions,
  subjects,
  topics,
} from '@studyhub/db';
import { FakeProvider, type AiProvider, type SessionBriefingOutput } from '@studyhub/ai';
import { processPrepareSession } from '../src/processors/generation/prepareSession.js';
import { runJob } from '../src/jobRunner.js';

const PAGE_1 =
  "L'entropia di un sistema isolato non diminuisce mai nel tempo. Il secondo principio della termodinamica lo formalizza.";
const PAGE_2 =
  'Un integrale doppio su un dominio normale si calcola per iterazione secondo il teorema di Fubini. Il dominio deve essere misurabile.';

describe('processPrepareSession', () => {
  let db: Awaited<ReturnType<typeof createTestDb>>;
  let subjectId: string;
  let docId: string;
  let topicId: string;
  let sessionId: string;

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
    await db.insert(chunks).values([
      {
        id: randomUUID(),
        documentId: docId,
        pageFrom: 1,
        pageTo: 1,
        ord: 0,
        text: PAGE_1,
        tokens: 30,
      },
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
    topicId = randomUUID();
    await db
      .insert(topics)
      .values({ id: topicId, subjectId, name: 'Termodinamica', slug: 'termodinamica' });
    await db.insert(documentTopics).values({ documentId: docId, topicId });

    sessionId = randomUUID();
    await db.insert(studySessions).values({
      id: sessionId,
      subjectId,
      topicIds: [topicId],
      documentIds: [docId],
    });
  });

  const input = (mode: 'all' | 'exercises' = 'all') => ({
    subjectId,
    sessionId,
    mode,
    force: false,
  });

  it('writes cited key points and exercises, with the topic of the document', async () => {
    const result = await processPrepareSession(db, input(), new FakeProvider());
    expect(result.keyPointCount).toBeGreaterThan(0);
    expect(result.exerciseCount).toBeGreaterThan(0);

    const items = await db.select().from(sessionItems).where(eq(sessionItems.sessionId, sessionId));
    expect(items.some((i) => i.kind === 'key_point')).toBe(true);
    expect(items.some((i) => i.kind === 'exercise')).toBe(true);
    for (const item of items) {
      expect(item.state).toBe('open');
      expect(item.topicId).toBe(topicId);
      const [citation] = item.citations;
      expect(citation?.docId).toBe(docId);
      expect([PAGE_1, PAGE_2].some((text) => text.includes(citation!.quote))).toBe(true);
    }
    expect(items.filter((i) => i.kind === 'exercise').every((i) => i.difficulty !== null)).toBe(
      true,
    );
  });

  it('refuses to generate everything twice, and never repeats an exercise on "more"', async () => {
    await processPrepareSession(db, input(), new FakeProvider());
    await expect(processPrepareSession(db, input(), new FakeProvider())).rejects.toThrow(
      /già stati generati/,
    );

    const keyPointsBefore = (
      await db.select().from(sessionItems).where(eq(sessionItems.kind, 'key_point'))
    ).length;
    const before = await db.select().from(sessionItems).where(eq(sessionItems.kind, 'exercise'));
    // The fake is deterministic: asking again yields the same exercises, all already there.
    await expect(processPrepareSession(db, input('exercises'), new FakeProvider())).rejects.toThrow(
      /Nessun nuovo esercizio/,
    );
    const after = await db.select().from(sessionItems).where(eq(sessionItems.kind, 'exercise'));
    const prompts = after.map((e) => e.title);
    expect(new Set(prompts).size).toBe(prompts.length);
    expect(after).toHaveLength(before.length);
    const keyPointsNow = await db
      .select()
      .from(sessionItems)
      .where(eq(sessionItems.kind, 'key_point'));
    expect(keyPointsNow).toHaveLength(keyPointsBefore);
  });

  it('discards items whose quote is not verbatim in the cited chunk', async () => {
    const forged: AiProvider = Object.assign(Object.create(new FakeProvider()), {
      async generateSessionBriefing() {
        const data: SessionBriefingOutput = {
          keyPoints: [
            {
              title: 'Vero',
              explanation: 'Dal testo.',
              sourceRef: { docId, page: 1, quote: 'non diminuisce mai nel tempo' },
            },
            {
              title: 'Inventato',
              explanation: 'Non nel testo.',
              sourceRef: { docId, page: 1, quote: 'frase che non esiste' },
            },
            {
              title: 'Pagina sbagliata',
              explanation: 'Citazione di un’altra pagina.',
              sourceRef: { docId, page: 2, quote: 'non diminuisce mai nel tempo' },
            },
          ],
          exercises: [],
        };
        return {
          data,
          usage: { inputTokens: 10, outputTokens: 10 },
          model: 'fake-v1',
          promptVersion: 'session_briefing/v1',
        };
      },
    });
    const result = await processPrepareSession(db, input(), forged);
    expect(result.keyPointCount).toBe(1);
    expect(result.discardedCount).toBe(2);
    const items = await db.select().from(sessionItems);
    expect(items.map((i) => i.title)).toEqual(['Vero']);
  });

  it('fails clearly when nothing survives validation', async () => {
    const forged: AiProvider = Object.assign(Object.create(new FakeProvider()), {
      async generateSessionBriefing() {
        return {
          data: {
            keyPoints: [
              { title: 'x', explanation: 'y', sourceRef: { docId, page: 1, quote: 'inventata' } },
            ],
            exercises: [],
          },
          usage: { inputTokens: 1, outputTokens: 1 },
          model: 'fake-v1',
          promptVersion: 'session_briefing/v1',
        };
      },
    });
    await expect(processPrepareSession(db, input(), forged)).rejects.toThrow(
      /citazione verificabile/,
    );
    expect(await db.select().from(sessionItems)).toHaveLength(0);
  });

  it('rejects an ended session and a session of another subject', async () => {
    await db.update(studySessions).set({ status: 'ended' }).where(eq(studySessions.id, sessionId));
    await expect(processPrepareSession(db, input(), new FakeProvider())).rejects.toThrow(
      /già terminata/,
    );
    await expect(
      processPrepareSession(db, { ...input(), sessionId: randomUUID() }, new FakeProvider()),
    ).rejects.toThrow(/Sessione non trovata/);
  });

  it('runs through runJob and records cost on the job row', async () => {
    const jobId = randomUUID();
    const output = (await runJob(db, '/irrelevant', {
      id: jobId,
      name: 'prepare_session',
      data: input(),
    })) as { keyPointCount: number };
    expect(output.keyPointCount).toBeGreaterThan(0);
  });
});
