import { randomUUID } from 'node:crypto';
import { expect, type APIRequestContext } from '@playwright/test';
import {
  documents,
  documentTopics,
  lessonBlocks,
  studySessions,
  tasks,
  topics,
} from '@studyhub/db';
import { eq } from 'drizzle-orm';
import { db, seedPlan } from './lacune-piano-seed';

export { deleteSubject } from './sessione-seed';

export const LESSON_TITLE = 'Termodinamica · parte 1 di 2';
export const DOC_NAME = 'Termodinamica.pdf';

export interface LessonSeed {
  slug: string;
  subjectId: string;
  sessionId: string;
  docId: string;
}

/**
 * Sessione di una task `lesson` con due blocchi già scritti (il worker non gira in e2e): il blocco 0
 * `open`, il blocco 1 `locked`. La correzione della risposta usa il FakeProvider del server.
 */
export async function seedLesson(request: APIRequestContext, baseURL: string): Promise<LessonSeed> {
  const plan = await seedPlan(request, baseURL, {
    status: 'active',
    targetOffset: 10,
    tasks: [{ offset: 0, kind: 'read', title: LESSON_TITLE, minutes: 45 }],
  });
  await db
    .update(tasks)
    .set({ kind: 'lesson', payload: { action: 'lesson', method: 'standard' } as never })
    .where(eq(tasks.id, plan.taskIds[0]!));

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
  await db.update(studySessions).set({ blockCount: 2 }).where(eq(studySessions.id, sessionId));

  for (const i of [0, 1]) {
    await db.insert(lessonBlocks).values({
      id: randomUUID(),
      sessionId,
      orderIndex: i,
      title: `Blocco ${i + 1}: il primo principio`,
      body: `Spiegazione discorsiva del blocco ${i + 1}.`,
      formula: String.raw`\Delta U = Q - W`,
      exampleSteps: [
        { text: `Passo uno del blocco ${i + 1}` },
        { text: 'Passo due', formula: 'x=2' },
      ],
      trap: 'Confondere il segno del lavoro.',
      checkQuestion: `Che cosa si conserva nel blocco ${i + 1}?`,
      checkAnswer: 'L’energia totale.',
      citations: [{ docId, page: 3 + i, quote: 'ΔU = Q - W' }],
      state: i === 0 ? 'open' : 'locked',
    });
  }
  return { slug: plan.slug, subjectId: plan.subjectId, sessionId, docId };
}

export const lessonUrl = (s: LessonSeed) => `/materie/${s.slug}/sessione/${s.sessionId}`;
