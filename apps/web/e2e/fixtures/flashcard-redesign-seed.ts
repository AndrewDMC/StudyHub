import { randomUUID } from 'node:crypto';
import { expect, type APIRequestContext } from '@playwright/test';
import { and, eq } from 'drizzle-orm';
import { artifacts, createDb, flashcards } from '@studyhub/db';
import { seedMazzi, type MazziSeed } from './flashcard-mazzi-seed';

const db = createDb(process.env.DATABASE_URL);

export interface RedesignSeed extends MazziSeed {
  /** Approved second deck "Mazzo extra" with one card ("Extra uno"). */
  extraDeckId: string;
  /** Draft deck "Bozza e2e" with two cards ("Bozza uno", "Bozza due"). */
  draftId: string;
}

/**
 * Seed of the redesigned Flashcard tab, on top of `seedMazzi`:
 *  - "Mazzo e2e" (approved): Calore (Entropia uno scaduta, due/tre nuove), Moto (Velocita uno nuova,
 *    Velocita due SEGNALATA), senza argomento (Sfusa uno nuova, Sfusa due SOSPESA);
 *  - "Mazzo extra" (approved): 1 card nuova;
 *  - "Bozza e2e" (draft): 2 card.
 * So: 1 in scadenza, 5 nuove (Entropia due/tre, Velocita uno, Sfusa uno, Extra uno), 2 escluse
 * (1 segnalata, 1 sospesa), 1 mazzo in bozza con 2 card.
 */
export async function seedRedesign(
  request: APIRequestContext,
  baseURL: string,
): Promise<RedesignSeed> {
  const base = await seedMazzi(request, baseURL);

  const { deck } = await (
    await request.post(`${baseURL}/api/subjects/${base.slug}/decks`, {
      data: { title: 'Mazzo extra' },
    })
  ).json();
  const res = await request.post(`${baseURL}/api/subjects/${base.slug}/flashcards`, {
    data: { deckId: deck.id, front: 'Extra uno', back: 'Risposta a Extra uno' },
  });
  expect(res.status()).toBe(201);

  await db
    .update(flashcards)
    .set({ flaggedAt: new Date() })
    .where(and(eq(flashcards.deckId, base.deckId), eq(flashcards.front, 'Velocita due')));
  await db
    .update(flashcards)
    .set({ suspended: true })
    .where(and(eq(flashcards.deckId, base.deckId), eq(flashcards.front, 'Sfusa due')));

  const draftId = randomUUID();
  await db.insert(artifacts).values({
    id: draftId,
    subjectId: base.subjectId,
    kind: 'flashcard_deck',
    title: 'Bozza e2e',
    path: `decks/${draftId}.json`,
    status: 'draft',
    model: 'fake',
    promptVersion: 'e2e',
  });
  await db.insert(flashcards).values(
    ['Bozza uno', 'Bozza due'].map((front) => ({
      id: randomUUID(),
      deckId: draftId,
      type: 'basic' as const,
      front,
      back: `Risposta a ${front}`,
    })),
  );

  return { ...base, extraDeckId: deck.id as string, draftId };
}

export async function cardExists(
  deckOrSubject: { deckId: string },
  front: string,
): Promise<boolean> {
  const rows = await db
    .select({ id: flashcards.id })
    .from(flashcards)
    .where(and(eq(flashcards.deckId, deckOrSubject.deckId), eq(flashcards.front, front)));
  return rows.length > 0;
}

export async function cardState(
  deckId: string,
  front: string,
): Promise<{ suspended: boolean; front: string; back: string } | null> {
  const [r] = await db
    .select()
    .from(flashcards)
    .where(and(eq(flashcards.deckId, deckId), eq(flashcards.front, front)));
  return r ? { suspended: r.suspended, front: r.front, back: r.back } : null;
}
