import { test, expect } from '@playwright/test';
import {
  attemptsOf,
  markGraded,
  seedSimulations,
  type SimulationSeed,
} from './fixtures/simulazioni-seed';

/**
 * Smoke desktop della slice 4: la tab Simulazioni (`ExamPrepPanel`), la modalità esame
 * (`ExamModeClient` → `useExamAttempt`) e i risultati (`AttemptResultsClient` → `useAttemptResults`)
 * si comportano come prima dell'estrazione degli hook. Gira solo nel progetto `chromium` (desktop).
 * Il worker non gira in e2e: il passaggio a `graded` è simulato via DB.
 */

test.describe('Materia desktop — Simulazioni, Esame e Risultati', () => {
  let s: SimulationSeed;

  test.beforeEach(async ({ request, baseURL }) => {
    s = await seedSimulations(request, baseURL!);
  });

  test.afterEach(async ({ request, baseURL }) => {
    await request.delete(`${baseURL}/api/subjects/${s.slug}`);
  });

  test('La tab Simulazioni mostra il pannello desktop, non la vista mobile', async ({ page }) => {
    test.setTimeout(90_000);
    await page.goto(`/materie/${s.slug}?tab=simulazioni`);
    await expect(page.getByText('Simulazione Alfa').first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('simulation-row')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: "Profilo dell'esame" })).toHaveCount(0);
    await expect(page.getByLabel(/Usa anche le pagine degli esami come immagini/)).toBeVisible();
  });

  test('Esame desktop: avvio, risposta salvata, "Vista completa" e consegna con conferma', async ({
    page,
  }) => {
    test.setTimeout(150_000);
    await page.goto(`/materie/${s.slug}/simulations/${s.fresh.id}`);

    await expect(page.getByText('Modalità esame')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText('1 / 3')).toBeVisible();
    // Nessuna UI mobile: niente chip, niente sheet di uscita.
    await expect(page.getByRole('group', { name: 'Esercizi' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Esci dalla simulazione' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Vista completa' })).toBeVisible();
    expect(await attemptsOf(s.fresh.id)).toHaveLength(1);

    await page.getByLabel("Risposta all'esercizio 1").fill('risposta desktop');
    await expect(page.getByText('Salvato', { exact: true })).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: 'Successivo' }).click();
    await expect(page.getByText('2 / 3')).toBeVisible();
    await page.getByRole('button', { name: 'Precedente' }).click();
    await expect(page.getByLabel("Risposta all'esercizio 1")).toHaveValue('risposta desktop');

    await page.getByRole('button', { name: 'Vista completa' }).click();
    await expect(page.getByLabel("Risposta all'esercizio 3")).toBeVisible();

    // Reload: ripresa dello stesso tentativo con la risposta.
    await page.reload();
    await expect(page.getByLabel("Risposta all'esercizio 1")).toHaveValue('risposta desktop', {
      timeout: 30_000,
    });
    expect(await attemptsOf(s.fresh.id)).toHaveLength(1);

    // Consegna: window.confirm; annullare non consegna.
    let confirmed = false;
    page.once('dialog', (d) => void d.dismiss());
    await page.getByRole('button', { name: 'Consegna' }).click();
    await page.waitForTimeout(500);
    expect(new URL(page.url()).pathname).toContain('/simulations/');
    page.once('dialog', (d) => {
      confirmed = true;
      void d.accept();
    });
    await page.getByRole('button', { name: 'Consegna' }).click();
    await expect(page).toHaveURL(/\/attempts\/[^/]+\/results$/, { timeout: 30_000 });
    expect(confirmed).toBe(true);

    const attemptId = page.url().split('/attempts/')[1]!.split('/')[0]!;
    const pending = page.getByText('Esame consegnato. La correzione è in corso…');
    const score = page.getByText('/ 15');
    await expect(pending.or(score)).toBeVisible({ timeout: 30_000 });
    if (await pending.isVisible()) {
      // Simula il worker: 3 esercizi da max 5 (qui basta la forma).
      await markGraded(attemptId, s.fresh.itemIds, [5, 2, 1]);
    }
    await expect(page.getByText('8 / 15')).toBeVisible({ timeout: 30_000 });
  });

  test('Risultati desktop: punteggio, argomenti deboli, drill e seconda opinione', async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await page.goto(`/materie/${s.slug}/attempts/${s.done.attemptId}/results`);
    await expect(page.getByRole('heading', { level: 1, name: 'Correzione' })).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByText('6 / 10')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText('Argomenti deboli rilevati')).toBeVisible();
    // Nessuna UI mobile
    await expect(page.getByTestId('result-item')).toHaveCount(0);
    await expect(page.getByTestId('attempt-score')).toHaveCount(0);

    await expect(page.getByText('Feedback esercizio 2').first()).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Chiedi una seconda opinione' }).first(),
    ).toBeVisible();

    await page.getByRole('button', { name: 'Genera drill su questo argomento' }).click();
    await expect(
      page.getByText('Drill in generazione — lo trovi nella pagina materia.'),
    ).toBeVisible({
      timeout: 30_000,
    });
  });
});
