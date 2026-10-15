import { randomUUID } from 'node:crypto';
import { expect, type APIRequestContext } from '@playwright/test';
import {
  createDb,
  documents,
  documentTopics,
  exams,
  studyPlans,
  tasks,
  topics,
  type PlannerFeasibilityData,
} from '@studyhub/db';
import { eq } from 'drizzle-orm';

/**
 * Seed per gli e2e di Lacune e Piano (slice 5 della materia mobile). Materia, argomenti, mazzo e
 * flashcard passano dalle API; documenti, legami argomento-documento, mastery, piani e task
 * si inseriscono direttamente in Postgres (il worker non gira in e2e).
 */

export const db = createDb(process.env.DATABASE_URL);

export type TopicKey = 'termodinamica' | 'entropia' | 'ottica' | 'cinematica';

interface TopicSpec {
  name: string;
  mastery: number | null;
  /** Documento di studio collegato all'argomento. */
  material: boolean;
  cards: number;
}

/**
 * Flag attesi (nessun esame passato, quindi priorità = gravità × 0,25):
 * - Cinematica: senza materiale + senza flashcard (priorità massima, 1,25)
 * - Termodinamica: senza flashcard + debole (0,75)
 * - Entropia: debole, con 2 card (0,25)
 * - Ottica: in regola
 */
export const TOPIC_SPECS: Record<TopicKey, TopicSpec> = {
  termodinamica: { name: 'Termodinamica', mastery: 0.2, material: true, cards: 0 },
  entropia: { name: 'Entropia', mastery: 0.3, material: true, cards: 2 },
  ottica: { name: 'Ottica', mastery: 0.9, material: true, cards: 2 },
  cinematica: { name: 'Cinematica', mastery: null, material: false, cards: 0 },
};

export interface CoverageSeed {
  slug: string;
  subjectId: string;
  topicIds: Record<string, string>;
}

async function createSubject(request: APIRequestContext, baseURL: string, label: string) {
  const name = `E2E ${label} ${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  const created = await request.post(`${baseURL}/api/subjects`, { data: { name, color: 'teal' } });
  expect(created.status()).toBe(201);
  const { subject } = await created.json();
  return { name, slug: subject.slug as string, id: subject.id as string };
}

export async function seedCoverage(
  request: APIRequestContext,
  baseURL: string,
  keys: TopicKey[],
): Promise<CoverageSeed> {
  const subject = await createSubject(request, baseURL, 'Lacune');
  const deckRes = await request.post(`${baseURL}/api/subjects/${subject.slug}/decks`, {
    data: { title: 'Mazzo lacune' },
  });
  const { deck } = await deckRes.json();

  const topicIds: Record<string, string> = {};
  for (const key of keys) {
    const spec = TOPIC_SPECS[key];
    const res = await request.post(`${baseURL}/api/subjects/${subject.slug}/topics`, {
      data: { name: spec.name },
    });
    expect(res.status()).toBe(201);
    const { topic } = await res.json();
    topicIds[key] = topic.id;

    await db.update(topics).set({ mastery: spec.mastery }).where(eq(topics.id, topic.id));

    if (spec.material) {
      const docId = randomUUID();
      await db.insert(documents).values({
        id: docId,
        subjectId: subject.id,
        type: 'appunti',
        originalName: `${spec.name}.pdf`,
        storedPath: '/x',
        mime: 'application/pdf',
        bytes: 1,
        sha256: docId.replaceAll('-', '').padEnd(64, 'a'),
        status: 'parsed',
        pages: 10,
      });
      await db.insert(documentTopics).values({ documentId: docId, topicId: topic.id });
    }
    for (let i = 1; i <= spec.cards; i++) {
      const card = await request.post(`${baseURL}/api/subjects/${subject.slug}/flashcards`, {
        data: {
          deckId: deck.id,
          topicId: topic.id,
          front: `${spec.name} domanda ${i}`,
          back: `Risposta ${i}`,
        },
      });
      expect(card.status()).toBe(201);
    }
  }
  return { slug: subject.slug, subjectId: subject.id, topicIds };
}

/** Materia senza argomenti. */
export async function seedEmptySubject(request: APIRequestContext, baseURL: string) {
  const subject = await createSubject(request, baseURL, 'Vuota');
  return { slug: subject.slug, subjectId: subject.id };
}

// --- Piano -----------------------------------------------------------------------------------

export const iso = (d: Date) => d.toISOString().slice(0, 10);
/** Data UTC `n` giorni da oggi (come `todayIso()` dell'app). */
export function dayOffset(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + n);
  return iso(d);
}

const FEASIBLE: PlannerFeasibilityData = {
  feasible: true,
  requiredMinutes: 0,
  availableMinutes: 0,
  shortfallMinutes: 0,
  unscheduledTopicKeys: [],
  strategies: [],
};

export interface SeedTask {
  /** Giorni rispetto a oggi (UTC). */
  offset: number;
  kind?: 'read' | 'flashcards' | 'schema' | 'simulation' | 'drill' | 'rest' | 'review';
  title: string;
  minutes?: number;
  status?: 'proposed' | 'todo' | 'doing' | 'done' | 'skipped' | 'moved';
  topicKey?: string;
}

export interface PlanSeed {
  slug: string;
  subjectId: string;
  planId: string;
  /** id delle task nell'ordine di inserimento. */
  taskIds: string[];
}

export async function seedPlan(
  request: APIRequestContext,
  baseURL: string,
  opts: {
    status: 'active' | 'draft';
    tasks: SeedTask[];
    targetOffset?: number;
    feasibility?: PlannerFeasibilityData;
    examTitle?: string;
  },
): Promise<PlanSeed> {
  const subject = await createSubject(request, baseURL, 'Piano');
  let examId: string | null = null;
  if (opts.examTitle) {
    examId = randomUUID();
    await db.insert(exams).values({
      id: examId,
      subjectId: subject.id,
      title: opts.examTitle,
      kind: 'scritto',
      date: new Date(`${dayOffset(opts.targetOffset ?? 10)}T09:00:00Z`),
    });
  }
  const planId = randomUUID();
  const offsets = opts.tasks.map((t) => t.offset);
  await db.insert(studyPlans).values({
    id: planId,
    subjectId: subject.id,
    examId,
    status: opts.status,
    startDate: dayOffset(Math.min(0, ...offsets)),
    targetDate: dayOffset(opts.targetOffset ?? Math.max(...offsets) + 3),
    availability: { perWeekday: [60, 90, 90, 90, 90, 90, 60], blackoutDates: [] },
    prefs: {
      sessionLength: 50,
      intensity: 'standard',
      simulationCount: 'auto',
      simulationMinutes: 90,
      reviewMinutesPerCard: 0.5,
    },
    feasibility: opts.feasibility ?? FEASIBLE,
    warnings: [],
    model: 'fake-v1',
    promptVersion: 'estimate_topics/v1',
    committedAt: opts.status === 'active' ? new Date() : null,
  });
  const taskIds: string[] = [];
  for (const [i, t] of opts.tasks.entries()) {
    const id = randomUUID();
    taskIds.push(id);
    await db.insert(tasks).values({
      id,
      subjectId: subject.id,
      planId,
      taskKey: `${t.kind ?? 'read'}:e2e:${String(i).padStart(3, '0')}`,
      date: dayOffset(t.offset),
      kind: t.kind ?? 'read',
      topicKey: t.topicKey ?? null,
      minutes: t.minutes ?? 45,
      title: t.title,
      description: `Dettaglio: ${t.title}`,
      payload: { action: 'read' },
      status: t.status ?? (opts.status === 'draft' ? 'proposed' : 'todo'),
    });
  }
  return { slug: subject.slug, subjectId: subject.id, planId, taskIds };
}

export async function taskStatus(taskId: string) {
  const [row] = await db.select().from(tasks).where(eq(tasks.id, taskId));
  return row;
}

export async function planStatus(planId: string) {
  const [row] = await db.select().from(studyPlans).where(eq(studyPlans.id, planId));
  return row?.status;
}

export async function deleteSubject(request: APIRequestContext, baseURL: string, slug: string) {
  await request.delete(`${baseURL}/api/subjects/${slug}`);
}
