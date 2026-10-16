import { randomUUID } from 'node:crypto';
import { expect, type APIRequestContext } from '@playwright/test';
import { and, eq } from 'drizzle-orm';
import { createDb, flashcards } from '@studyhub/db';

const db = createDb(process.env.DATABASE_URL);

export interface MazziSeed {
  slug: string;
  subjectId: string;
  deckId: string;
  topicIds: { calore: string; moto: string };
}

/**
 * Materia con due argomenti e card sfuse: Calore (3 card, 1 da ripassare, 2 nuove), Moto (2 nuove),
 * senza argomento (2 nuove). Le card si inseriscono via DB (l'API le crea tutte nuove).
 * Con `withTopics: false` la materia non ha argomenti e tutte le 7 card sono sfuse.
 */
export async function seedMazzi(
  request: APIRequestContext,
  baseURL: string,
  opts: { withTopics?: boolean } = {},
): Promise<MazziSeed> {
  const withTopics = opts.withTopics ?? true;
  const name = `E2E Mazzi ${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  const { subject } = await (
    await request.post(`${baseURL}/api/subjects`, { data: { name, color: 'teal' } })
  ).json();
  const slug: string = subject.slug;
  const { deck } = await (
    await request.post(`${baseURL}/api/subjects/${slug}/decks`, { data: { title: 'Mazzo e2e' } })
  ).json();
  const deckId = deck.id as string;
  const topic = async (n: string) =>
    (
      await (
        await request.post(`${baseURL}/api/subjects/${slug}/topics`, { data: { name: n } })
      ).json()
    ).topic.id as string;
  const calore = withTopics ? await topic('Calore') : '';
  const moto = withTopics ? await topic('Moto') : '';

  const rows: Array<[string, string | null]> = [
    ['Entropia uno', calore || null],
    ['Entropia due', calore || null],
    ['Entropia tre', calore || null],
    ['Velocita uno', moto || null],
    ['Velocita due', moto || null],
    ['Sfusa uno', null],
    ['Sfusa due', null],
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
  if (withTopics) {
    const past = new Date(Date.now() - 86_400_000);
    await db
      .update(flashcards)
      .set({
        state: 'review',
        reps: 2,
        stability: 3,
        difficulty: 5,
        dueAt: past,
        lastReviewAt: past,
      })
      .where(and(eq(flashcards.deckId, deckId), eq(flashcards.front, 'Entropia uno')));
  }
  return { slug, subjectId: subject.id as string, deckId, topicIds: { calore, moto } };
}

/** Simula il worker del sort: assegna le due card sfuse ai due argomenti. */
export async function applySort(s: MazziSeed) {
  const set = (front: string, topicId: string) =>
    db
      .update(flashcards)
      .set({ topicId })
      .where(and(eq(flashcards.deckId, s.deckId), eq(flashcards.front, front)));
  await set('Sfusa uno', s.topicIds.calore);
  await set('Sfusa due', s.topicIds.moto);
}

export async function cardTopic(s: MazziSeed, front: string): Promise<string | null> {
  const [r] = await db
    .select()
    .from(flashcards)
    .where(and(eq(flashcards.deckId, s.deckId), eq(flashcards.front, front)));
  expect(r).toBeDefined();
  return r!.topicId;
}
