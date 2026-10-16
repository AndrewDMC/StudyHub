import { test, expect, type Page } from '@playwright/test';
import {
  attemptsOf,
  markGraded,
  seedSimulations,
  type SimulationSeed,
} from './fixtures/simulazioni-seed';

/**
 * Slice 4 della materia mobile (docs/design/materia-mobile): tab Simulazioni, Esame e Risultati a
 * 375×812. Gira solo nel progetto `mobile` (playwright.config.ts).
 *
 * Simulazioni, profilo e un tentativo già corretto si inseriscono direttamente in Postgres. Il
 * worker non gira in e2e: dopo la consegna il tentativo resta `submitted` ("correzione in corso")
 * e il passaggio a `graded` è simulato via DB (`markGraded`), come farebbe il worker.
 */

test.use({ viewport: { width: 375, height: 812 } });

const tabUrl = (s: SimulationSeed) => `/materie/${s.slug}?tab=simulazioni`;
const row = (page: Page, title: string) =>
  page.getByTestId('simulation-row').filter({ hasText: title });

async function noHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => ({
    document: document.documentElement.scrollWidth - window.innerWidth,
  }));
  expect(overflow).toEqual({ document: 0 });
}

/** Controlli interattivi visibili più bassi di 44px (selettore, altezza). */
async function smallTargets(page: Page, scope: string) {
  return page.evaluate((sel) => {
    const root = document.querySelector(sel);
    if (!root) return ['(scope mancante)'];
    return Array.from(
      root.querySelectorAll<HTMLElement>('button, a[href], input, select, textarea'),
    )
      .filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';
      })
      .filter((el) => el.getBoundingClientRect().height < 43.5)
      .map(
        (el) =>
          `${el.tagName.toLowerCase()} "${(el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 40)}" ${Math.round(el.getBoundingClientRect().height)}px`,
      );
  }, scope);
}

test.describe('Materia mobile — Simulazioni, Esame e Risultati', () => {
  let s: SimulationSeed;

  test.beforeEach(async ({ request, baseURL }) => {
    s = await seedSimulations(request, baseURL!);
  });

  test.afterEach(async ({ request, baseURL }) => {
    await request.delete(`${baseURL}/api/subjects/${s.slug}`);
  });

  test('Tab Simulazioni: vista mobile con profilo, azioni, lista, senza scroll orizzontale e target da 44px', async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await page.goto(tabUrl(s));

    await expect(page.getByRole('heading', { name: "Profilo dell'esame" })).toBeVisible({
      timeout: 30_000,
    });
    const kv: [string, string][] = [
      ['Durata (min)', '180'],
      ['Esercizi', '6'],
      ['Punti totali', '30'],
      ['Min per esercizio', '30'],
    ];
    for (const [label, value] of kv) {
      await expect(page.getByText(label, { exact: true }).locator('xpath=..')).toContainText(value);
    }
    await expect(page.getByText('Estratto da 2 esami passati.')).toBeVisible();
    await expect(page.getByText('Integrali', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Nuova simulazione completa' })).toBeEnabled();
    await expect(page.getByRole('button', { name: /^Drill su un argomento/ })).toBeEnabled();
    await expect(page.getByRole('button', { name: 'Modifica', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Ri-estrai profilo' })).toBeVisible();

    await expect(page.getByTestId('simulation-row')).toHaveCount(2);
    await expect(row(page, 'Simulazione Alfa')).toContainText('Pronta · 3 esercizi · 30 min');
    await expect(row(page, 'Simulazione Beta')).toContainText('Corretta');
    await expect(row(page, 'Simulazione Beta')).toHaveAttribute('aria-haspopup', 'dialog');

    // È la vista mobile: nessun pannello desktop (select modello inline, "Simula esame").
    await expect(page.getByRole('button', { name: 'Simula esame' })).toHaveCount(0);

    await noHorizontalScroll(page);
    expect(await smallTargets(page, 'main')).toEqual([]);
  });

  test('Aprire la route esame crea un solo tentativo (anche con il doppio effect di StrictMode)', async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await page.goto(tabUrl(s));
    await row(page, 'Simulazione Alfa').click({ timeout: 30_000 });
    await page.getByRole('link', { name: 'Inizia la simulazione' }).click();
    await expect(page.getByRole('timer', { name: 'Tempo rimasto' })).toBeVisible({
      timeout: 30_000,
    });
    await page.waitForLoadState('networkidle');
    expect(await attemptsOf(s.fresh.id)).toHaveLength(1);
  });

  test('La riga apre lo sheet con le azioni giuste e non avvia nessun tentativo', async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await page.goto(tabUrl(s));

    await row(page, 'Simulazione Alfa').click({ timeout: 30_000 });
    let sheet = page.getByRole('dialog', { name: 'Simulazione Alfa' });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByRole('link', { name: 'Inizia la simulazione' })).toHaveAttribute(
      'href',
      `/materie/${s.slug}/simulations/${s.fresh.id}`,
    );
    await expect(sheet.getByRole('link', { name: 'Vedi la correzione' })).toHaveCount(0);
    expect(await smallTargets(page, '[role="dialog"]')).toEqual([]);
    await page.keyboard.press('Escape');
    await expect(sheet).toHaveCount(0);

    await row(page, 'Simulazione Beta').click();
    sheet = page.getByRole('dialog', { name: 'Simulazione Beta' });
    await expect(sheet.getByRole('link', { name: 'Rifai la simulazione' })).toBeVisible();
    await expect(sheet.getByRole('link', { name: 'Vedi la correzione' })).toHaveAttribute(
      'href',
      `/materie/${s.slug}/attempts/${s.done.attemptId}/results`,
    );

    // Aprire gli sheet non crea tentativi (la route esame lo farebbe).
    expect(await attemptsOf(s.fresh.id)).toHaveLength(0);
  });

  test('Esame: avvio, header/timer/chip, autosave dopo reload, navigazione, uscita con conferma e Riprendi', async ({
    page,
  }) => {
    test.setTimeout(150_000);
    await page.goto(tabUrl(s));
    await row(page, 'Simulazione Alfa').click({ timeout: 30_000 });
    await page.getByRole('link', { name: 'Inizia la simulazione' }).click();
    await expect(page).toHaveURL(new RegExp(`/simulations/${s.fresh.id}$`), { timeout: 30_000 });

    // Header proprio: X, titolo, timer, banner; header globale e tab bar nascosti.
    await expect(page.getByRole('timer', { name: 'Tempo rimasto' })).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByRole('timer', { name: 'Tempo rimasto' })).toHaveText(/\d{2}:\d{2}/);
    await expect(page.getByRole('heading', { level: 1, name: 'Simulazione Alfa' })).toBeVisible();
    await expect(page.getByText('Modalità esame · nessun aiuto disponibile')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Esci dalla simulazione' })).toBeVisible();
    await expect(page.locator('header').filter({ hasText: 'StudyHub' })).toBeHidden();
    await expect(page.getByRole('navigation', { name: 'Navigazione principale' })).toBeHidden();
    await noHorizontalScroll(page);
    expect(await smallTargets(page, 'main')).toEqual([]);
    expect(await smallTargets(page, 'footer')).toEqual([]);
    expect(await smallTargets(page, 'header')).toEqual([]);

    // Chip: 3 esercizi, il primo corrente e senza risposta.
    const strip = page.getByRole('group', { name: 'Esercizi' });
    await expect(strip.getByRole('button')).toHaveCount(3);
    const chip1 = strip.getByRole('button', { name: 'Esercizio 1, senza risposta, corrente' });
    await expect(chip1).toHaveAttribute('aria-current', 'true');
    await expect(page.getByText('Esercizio 1 di 3')).toBeVisible();

    // Risposta + autosave (debounce 1,5 s)
    await page.getByLabel('La tua risposta').fill('rendimento = 1 - Tc/Th');
    await expect(page.getByText(/^Salvato · \d{2}:\d{2}$/)).toBeVisible({ timeout: 15_000 });
    await expect(
      strip.getByRole('button', { name: 'Esercizio 1, con risposta, corrente' }),
    ).toBeVisible();

    // Reload: la risposta torna, il tempo residuo non riparte, nessun secondo tentativo.
    await page.reload();
    await expect(page.getByLabel('La tua risposta')).toHaveValue('rendimento = 1 - Tc/Th', {
      timeout: 30_000,
    });
    await expect(
      page
        .getByRole('group', { name: 'Esercizi' })
        .getByRole('button', { name: 'Esercizio 1, con risposta, corrente' }),
    ).toBeVisible();
    expect(await attemptsOf(s.fresh.id)).toHaveLength(1);

    // Navigazione: successivo, chip, precedente.
    await page.getByRole('button', { name: 'Esercizio successivo' }).click();
    await expect(page.getByText('Esercizio 2 di 3')).toBeVisible();
    await expect(
      strip.getByRole('button', { name: 'Esercizio 2, senza risposta, corrente' }),
    ).toHaveAttribute('aria-current', 'true');
    await expect(page.getByLabel('La tua risposta')).toHaveValue('');
    // dispatchEvent: in dev l'indicatore di Next.js (in basso a sinistra) copre questo bottone.
    await page.getByRole('button', { name: 'Esercizio precedente' }).dispatchEvent('click');
    await expect(page.getByText('Esercizio 1 di 3')).toBeVisible();
    await strip.getByRole('button', { name: 'Esercizio 3, senza risposta' }).click();
    await expect(page.getByText('Esercizio 3 di 3')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Consegna' })).toBeVisible();

    // Uscita con conferma: "Continua l'esame" chiude, "Esci" salva e torna alla tab.
    await page.getByRole('button', { name: 'Esci dalla simulazione' }).click();
    const exit = page.getByRole('dialog', { name: 'Uscire dalla simulazione?' });
    await expect(exit).toBeVisible();
    await expect(exit.getByRole('button', { name: "Continua l'esame" })).toBeFocused();
    await exit.getByRole('button', { name: "Continua l'esame" }).click();
    await expect(exit).toHaveCount(0);
    expect(new URL(page.url()).pathname).toContain('/simulations/');

    await page.getByRole('button', { name: 'Esci dalla simulazione' }).click();
    await exit.getByRole('button', { name: 'Esci' }).click();
    await expect(page).toHaveURL(new RegExp(`/materie/${s.slug}\\?tab=simulazioni`), {
      timeout: 30_000,
    });
    // Non consegnato: tentativo ancora aperto.
    const attempts = await attemptsOf(s.fresh.id);
    expect(attempts).toHaveLength(1);
    expect(attempts[0]!.status).toBe('in_progress');

    // "Riprendi": stessa riga, sheet con "Riprendi la simulazione", stesso tentativo e risposta.
    await expect(row(page, 'Simulazione Alfa')).toContainText('Riprendi', { timeout: 30_000 });
    await row(page, 'Simulazione Alfa').click();
    await page.getByRole('link', { name: 'Riprendi la simulazione' }).click();
    await expect(page.getByLabel('La tua risposta')).toHaveValue('rendimento = 1 - Tc/Th', {
      timeout: 30_000,
    });
    expect(await attemptsOf(s.fresh.id)).toHaveLength(1);
  });

  test('Consegna con conferma: Risultati con correzione in corso, poi punteggio e dettaglio; indietro torna alla tab', async ({
    page,
  }) => {
    test.setTimeout(150_000);
    await page.goto(tabUrl(s));
    await row(page, 'Simulazione Alfa').click({ timeout: 30_000 });
    await page.getByRole('link', { name: 'Inizia la simulazione' }).click();
    await expect(page.getByLabel('La tua risposta')).toBeVisible({ timeout: 30_000 });
    await page.getByLabel('La tua risposta').fill('una risposta');
    await expect(page.getByText(/^Salvato · \d{2}:\d{2}$/)).toBeVisible({ timeout: 15_000 });

    const strip = page.getByRole('group', { name: 'Esercizi' });
    await strip.getByRole('button', { name: /^Esercizio 3/ }).click();
    await page.getByRole('button', { name: 'Consegna' }).click();

    const sheet = page.getByRole('dialog', { name: "Consegnare l'esame?" });
    await expect(sheet).toContainText('Hai risposto a 1 esercizi su 3');
    await expect(sheet).toContainText('2 esercizi senza risposta');
    await expect(sheet.getByRole('button', { name: "Continua l'esame" })).toBeFocused();
    await sheet.getByRole('button', { name: "Continua l'esame" }).click();
    await expect(sheet).toHaveCount(0);
    expect(await attemptsOf(s.fresh.id)).toMatchObject([{ status: 'in_progress' }]);

    await page.getByRole('button', { name: 'Consegna' }).click();
    await sheet.getByRole('button', { name: 'Consegna' }).click();
    await expect(page).toHaveURL(/\/attempts\/[^/]+\/results$/, { timeout: 30_000 });
    const attemptId = page.url().split('/attempts/')[1]!.split('/')[0]!;

    // Header di sottopagina, tab bar visibile; il worker non gira: correzione in corso.
    await expect(
      page.getByRole('link', { name: 'Torna alle simulazioni' }).first(),
    ).toHaveAttribute('href', `/materie/${s.slug}?tab=simulazioni`);
    await expect(page.getByRole('navigation', { name: 'Navigazione principale' })).toBeVisible();
    const pending = page.getByText('Esame consegnato. La correzione è in corso…');
    const graded = page.getByTestId('attempt-score');
    await expect(pending.or(graded)).toBeVisible({ timeout: 30_000 });
    if (await pending.isVisible()) {
      await noHorizontalScroll(page);
      // Simula il worker: il polling (3 s) porta la pagina al punteggio.
      await markGraded(attemptId, s.fresh.itemIds.slice(0, 2), [4, 1]);
    }
    await expect(graded).toBeVisible({ timeout: 30_000 });

    await expect(graded).toContainText('5');
    await expect(page.getByText('1 esercizio sotto la metà')).toBeVisible();
    await expect(page.getByTestId('result-item')).toHaveCount(2);
    await noHorizontalScroll(page);

    // "Indietro" non rientra nell'esame (replace): torna alla tab.
    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`/materie/${s.slug}\\?tab=simulazioni`), {
      timeout: 30_000,
    });
    expect(await attemptsOf(s.fresh.id)).toHaveLength(1);
  });

  test('"Vedi la correzione" dalla lista: punteggio, accordion con dettaglio, drill e ritorno alla tab', async ({
    page,
  }) => {
    test.setTimeout(150_000);
    await page.goto(tabUrl(s));
    await row(page, 'Simulazione Beta').click({ timeout: 30_000 });
    await page.getByRole('link', { name: 'Vedi la correzione' }).click();
    await expect(page).toHaveURL(
      new RegExp(`/materie/${s.slug}/attempts/${s.done.attemptId}/results$`),
      { timeout: 30_000 },
    );

    await expect(page.getByTestId('attempt-score')).toContainText('6', { timeout: 30_000 });
    await expect(page.getByTestId('attempt-score')).toContainText('10');
    await expect(page.getByRole('heading', { level: 1, name: 'Simulazione Beta' })).toBeVisible();
    await expect(page.getByText('1 esercizio sotto la metà')).toBeVisible();

    const items = page.getByTestId('result-item');
    await expect(items).toHaveCount(2);
    const first = items.nth(0).getByRole('button', { expanded: false });
    const second = items.nth(1).locator('button[aria-expanded]');
    // Si apre da solo il primo esercizio sotto la metà (il 2°); accordion a uno aperto.
    await expect(second).toHaveAttribute('aria-expanded', 'true');
    const detail2 = page.getByRole('region', { name: 'Dettaglio esercizio 2' });
    await expect(detail2).toContainText('risposta due');
    await expect(detail2).toContainText('Feedback esercizio 2');
    await expect(detail2).toContainText('il passaggio finale');
    await expect(detail2).toContainText("Soluzione dell'esercizio 2");
    await expect(detail2).toContainText('pag. 3');
    await expect(detail2.getByRole('link', { name: 'Apri la fonte' })).toHaveAttribute(
      'href',
      /\/api\/subjects\/.+\/documents\/.+\/file#page=3/,
    );
    await expect(
      detail2.getByRole('button', { name: 'Chiedi una seconda opinione' }),
    ).toBeVisible();

    await first.click();
    await expect(items.nth(0).locator('button[aria-expanded]')).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    await expect(second).toHaveAttribute('aria-expanded', 'false');
    await expect(page.getByRole('region', { name: 'Dettaglio esercizio 1' })).toContainText(
      'risposta uno',
    );
    await noHorizontalScroll(page);
    expect(await smallTargets(page, 'main')).toEqual([]);

    // Un solo argomento debole: il drill parte direttamente.
    await page.getByRole('button', { name: 'Drill sugli errori' }).click();
    await expect(
      page.getByText('Drill in generazione — lo trovi nella tab Simulazioni.'),
    ).toBeVisible({ timeout: 30_000 });

    // Indietro all'elenco.
    await page.getByRole('link', { name: 'Torna alle simulazioni' }).first().click();
    await expect(page).toHaveURL(new RegExp(`/materie/${s.slug}\\?tab=simulazioni`), {
      timeout: 30_000,
    });
  });

  test('Seconda opinione: il bottone passa a "in corso" e si disabilita', async ({ page }) => {
    test.setTimeout(90_000);
    await page.goto(`/materie/${s.slug}/attempts/${s.done.attemptId}/results`);
    const detail = page.getByRole('region', { name: 'Dettaglio esercizio 2' });
    await detail.getByRole('button', { name: 'Chiedi una seconda opinione' }).click({
      timeout: 30_000,
    });
    // Il worker non gira: la richiesta resta in attesa.
    const pending = detail.getByRole('button', { name: 'Seconda opinione in corso…' });
    await expect(pending).toBeVisible({ timeout: 20_000 });
    await expect(pending).toBeDisabled();
  });

  test('Risultati senza argomenti deboli: nessun "Drill sugli errori"', async ({ page }) => {
    test.setTimeout(90_000);
    const { db } = await import('./fixtures/simulazioni-seed');
    const { simulationAttempts } = await import('@studyhub/db');
    const { eq } = await import('drizzle-orm');
    await db
      .update(simulationAttempts)
      .set({ weakTopics: [] })
      .where(eq(simulationAttempts.id, s.done.attemptId));
    await page.goto(`/materie/${s.slug}/attempts/${s.done.attemptId}/results`);
    await expect(page.getByTestId('attempt-score')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('button', { name: 'Drill sugli errori' })).toHaveCount(0);
  });
});
