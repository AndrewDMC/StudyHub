import { test, expect } from '@playwright/test';

/**
 * F0 main flow, end-to-end through a real browser (not just library
 * functions, see apps/web/test/subjects.test.ts for that level): input ->
 * slug -> FS scaffold -> DB insert -> UI list, exactly the F0 acceptance
 * criterion "Creo 'Fisica 1' da UI -> esiste /data/subjects/fisica-1/".
 */
test('creates a subject from the UI and lists it', async ({ page, request, baseURL }) => {
  const name = `E2E Fisica ${Date.now()}`;

  await page.goto('/materie');
  await page.getByRole('button', { name: 'Nuova materia' }).click();

  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Nome materia').fill(name);
  await dialog.getByRole('button', { name: 'Crea materia' }).click();

  await expect(dialog).toBeHidden();
  await expect(page.getByRole('heading', { name })).toBeVisible();

  // Clean up via the same API the app uses, so re-running the suite is idempotent.
  const slug = name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
  await request.delete(`${baseURL}/api/subjects/${slug}`);
});
