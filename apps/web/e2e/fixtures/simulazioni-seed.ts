import { randomUUID } from 'node:crypto';
import { expect, type APIRequestContext } from '@playwright/test';
import {
  artifacts,
  attemptItemResults,
  createDb,
  examProfiles,
  simulationAttempts,
  simulationItems,
  simulations,
  topics,
} from '@studyhub/db';
import { eq } from 'drizzle-orm';

/**
 * Seed per gli e2e di Simulazioni / Esame / Risultati (slice 4 della materia mobile).
 * Dati inseriti direttamente in Postgres (come `esami-f5.spec.ts`): servono la *forma* di
 * simulazioni e correzioni, non una generazione o una correzione vera (coperte dai test del worker).
 */

export const db = createDb(process.env.DATABASE_URL);

export interface SimulationSeed {
  name: string;
  slug: string;
  subjectId: string;
  topicId: string;
  /** Simulazione senza tentativi (3 esercizi, 30 min). */
  fresh: { id: string; title: string; itemIds: string[] };
  /** Simulazione con un tentativo già corretto (2 esercizi: 5/5 e 1/5). */
  done: { id: string; title: string; attemptId: string; itemIds: string[] };
}

const SOURCE = () => ({ docId: randomUUID(), page: 3, quote: 'Il rendimento di Carnot' });

export async function seedSimulations(
  request: APIRequestContext,
  baseURL: string,
): Promise<SimulationSeed> {
  const name = `E2E Simulazioni ${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  const created = await request.post(`${baseURL}/api/subjects`, { data: { name, color: 'teal' } });
  expect(created.status()).toBe(201);
  const { subject } = await created.json();
  const subjectId: string = subject.id;

  const topicId = randomUUID();
  await db.insert(topics).values({ id: topicId, subjectId, name: 'Carnot', slug: 'carnot' });

  await db.insert(examProfiles).values({
    id: randomUUID(),
    subjectId,
    sourceDocIds: [randomUUID(), randomUUID()],
    profile: {
      itemCount: 6,
      durationMin: 180,
      totalPoints: 30,
      kindDistribution: { open: 6 },
      avgMinutesPerItem: 30,
      verbosity: 'media',
      recurringTopics: ['Integrali', 'Serie numeriche'],
      notes: '',
    },
    edited: false,
    model: 'fake-v1',
    promptVersion: 'exam-profile/v1',
  });

  async function simulation(title: string, prompts: { prompt: string; points: number }[]) {
    const id = randomUUID();
    await db.insert(artifacts).values({
      id,
      subjectId,
      kind: 'simulation',
      title,
      path: '/x.json',
      model: 'fake-v1',
      promptVersion: 'simulation/v2',
    });
    await db.insert(simulations).values({
      artifactId: id,
      mode: 'esame_completo',
      topicId: null,
      timeBudgetMin: 30,
      totalPoints: prompts.reduce((n, p) => n + p.points, 0),
    });
    const itemIds: string[] = [];
    for (const [ord, p] of prompts.entries()) {
      const itemId = randomUUID();
      itemIds.push(itemId);
      await db.insert(simulationItems).values({
        id: itemId,
        simulationId: id,
        ord,
        topicId,
        prompt: p.prompt,
        kind: 'open',
        points: p.points,
        expectedPoints: ['punto'],
        rubric: [{ criterion: 'Svolgimento', points: p.points }],
        solution: `Soluzione dell'esercizio ${ord + 1}`,
        sourceRef: SOURCE(),
      });
    }
    return { id, itemIds };
  }

  const fresh = await simulation('Simulazione Alfa', [
    { prompt: 'Calcola il rendimento di un ciclo di Carnot.', points: 4 },
    { prompt: 'Enuncia il secondo principio.', points: 3 },
    { prompt: 'Definisci l’entropia.', points: 3 },
  ]);
  const done = await simulation('Simulazione Beta', [
    { prompt: 'Primo esercizio della Beta.', points: 5 },
    { prompt: 'Secondo esercizio della Beta.', points: 5 },
  ]);

  const attemptId = randomUUID();
  await db.insert(simulationAttempts).values({
    id: attemptId,
    simulationId: done.id,
    status: 'graded',
    durationMin: 30,
    answers: { [done.itemIds[0]!]: 'risposta uno', [done.itemIds[1]!]: 'risposta due' },
    submittedAt: new Date(),
    gradedAt: new Date(),
    totalAwarded: 6,
    totalMax: 10,
    weakTopics: [topicId],
  });
  await gradeAttempt(attemptId, done.itemIds, [5, 1]);

  return {
    name,
    slug: subject.slug,
    subjectId,
    topicId,
    fresh: { id: fresh.id, title: 'Simulazione Alfa', itemIds: fresh.itemIds },
    done: { id: done.id, title: 'Simulazione Beta', attemptId, itemIds: done.itemIds },
  };
}

/** Inserisce i risultati per esercizio (`awarded` su max 5 ciascuno) di un tentativo. */
export async function gradeAttempt(attemptId: string, itemIds: string[], awarded: number[]) {
  for (const [i, itemId] of itemIds.entries()) {
    await db.insert(attemptItemResults).values({
      id: randomUUID(),
      attemptId,
      itemId,
      awarded: awarded[i]!,
      max: 5,
      criteria: [
        {
          criterion: 'Svolgimento',
          awarded: awarded[i]!,
          max: 5,
          feedback: `Feedback esercizio ${i + 1}`,
        },
      ],
      missing: awarded[i]! < 5 ? ['il passaggio finale'] : [],
      sourceRef: SOURCE(),
    });
  }
}

/** Simula il worker: porta un tentativo consegnato a `graded` con i risultati. */
export async function markGraded(attemptId: string, itemIds: string[], awarded: number[]) {
  const [row] = await db
    .select()
    .from(simulationAttempts)
    .where(eq(simulationAttempts.id, attemptId));
  if (row?.status === 'graded') return; // un worker vero ha già corretto
  await gradeAttempt(attemptId, itemIds, awarded);
  await db
    .update(simulationAttempts)
    .set({
      status: 'graded',
      gradedAt: new Date(),
      totalAwarded: awarded.reduce((a, b) => a + b, 0),
      totalMax: 5 * itemIds.length,
      weakTopics: [],
    })
    .where(eq(simulationAttempts.id, attemptId));
}

export async function attemptsOf(simulationId: string) {
  return db
    .select()
    .from(simulationAttempts)
    .where(eq(simulationAttempts.simulationId, simulationId));
}
