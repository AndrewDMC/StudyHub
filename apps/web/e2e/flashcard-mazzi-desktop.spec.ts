import { test, expect, type Page } from '@playwright/test';
import { applySort, cardTopic, seedMazzi, type MazziSeed } from './fixtures/flashcard-mazzi-seed';

/** Smoke desktop della Slice 1 "Mazzi per argomento" (Panoramica per argomento + vista Card, >= md). */
test.use({ viewport: { width: 1280, height: 800 } });

const list = (page: Page) => page.getByRole('list', { name: 'Mazzi per argomento' });
const topicRow = (page: Page, name: string) =>
  list(page).getByRole('listitem').filter({ hasText: name });
/** Il bottone cambia nome mentre l'ordinamento è in corso. */
const sortButton = (page: Page) =>
  page.getByRole('button', { name: /^(Ordina con l'AI|Ordino…)$/ });
const cardRow = (page: Page, front: string) =>
  page.getByRole('button', { name: new RegExp(`^${front}`) });

test.describe('Flashcard desktop — mazzi per argomento', () => {
  let s: MazziSeed;
  test.afterEach(async ({ request, baseURL }) => {
    await request.delete(`${baseURL}/api/subjects/${s.slug}`);
  });

  test('Argomenti con conteggi, filtro, Ripassa, Senza argomento e Sposta…', async ({
    page,
    request,
    baseURL,
  }) => {
    test.setTimeout(120_000);
    s = await seedMazzi(request, baseURL!);
    await page.goto(`/materie/${s.slug}?tab=flashcard`);
    await expect(topicRow(page, 'Calore')).toBeVisible({ timeout: 30_000 });

    const items = list(page).getByRole('listitem');
    await expect(items).toHaveCount(3);
    await expect(items.nth(0)).toContainText('Calore');
    await expect(items.nth(0)).toContainText('3 card');
    await expect(items.nth(0)).toContainText('1 da ripassare · 2 nuove');
    await expect(items.nth(1)).toContainText('Moto');
    await expect(items.nth(1)).toContainText('2 card');
    await expect(items.nth(1)).toContainText('2 nuove');
    await expect(items.nth(2)).toContainText('Senza argomento');
    await expect(items.nth(2)).toContainText('2 card');

    await expect(page.getByRole('link', { name: 'Ripassa Calore' })).toHaveAttribute(
      'href',
      `/ripasso?materia=${s.slug}&argomento=${s.topicIds.calore}`,
    );
    await expect(page.getByRole('link', { name: 'Ripassa Senza argomento' })).toHaveAttribute(
      'href',
      `/ripasso?materia=${s.slug}&argomento=none`,
    );

    // Filtro per argomento: la riga porta alla vista Card, che riflette il filtro.
    await topicRow(page, 'Moto').getByRole('link').first().click();
    await expect(page).toHaveURL(new RegExp(`view=card.*argomento=${s.topicIds.moto}`));
    await expect(cardRow(page, 'Velocita uno')).toBeVisible({ timeout: 20_000 });
    await expect(cardRow(page, 'Entropia uno')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Argomento: Moto' })).toBeVisible();
    await expect(page.getByText(/2 card in Moto/)).toBeVisible();
    await page.getByRole('button', { name: 'Azzera filtri' }).first().click();
    await expect(cardRow(page, 'Entropia uno')).toBeVisible({ timeout: 20_000 });

    // Senza argomento: solo le sfuse.
    await page
      .getByRole('navigation', { name: 'Viste flashcard' })
      .getByRole('link', { name: 'Panoramica' })
      .click();
    await topicRow(page, 'Senza argomento').getByRole('link', { name: 'Vedi le card' }).click();
    await expect(page).toHaveURL(/view=card.*argomento=none/);
    await expect(cardRow(page, 'Sfusa uno')).toBeVisible({ timeout: 20_000 });
    await expect(cardRow(page, 'Entropia uno')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Argomento: Senza argomento' })).toBeVisible();

    // Sposta… (bulk): le due sfuse in Moto.
    const boxes = page.getByRole('checkbox', { name: /^Seleziona card:/ });
    await expect(boxes).toHaveCount(2);
    for (const box of await boxes.all()) await box.check();
    await page
      .getByRole('toolbar', { name: 'Azioni sulle card selezionate' })
      .getByRole('button', { name: 'Sposta…' })
      .click();
    const dialog = page.getByRole('dialog', { name: 'Sposta 2 card' });
    await dialog.getByLabel('Argomento').selectOption(s.topicIds.moto);
    await dialog.getByRole('button', { name: 'Applica' }).click();
    await expect(page.getByRole('status').filter({ hasText: '2 card spostate.' })).toBeVisible({
      timeout: 20_000,
    });
    expect(await cardTopic(s, 'Sfusa due')).toBe(s.topicIds.moto);
    expect(await cardTopic(s, 'Sfusa uno')).toBe(s.topicIds.moto);
  });

  test("Ordina con l'AI: in corso, poi i gruppi si aggiornano", async ({
    page,
    request,
    baseURL,
  }) => {
    test.setTimeout(120_000);
    s = await seedMazzi(request, baseURL!);
    let release = false;
    await page.route('**/api/subjects/*/flashcards/sort', (route) =>
      route.request().method() === 'POST'
        ? route.fulfill({ status: 202, json: { jobId: 'job-e2e' } })
        : route.continue(),
    );
    await page.route('**/api/subjects/*/flashcards/sort/*', async (route) => {
      if (!release) return route.fulfill({ json: { status: 'running', output: null } });
      await applySort(s);
      await route.fulfill({
        json: {
          status: 'succeeded',
          output: {
            assigned: 2,
            assignedByDocument: 0,
            assignedByAi: 2,
            unassigned: 0,
            noTopics: false,
          },
        },
      });
    });
    await page.goto(`/materie/${s.slug}?tab=flashcard`);
    const cta = sortButton(page);
    await cta.click({ timeout: 30_000 });
    await expect(cta).toBeDisabled();
    await expect(page.getByTestId('sort-status')).toHaveText('Ordino le card…');
    release = true;
    await expect(page.getByTestId('sort-status')).toContainText(
      '2 card ordinate nei loro argomenti.',
      { timeout: 20_000 },
    );
    await expect(topicRow(page, 'Calore')).toContainText('4 card', { timeout: 20_000 });
    await expect(topicRow(page, 'Calore')).toContainText('1 da ripassare · 3 nuove');
  });

  test('Materia senza argomenti: niente CTA, messaggio con rimando al pannello Argomenti', async ({
    page,
    request,
    baseURL,
  }) => {
    test.setTimeout(90_000);
    s = await seedMazzi(request, baseURL!, { withTopics: false });
    await page.goto(`/materie/${s.slug}?tab=flashcard`);
    await expect(topicRow(page, 'Senza argomento')).toBeVisible({ timeout: 30_000 });
    await expect(sortButton(page)).toHaveCount(0);
    await expect(page.getByTestId('sort-status')).toContainText(
      'Questa materia non ha ancora argomenti.',
    );
    await expect(
      page.getByRole('button', { name: 'Apri il pannello Argomenti a sinistra' }),
    ).toBeVisible();
  });
});
