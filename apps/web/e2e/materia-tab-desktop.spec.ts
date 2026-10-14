import { test, expect } from '@playwright/test';

/**
 * `?tab=materiale` è emesso dal layout mobile: su desktop un link condiviso non deve cadere su
 * Panoramica ma aprire il tab documenti corrispondente (Appunti, o il `filtro`).
 */
test.use({ viewport: { width: 1280, height: 800 } });

test('Desktop: ?tab=materiale apre Appunti e ?tab=materiale&filtro=esami apre Esami', async ({
  page,
  request,
  baseURL,
}) => {
  test.setTimeout(90_000);
  const name = `E2E Tab Desktop ${Date.now()}`;
  const created = await request.post(`${baseURL}/api/subjects`, { data: { name, color: 'blue' } });
  const { subject } = await created.json();
  const active = (label: string) =>
    page.getByRole('button', { name: label, exact: true }).locator('visible=true');

  try {
    await page.goto(`/materie/${subject.slug}?tab=materiale`);
    await expect(active('Appunti')).toHaveClass(/border-accent/, { timeout: 20_000 });
    await expect(active('Panoramica')).not.toHaveClass(/border-accent/);

    await page.goto(`/materie/${subject.slug}?tab=materiale&filtro=esami`);
    await expect(active('Esami')).toHaveClass(/border-accent/, { timeout: 20_000 });
    await expect(active('Appunti')).not.toHaveClass(/border-accent/);
  } finally {
    await request.delete(`${baseURL}/api/subjects/${subject.slug}`);
  }
});
