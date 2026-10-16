import { randomUUID } from 'node:crypto';
import { expect, type APIRequestContext } from '@playwright/test';
import { and, eq } from 'drizzle-orm';
import { artifacts, flashcards, taskFlashcards, tasks } from '@studyhub/db';
import { db, seedPlan } from './lacune-piano-seed';

export { db, deleteSubject } from './lacune-piano-seed';

/**
 * Seed per gli e2e Slice 2 "flashcard attaccate alle lezioni". Piano attivo con due task di oggi
 * (Calore, Moto) e un riposo, argomenti e card via API/DB, link task-card e sessione sulla prima
 * task. Il worker non gira: i link `auto` si inseriscono direttamente.
 *
 * Card: Calore = Entropia uno/due/tre (uno `auto` e due `user` attaccate alla task Calore),
 * Moto = Velocita uno/due (non attaccate). Il mazzo e' approvato (ripassabile).
 */

export const CALORE_TITLE = 'Studia il calore';
export const MOTO_TITLE = 'Studia il moto';

export interface LezioniSeed {
  slug: string;
  subjectId: string;
  planId: string;
  deckId: string;
  topicIds: { calore: string; moto: string };
  taskIds: { calore: string; moto: string };
  sessionId: string;
}

export interface LezioniSeedOptions {
  /** Crea la sessione sulla task Calore. Default true. */
  session?: boolean;
  /** Attacca a Calore anche una card sospesa e una di un mazzo in bozza (non ripassabili). */
  nonReviewable?: boolean;
}

export async function seedLezioni(
  request: APIRequestContext,
  baseURL: string,
  opts: LezioniSeedOptions = {},
): Promise<LezioniSeed> {
  const plan = await seedPlan(request, baseURL, {
    status: 'active',
    targetOffset: 10,
    tasks: [
      { offset: 0, kind: 'read', title: CALORE_TITLE, minutes: 45 },
      { offset: 0, kind: 'read', title: MOTO_TITLE, minutes: 30 },
    ],
  });
  const { slug } = plan;
  const topic = async (name: string) => {
    const res = await request.post(`${baseURL}/api/subjects/${slug}/topics`, { data: { name } });
    expect(res.status()).toBe(201);
    return (await res.json()).topic.id as string;
  };
  const calore = await topic('Calore');
  const moto = await topic('Moto');
  const [caloreTask, motoTask] = plan.taskIds as [string, string];
  await db.update(tasks).set({ topicId: calore }).where(eq(tasks.id, caloreTask));
  await db.update(tasks).set({ topicId: moto }).where(eq(tasks.id, motoTask));

  const deckRes = await request.post(`${baseURL}/api/subjects/${slug}/decks`, {
    data: { title: 'Mazzo lezioni' },
  });
  const deckId = (await deckRes.json()).deck.id as string;
  const rows: Array<[string, string]> = [
    ['Entropia uno', calore],
    ['Entropia due', calore],
    ['Entropia tre', calore],
    ['Velocita uno', moto],
    ['Velocita due', moto],
  ];
  await db.insert(flashcards).values(
    rows.map(([front, topicId]) => ({
      id: randomUUID(),
      deckId,
      topicId,
      type: 'basic' as const,
      front,
      back: `Risposta a ${front}`,
    })),
  );
  await db.insert(taskFlashcards).values([
    { taskId: caloreTask, flashcardId: await cardId(deckId, 'Entropia uno'), source: 'auto' },
    { taskId: caloreTask, flashcardId: await cardId(deckId, 'Entropia due'), source: 'user' },
  ]);

  if (opts.nonReviewable) {
    const draftDeckId = randomUUID();
    await db.insert(artifacts).values({
      id: draftDeckId,
      subjectId: plan.subjectId,
      kind: 'flashcard_deck',
      title: 'Mazzo in bozza',
      path: '/x',
      status: 'draft',
      model: 'fake-v1',
      promptVersion: 'v',
    });
    const draftCard = randomUUID();
    const suspendedCard = randomUUID();
    await db.insert(flashcards).values([
      {
        id: draftCard,
        deckId: draftDeckId,
        topicId: calore,
        type: 'basic' as const,
        front: 'Bozza uno',
        back: 'b',
      },
      {
        id: suspendedCard,
        deckId,
        topicId: calore,
        type: 'basic' as const,
        front: 'Sospesa uno',
        back: 'b',
        suspended: true,
      },
    ]);
    await db.insert(taskFlashcards).values([
      { taskId: caloreTask, flashcardId: draftCard, source: 'user' },
      { taskId: caloreTask, flashcardId: suspendedCard, source: 'user' },
    ]);
  }

  let sessionId = '';
  if (opts.session ?? true) {
    const res = await request.post(`${baseURL}/api/subjects/${slug}/sessions`, {
      data: { taskId: caloreTask },
    });
    expect(res.status()).toBe(201);
    sessionId = (await res.json()).session.id as string;
  }
  return {
    slug,
    subjectId: plan.subjectId,
    planId: plan.planId,
    deckId,
    topicIds: { calore, moto },
    taskIds: { calore: caloreTask, moto: motoTask },
    sessionId,
  };
}

export async function cardId(deckId: string, front: string): Promise<string> {
  const [row] = await db
    .select()
    .from(flashcards)
    .where(and(eq(flashcards.deckId, deckId), eq(flashcards.front, front)));
  expect(row).toBeDefined();
  return row!.id;
}

/** Link `front` della task, come `front:source`, ordinati. */
export async function taskLinks(s: LezioniSeed, taskId: string): Promise<string[]> {
  const rows = await db
    .select({ front: flashcards.front, source: taskFlashcards.source })
    .from(taskFlashcards)
    .innerJoin(flashcards, eq(flashcards.id, taskFlashcards.flashcardId))
    .where(eq(taskFlashcards.taskId, taskId));
  return rows.map((r) => `${r.front}:${r.source}`).sort();
}

export const lezioniSessionUrl = (s: LezioniSeed) => `/materie/${s.slug}/sessione/${s.sessionId}`;
