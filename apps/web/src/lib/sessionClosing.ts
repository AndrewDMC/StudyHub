import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { and, asc, eq } from 'drizzle-orm';
import {
  artifactSources,
  artifacts,
  flashcards,
  sessionItems,
  simulationItems,
  simulations,
  studySessions,
  subjects,
  type SessionItem,
  type StudySession,
} from '@studyhub/db';
import { resolveSubjectSubpath } from '@studyhub/core';
import type { SessionDeckResult, SessionDrillResult } from '@studyhub/contracts';
import { SubjectNotFoundError } from './errors';
import { ConflictError, NotFoundError } from './examPrep';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = any;

/** Written into the artifact rows: nothing here calls a model, the content is the briefing the student already has. */
const SOURCE_MODEL = 'session';
const SOURCE_PROMPT_VERSION = 'session_briefing/v1';
/** Minutes a student gets per drill exercise, with a floor so a one-item drill is still a real sitting. */
const MINUTES_PER_EXERCISE = 5;

async function requireEndedSession(db: AnyDb, slug: string, sessionId: string) {
  const [subject] = await db.select().from(subjects).where(eq(subjects.slug, slug));
  if (!subject) throw new SubjectNotFoundError(slug);
  const [session] = await db
    .select()
    .from(studySessions)
    .where(and(eq(studySessions.id, sessionId), eq(studySessions.subjectId, subject.id)));
  if (!session) throw new NotFoundError('Sessione');
  // The closing proposals (docs/08 §2 "Termina") look at the final state: nothing can change under them.
  if (session.status !== 'ended') throw new ConflictError('Termina prima la sessione.');
  return {
    subject: subject as typeof subjects.$inferSelect,
    session: session as StudySession,
  };
}

async function loadItems(
  db: AnyDb,
  sessionId: string,
  kind: 'key_point' | 'exercise',
): Promise<SessionItem[]> {
  return db
    .select()
    .from(sessionItems)
    .where(and(eq(sessionItems.sessionId, sessionId), eq(sessionItems.kind, kind)))
    .orderBy(asc(sessionItems.orderIndex));
}

const docIdsOf = (items: SessionItem[]) => [
  ...new Set(items.flatMap((i) => i.citations.map((c) => c.docId))),
];

/**
 * "Crea flashcard dai punti chiave": one card per key point (front = the point, back = its explanation),
 * citing the same passage. No AI call — the points were already generated and validated — so it is free.
 * The deck stays a `draft` like every machine-made deck: the student approves it in the deck list.
 */
export async function createKeyPointDeck(
  db: AnyDb,
  dataRoot: string,
  slug: string,
  sessionId: string,
): Promise<SessionDeckResult> {
  const { subject, session } = await requireEndedSession(db, slug, sessionId);

  if (session.flashcardDeckId) {
    const [deck] = await db
      .select()
      .from(artifacts)
      .where(eq(artifacts.id, session.flashcardDeckId));
    const cards: { id: string }[] = await db
      .select({ id: flashcards.id })
      .from(flashcards)
      .where(eq(flashcards.deckId, session.flashcardDeckId));
    if (deck) {
      return {
        deckId: deck.id,
        title: deck.title,
        cardCount: cards.length,
        created: false,
      };
    }
  }

  const points = await loadItems(db, session.id, 'key_point');
  if (points.length === 0) {
    throw new ConflictError('Questa sessione non ha punti chiave da trasformare in flashcard.');
  }

  const deckId = randomUUID();
  const title = `Flashcard — punti chiave (${points.length} carte)`;
  const dir = resolveSubjectSubpath(subject.slug, ['artifacts', 'flashcards'], dataRoot);
  await fs.mkdir(dir, { recursive: true });
  const path = join(dir, `${deckId}.json`);
  const cards = points.map((p) => ({
    type: 'basic' as const,
    front: p.title,
    back: p.body,
    hint: null,
    sourceRef: p.citations[0] ?? null,
  }));
  await fs.writeFile(
    path,
    JSON.stringify(
      {
        generatedBy: 'studyhub-session',
        model: SOURCE_MODEL,
        promptVersion: SOURCE_PROMPT_VERSION,
        sourceDocIds: docIdsOf(points),
        approvedAt: null,
        createdAt: new Date().toISOString(),
        cards,
      },
      null,
      2,
    ),
    'utf-8',
  );

  await db.insert(artifacts).values({
    id: deckId,
    subjectId: subject.id,
    kind: 'flashcard_deck',
    title,
    path,
    model: SOURCE_MODEL,
    promptVersion: SOURCE_PROMPT_VERSION,
    costEur: 0,
  });
  await db.insert(flashcards).values(
    points.map((p, i) => ({
      id: randomUUID(),
      deckId,
      topicId: p.topicId,
      type: 'basic' as const,
      front: cards[i]!.front,
      back: cards[i]!.back,
      hint: null,
      sourceRef: cards[i]!.sourceRef,
    })),
  );
  const docIds = docIdsOf(points);
  if (docIds.length > 0) {
    await db
      .insert(artifactSources)
      .values(docIds.map((documentId) => ({ artifactId: deckId, documentId })));
  }
  await db
    .update(studySessions)
    .set({ flashcardDeckId: deckId })
    .where(eq(studySessions.id, session.id));

  return { deckId, title, cardCount: points.length, created: true };
}

/**
 * "Aggiungi gli esercizi sbagliati ai drill": the exercises the student marked `wrong` (by hand or from the
 * AI correction) become a drill simulation, to be attempted and graded like any other. Free to create; the
 * attempt is corrected by the usual exam grader.
 */
export async function createDrillFromWrongExercises(
  db: AnyDb,
  dataRoot: string,
  slug: string,
  sessionId: string,
): Promise<SessionDrillResult> {
  const { subject, session } = await requireEndedSession(db, slug, sessionId);

  if (session.drillId) {
    const [drill] = await db.select().from(artifacts).where(eq(artifacts.id, session.drillId));
    const items: { id: string }[] = await db
      .select({ id: simulationItems.id })
      .from(simulationItems)
      .where(eq(simulationItems.simulationId, session.drillId));
    if (drill) {
      return {
        simulationId: drill.id,
        title: drill.title,
        itemCount: items.length,
        created: false,
      };
    }
  }

  const exercises = (await loadItems(db, session.id, 'exercise')).filter(
    (e) => e.state === 'wrong' && e.citations.length > 0,
  );
  if (exercises.length === 0) {
    throw new ConflictError('Nessun esercizio sbagliato da aggiungere ai drill.');
  }

  const topicIds = new Set(exercises.map((e) => e.topicId));
  const sharedTopic = topicIds.size === 1 ? ([...topicIds][0] ?? null) : null;
  const simulationId = randomUUID();
  const title = `Drill — esercizi da rivedere (${exercises.length})`;
  const timeBudgetMin = Math.max(MINUTES_PER_EXERCISE, exercises.length * MINUTES_PER_EXERCISE);
  const items = exercises.map((e, ord) => ({
    id: randomUUID(),
    simulationId,
    ord,
    topicId: e.topicId,
    prompt: e.title,
    kind: 'open' as const,
    points: 1,
    expectedPoints: [e.body],
    rubric: [{ criterion: 'Risposta corretta e completa', points: 1 }],
    solution: e.body,
    sourceRef: e.citations[0]!,
  }));

  const dir = resolveSubjectSubpath(subject.slug, ['artifacts', 'simulations'], dataRoot);
  await fs.mkdir(dir, { recursive: true });
  const path = join(dir, `${simulationId}.json`);
  await fs.writeFile(
    path,
    JSON.stringify(
      {
        generatedBy: 'studyhub-session',
        model: SOURCE_MODEL,
        promptVersion: SOURCE_PROMPT_VERSION,
        sourceDocIds: docIdsOf(exercises),
        approvedAt: null,
        createdAt: new Date().toISOString(),
        mode: 'drill_argomento',
        topic: null,
        timeBudgetMin,
        items: items.map(
          ({ id: _id, simulationId: _sid, ord: _ord, topicId: _t, ...item }) => item,
        ),
      },
      null,
      2,
    ),
    'utf-8',
  );

  await db.insert(artifacts).values({
    id: simulationId,
    subjectId: subject.id,
    kind: 'simulation',
    title,
    path,
    model: SOURCE_MODEL,
    promptVersion: SOURCE_PROMPT_VERSION,
    costEur: 0,
  });
  await db.insert(simulations).values({
    artifactId: simulationId,
    mode: 'drill_argomento',
    topicId: sharedTopic,
    timeBudgetMin,
    totalPoints: exercises.length,
  });
  await db.insert(simulationItems).values(items);
  const docIds = docIdsOf(exercises);
  await db
    .insert(artifactSources)
    .values(docIds.map((documentId) => ({ artifactId: simulationId, documentId })));
  await db
    .update(studySessions)
    .set({ drillId: simulationId })
    .where(eq(studySessions.id, session.id));

  return { simulationId, title, itemCount: items.length, created: true };
}
