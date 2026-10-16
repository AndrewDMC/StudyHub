import { test, expect } from '@playwright/test';
import { eq } from 'drizzle-orm';
import { simulationAttempts } from '@studyhub/db';
import { db, seedSimulations, type SimulationSeed } from './fixtures/simulazioni-seed';

/** Smoke desktop della slice E: il verdetto Sufficiente/Insufficiente nei Risultati. Solo `chromium`. */
test.describe('Materia desktop — verdetto nei Risultati (slice E)', () => {
  let s: SimulationSeed;

  test.beforeEach(async ({ request, baseURL }) => {
    s = await seedSimulations(request, baseURL!);
  });

  test.afterEach(async ({ request, baseURL }) => {
    await request.delete(`${baseURL}/api/subjects/${s.slug}`);
  });

  test('6/10 è Sufficiente, 5/10 Insufficiente (stesso testid del mobile)', async ({ page }) => {
    test.setTimeout(120_000);
    const url = `/materie/${s.slug}/attempts/${s.done.attemptId}/results`;
    await page.goto(url);
    const verdict = page.getByTestId('attempt-verdict');
    await expect(verdict).toHaveText('Sufficiente', { timeout: 30_000 });
    await expect(verdict).toHaveAttribute('data-verdict', 'pass');

    await db
      .update(simulationAttempts)
      .set({ totalAwarded: 5 })
      .where(eq(simulationAttempts.id, s.done.attemptId));
    await page.reload();
    await expect(verdict).toHaveText('Insufficiente', { timeout: 30_000 });
    await expect(verdict).toHaveAttribute('data-verdict', 'fail');
  });
});
