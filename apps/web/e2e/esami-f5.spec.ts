import { randomUUID } from 'node:crypto';
import { test, expect } from '@playwright/test';
import {
  artifacts,
  attemptItemResults,
  createDb,
  simulationAttempts,
  simulationItems,
  simulations,
  topics,
} from '@studyhub/db';

/**
 * F5 in a real browser: the per-topic trend across graded attempts (docs/fasi/F5 "Storico
 * simulazioni con trend e confronto per argomento") and the opt-in multimodal switch on the
 * profile extraction. Data is seeded straight into Postgres — it needs the *shape* of graded
 * results, not a real generation/grading run (that pipeline is covered by apps/worker tests).
 */
test.describe('F5 — Esami & Simulazioni', () => {
  test('La scheda Simulazioni mostra l’andamento per argomento su più tentativi corretti', async ({
    page,
    request,
    baseURL,
  }) => {
    const name = `E2E Termodinamica ${Date.now()}`;
    const created = await request.post(`${baseURL}/api/subjects`, {
      data: { name, color: 'amber' },
    });
    const { subject } = await created.json();

    const db = createDb(process.env.DATABASE_URL);
    try {
      const topicId = randomUUID();
      await db
        .insert(topics)
        .values({ id: topicId, subjectId: subject.id, name: 'Carnot', slug: 'carnot' });

      const simulationId = randomUUID();
      await db.insert(artifacts).values({
        id: simulationId,
        subjectId: subject.id,
        kind: 'simulation',
        title: 'Drill Carnot',
        path: '/x.json',
        model: 'fake-v1',
        promptVersion: 'simulation/v2',
      });
      await db.insert(simulations).values({
        artifactId: simulationId,
        mode: 'drill_argomento',
        topicId,
        timeBudgetMin: 30,
        totalPoints: 10,
      });
      const itemId = randomUUID();
      await db.insert(simulationItems).values({
        id: itemId,
        simulationId,
        ord: 0,
        topicId,
        prompt: 'Calcola il rendimento di un ciclo di Carnot.',
        kind: 'open',
        points: 10,
        expectedPoints: ['rendimento'],
        rubric: [{ criterion: 'Rendimento', points: 10 }],
        solution: 'η = 1 − Tc/Th',
        sourceRef: { docId: randomUUID(), page: 1, quote: 'q' },
      });

      for (const [gradedAt, awarded] of [
        ['2026-09-01T10:00:00Z', 4],
        ['2026-09-15T10:00:00Z', 8],
      ] as const) {
        const attemptId = randomUUID();
        await db.insert(simulationAttempts).values({
          id: attemptId,
          simulationId,
          status: 'graded',
          durationMin: 30,
          gradedAt: new Date(gradedAt),
          totalAwarded: awarded,
          totalMax: 10,
        });
        await db.insert(attemptItemResults).values({
          id: randomUUID(),
          attemptId,
          itemId,
          awarded,
          max: 10,
          criteria: [],
          missing: [],
          sourceRef: { docId: randomUUID(), page: 1, quote: 'q' },
        });
      }

      await page.goto(`/materie/${subject.slug}?tab=simulazioni`);
      await expect(page.getByRole('heading', { name: 'Andamento per argomento' })).toBeVisible();
      const row = page.getByRole('listitem').filter({ hasText: 'Carnot' }).first();
      await expect(row).toContainText('80%');
      await expect(row).toContainText('+40');
    } finally {
      await request.delete(`${baseURL}/api/subjects/${subject.slug}`);
    }
  });

  test('L’estrazione del profilo con le immagini è un’opzione esplicita, spenta di default', async ({
    page,
    request,
    baseURL,
  }) => {
    const name = `E2E Profilo ${Date.now()}`;
    const created = await request.post(`${baseURL}/api/subjects`, {
      data: { name, color: 'blue' },
    });
    const { subject } = await created.json();

    try {
      await page.goto(`/materie/${subject.slug}?tab=simulazioni`);
      const toggle = page.getByLabel(/Usa anche le pagine degli esami come immagini/);
      await expect(toggle).not.toBeChecked();

      await toggle.check();
      const [req] = await Promise.all([
        page.waitForRequest((r) => r.url().endsWith('/exam-profile') && r.method() === 'POST'),
        page.getByRole('button', { name: 'Estrai profilo' }).click(),
      ]);
      expect(req.postDataJSON()).toMatchObject({ useImages: true });
    } finally {
      await request.delete(`${baseURL}/api/subjects/${subject.slug}`);
    }
  });
});
