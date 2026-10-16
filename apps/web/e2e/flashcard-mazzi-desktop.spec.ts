import { test, expect, type Page } from '@playwright/test';
import { applySort, cardTopic, seedMazzi, type MazziSeed } from './fixtures/flashcard-mazzi-seed';

/** Smoke desktop della Slice 1 "Mazzi per argomento" (tab Flashcard, >= md). */
test.use({ viewport: { width: 1280, height: 800 } });

const region = (page: Page) => page.getByRole('region', { name: 'Mazzi per argomento' });
const deck = (page: Page, name: string) =>
  region(page).getByRole('button', { name: new RegExp(`^Mazzo ${name}:`) });

test.describe('Flashcard desktop — mazzi per argomento', () => {
  let s: MazziSeed;
  test.afterEach(async ({ request, baseURL }) => {
    await request.delete(`${baseURL}/api/subjects/${s.slug}`);
  });

  test('Mazzi con conteggi, filtro, Ripassa, Senza argomento e Sposta in argomento', async ({
    page,
    request,
    baseURL,
  }) => {
    test.setTimeout(120_000);
    s = await seedMazzi(request, baseURL!);
    await page.goto(`/materie/${s.slug}?tab=flashcard`);
    await expect(deck(page, 'Calore')).toBeVisible({ timeout: 30_000 });

    const labels = await region(page)
      .getByRole('button', { name: /^Mazzo / })
      .evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')));
    expect(labels).toEqual([
      'Mazzo Calore: 3 card, 1 da ripassare, 2 nuove',
      'Mazzo Moto: 2 card, 0 da ripassare, 2 nuove',
      'Mazzo Senza argomento: 2 card, 0 da ripassare, 2 nuove',
    ]);

    await expect(page.getByRole('link', { name: 'Ripassa Calore' })).toHaveAttribute(
      'href',
      `/ripasso?materia=${s.slug}&argomento=${s.topicIds.calore}`,
    );
    await expect(page.getByRole('link', { name: 'Ripassa Senza argomento' })).toHaveAttribute(
      'href',
      `/ripasso?materia=${s.slug}&argomento=none`,
    );

    // Filtro per mazzo, sincronizzato con il select.
    await deck(page, 'Moto').click();
    await expect(deck(page, 'Moto')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByText('Velocita uno', { exact: true })).toBeVisible();
    await expect(page.getByText('Entropia uno', { exact: true })).toHaveCount(0);
    await expect(page.getByLabel('Filtra per argomento')).toHaveValue(s.topicIds.moto);
    await page.getByRole('button', { name: 'Mostra tutte le card' }).click();
    await expect(page.getByText('Entropia uno', { exact: true })).toBeVisible();

    // Senza argomento: solo le sfuse.
    await deck(page, 'Senza argomento').click();
    await expect(page.getByText('Sfusa uno', { exact: true })).toBeVisible();
    await expect(page.getByText('Entropia uno', { exact: true })).toHaveCount(0);
    await expect(page.getByLabel('Filtra per argomento')).toHaveValue('none');

    // Sposta in argomento (bulk): le due sfuse in Moto.
    await expect(page.getByRole('checkbox', { name: 'Seleziona card' })).toHaveCount(2);
    for (const box of await page.getByRole('checkbox', { name: 'Seleziona card' }).all()) {
      await box.check();
    }
    await page.getByRole('combobox', { name: 'Sposta in argomento' }).selectOption(s.topicIds.moto);
    await expect(deck(page, 'Moto')).toHaveAttribute(
      'aria-label',
      'Mazzo Moto: 4 card, 0 da ripassare, 4 nuove',
      { timeout: 20_000 },
    );
    expect(await cardTopic(s, 'Sfusa due')).toBe(s.topicIds.moto);
  });

  test('Ordina automaticamente: in corso, poi i mazzi si aggiornano', async ({
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
    const cta = page.getByRole('button', { name: 'Ordina automaticamente' });
    await cta.click({ timeout: 30_000 });
    await expect(cta).toBeDisabled();
    await expect(page.getByTestId('sort-status')).toHaveText('Ordino le card…');
    release = true;
    await expect(page.getByTestId('sort-status')).toContainText(
      '2 card ordinate nei loro argomenti.',
      { timeout: 20_000 },
    );
    await expect(deck(page, 'Calore')).toHaveAttribute(
      'aria-label',
      'Mazzo Calore: 4 card, 1 da ripassare, 3 nuove',
      { timeout: 20_000 },
    );
  });

  test('Materia senza argomenti: niente CTA, messaggio con rimando al pannello Argomenti', async ({
    page,
    request,
    baseURL,
  }) => {
    test.setTimeout(90_000);
    s = await seedMazzi(request, baseURL!, { withTopics: false });
    await page.goto(`/materie/${s.slug}?tab=flashcard`);
    await expect(deck(page, 'Senza argomento')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('button', { name: 'Ordina automaticamente' })).toHaveCount(0);
    await expect(page.getByTestId('sort-status')).toContainText(
      'Questa materia non ha ancora argomenti.',
    );
    await expect(
      page.getByRole('button', { name: 'Apri il pannello Argomenti a sinistra' }),
    ).toBeVisible();
  });
});
