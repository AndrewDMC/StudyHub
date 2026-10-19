import { test, expect, type Page } from '@playwright/test';
import { applySort, cardTopic, seedMazzi, type MazziSeed } from './fixtures/flashcard-mazzi-seed';

/**
 * Slice 1 "Mazzi per argomento" a 375×812, nella Panoramica ridisegnata: righe per argomento,
 * filtro (link alla vista Card), Ripassa, "Senza argomento", "Ordina con l'AI" e "Cambia argomento".
 * Il worker non gira negli e2e: il sort si simula intercettando POST/GET `flashcards/sort` e
 * aggiornando il DB al posto del processor.
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

const list = (page: Page) => page.getByRole('list', { name: 'Mazzi per argomento' });
/** Riga della Panoramica per argomento (`li` della lista "Mazzi per argomento"). */
const deck = (page: Page, name: string) =>
  list(page).getByRole('listitem').filter({ hasText: name });
/** Il bottone cambia nome mentre l'ordinamento è in corso. */
const sortButton = (page: Page) =>
  page.getByRole('button', { name: /^(Ordina con l'AI|Ordino…)$/ });
const row = (page: Page, front: string) =>
  page.getByRole('button', { name: new RegExp(`^${front}, `) });
const viewLink = (page: Page, name: string) =>
  page.getByRole('navigation', { name: 'Viste flashcard' }).getByRole('link', { name });

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

    test('Per argomento: Calore, Moto e Senza argomento ultimo, con i conteggi', async ({
      page,
    }) => {
      test.setTimeout(90_000);
      await page.goto(tabUrl());
      await expect(list(page)).toBeVisible({ timeout: 30_000 });
      const items = list(page).getByRole('listitem');
      await expect(items).toHaveCount(3);
      await expect(items.nth(0)).toContainText('Calore');
      await expect(items.nth(0)).toContainText('1 da ripassare');
      await expect(items.nth(1)).toContainText('Moto');
      await expect(items.nth(1)).toContainText('2 nuove');
      await expect(items.nth(2)).toContainText('Senza argomento');
      await expect(items.nth(2)).toContainText('2 card');
      // Target ≥ 44px: link dell'argomento e "Ripassa".
      for (const name of ['Calore', 'Moto']) {
        const link = await deck(page, name).getByRole('link').first().boundingBox();
        expect(link!.height).toBeGreaterThanOrEqual(44);
        const play = await page.getByRole('link', { name: `Ripassa ${name}` }).boundingBox();
        expect(play!.height).toBeGreaterThanOrEqual(44);
        expect(play!.width).toBeGreaterThanOrEqual(44);
      }
      await noHorizontalScroll(page);
    });

    test('Tap su un argomento apre la vista Card filtrata; "Azzera filtri" la ripristina', async ({
      page,
    }) => {
      test.setTimeout(90_000);
      await page.goto(tabUrl());
      await expect(deck(page, 'Moto')).toBeVisible({ timeout: 30_000 });
      await deck(page, 'Moto').getByRole('link').first().click();
      await expect(page).toHaveURL(new RegExp(`view=card.*argomento=${s.topicIds.moto}`));
      await expect(row(page, 'Velocita uno')).toBeVisible({ timeout: 20_000 });
      await expect(row(page, 'Entropia uno')).toHaveCount(0);
      await expect(row(page, 'Sfusa uno')).toHaveCount(0);
      const chips = page.getByRole('group', { name: 'Filtra per argomento' });
      await expect(chips.getByRole('button', { name: /^Moto/ })).toHaveAttribute(
        'aria-pressed',
        'true',
      );

      await page.getByRole('button', { name: 'Azzera filtri' }).click();
      await expect(row(page, 'Entropia uno')).toBeVisible({ timeout: 20_000 });
      await expect(row(page, 'Sfusa uno')).toBeVisible();
      await expect(page.getByRole('button', { name: 'Azzera filtri' })).toHaveCount(0);
    });

    test('"Vedi le card" di Senza argomento mostra le sole card sfuse', async ({ page }) => {
      test.setTimeout(90_000);
      await page.goto(tabUrl());
      await expect(deck(page, 'Senza argomento')).toBeVisible({ timeout: 30_000 });
      await deck(page, 'Senza argomento').getByRole('link', { name: 'Vedi le card' }).click();
      await expect(page).toHaveURL(/view=card.*argomento=none/);
      await expect(row(page, 'Sfusa uno')).toBeVisible({ timeout: 20_000 });
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

    test('Cambia argomento nel dettaglio card sposta la card e aggiorna i conteggi', async ({
      page,
    }) => {
      test.setTimeout(90_000);
      await page.goto(`${tabUrl()}&view=card`);
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
      expect(await cardTopic(s, 'Sfusa uno')).toBe(s.topicIds.moto);

      // La Panoramica riflette lo spostamento.
      await viewLink(page, 'Panoramica').click();
      await expect(deck(page, 'Moto')).toContainText('3 nuove', { timeout: 20_000 });
      await expect(deck(page, 'Senza argomento')).toContainText('1 card', { timeout: 20_000 });

      // Riporta la card senza argomento.
      await viewLink(page, 'Card').click();
      await row(page, 'Sfusa uno').click();
      await sheet.getByRole('button', { name: 'Cambia argomento' }).click();
      await group.getByRole('radio', { name: 'Senza argomento' }).click();
      await sheet.getByRole('button', { name: 'Salva' }).click();
      await expect(sheet).toHaveCount(0, { timeout: 20_000 });
      expect(await cardTopic(s, 'Sfusa uno')).toBeNull();
    });

    test("Ordina con l'AI: in corso (bottone disabilitato) poi gruppi aggiornati", async ({
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
      const cta = sortButton(page);
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
      await expect(deck(page, 'Calore')).toContainText('3 nuove', { timeout: 20_000 });
      await expect(deck(page, 'Moto')).toContainText('3 nuove');
      await noHorizontalScroll(page);
    });

    test("Ordina con l'AI: errore del POST mostra alert e Riprova", async ({ page }) => {
      test.setTimeout(90_000);
      await page.route('**/api/subjects/*/flashcards/sort', (route) =>
        route.request().method() === 'POST'
          ? route.fulfill({ status: 500, json: { error: { message: 'boom' } } })
          : route.continue(),
      );
      await page.goto(tabUrl());
      await sortButton(page).click({ timeout: 30_000 });
      await expect(
        page.getByRole('alert').filter({ hasText: 'Non sono riuscito a ordinare le card.' }),
      ).toBeVisible();
      await expect(page.getByRole('button', { name: 'Riprova' })).toBeEnabled();
    });

    test("Ordina con l'AI: job failed mostra l'errore e le card restano sfuse", async ({
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
      await sortButton(page).click({ timeout: 30_000 });
      await expect(
        page.getByRole('alert').filter({ hasText: 'Non sono riuscito a ordinare le card.' }),
      ).toBeVisible({ timeout: 20_000 });
      await expect(deck(page, 'Senza argomento')).toContainText('2 card');
    });

    test("Ordina con l'AI: un 409 si aggancia al job già in corso", async ({ page }) => {
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
      await sortButton(page).click({ timeout: 30_000 });
      await expect(page.getByTestId('sort-status')).toHaveText(RUNNING_TEXT, { timeout: 20_000 });
      await expect(sortButton(page)).toBeDisabled();
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
      await expect(sortButton(page)).toHaveCount(0);
      const status = page.getByTestId('sort-status');
      await expect(status).toContainText('Questa materia non ha ancora argomenti.');
      // Su mobile non c'è il pannello Argomenti: il rimando è al materiale (come prima del redesign).
      await expect(status.getByRole('link', { name: 'Vai al materiale' })).toBeVisible();
      await noHorizontalScroll(page);
    });
  });
});
