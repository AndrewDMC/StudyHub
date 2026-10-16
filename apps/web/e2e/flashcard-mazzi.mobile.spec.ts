import { test, expect, type Page } from '@playwright/test';
import { applySort, cardTopic, seedMazzi, type MazziSeed } from './fixtures/flashcard-mazzi-seed';

/**
 * Slice 1 "Mazzi per argomento" a 375×812: sezione Mazzi, filtro, Ripassa, "Senza argomento",
 * "Ordina automaticamente" e "Cambia argomento". Il worker non gira negli e2e: il sort si simula
 * intercettando POST/GET `flashcards/sort` e aggiornando il DB al posto del processor.
 */
test.use({ viewport: { width: 375, height: 812 } });

const RUNNING_TEXT = 'Ordino le card…';

async function noHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => {
    const main = document.querySelector('main');
    return {
      document: document.documentElement.scrollWidth - window.innerWidth,
      main: main ? main.scrollWidth - main.clientWidth : 0,
    };
  });
  expect(overflow).toEqual({ document: 0, main: 0 });
}

const deck = (page: Page, name: string) =>
  page.getByRole('button', { name: new RegExp(`^Mazzo ${name}:`) });
const row = (page: Page, front: string) =>
  page.getByRole('button', { name: new RegExp(`^${front}, `) });

const OK_OUTPUT = {
  assigned: 2,
  assignedByDocument: 0,
  assignedByAi: 2,
  unassigned: 0,
  noTopics: false,
};

test.describe('Flashcard mobile — mazzi per argomento', () => {
  let s: MazziSeed;
  const tabUrl = () => `/materie/${s.slug}?tab=flashcard`;

  test.afterEach(async ({ request, baseURL }) => {
    await request.delete(`${baseURL}/api/subjects/${s.slug}`);
  });

  test.describe('con argomenti', () => {
    test.beforeEach(async ({ request, baseURL }) => {
      s = await seedMazzi(request, baseURL!);
    });

    test('Mazzi per argomento: Calore, Moto e Senza argomento ultimo, con i conteggi', async ({
      page,
    }) => {
      test.setTimeout(90_000);
      await page.goto(tabUrl());
      const list = page.getByRole('list', { name: 'Mazzi per argomento' });
      await expect(list).toBeVisible({ timeout: 30_000 });
      const labels = await list
        .getByRole('button', { name: /^Mazzo / })
        .evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')));
      expect(labels).toEqual([
        'Mazzo Calore: 3 card · 1 da ripassare · 2 nuove',
        'Mazzo Moto: 2 card · 0 da ripassare · 2 nuove',
        'Mazzo Senza argomento: 2 card · 0 da ripassare · 2 nuove',
      ]);
      for (const name of ['Calore', 'Moto', 'Senza argomento']) {
        const box = await deck(page, name).boundingBox();
        expect(box!.height).toBeGreaterThanOrEqual(44);
      }
      await noHorizontalScroll(page);
    });

    test('Tap su un mazzo filtra la lista e i chip; un secondo tap deseleziona', async ({
      page,
    }) => {
      test.setTimeout(90_000);
      await page.goto(tabUrl());
      await expect(row(page, 'Entropia uno')).toBeVisible({ timeout: 30_000 });
      await expect(row(page, 'Velocita uno')).toBeVisible();

      await deck(page, 'Moto').click();
      await expect(deck(page, 'Moto')).toHaveAttribute('aria-pressed', 'true');
      await expect(row(page, 'Velocita uno')).toBeVisible();
      await expect(row(page, 'Entropia uno')).toHaveCount(0);
      await expect(row(page, 'Sfusa uno')).toHaveCount(0);
      const chips = page.getByRole('group', { name: 'Filtra per argomento' });
      await expect(chips.getByRole('button', { name: /^Moto/ })).toHaveAttribute(
        'aria-pressed',
        'true',
      );

      await deck(page, 'Moto').click();
      await expect(deck(page, 'Moto')).toHaveAttribute('aria-pressed', 'false');
      await expect(row(page, 'Entropia uno')).toBeVisible();
      await expect(row(page, 'Sfusa uno')).toBeVisible();
    });

    test('Senza argomento filtra le sole card sfuse', async ({ page }) => {
      test.setTimeout(90_000);
      await page.goto(tabUrl());
      await expect(row(page, 'Entropia uno')).toBeVisible({ timeout: 30_000 });
      await deck(page, 'Senza argomento').click();
      await expect(deck(page, 'Senza argomento')).toHaveAttribute('aria-pressed', 'true');
      await expect(row(page, 'Sfusa uno')).toBeVisible();
      await expect(row(page, 'Sfusa due')).toBeVisible();
      await expect(row(page, 'Entropia uno')).toHaveCount(0);
      await expect(row(page, 'Velocita uno')).toHaveCount(0);
    });

    test('Ripassa porta a /ripasso con argomento; Senza argomento usa argomento=none', async ({
      page,
    }) => {
      test.setTimeout(90_000);
      await page.goto(tabUrl());
      await expect(deck(page, 'Calore')).toBeVisible({ timeout: 30_000 });
      await expect(page.getByRole('link', { name: 'Ripassa Calore' })).toHaveAttribute(
        'href',
        `/ripasso?materia=${s.slug}&argomento=${s.topicIds.calore}`,
      );
      await expect(page.getByRole('link', { name: 'Ripassa Moto' })).toHaveAttribute(
        'href',
        `/ripasso?materia=${s.slug}&argomento=${s.topicIds.moto}`,
      );
      await expect(page.getByRole('link', { name: 'Ripassa Senza argomento' })).toHaveAttribute(
        'href',
        `/ripasso?materia=${s.slug}&argomento=none`,
      );
      await page.getByRole('link', { name: 'Ripassa Moto' }).click();
      await expect(page).toHaveURL(/\/ripasso\?.*argomento=/, { timeout: 30_000 });
      await expect(page.getByRole('dialog').locator('p.font-mono').first()).toHaveText('1 / 2', {
        timeout: 30_000,
      });
    });

    test('Cambia argomento nel dettaglio card sposta la card e aggiorna i mazzi', async ({
      page,
    }) => {
      test.setTimeout(90_000);
      await page.goto(tabUrl());
      await row(page, 'Sfusa uno').click({ timeout: 30_000 });
      const sheet = page.getByRole('dialog', { name: 'Card' });
      await expect(sheet.getByText('Senza argomento').first()).toBeVisible();
      await sheet.getByRole('button', { name: 'Cambia argomento' }).click();
      const group = sheet.getByRole('radiogroup', { name: 'Argomento' });
      await expect(group.getByRole('radio', { name: 'Senza argomento' })).toHaveAttribute(
        'aria-checked',
        'true',
      );
      await group.getByRole('radio', { name: 'Moto' }).click();
      await sheet.getByRole('button', { name: 'Salva' }).click();
      await expect(sheet).toHaveCount(0, { timeout: 20_000 });

      await expect(deck(page, 'Moto')).toHaveAttribute(
        'aria-label',
        'Mazzo Moto: 3 card · 0 da ripassare · 3 nuove',
        { timeout: 20_000 },
      );
      await expect(deck(page, 'Senza argomento')).toHaveAttribute(
        'aria-label',
        'Mazzo Senza argomento: 1 card · 0 da ripassare · 1 nuove',
      );
      expect(await cardTopic(s, 'Sfusa uno')).toBe(s.topicIds.moto);

      // Riporta la card senza argomento.
      await row(page, 'Sfusa uno').click();
      await sheet.getByRole('button', { name: 'Cambia argomento' }).click();
      await group.getByRole('radio', { name: 'Senza argomento' }).click();
      await sheet.getByRole('button', { name: 'Salva' }).click();
      await expect(sheet).toHaveCount(0, { timeout: 20_000 });
      await expect(deck(page, 'Senza argomento')).toHaveAttribute(
        'aria-label',
        'Mazzo Senza argomento: 2 card · 0 da ripassare · 2 nuove',
        { timeout: 20_000 },
      );
      expect(await cardTopic(s, 'Sfusa uno')).toBeNull();
    });

    test('Ordina automaticamente: in corso (bottone disabilitato) poi gruppi aggiornati', async ({
      page,
    }) => {
      test.setTimeout(90_000);
      let release = false;
      await page.route('**/api/subjects/*/flashcards/sort', async (route) => {
        if (route.request().method() !== 'POST') return route.continue();
        await route.fulfill({ status: 202, json: { jobId: 'job-e2e' } });
      });
      await page.route('**/api/subjects/*/flashcards/sort/*', async (route) => {
        if (!release) return route.fulfill({ json: { status: 'running', output: null } });
        await applySort(s);
        await route.fulfill({ json: { status: 'succeeded', output: OK_OUTPUT } });
      });

      await page.goto(tabUrl());
      const cta = page.getByRole('button', { name: 'Ordina automaticamente' });
      await expect(cta).toBeVisible({ timeout: 30_000 });
      await cta.click();
      await expect(cta).toBeDisabled();
      await expect(cta).toHaveAttribute('aria-busy', 'true');
      const status = page.getByTestId('sort-status');
      await expect(status).toHaveText(RUNNING_TEXT);

      release = true;
      await expect(status).toContainText('2 card ordinate nei loro argomenti.', {
        timeout: 20_000,
      });
      await expect(deck(page, 'Calore')).toHaveAttribute(
        'aria-label',
        'Mazzo Calore: 4 card · 1 da ripassare · 3 nuove',
        { timeout: 20_000 },
      );
      await expect(deck(page, 'Moto')).toHaveAttribute(
        'aria-label',
        'Mazzo Moto: 3 card · 0 da ripassare · 3 nuove',
      );
      await noHorizontalScroll(page);
    });

    test('Ordina automaticamente: errore del POST mostra alert e Riprova', async ({ page }) => {
      test.setTimeout(90_000);
      await page.route('**/api/subjects/*/flashcards/sort', (route) =>
        route.request().method() === 'POST'
          ? route.fulfill({ status: 500, json: { error: { message: 'boom' } } })
          : route.continue(),
      );
      await page.goto(tabUrl());
      await page.getByRole('button', { name: 'Ordina automaticamente' }).click({ timeout: 30_000 });
      await expect(
        page.getByRole('alert').filter({ hasText: 'Non sono riuscito a ordinare le card.' }),
      ).toBeVisible();
      await expect(page.getByRole('button', { name: 'Riprova' })).toBeEnabled();
    });

    test('Ordina automaticamente: job failed mostra l errore e le card restano sfuse', async ({
      page,
    }) => {
      test.setTimeout(90_000);
      await page.route('**/api/subjects/*/flashcards/sort', (route) =>
        route.request().method() === 'POST'
          ? route.fulfill({ status: 202, json: { jobId: 'job-ko' } })
          : route.continue(),
      );
      await page.route('**/api/subjects/*/flashcards/sort/*', (route) =>
        route.fulfill({ json: { status: 'failed', output: null, error: 'x' } }),
      );
      await page.goto(tabUrl());
      await page.getByRole('button', { name: 'Ordina automaticamente' }).click({ timeout: 30_000 });
      await expect(
        page.getByRole('alert').filter({ hasText: 'Non sono riuscito a ordinare le card.' }),
      ).toBeVisible({ timeout: 20_000 });
      await expect(deck(page, 'Senza argomento')).toBeVisible();
    });

    test('Ordina automaticamente: un 409 si aggancia al job già in corso', async ({ page }) => {
      test.setTimeout(90_000);
      await page.route('**/api/subjects/*/flashcards/sort', (route) =>
        route.request().method() === 'POST'
          ? route.fulfill({
              status: 409,
              json: { error: { code: 'conflict', message: 'in corso', jobId: 'job-esistente' } },
            })
          : route.continue(),
      );
      await page.route('**/api/subjects/*/flashcards/sort/job-esistente', (route) =>
        route.fulfill({ json: { status: 'running', output: null } }),
      );
      await page.goto(tabUrl());
      await page.getByRole('button', { name: 'Ordina automaticamente' }).click({ timeout: 30_000 });
      await expect(page.getByTestId('sort-status')).toHaveText(RUNNING_TEXT, { timeout: 20_000 });
      await expect(page.getByRole('button', { name: 'Ordina automaticamente' })).toBeDisabled();
    });
  });

  test.describe('senza argomenti', () => {
    test.beforeEach(async ({ request, baseURL }) => {
      s = await seedMazzi(request, baseURL!, { withTopics: false });
    });

    test('Materia senza argomenti: niente CTA, messaggio e link al materiale', async ({ page }) => {
      test.setTimeout(90_000);
      await page.goto(tabUrl());
      await expect(deck(page, 'Senza argomento')).toBeVisible({ timeout: 30_000 });
      await expect(page.getByRole('button', { name: 'Ordina automaticamente' })).toHaveCount(0);
      const status = page.getByTestId('sort-status');
      await expect(status).toContainText('Questa materia non ha ancora argomenti.');
      await expect(status.getByRole('link', { name: 'Vai al materiale' })).toBeVisible();
      await noHorizontalScroll(page);
    });
  });
});
