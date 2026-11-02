import { describe, expect, it, beforeEach, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { createTestDb } from '@studyhub/db/testDb';
import {
  chunks,
  documentTopics,
  documents,
  jobs,
  lessonBlocks,
  sessionItems,
  studySessions,
  subjects,
  topics,
} from '@studyhub/db';
import { FakeProvider } from '@studyhub/ai';
import { processGenerateLessonBlock } from '../src/processors/generation/generateLessonBlock.js';
import { runJob } from '../src/jobRunner.js';

const PAGE_1 =
  "L'entropia di un sistema isolato non diminuisce mai nel tempo. Il secondo principio della termodinamica lo formalizza.";
const PAGE_2 =
  'Un integrale doppio su un dominio normale si calcola per iterazione secondo il teorema di Fubini. Il dominio deve essere misurabile.';

describe('processGenerateLessonBlock', () => {
  let db: Awaited<ReturnType<typeof createTestDb>>;
  let subjectId: string;
  let docId: string;
  let sessionId: string;
  const enqueue = vi.fn().mockResolvedValue(undefined);

  beforeEach(async () => {
    enqueue.mockClear();
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
    const topicId = randomUUID();
    await db
      .insert(topics)
      .values({ id: topicId, subjectId, name: 'Termodinamica', slug: 'termodinamica' });
    await db.insert(documentTopics).values({ documentId: docId, topicId });
    sessionId = randomUUID();
    await db.insert(studySessions).values({
      id: sessionId,
      subjectId,
      kind: 'lesson',
      phase: 'understand',
      topicIds: [topicId],
      documentIds: [docId],
    });
  });

  const input = (blockIndex = 0, extra: Record<string, unknown> = {}) => ({
    subjectId,
    sessionId,
    blockIndex,
    regenerate: false,
    force: false,
    ...extra,
  });

  it('block 0: saves block_count and guide questions, opens the block and queues block 1', async () => {
    const result = await processGenerateLessonBlock(db, input(), new FakeProvider(), enqueue);
    expect(result.skipped).toBe(false);

    const [session] = await db.select().from(studySessions).where(eq(studySessions.id, sessionId));
    expect(session?.blockCount).toBe(result.blockCount);
    expect(session?.blockCount).toBeGreaterThanOrEqual(2);

    const blocks = await db
      .select()
      .from(lessonBlocks)
      .where(eq(lessonBlocks.sessionId, sessionId));
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.orderIndex).toBe(0);
    expect(blocks[0]?.state).toBe('open');
    expect(blocks[0]?.citations.length).toBeGreaterThan(0);

    const questions = await db
      .select()
      .from(sessionItems)
      .where(and(eq(sessionItems.sessionId, sessionId), eq(sessionItems.kind, 'guide_question')));
    expect(questions.length).toBeGreaterThanOrEqual(3);

    expect(enqueue).toHaveBeenCalledTimes(1);
    const [name, data, jobId] = enqueue.mock.calls[0]!;
    expect(name).toBe('generate_lesson_block');
    expect(data).toMatchObject({ sessionId, blockIndex: 1, regenerate: false });
    const [queued] = await db.select().from(jobs).where(eq(jobs.id, jobId));
    expect(queued?.status).toBe('queued');
  });

  it('block 1 is born locked and nothing else is queued', async () => {
    await processGenerateLessonBlock(db, input(), new FakeProvider(), enqueue);
    enqueue.mockClear();
    await processGenerateLessonBlock(db, input(1), new FakeProvider(), enqueue);
    const blocks = await db
      .select()
      .from(lessonBlocks)
      .where(eq(lessonBlocks.sessionId, sessionId))
      .orderBy(lessonBlocks.orderIndex);
    expect(blocks.map((b) => b.state)).toEqual(['open', 'locked']);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('opens block 1 when block 0 is answered while block 1 is being generated', async () => {
    await processGenerateLessonBlock(db, input(), new FakeProvider(), enqueue);
    class AnsweredMeanwhile extends FakeProvider {
      override async generateLessonBlock(...args: Parameters<FakeProvider['generateLessonBlock']>) {
        const out = await super.generateLessonBlock(...args);
        // The student answers block 0 while the model is still working.
        await db
          .update(lessonBlocks)
          .set({ state: 'done' })
          .where(and(eq(lessonBlocks.sessionId, sessionId), eq(lessonBlocks.orderIndex, 0)));
        return out;
      }
    }
    await processGenerateLessonBlock(db, input(1), new AnsweredMeanwhile(), enqueue);
    const blocks = await db
      .select()
      .from(lessonBlocks)
      .where(eq(lessonBlocks.sessionId, sessionId))
      .orderBy(lessonBlocks.orderIndex);
    expect(blocks.map((b) => b.state)).toEqual(['done', 'open']);
  });

  it('is idempotent: an existing block is not regenerated and costs nothing', async () => {
    await processGenerateLessonBlock(db, input(), new FakeProvider(), enqueue);
    const spy = vi.spyOn(FakeProvider.prototype, 'generateLessonBlock');
    enqueue.mockClear();
    const again = await processGenerateLessonBlock(db, input(), new FakeProvider(), enqueue);
    expect(again.skipped).toBe(true);
    expect(spy).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
    expect(await db.select().from(lessonBlocks)).toHaveLength(1);
    spy.mockRestore();
  });

  it('regenerate replaces the block in place (same id)', async () => {
    const first = await processGenerateLessonBlock(db, input(), new FakeProvider(), enqueue);
    const result = await processGenerateLessonBlock(
      db,
      input(0, { regenerate: true, hint: 'simpler' }),
      new FakeProvider(),
      enqueue,
    );
    expect(result.blockId).toBe(first.blockId);
    const blocks = await db.select().from(lessonBlocks);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.id).toBe(first.blockId);
    expect(blocks[0]?.body).toMatch(/semplice/);
  });

  it('discards citations whose quote is not verbatim in the chunk', async () => {
    class Forged extends FakeProvider {
      override async generateLessonBlock(...args: Parameters<FakeProvider['generateLessonBlock']>) {
        const out = await super.generateLessonBlock(...args);
        out.data.block.citations.push({ chunkId: args[0].chunks[0]!.id, quote: 'frase inventata' });
        out.data.block.citations.push({ chunkId: randomUUID(), quote: 'altro' });
        return out;
      }
    }
    const result = await processGenerateLessonBlock(db, input(), new Forged(), enqueue);
    expect(result.discardedCitations).toBe(2);
    const [block] = await db.select().from(lessonBlocks);
    expect(block?.citations.length).toBeGreaterThan(0);
    for (const c of block!.citations) {
      expect(c.docId).toBe(docId);
      expect([PAGE_1, PAGE_2].some((t) => t.includes(c.quote))).toBe(true);
    }
  });

  it('fails with a clear message when the material has no text', async () => {
    await db.delete(chunks);
    await expect(
      processGenerateLessonBlock(db, input(), new FakeProvider(), enqueue),
    ).rejects.toThrow(/Nessun testo estratto/);
    expect(await db.select().from(lessonBlocks)).toHaveLength(0);
  });

  it('runs through runJob and records the job row', async () => {
    const jobId = randomUUID();
    const output = (await runJob(db, '/irrelevant', {
      id: jobId,
      name: 'generate_lesson_block',
      data: input(1),
    })) as { blockIndex: number };
    expect(output.blockIndex).toBe(1);
    const [row] = await db.select().from(jobs).where(eq(jobs.id, jobId));
    expect(row?.status).toBe('succeeded');
    expect(row?.subjectId).toBe(subjectId);
  });
});
