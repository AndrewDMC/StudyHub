import { test, expect } from '@playwright/test';
import { deleteSubject, lessonUrl, seedLesson } from './fixtures/lezione-seed';

/** Fase Studia della lezione guidata: blocco 0 → controllo → blocco 1 (blocchi seminati, FakeProvider per la correzione). */
test.use({ viewport: { width: 1280, height: 800 } });

test('Desktop: si studia il blocco 0, si risponde al controllo e si apre il blocco 1', async ({
  page,
  request,
  baseURL,
}) => {
  test.setTimeout(90_000);
  const seed = await seedLesson(request, baseURL!);
  try {
    await page.goto(lessonUrl(seed));
    const outline = page.getByRole('navigation', { name: 'Indice della lezione' });
    await expect(outline).toBeVisible({ timeout: 30_000 });
    await expect(outline.locator('[aria-current="step"]')).toContainText('Blocco 1');
    await expect(outline.locator('[aria-disabled="true"]')).toHaveCount(1);
    await expect(page.getByRole('heading', { level: 2, name: /Blocco 1/ })).toBeVisible();

    // Esempio a passaggi: uno alla volta.
    await expect(page.getByText('Passo uno del blocco 1')).toBeVisible();
    await expect(page.getByText('Passo due')).toHaveCount(0);
    await page.getByRole('button', { name: 'Passaggio successivo' }).click();
    await expect(page.getByText('Passo due')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Passaggio successivo' })).toHaveCount(0);

    // Interruzione: apre il Tutor con la domanda precompilata, senza inviarla.
    await page.getByRole('button', { name: 'Fammi un altro esempio' }).click();
    await expect(page.getByLabel('Domanda al tutor')).toHaveValue(/Nel blocco 1 \(«Blocco 1/);
    await page.getByRole('tab', { name: 'Materiale' }).click();

    // Controllo.
    const check = page.getByRole('button', { name: 'Controlla' });
    await expect(check).toBeDisabled();
    await page.getByLabel(/Che cosa si conserva nel blocco 1/).fill('L’energia totale del sistema');
    await check.click();
    await expect(page.getByRole('button', { name: 'Blocco successivo →' })).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByText('Risposta attesa')).toBeVisible();

    await page.getByRole('button', { name: 'Blocco successivo →' }).click();
    await expect(page.getByRole('heading', { level: 2, name: /Blocco 2/ })).toBeFocused();
    await expect(outline.locator('[aria-current="step"]')).toContainText('Blocco 2');
    await expect(outline.getByText('Fatto')).toBeVisible();
  } finally {
    await deleteSubject(request, baseURL!, seed.slug);
  }
});
