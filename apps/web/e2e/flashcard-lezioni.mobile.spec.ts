import { test, expect, type Page } from '@playwright/test';
import {
  CALORE_TITLE,
  MOTO_TITLE,
  deleteSubject,
  lezioniSessionUrl,
  seedLezioni,
  taskLinks,
  type LezioniSeed,
} from './fixtures/flashcard-lezioni-seed';

/**
 * Slice 2 "flashcard attaccate alle lezioni" a 375×812: badge sulla task, TaskSheet con sezione
 * Flashcard, stacca, picker "Attacca card…", blocco in sessione e /ripasso?task=. Il worker non
 * gira: piano, task e link si inseriscono via DB.
 */
test.use({ viewport: { width: 375, height: 812 } });

async function noHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBe(0);
}

const planUrl = (s: LezioniSeed) => `/materie/${s.slug}/piano`;
const caloreRow = (page: Page, meta = '') =>
  page.getByRole('button', {
    name: new RegExp(`^Lettura, ${CALORE_TITLE}, 45 min(?: · in corso)?${meta}`),
  });

test.describe('Flashcard delle lezioni — mobile', () => {
  let s: LezioniSeed;

  test.beforeEach(async ({ request, baseURL }) => {
    s = await seedLezioni(request, baseURL!);
  });
  test.afterEach(async ({ request, baseURL }) => {
    await deleteSubject(request, baseURL!, s.slug);
  });

  test('La riga della task mostra "N card" nel meta; senza card niente', async ({ page }) => {
    test.setTimeout(90_000);
    await page.goto(planUrl(s));
    await expect(caloreRow(page, ' · 2 card')).toBeVisible({ timeout: 30_000 });
    await expect(
      page.getByRole('button', { name: new RegExp(`^Lettura, ${MOTO_TITLE}, 30 min$`) }),
    ).toBeVisible();
    await noHorizontalScroll(page);
  });

  test('TaskSheet: sezione Flashcard con le card, "manuale" solo per le user, e stacca', async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await page.goto(planUrl(s));
    await caloreRow(page).click({ timeout: 30_000 });
    const sheet = page.getByRole('dialog');
    const section = sheet.getByTestId('task-flashcards');
    await expect(section.getByRole('heading', { name: 'Flashcard' })).toBeVisible({
      timeout: 20_000,
    });
    const rows = section.getByTestId('task-flashcard-row');
    await expect(rows).toHaveCount(2);
    await expect(rows.filter({ hasText: 'Entropia uno' })).toBeVisible();
    await expect(section.getByText('manuale')).toHaveCount(1);
    await expect(rows.filter({ hasText: 'Entropia due' }).getByText('manuale')).toBeVisible();
    // La sezione sta sopra le azioni di stato.
    const sectionBox = (await section.boundingBox())!;
    const doneBox = (await sheet.getByRole('button', { name: 'Segna come fatta' }).boundingBox())!;
    expect(sectionBox.y).toBeLessThan(doneBox.y);
    const stacca = section.getByRole('button', { name: /^Stacca: Entropia uno/ });
    const box = (await stacca.boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual(43.5);
    expect(box.height).toBeGreaterThanOrEqual(43.5);

    await stacca.click();
    await expect(rows).toHaveCount(1, { timeout: 20_000 });
    await expect(rows.filter({ hasText: 'Entropia uno' })).toHaveCount(0);
    expect(await taskLinks(s, s.taskIds.calore)).toEqual(['Entropia due:user']);

    // Chiusa la sheet, il conteggio nella riga e' sceso senza reload.
    await sheet.getByRole('button', { name: 'Chiudi' }).first().click();
    await expect(caloreRow(page, ' · 1 card')).toBeVisible({ timeout: 20_000 });
    await noHorizontalScroll(page);
  });

  test('Stato vuoto: la task Moto non ha card attaccate', async ({ page }) => {
    test.setTimeout(90_000);
    await page.goto(planUrl(s));
    await page
      .getByRole('button', { name: new RegExp(`^Lettura, ${MOTO_TITLE}`) })
      .click({ timeout: 30_000 });
    const sheet = page.getByRole('dialog');
    await expect(sheet.getByText('Nessuna flashcard attaccata a questa task.')).toBeVisible({
      timeout: 20_000,
    });
  });

  test('Attacca card…: picker con filtro argomento, già attaccate disabilitate, attacca aggiorna il conteggio', async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await page.goto(planUrl(s));
    await caloreRow(page).click({ timeout: 30_000 });
    const sheet = page.getByRole('dialog');
    await expect(sheet.getByTestId('task-flashcard-row')).toHaveCount(2, { timeout: 20_000 });
    await sheet.getByRole('button', { name: 'Attacca card…' }).click();

    const picker = sheet.getByTestId('attach-picker');
    await expect(picker).toBeVisible();
    // Filtro preselezionato sull'argomento della task (Calore): 3 card.
    const filter = picker.getByRole('combobox', { name: 'Filtra per argomento' });
    await expect(filter).toHaveValue(s.topicIds.calore);
    const checkbox = (name: string) => picker.getByRole('checkbox', { name: new RegExp(name) });
    await expect(checkbox('Entropia tre')).toBeVisible({ timeout: 20_000 });
    await expect(picker.getByTestId('attach-card-row')).toHaveCount(3);
    await expect(checkbox('Velocita uno')).toHaveCount(0);
    // Le gia' attaccate: checked + disabled + pill testuale.
    await expect(checkbox('Entropia uno')).toBeChecked();
    await expect(checkbox('Entropia uno')).toBeDisabled();
    await expect(picker.getByText('Già attaccata')).toHaveCount(2);
    await expect(picker.getByRole('button', { name: /^Attacca \(/ })).toBeDisabled();

    // Cambio filtro: la selezione sopravvive.
    await checkbox('Entropia tre').check();
    await filter.selectOption(s.topicIds.moto);
    await expect(checkbox('Velocita uno')).toBeVisible({ timeout: 20_000 });
    await expect(checkbox('Entropia tre')).toHaveCount(0);
    await checkbox('Velocita uno').check();
    await filter.selectOption(s.topicIds.calore);
    await expect(checkbox('Entropia tre')).toBeChecked({ timeout: 20_000 });
    const cta = picker.getByRole('button', { name: 'Attacca (2)' });
    await expect(cta).toBeEnabled();
    await noHorizontalScroll(page);
    const ctaBox = (await cta.boundingBox())!;
    expect(ctaBox.height).toBeGreaterThanOrEqual(43.5);

    await cta.click();
    const section = sheet.getByTestId('task-flashcards');
    await expect(section.getByTestId('task-flashcard-row')).toHaveCount(4, { timeout: 20_000 });
    await expect(sheet.getByTestId('attach-picker')).toHaveCount(0);
    await expect(section.getByText('manuale')).toHaveCount(3);
    expect(await taskLinks(s, s.taskIds.calore)).toEqual([
      'Entropia due:user',
      'Entropia tre:user',
      'Entropia uno:auto',
      'Velocita uno:user',
    ]);

    await sheet.getByRole('button', { name: 'Chiudi' }).first().click();
    await expect(caloreRow(page, ' · 4 card')).toBeVisible({ timeout: 20_000 });
  });

  test('Picker: la ricerca filtra per testo e "Indietro" torna al dettaglio', async ({ page }) => {
    test.setTimeout(90_000);
    await page.goto(planUrl(s));
    await caloreRow(page).click({ timeout: 30_000 });
    const sheet = page.getByRole('dialog');
    await sheet.getByRole('button', { name: 'Attacca card…' }).click({ timeout: 20_000 });
    const picker = sheet.getByTestId('attach-picker');
    await picker.getByRole('combobox', { name: 'Filtra per argomento' }).selectOption('all');
    await picker.getByRole('searchbox', { name: 'Cerca nelle card' }).fill('Velocita due');
    await expect(picker.getByTestId('attach-card-row')).toHaveCount(1, { timeout: 20_000 });
    await expect(picker.getByRole('checkbox', { name: /Velocita due/ })).toBeVisible();
    await sheet.getByRole('button', { name: 'Torna alla task' }).click();
    await expect(sheet.getByTestId('attach-picker')).toHaveCount(0);
    await expect(sheet.getByTestId('task-flashcards')).toBeVisible();
    expect(await taskLinks(s, s.taskIds.calore)).toHaveLength(2);
  });

  test('Sessione con taskId: blocco "Flashcard della lezione (2)" e link Ripassa con task=', async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await page.goto(lezioniSessionUrl(s));
    await page.getByRole('tab', { name: /Punti chiave/ }).click({ timeout: 30_000 });
    const block = page.getByTestId('session-lesson-cards');
    await expect(block.getByRole('heading', { name: 'Flashcard della lezione (2)' })).toBeVisible({
      timeout: 30_000,
    });
    const link = block.getByRole('link', { name: 'Ripassa le flashcard della lezione' });
    await expect(link).toHaveAttribute(
      'href',
      `/ripasso?materia=${s.slug}&task=${s.taskIds.calore}`,
    );
    const box = (await link.boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(43.5);
    await noHorizontalScroll(page);

    await link.click();
    await expect(page).toHaveURL(new RegExp(`/ripasso\\?.*task=${s.taskIds.calore}`), {
      timeout: 30_000,
    });
    // Solo le 2 card della lezione, non le 5 della materia.
    await expect(page.getByRole('dialog').locator('p.font-mono').first()).toHaveText('1 / 2', {
      timeout: 30_000,
    });
  });

  test('/ripasso?materia=&task= mostra solo le card della lezione', async ({ page }) => {
    test.setTimeout(90_000);
    await page.goto(`/ripasso?materia=${s.slug}&task=${s.taskIds.calore}`);
    const dialog = page.getByRole('dialog');
    await expect(dialog.locator('p.font-mono').first()).toHaveText('1 / 2', { timeout: 30_000 });
    await expect(dialog.getByText(/^Entropia (uno|due)$/).first()).toBeVisible();
    await expect(dialog.getByText(/Velocita|Entropia tre/)).toHaveCount(0);
  });

  test('Fine ripasso da /ripasso?task= aperto a freddo: "Torna alla lezione" porta al piano', async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await page.goto(`/ripasso?materia=${s.slug}&task=${s.taskIds.calore}`);
    const dialog = page.getByRole('dialog');
    await expect(dialog.locator('p.font-mono').first()).toHaveText('1 / 2', { timeout: 30_000 });
    for (const label of ['Bene', 'Bene']) {
      await dialog.getByRole('button', { name: 'Mostra risposta' }).click();
      await dialog.getByRole('button', { name: new RegExp(`^${label}, prossimo ripasso`) }).click();
    }
    await expect(dialog.getByRole('heading', { name: 'Sessione completata' })).toBeVisible({
      timeout: 20_000,
    });
    await dialog.getByRole('button', { name: 'Torna alla lezione' }).click();
    await expect(page).toHaveURL(new RegExp(`/materie/${s.slug}/piano$`), { timeout: 30_000 });
  });

  test('"Chiudi sessione" in corso da /ripasso?task= aperto a freddo porta al piano', async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await page.goto(`/ripasso?materia=${s.slug}&task=${s.taskIds.calore}`);
    const dialog = page.getByRole('dialog');
    await expect(dialog.locator('p.font-mono').first()).toHaveText('1 / 2', { timeout: 30_000 });
    await dialog.getByRole('button', { name: 'Mostra risposta' }).click();
    await dialog.getByRole('button', { name: /^Bene, prossimo ripasso/ }).click();
    await expect(dialog.locator('p.font-mono').first()).toHaveText('2 / 2');
    await dialog.getByRole('button', { name: 'Chiudi sessione' }).click();
    await expect(page).toHaveURL(new RegExp(`/materie/${s.slug}/piano$`), { timeout: 30_000 });
  });
});

test.describe('Flashcard delle lezioni — card non ripassabili (mobile)', () => {
  let s: LezioniSeed;

  test.beforeEach(async ({ request, baseURL }) => {
    s = await seedLezioni(request, baseURL!, { nonReviewable: true });
  });
  test.afterEach(async ({ request, baseURL }) => {
    await deleteSubject(request, baseURL!, s.slug);
  });

  test('La sheet dice perché le card sospese o in bozza non sono in ripasso; la sessione conta le sole ripassabili', async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await page.goto(planUrl(s));
    await caloreRow(page, ' · 4 card').click({ timeout: 30_000 });
    const section = page.getByRole('dialog').getByTestId('task-flashcards');
    await expect(section.getByTestId('task-flashcard-row')).toHaveCount(4, { timeout: 20_000 });
    const row = (front: string) =>
      section.getByTestId('task-flashcard-row').filter({ hasText: front });
    await expect(row('Bozza uno').getByText('Mazzo da approvare', { exact: true })).toBeVisible();
    await expect(row('Sospesa uno').getByText('Sospesa', { exact: true })).toBeVisible();
    await expect(row('Entropia uno').getByText('Mazzo da approvare', { exact: true })).toHaveCount(
      0,
    );
    await expect(row('Entropia uno').getByText('Sospesa', { exact: true })).toHaveCount(0);
    // The draft deck is one tap away from its approval screen.
    await expect(
      section.getByTestId('task-flashcards-drafts').getByRole('link', { name: 'Apri il mazzo' }),
    ).toHaveAttribute('href', new RegExp(`/materie/${s.slug}/artifacts/`));
    // "Ripassa" in the sheet counts and opens only the reviewable cards of the lesson.
    const review = section.getByTestId('task-flashcards-review');
    await expect(review).toHaveText('Ripassa (2)');
    await expect(review).toHaveAttribute(
      'href',
      `/ripasso?materia=${s.slug}&task=${s.taskIds.calore}`,
    );

    await page.goto(lezioniSessionUrl(s));
    await page.getByRole('tab', { name: /Punti chiave/ }).click({ timeout: 30_000 });
    await expect(
      page.getByTestId('session-lesson-cards').getByRole('heading', {
        name: 'Flashcard della lezione (2)',
      }),
    ).toBeVisible({ timeout: 30_000 });
  });
});
