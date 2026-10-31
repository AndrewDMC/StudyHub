import { describe, expect, it, beforeEach, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { and, asc, eq } from 'drizzle-orm';
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
import { processGenerateSprintExercises } from '../src/processors/generation/generateSprintExercises.js';
import { processGenerateLessonBlock } from '../src/processors/generation/generateLessonBlock.js';
import { runJob } from '../src/jobRunner.js';

const PAGE_1 =
  "L'entropia di un sistema isolato non diminuisce mai nel tempo. Il secondo principio della termodinamica lo formalizza.";
const PAGE_2 =
  'Un integrale doppio su un dominio normale si calcola per iterazione secondo il teorema di Fubini. Il dominio deve essere misurabile.';

describe('sprint lesson jobs', () => {
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
      method: 'sprint',
      phase: 'exercises',
      topicIds: [topicId],
      documentIds: [docId],
    });
  });

  const input = (extra: Record<string, unknown> = {}) => ({
    subjectId,
    sessionId,
    force: false,
    ...extra,
  });

  const items = (kind: 'exercise' | 'retry_exercise') =>
    db
      .select()
      .from(sessionItems)
      .where(and(eq(sessionItems.sessionId, sessionId), eq(sessionItems.kind, kind)))
      .orderBy(asc(sessionItems.orderIndex));

  describe('generate_sprint_exercises', () => {
    it('saves 3 exercises with steps, concepts and one retry each, citations verbatim', async () => {
      const result = await processGenerateSprintExercises(db, input(), new FakeProvider());
      expect(result).toMatchObject({ skipped: false, exerciseCount: 3 });

      const exercises = await items('exercise');
      const retries = await items('retry_exercise');
      expect(exercises).toHaveLength(3);
      expect(retries).toHaveLength(3);
      for (const [i, e] of exercises.entries()) {
        expect(e.state).toBe('open');
        expect(e.solutionSteps.length).toBeGreaterThanOrEqual(2);
        expect(e.body).toContain('1. ');
        expect(e.concepts.length).toBeGreaterThanOrEqual(1);
        expect(e.linkedBlockIds).toEqual([]);
        expect(e.citations.length).toBeGreaterThan(0);
        for (const c of e.citations) {
          expect(c.docId).toBe(docId);
          expect([PAGE_1, PAGE_2].some((t) => t.includes(c.quote))).toBe(true);
        }
        // The retry points at its exercise, shares its source and has its own steps.
        const retry = retries[i]!;
        expect(retry.parentItemId).toBe(e.id);
        expect(retry.citations).toEqual(e.citations);
        expect(retry.solutionSteps.length).toBeGreaterThanOrEqual(2);
        expect(retry.concepts).toEqual([]);
      }
    });

    it('saves exercises and retries in one statement, so a retry is never left behind', async () => {
      const insert = vi.spyOn(db, 'insert');
      await processGenerateSprintExercises(db, input(), new FakeProvider());
      const intoItems = insert.mock.calls.filter(([table]) => table === sessionItems);
      expect(intoItems).toHaveLength(1);
      insert.mockRestore();
      expect(await items('exercise')).toHaveLength(3);
      expect(await items('retry_exercise')).toHaveLength(3);
    });

    it('refuses an ended session without spending anything', async () => {
      await db.update(studySessions).set({ status: 'ended' });
      const spy = vi.spyOn(FakeProvider.prototype, 'generateSprintExercises');
      await expect(processGenerateSprintExercises(db, input(), new FakeProvider())).rejects.toThrow(
        /già terminata/,
      );
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    });

    it('is idempotent: existing exercises are left alone and cost nothing', async () => {
      await processGenerateSprintExercises(db, input(), new FakeProvider());
      const spy = vi.spyOn(FakeProvider.prototype, 'generateSprintExercises');
      const again = await processGenerateSprintExercises(db, input(), new FakeProvider());
      expect(again.skipped).toBe(true);
      expect(spy).not.toHaveBeenCalled();
      expect(await items('exercise')).toHaveLength(3);
      spy.mockRestore();
    });

    it('passes the past-exam excerpts to the model as style, never as material to cite', async () => {
      const examId = randomUUID();
      await db.insert(documents).values({
        id: examId,
        subjectId,
        type: 'esami',
        originalName: 'esame-2024.pdf',
        storedPath: '/irrelevant',
        mime: 'application/pdf',
        bytes: 10,
        sha256: 'b'.repeat(64),
        status: 'parsed',
      });
      await db.insert(chunks).values({
        id: randomUUID(),
        documentId: examId,
        pageFrom: 1,
        pageTo: 1,
        ord: 0,
        text: 'Esercizio 1. Calcolare il flusso del campo attraverso la superficie.',
        tokens: 20,
      });
      const spy = vi.spyOn(FakeProvider.prototype, 'generateSprintExercises');
      await processGenerateSprintExercises(db, input(), new FakeProvider());
      const given = spy.mock.calls[0]![0];
      expect(given.examExcerpts).toEqual([
        { name: 'esame-2024.pdf', text: expect.stringContaining('Calcolare il flusso') },
      ]);
      expect(given.chunks.every((c) => c.docId === docId)).toBe(true);
      spy.mockRestore();
    });

    it('discards an exercise whose citations are not verbatim, and fails if none is left', async () => {
      class Forged extends FakeProvider {
        override async generateSprintExercises(
          ...args: Parameters<FakeProvider['generateSprintExercises']>
        ) {
          const out = await super.generateSprintExercises(...args);
          out.data.exercises[0]!.citations = [
            { chunkId: args[0].chunks[0]!.id, quote: 'inventata' },
          ];
          return out;
        }
      }
      const result = await processGenerateSprintExercises(db, input(), new Forged());
      expect(result).toMatchObject({ exerciseCount: 2, discardedCount: 1 });
      // No orphan retries: one per kept exercise.
      expect(await items('retry_exercise')).toHaveLength(2);

      await db.delete(sessionItems);
      class AllForged extends FakeProvider {
        override async generateSprintExercises(
          ...args: Parameters<FakeProvider['generateSprintExercises']>
        ) {
          const out = await super.generateSprintExercises(...args);
          for (const e of out.data.exercises) e.citations = [{ chunkId: 'nope', quote: 'x' }];
          return out;
        }
      }
      await expect(processGenerateSprintExercises(db, input(), new AllForged())).rejects.toThrow(
        /citazione verificabile/,
      );
      expect(await db.select().from(sessionItems)).toHaveLength(0);
    });

    it('refuses a standard lesson and a session without text', async () => {
      await db.update(studySessions).set({ method: 'standard' });
      await expect(processGenerateSprintExercises(db, input(), new FakeProvider())).rejects.toThrow(
        /sprint/,
      );
      await db.update(studySessions).set({ method: 'sprint' });
      await db.delete(chunks);
      await expect(processGenerateSprintExercises(db, input(), new FakeProvider())).rejects.toThrow(
        /Nessun testo estratto/,
      );
    });

    it('runs through runJob and records the job row', async () => {
      const jobId = randomUUID();
      const output = (await runJob(db, '/irrelevant', {
        id: jobId,
        name: 'generate_sprint_exercises',
        data: input(),
      })) as { exerciseCount: number };
      expect(output.exerciseCount).toBe(3);
      const [row] = await db.select().from(jobs).where(eq(jobs.id, jobId));
      expect(row).toMatchObject({ status: 'succeeded', subjectId });
    });
  });

  describe('generate_lesson_block with a focus', () => {
    const focus = (concept: string, exercise = 'Calcola il lavoro') => ({ concept, exercise });
    const block = (blockIndex: number, concept: string) => ({
      subjectId,
      sessionId,
      blockIndex,
      regenerate: false,
      force: false,
      focus: focus(concept),
    });

    /** Generates the exercises, then marks the first two wrong (with the given concepts) and the third correct. */
    async function markWrong(concepts: string[][]) {
      await processGenerateSprintExercises(db, input(), new FakeProvider());
      const exercises = await items('exercise');
      for (const [i, e] of exercises.entries()) {
        await db
          .update(sessionItems)
          .set({ concepts: concepts[i] ?? e.concepts, state: i === 2 ? 'correct' : 'wrong' })
          .where(eq(sessionItems.id, e.id));
      }
    }

    it('makes a block for the concept: no guide questions, no chain, session count untouched', async () => {
      await markWrong([['Entropia'], ['Fubini']]);
      await db.update(studySessions).set({ blockCount: 2 });
      const result = await processGenerateLessonBlock(
        db,
        block(0, 'Entropia'),
        new FakeProvider(),
        enqueue,
      );
      expect(result.skipped).toBe(false);
      expect(enqueue).not.toHaveBeenCalled();

      const [saved] = await db.select().from(lessonBlocks);
      expect(saved).toMatchObject({ orderIndex: 0, state: 'open', concept: 'entropia' });
      expect(
        await db.select().from(sessionItems).where(eq(sessionItems.kind, 'guide_question')),
      ).toHaveLength(0);
      const [session] = await db.select().from(studySessions);
      expect(session?.blockCount).toBe(2);
    });

    it('links the block to the wrong exercises that list its concept, and only those', async () => {
      await markWrong([['Entropia', 'Fubini'], ['Fubini'], ['Entropia']]);
      await db.update(studySessions).set({ blockCount: 2 });
      await processGenerateLessonBlock(db, block(0, 'Fubini'), new FakeProvider(), enqueue);
      const [fubini] = await db.select().from(lessonBlocks);
      const [first, second, third] = await items('exercise');
      expect(first?.linkedBlockIds).toEqual([fubini!.id]);
      expect(second?.linkedBlockIds).toEqual([fubini!.id]);
      // The third is correct: nothing to review.
      expect(third?.linkedBlockIds).toEqual([]);

      await processGenerateLessonBlock(db, block(1, ' Entropia. '), new FakeProvider(), enqueue);
      const blocks = await db.select().from(lessonBlocks).orderBy(asc(lessonBlocks.orderIndex));
      expect(blocks.map((b) => [b.state, b.concept])).toEqual([
        ['open', 'fubini'],
        ['locked', 'entropia'],
      ]);
      const [firstAgain] = await items('exercise');
      expect(firstAgain?.linkedBlockIds).toEqual([fubini!.id, blocks[1]!.id]);
    });

    it('passes the focus to the model and is idempotent', async () => {
      await markWrong([['Entropia']]);
      await db.update(studySessions).set({ blockCount: 1 });
      const spy = vi.spyOn(FakeProvider.prototype, 'generateLessonBlock');
      await processGenerateLessonBlock(db, block(0, 'Entropia'), new FakeProvider(), enqueue);
      expect(spy.mock.calls[0]![0].focus).toEqual(focus('Entropia'));
      spy.mockClear();
      const again = await processGenerateLessonBlock(
        db,
        block(0, 'Entropia'),
        new FakeProvider(),
        enqueue,
      );
      expect(again.skipped).toBe(true);
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    });
  });
});
