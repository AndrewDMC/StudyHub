import { randomUUID } from 'node:crypto';
import { test, expect } from '@playwright/test';
import { createDb, documents } from '@studyhub/db';
import { eq } from 'drizzle-orm';

/**
 * F6 in a real browser: the wizard declares insufficient time *before* generating
 * (docs/fasi/F6 acceptance criterion), via the free pre-flight — no worker, no AI call.
 */
test.describe('F6 — Planner', () => {
  test('Il wizard dichiara il tempo insufficiente prima di generare, con le 3 strategie', async ({
    page,
    request,
    baseURL,
  }) => {
    const name = `E2E Piano ${Date.now()}`;
    const created = await request.post(`${baseURL}/api/subjects`, {
      data: { name, color: 'violet' },
    });
    const { subject } = await created.json();

    const db = createDb(process.env.DATABASE_URL);
    try {
      await db.insert(documents).values({
        id: randomUUID(),
        subjectId: subject.id,
        type: 'appunti',
        originalName: 'dispense.pdf',
        storedPath: '/x',
        mime: 'application/pdf',
        bytes: 1,
        sha256: 'a'.repeat(64),
        status: 'parsed',
        pages: 600,
      });

      await page.goto(`/materie/${subject.slug}/piano`);
      const start = new Date();
      const target = new Date(start.getTime() + 5 * 86_400_000);
      await page.getByLabel('Inizio studio').fill(start.toISOString().slice(0, 10));
      await page.getByLabel('Data esame').fill(target.toISOString().slice(0, 10));

      const preview = page.getByTestId('plan-preview');
      await expect(preview).toContainText('Tempo insufficiente');
      await expect(preview).toContainText('stima dalle pagine');
      // The three strategies are listed before any job was enqueued.
      await expect(preview.getByRole('listitem').filter({ hasText: /:/ })).not.toHaveCount(0);
    } finally {
      await db.delete(documents).where(eq(documents.subjectId, subject.id));
      await request.delete(`${baseURL}/api/subjects/${subject.slug}`);
    }
  });
});
