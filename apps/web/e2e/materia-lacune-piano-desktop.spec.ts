import { test, expect } from '@playwright/test';
import { deleteSubject, seedCoverage, seedPlan } from './fixtures/lacune-piano-seed';

/**
 * Slice 5 della materia mobile: a 1280px Lacune e Piano restano quelli desktop (tabella di
 * copertura, `PlanDesktop`), nessuna vista mobile.
 */
test.use({ viewport: { width: 1280, height: 800 } });

test('Desktop: la tab Lacune mostra la tabella di copertura, non le card mobile', async ({
  page,
  request,
  baseURL,
}) => {
  test.setTimeout(90_000);
  const seed = await seedCoverage(request, baseURL!, ['termodinamica', 'ottica', 'cinematica']);
  try {
    await page.goto(`/materie/${seed.slug}?tab=lacune`);
    const coverage = page.getByTestId('coverage');
    await expect(coverage.getByRole('columnheader', { name: 'Argomento' })).toBeVisible({
      timeout: 30_000,
    });
    await expect(coverage.getByRole('row')).toHaveCount(4); // intestazione + 3 argomenti
    await expect(coverage.getByRole('heading', { name: 'Da colmare per primo' })).toBeVisible();
    await expect(page.getByRole('group', { name: 'Filtra le lacune' })).toHaveCount(0);
    await expect(page.getByRole('article')).toHaveCount(0);
  } finally {
    await deleteSubject(request, baseURL!, seed.slug);
  }
});

test('Desktop: /piano mostra il piano desktop con i comandi di sempre', async ({
  page,
  request,
  baseURL,
}) => {
  test.setTimeout(90_000);
  const seed = await seedPlan(request, baseURL!, {
    status: 'draft',
    targetOffset: 10,
    tasks: [{ offset: 1, title: 'Studia Termodinamica', topicKey: 'doc-a' }],
  });
  try {
    await page.goto(`/materie/${seed.slug}/piano`);
    await expect(page.getByRole('heading', { name: 'Piano di studio', level: 1 })).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByRole('button', { name: 'Conferma piano' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Rigenera bozza' })).toBeVisible();
    // Niente chrome mobile: né header proprio né "Torna alla materia".
    await expect(page.getByRole('link', { name: 'Torna alla materia' })).toHaveCount(0);
    await expect(page.getByRole('group', { name: 'Giorni del piano' })).toHaveCount(0);
  } finally {
    await deleteSubject(request, baseURL!, seed.slug);
  }
});
