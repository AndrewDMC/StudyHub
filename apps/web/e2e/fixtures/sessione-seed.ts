import { randomUUID } from 'node:crypto';
import { expect, type APIRequestContext } from '@playwright/test';
import { documents, documentTopics, jobs, sessionItems, studySessions, topics } from '@studyhub/db';
import { eq } from 'drizzle-orm';
import { db, seedPlan, type SeedTask } from './lacune-piano-seed';

export { db } from './lacune-piano-seed';

/** Come quello di lacune-piano-seed, ma ritenta se il dev server chiude la connessione (ECONNRESET). */
export async function deleteSubject(request: APIRequestContext, baseURL: string, slug: string) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await request.delete(`${baseURL}/api/subjects/${slug}`);
      return;
    } catch {
      // ritenta
    }
  }
}

/**
 * Seed per gli e2e di Sessione e Chiusura (slice 6 della materia mobile). Materia, piano, task e
 * sessione passano da DB/API; briefing, punti chiave ed esercizi si inseriscono in `session_items`
 * perché il worker non gira in e2e. Correzione AI e chat usano il FakeProvider del server.
 */

export const TASK_TITLE = 'Studia le macchine termiche';
export const NEXT_TASK_TITLE = 'Schema dell’entropia';
export const DOC_NAME = 'Termodinamica.pdf';

export interface SessionSeed {
  slug: string;
  subjectId: string;
  sessionId: string;
  taskId: string;
  docId: string;
  topicId: string;
  /** id degli item nell'ordine di inserimento (3 punti chiave, poi 3 esercizi). */
  itemIds: string[];
}

export interface SessionSeedOptions {
  /** Aggiunge una seconda task aperta di oggi (abilita "Prossima task"). Default true. */
  nextTask?: boolean;
  /** Tipo della seconda task. Default 'read'. */
  nextKind?: SeedTask['kind'];
  /** Inserisce 3 punti chiave e 3 esercizi. Default true. */
  items?: boolean;
  /** Stato iniziale degli esercizi (per ordine), es. ['correct', 'wrong', 'open']. */
  /** Se false gli esercizi non hanno citazioni (il drill li scarta). Default true. */
  exerciseCitations?: boolean;
  exerciseStates?: Array<'open' | 'done' | 'correct' | 'wrong'>;
}

export async function seedSession(
  request: APIRequestContext,
  baseURL: string,
  opts: SessionSeedOptions = {},
): Promise<SessionSeed> {
  const nextTask = opts.nextTask ?? true;
  const plan = await seedPlan(request, baseURL, {
    status: 'active',
    targetOffset: 10,
    tasks: [
      { offset: 0, kind: 'read', title: TASK_TITLE, minutes: 45 },
      ...(nextTask
        ? [{ offset: 0, kind: opts.nextKind ?? 'read', title: NEXT_TASK_TITLE, minutes: 30 }]
        : []),
    ],
  });

  // Argomento + documento di studio collegato (citazioni e link "Apri il documento").
  const topicId = randomUUID();
  await db.insert(topics).values({
    id: topicId,
    subjectId: plan.subjectId,
    name: 'Termodinamica',
    slug: `termodinamica-${topicId.slice(0, 6)}`,
  } as typeof topics.$inferInsert);
  const docId = randomUUID();
  await db.insert(documents).values({
    id: docId,
    subjectId: plan.subjectId,
    type: 'appunti',
    originalName: DOC_NAME,
    storedPath: '/x',
    mime: 'application/pdf',
    bytes: 1,
    sha256: docId.replaceAll('-', '').padEnd(64, 'a'),
    status: 'parsed',
    pages: 12,
  });
  await db.insert(documentTopics).values({ documentId: docId, topicId });

  const res = await request.post(`${baseURL}/api/subjects/${plan.slug}/sessions`, {
    data: { taskId: plan.taskIds[0] },
  });
  expect(res.status()).toBe(201);
  const { session } = await res.json();
  const sessionId = session.id as string;

  const itemIds: string[] = [];
  if (opts.items ?? true) {
    const states = opts.exerciseStates ?? [];
    for (let i = 0; i < 3; i++) {
      const id = randomUUID();
      itemIds.push(id);
      await db.insert(sessionItems).values({
        id,
        sessionId,
        kind: 'key_point',
        orderIndex: i,
        title: `Punto chiave ${i + 1}: primo principio`,
        body: `Spiegazione del punto chiave ${i + 1}.`,
        citations: [{ docId, page: 3 + i, quote: `Citazione del punto ${i + 1}` }],
      });
    }
    for (let i = 0; i < 3; i++) {
      const id = randomUUID();
      itemIds.push(id);
      const state = states[i] ?? 'open';
      await db.insert(sessionItems).values({
        id,
        sessionId,
        kind: 'exercise',
        orderIndex: i,
        title: `Calcola il rendimento della macchina ${i + 1}`,
        body: `Soluzione attesa dell'esercizio ${i + 1}.`,
        difficulty: i + 1,
        citations:
          opts.exerciseCitations === false
            ? []
            : [{ docId, page: 5 + i, quote: `Citazione dell'esercizio ${i + 1}` }],
        state,
        answer: state === 'open' ? null : 'risposta già data',
      });
    }
  }
  return {
    slug: plan.slug,
    subjectId: plan.subjectId,
    sessionId,
    taskId: plan.taskIds[0]!,
    docId,
    topicId,
    itemIds,
  };
}

/** Lavoro di preparazione del briefing che il worker non esegue: lo stato lo decide il test. */
export async function seedBriefingJob(
  seed: SessionSeed,
  status: 'queued' | 'running' | 'failed',
  error?: string,
) {
  const jobId = randomUUID();
  await db.insert(jobs).values({
    id: jobId,
    type: 'prepare_session',
    subjectId: seed.subjectId,
    status,
    error: status === 'failed' ? { message: error ?? 'errore simulato' } : null,
  });
  await db
    .update(studySessions)
    .set({ briefingJobId: jobId })
    .where(eq(studySessions.id, seed.sessionId));
}

/** Termina la sessione via API con i minuti attivi indicati (ms). */
export async function endSession(
  request: APIRequestContext,
  baseURL: string,
  seed: SessionSeed,
  activeMs: number,
) {
  const res = await request.post(
    `${baseURL}/api/subjects/${seed.slug}/sessions/${seed.sessionId}/end`,
    { data: { activeMs, pomodoros: 0 } },
  );
  expect(res.ok()).toBe(true);
}

export const sessionUrl = (s: SessionSeed) => `/materie/${s.slug}/sessione/${s.sessionId}`;

export async function itemRow(itemId: string) {
  const [row] = await db.select().from(sessionItems).where(eq(sessionItems.id, itemId));
  return row;
}
