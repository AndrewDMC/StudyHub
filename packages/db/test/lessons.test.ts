import { beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { createTestDb } from '../src/testDb.js';
import { lessonBlocks, sessionItems, studySessions, subjects } from '../src/schema.js';

/** Migration 0027 (docs/10-planner-lezioni.md §4.3): lesson columns and `lesson_blocks`. */
describe('lessons', () => {
  let db: Awaited<ReturnType<typeof createTestDb>>;
  let sessionId: string;

  beforeEach(async () => {
    db = await createTestDb();
    const subjectId = randomUUID();
    await db.insert(subjects).values({
      id: subjectId,
      slug: 'analisi-1',
      name: 'Analisi 1',
      color: 'violet',
      folderPath: '/data/subjects/analisi-1',
    });
    sessionId = randomUUID();
    await db
      .insert(studySessions)
      .values({ id: sessionId, subjectId, topicIds: [], documentIds: [] });
  });

  it('defaults an existing-style session to a standard lesson without phase', async () => {
    const [row] = await db.select().from(studySessions).where(eq(studySessions.id, sessionId));
    expect(row).toMatchObject({ kind: 'lesson', method: 'standard', phase: null, blockIndex: 0 });
  });

  it('rejects an unknown phase', async () => {
    await expect(
      db
        .update(studySessions)
        .set({ phase: 'nope' as never })
        .where(eq(studySessions.id, sessionId)),
    ).rejects.toThrow();
  });

  it('stores lesson blocks, one per index, and deletes them with the session', async () => {
    await db.insert(lessonBlocks).values({
      id: randomUUID(),
      sessionId,
      orderIndex: 0,
      title: 'Integrali impropri',
      body: "Partiamo dall'intuizione: l'area sotto una curva che non finisce.",
      exampleSteps: [
        { text: 'Spezza l’intervallo' },
        { text: 'Passa al limite', formula: '\\lim' },
      ],
    });
    const [block] = await db.select().from(lessonBlocks);
    expect(block).toMatchObject({ state: 'locked', citations: [], formula: null });
    expect(block?.exampleSteps).toHaveLength(2);

    await expect(
      db
        .insert(lessonBlocks)
        .values({ id: randomUUID(), sessionId, orderIndex: 0, title: 'x', body: 'x' }),
    ).rejects.toThrow();

    await db.delete(studySessions).where(eq(studySessions.id, sessionId));
    expect(await db.select().from(lessonBlocks)).toHaveLength(0);
  });

  it('keeps the linked blocks of a sprint exercise', async () => {
    const blockId = randomUUID();
    await db.insert(sessionItems).values({
      id: randomUUID(),
      sessionId,
      kind: 'exercise',
      orderIndex: 0,
      title: 'Calcola',
      body: 'Soluzione',
      linkedBlockIds: [blockId],
    });
    const [item] = await db.select().from(sessionItems);
    expect(item?.linkedBlockIds).toEqual([blockId]);
  });
});

/** Migration 0028: what a sprint lesson stores on its exercises and blocks. */
describe('sprint lessons', () => {
  let db: Awaited<ReturnType<typeof createTestDb>>;
  let sessionId: string;

  beforeEach(async () => {
    db = await createTestDb();
    const subjectId = randomUUID();
    await db.insert(subjects).values({
      id: subjectId,
      slug: 'fisica-1',
      name: 'Fisica 1',
      color: 'violet',
      folderPath: '/data/subjects/fisica-1',
    });
    sessionId = randomUUID();
    await db.insert(studySessions).values({
      id: sessionId,
      subjectId,
      topicIds: [],
      documentIds: [],
      method: 'sprint',
      phase: 'exercises',
    });
  });

  it('keeps concepts, solution steps and the exercise a retry belongs to', async () => {
    const exerciseId = randomUUID();
    await db.insert(sessionItems).values({
      id: exerciseId,
      sessionId,
      kind: 'exercise',
      orderIndex: 0,
      title: 'Calcola il lavoro',
      body: 'Soluzione',
      concepts: ['Lavoro di una forza', 'Energia cinetica'],
      solutionSteps: [{ text: 'Scrivi la definizione', formula: 'W=Fd' }],
      state: 'unknown',
    });
    const retryId = randomUUID();
    await db.insert(sessionItems).values({
      id: retryId,
      sessionId,
      kind: 'retry_exercise',
      orderIndex: 0,
      title: 'Calcola un altro lavoro',
      body: 'Soluzione',
      parentItemId: exerciseId,
    });
    const [exercise] = await db.select().from(sessionItems).where(eq(sessionItems.id, exerciseId));
    expect(exercise).toMatchObject({ solutionRevealed: false, state: 'unknown' });
    expect(exercise?.concepts).toHaveLength(2);
    expect(exercise?.solutionSteps).toEqual([{ text: 'Scrivi la definizione', formula: 'W=Fd' }]);
    const [retry] = await db.select().from(sessionItems).where(eq(sessionItems.id, retryId));
    expect(retry).toMatchObject({ kind: 'retry_exercise', parentItemId: exerciseId });
    expect(retry?.concepts).toEqual([]);

    // A retry goes away with the exercise it belongs to.
    await db.delete(sessionItems).where(eq(sessionItems.id, exerciseId));
    expect(await db.select().from(sessionItems)).toHaveLength(0);
  });

  it('records the concept a block explains', async () => {
    await db.insert(lessonBlocks).values({
      id: randomUUID(),
      sessionId,
      orderIndex: 0,
      title: 'Lavoro di una forza',
      body: 'x',
      concept: 'lavoro di una forza',
    });
    const [block] = await db.select().from(lessonBlocks);
    expect(block?.concept).toBe('lavoro di una forza');
  });
});
