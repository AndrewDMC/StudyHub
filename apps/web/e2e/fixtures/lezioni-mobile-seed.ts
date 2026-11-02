import { randomUUID } from 'node:crypto';
import { expect, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import { lessonBlocks, sessionItems, studyPlans, studySessions, tasks, topics } from '@studyhub/db';
import { eq } from 'drizzle-orm';
import { db, seedPlan, taskStatus, type PlanSeed } from './lacune-piano-seed';
import { seedLesson, type LessonSeed } from './lezione-seed';

export { deleteSubject } from './sessione-seed';
export { lessonUrl, LESSON_TITLE, DOC_NAME } from './lezione-seed';

/**
 * Seed e helper per gli e2e mobili del piano a lezioni (S7: Piano C12, lezione C13, verifica).
 * Il worker non gira in e2e: sessioni, blocchi, esercizi e domande si inseriscono direttamente in DB.
 */

/** Controlli interattivi visibili più bassi di 44 px dentro `scope` (selettore CSS). */
export async function smallTargets(page: Page, scope: string): Promise<string[]> {
  return page.evaluate((sel) => {
    const root = document.querySelector(sel);
    if (!root) return ['(scope mancante)'];
    return Array.from(
      root.querySelectorAll<HTMLElement>('button, a[href], input, select, textarea'),
    )
      .filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';
      })
      .filter((el) => el.getBoundingClientRect().height < 43.5)
      .map(
        (el) =>
          `${el.tagName.toLowerCase()} "${(el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 40)}" ${Math.round(el.getBoundingClientRect().height)}px`,
      );
  }, scope);
}

/** Nessuno scroll orizzontale: la pagina non è più larga della finestra (scrollWidth <= clientWidth). */
export async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => ({
    document: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    body: document.body.scrollWidth - document.body.clientWidth,
  }));
  expect(overflow.document).toBeLessThanOrEqual(0);
  expect(overflow.body).toBeLessThanOrEqual(0);
}

/** Altezza (e, se data, larghezza) minime in px di un elemento visibile. */
export async function expectMinSize(locator: Locator, min: { width?: number; height: number }) {
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.height).toBeGreaterThanOrEqual(min.height - 0.5);
  if (min.width) expect(box!.width).toBeGreaterThanOrEqual(min.width - 0.5);
}

// --- Lezioni -----------------------------------------------------------------------------------

/** Lezione standard con 2 blocchi, aperta sulla fase indicata (default Studia). */
export async function seedStandardLesson(
  request: APIRequestContext,
  baseURL: string,
  phase: 'explore' | 'understand' | 'rework' | 'apply' | 'recall' = 'understand',
): Promise<LessonSeed> {
  const seed = await seedLesson(request, baseURL);
  await db
    .update(studySessions)
    .set({ phase, method: 'standard' })
    .where(eq(studySessions.id, seed.sessionId));
  return seed;
}

/** Lezione sprint con 3 esercizi già generati, aperta sulla fase indicata (default Esercizi). */
export async function seedSprintLesson(
  request: APIRequestContext,
  baseURL: string,
  phase: 'exercises' | 'theory' | 'retry' | 'recall' = 'exercises',
): Promise<LessonSeed> {
  const seed = await seedLesson(request, baseURL);
  await db.delete(lessonBlocks).where(eq(lessonBlocks.sessionId, seed.sessionId));
  await db
    .update(studySessions)
    .set({ method: 'sprint', phase, blockCount: null })
    .where(eq(studySessions.id, seed.sessionId));
  for (const i of [0, 1, 2]) {
    await db.insert(sessionItems).values({
      id: randomUUID(),
      sessionId: seed.sessionId,
      kind: 'exercise',
      orderIndex: i,
      title: `Esercizio di prova ${i + 1}: calcola la variazione di energia interna.`,
      body: 'ΔU = Q - W',
      difficulty: 2,
      citations: [{ docId: seed.docId, page: 3 + i, quote: 'ΔU = Q - W' }],
      concepts: ['Primo principio'],
      solutionSteps: [
        { text: 'Applica il primo principio', formula: String.raw`\Delta U = Q - W` },
      ],
    });
  }
  return seed;
}

// --- Verifica ----------------------------------------------------------------------------------

export interface VerifySeed {
  slug: string;
  subjectId: string;
  sessionId: string;
  docId: string;
}

export const VERIFY_TOPIC = 'Termodinamica';

/** Verifica con 2 domande aperte; il punto chiave di ognuna cita la pagina 3 del documento. */
export async function seedVerify(request: APIRequestContext, baseURL: string): Promise<VerifySeed> {
  const lesson = await seedLesson(request, baseURL);
  const [topic] = await db.select().from(topics).where(eq(topics.subjectId, lesson.subjectId));
  const [anyTask] = await db.select().from(tasks).where(eq(tasks.subjectId, lesson.subjectId));
  // Sulla stessa materia e sullo stesso piano: una task `verify` (+3 giorni) e la sua sessione.
  const taskId = randomUUID();
  await db.insert(tasks).values({
    id: taskId,
    subjectId: lesson.subjectId,
    planId: anyTask!.planId,
    taskKey: 'rev:e2e:2',
    date: new Date().toISOString().slice(0, 10),
    kind: 'verify',
    topicKey: null,
    minutes: 15,
    title: `Verifica · ${VERIFY_TOPIC}`,
    description: 'Verifica a libro chiuso',
    payload: { action: 'verify' },
    status: 'todo',
  });
  const res = await request.post(`${baseURL}/api/subjects/${lesson.slug}/sessions`, {
    data: { taskId },
  });
  expect(res.status()).toBe(201);
  const { session } = await res.json();
  const sessionId = session.id as string;
  expect(session.kind).toBe('verify');

  // Domande scritte a mano: niente copia dalle lezioni, niente job di generazione.
  await db.delete(sessionItems).where(eq(sessionItems.sessionId, sessionId));
  await db
    .update(studySessions)
    .set({
      verifyPreparedAt: new Date(),
      briefingJobId: null,
      masteryBefore: 0.3,
      topicIds: [topic!.id],
      documentIds: [lesson.docId],
    })
    .where(eq(studySessions.id, sessionId));
  const topicId = topic!.id;
  for (const i of [0, 1]) {
    await db.insert(sessionItems).values({
      id: randomUUID(),
      sessionId,
      kind: 'exercise',
      orderIndex: i,
      title: `Domanda ${i + 1}: che cosa afferma il primo principio?`,
      body: 'La variazione di energia interna è calore meno lavoro.',
      difficulty: 2,
      citations: [{ docId: lesson.docId, page: 3, quote: 'ΔU = Q - W' }],
      topicId,
      concepts: ['Primo principio'],
    });
  }
  return { slug: lesson.slug, subjectId: lesson.subjectId, sessionId, docId: lesson.docId };
}

export const verifyUrl = (s: { slug: string; sessionId: string }) =>
  `/materie/${s.slug}/sessione/${s.sessionId}`;

// --- Piano a lezioni ---------------------------------------------------------------------------

export interface LessonPlanSeed extends PlanSeed {
  /** id dell'argomento lasciato fuori dal piano (nome "Cinematica"), solo con `problem`. */
  excludedTopicId: string;
}

export const PLAN_TASKS = {
  standard: 'Termodinamica · parte 1 di 2',
  sprint: 'Entropia',
  verify: 'Verifica · Termodinamica',
  flashcards: 'Flashcard di termodinamica',
} as const;

/**
 * Piano attivo a lezioni: oggi una lezione standard (pag. 12–31) e una sprint; domani una verifica
 * (+3 giorni) e flashcard. Con `problem` il piano non è fattibile: la lezione sprint è una scelta del
 * planner e "Cinematica" resta fuori dal piano.
 */
export async function seedLessonPlan(
  request: APIRequestContext,
  baseURL: string,
  opts: { problem: boolean },
): Promise<LessonPlanSeed> {
  const plan = await seedPlan(request, baseURL, {
    status: 'active',
    targetOffset: 14,
    examTitle: 'Scritto di fisica',
    tasks: [
      { offset: 0, title: PLAN_TASKS.standard, minutes: 45 },
      { offset: 0, title: PLAN_TASKS.sprint, minutes: 30 },
      { offset: 1, title: PLAN_TASKS.verify, minutes: 15 },
      { offset: 1, kind: 'flashcards', title: PLAN_TASKS.flashcards, minutes: 20 },
    ],
  });
  const [standardId, sprintId, verifyId] = plan.taskIds as [string, string, string];
  await db
    .update(tasks)
    .set({
      kind: 'lesson',
      topicKey: 'term',
      payload: {
        action: 'lesson',
        method: 'standard',
        material: [{ docId: randomUUID(), pageFrom: 12, pageTo: 31 }],
      },
    })
    .where(eq(tasks.id, standardId));
  await db
    .update(tasks)
    .set({
      kind: 'lesson',
      topicKey: 'entr',
      payload: { action: 'lesson', method: 'sprint' },
    })
    .where(eq(tasks.id, sprintId));
  await db
    .update(tasks)
    .set({ kind: 'verify', taskKey: 'rev:term:2', payload: { action: 'verify' } })
    .where(eq(tasks.id, verifyId));

  const topicRes = await request.post(`${baseURL}/api/subjects/${plan.slug}/topics`, {
    data: { name: 'Cinematica' },
  });
  expect(topicRes.status()).toBe(201);
  const { topic } = await topicRes.json();

  if (opts.problem) {
    const sprintKey = (await taskStatus(sprintId))!.taskKey;
    await db
      .update(studyPlans)
      .set({
        feasibility: {
          feasible: false,
          requiredMinutes: 600,
          availableMinutes: 480,
          shortfallMinutes: 120,
          unscheduledTopicKeys: [],
          sprintLessonKeys: [sprintKey],
          excludedTopicKeys: [topic.id as string],
          strategies: [
            {
              id: 'estendi_data',
              label: 'Sposta l’esame',
              description: 'Aggiungi qualche giorno prima della data.',
            },
          ],
        },
      })
      .where(eq(studyPlans.id, plan.planId));
  }
  return { ...plan, excludedTopicId: topic.id as string };
}
