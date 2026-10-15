import { test, expect, type APIRequestContext, type Page } from '@playwright/test';

/**
 * Flusso materia mobile, slice 1 (docs/design/materia-mobile): header, sei tab, Panoramica e sheet
 * "Assistente" a 375×812. Gira solo nel progetto `mobile` (playwright.config.ts).
 */

test.use({ viewport: { width: 375, height: 812 } });

const TAB_LABELS = ['Panoramica', 'Materiale', 'Flashcard', 'Simulazioni', 'Lacune', 'Piano'];

async function seedSubject(request: APIRequestContext, baseURL: string) {
  const name = `E2E Materia ${Date.now()}`;
  const created = await request.post(`${baseURL}/api/subjects`, { data: { name, color: 'teal' } });
  const { subject } = await created.json();
  const slug: string = subject.slug;
  await request.post(`${baseURL}/api/subjects/${slug}/exams`, {
    data: {
      title: 'Scritto finale',
      kind: 'scritto',
      date: new Date(Date.now() + 21 * 86_400_000).toISOString(),
    },
  });
  const { deck } = await (
    await request.post(`${baseURL}/api/subjects/${slug}/decks`, { data: { title: 'Mazzo e2e' } })
  ).json();
  const { topic } = await (
    await request.post(`${baseURL}/api/subjects/${slug}/topics`, {
      data: { name: 'Argomento e2e' },
    })
  ).json();
  for (const i of [1, 2, 3]) {
    const res = await request.post(`${baseURL}/api/subjects/${slug}/flashcards`, {
      data: { deckId: deck.id, topicId: topic.id, front: `Domanda ${i}`, back: `Risposta ${i}` },
    });
    expect(res.status()).toBe(201);
  }
  return { name, slug };
}

async function open(page: Page, url: string, name: string) {
  await page.goto(url);
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible({ timeout: 20_000 });
}

const tabsNav = (page: Page) => page.getByRole('navigation', { name: 'Sezioni della materia' });

test.describe('Materia mobile — shell e Panoramica', () => {
  let ctx: { name: string; slug: string };

  test.beforeEach(async ({ request, baseURL }) => {
    ctx = await seedSubject(request, baseURL!);
  });

  test.afterEach(async ({ request, baseURL }) => {
    await request.delete(`${baseURL}/api/subjects/${ctx.slug}`);
  });

  test('Header e 6 tab, header globale nascosto, nessuno scroll orizzontale, bottom nav visibile', async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await open(page, `/materie/${ctx.slug}`, ctx.name);

    await expect(page.getByRole('link', { name: 'Torna a Materie' })).toHaveAttribute(
      'href',
      '/materie',
    );
    await expect(page.getByRole('button', { name: 'Cerca nella materia' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Azioni della materia' })).toBeVisible();

    const links = tabsNav(page).getByRole('link');
    await expect(links).toHaveText(TAB_LABELS);
    await expect(tabsNav(page).locator('[aria-current="page"]')).toHaveCount(1);
    await expect(tabsNav(page).getByRole('link', { name: 'Panoramica' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await expect(tabsNav(page).getByRole('link', { name: 'Piano' })).toHaveAttribute(
      'href',
      `/materie/${ctx.slug}/piano`,
    );

    // Header globale (brand "StudyHub") nascosto sotto md, bottom nav visibile.
    await expect(page.locator('header').filter({ hasText: 'StudyHub' })).toBeHidden();
    await expect(page.getByRole('navigation', { name: 'Navigazione principale' })).toBeVisible();

    // Nessuno scroll orizzontale della pagina: solo la riga dei tab può scorrere.
    const overflow = await page.evaluate(() => {
      const main = document.querySelector('main');
      return {
        document: document.documentElement.scrollWidth - window.innerWidth,
        main: main ? main.scrollWidth - main.clientWidth : 0,
      };
    });
    expect(overflow).toEqual({ document: 0, main: 0 });
  });

  test('Ogni tab è raggiungibile con aria-current corretto', async ({ page }) => {
    test.setTimeout(120_000);
    await open(page, `/materie/${ctx.slug}`, ctx.name);

    const cases: [string, string][] = [
      ['Materiale', 'materiale'],
      ['Flashcard', 'flashcard'],
      ['Simulazioni', 'simulazioni'],
      ['Lacune', 'lacune'],
    ];
    for (const [label, param] of cases) {
      await tabsNav(page).getByRole('link', { name: label }).click();
      await expect(page).toHaveURL(new RegExp(`tab=${param}`), { timeout: 20_000 });
      await expect(tabsNav(page).getByRole('link', { name: label })).toHaveAttribute(
        'aria-current',
        'page',
      );
      await expect(tabsNav(page).locator('[aria-current="page"]')).toHaveCount(1);
    }

    await tabsNav(page).getByRole('link', { name: 'Piano' }).click();
    await expect(page).toHaveURL(new RegExp(`/materie/${ctx.slug}/piano$`), { timeout: 20_000 });
  });

  test('?tab=appunti|schemi|esami|altro apre Materiale col filtro; ?tab=materiale apre Tutti', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const filterGroup = page.getByRole('group', { name: 'Filtra per tipo' });
    const expectations: [string, string][] = [
      ['materiale', 'Tutti'],
      ['appunti', 'Appunti'],
      ['schemi', 'Schemi'],
      ['esami', 'Esami'],
      ['altro', 'Altro'],
    ];
    for (const [param, chip] of expectations) {
      await open(page, `/materie/${ctx.slug}?tab=${param}`, ctx.name);
      await expect(tabsNav(page).getByRole('link', { name: 'Materiale' })).toHaveAttribute(
        'aria-current',
        'page',
      );
      await expect(
        filterGroup.getByRole('button', { name: new RegExp(`^${chip}( \\d+)?$`) }),
      ).toHaveAttribute('aria-pressed', 'true');
      await expect(filterGroup.locator('[aria-pressed="true"]')).toHaveCount(1);
    }

    // Valore sconosciuto → Panoramica.
    await open(page, `/materie/${ctx.slug}?tab=inesistente`, ctx.name);
    await expect(tabsNav(page).getByRole('link', { name: 'Panoramica' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  test('Panoramica: sezioni con dati reali e CTA verso ripasso e piano', async ({ page }) => {
    test.setTimeout(120_000);
    await open(page, `/materie/${ctx.slug}`, ctx.name);

    const status = page.getByRole('region', { name: 'Stato della materia' });
    await expect(status).toContainText('0 documenti');
    await expect(status).toContainText('1 argomenti');
    await expect(status).toContainText('3 flashcard');
    await expect(status).toContainText('Scritto');
    await expect(status.getByText('giorni all’esame')).toBeVisible();

    await expect(page.getByRole('heading', { level: 2, name: 'Da fare adesso' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: /^Oggi/ })).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: 'Attività recente' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Apri il piano', exact: true })).toHaveAttribute(
      'href',
      `/materie/${ctx.slug}/piano`,
    );

    // Nessun piano: "Studia ora" porta al piano.
    await expect(status.getByRole('link', { name: 'Studia ora' })).toHaveAttribute(
      'href',
      `/materie/${ctx.slug}/piano`,
    );
    await status.getByRole('link', { name: 'Studia ora' }).click();
    await expect(page).toHaveURL(new RegExp(`/materie/${ctx.slug}/piano$`), { timeout: 20_000 });

    // "Ripassa N card" porta al ripasso della materia.
    await open(page, `/materie/${ctx.slug}`, ctx.name);
    const review = page
      .getByRole('region', { name: 'Stato della materia' })
      .getByRole('link', { name: /^Ripassa \d+ card$/ });
    await expect(review).toHaveText('Ripassa 3 card');
    await review.click();
    await expect(page).toHaveURL(new RegExp(`/materie/${ctx.slug}/review$`), { timeout: 20_000 });
  });

  for (const [trigger, label] of [
    ['kebab', 'Azioni della materia'],
    ['FAB', 'Assistente'],
  ] as const) {
    test(`Sheet Assistente da ${trigger}: apertura, focus trap, chiusura con Esc, sfondo e Chiudi`, async ({
      page,
    }) => {
      test.setTimeout(90_000);
      await open(page, `/materie/${ctx.slug}`, ctx.name);
      const button = page.getByRole('button', { name: label, exact: true });
      const dialog = page.getByRole('dialog', { name: 'Assistente' });

      await button.click();
      await expect(dialog).toBeVisible();
      await expect(dialog.getByRole('button', { name: 'Chiudi' })).toBeFocused();
      await expect(dialog.getByRole('radiogroup', { name: 'Cosa generare' })).toBeVisible();
      await expect(dialog.getByRole('radio')).toHaveCount(3);

      // Focus intrappolato: dopo molti Tab resta dentro lo sheet.
      for (let i = 0; i < 12; i += 1) {
        await page.keyboard.press('Tab');
        expect(await dialog.evaluate((el) => el.contains(document.activeElement))).toBe(true);
      }
      await page.keyboard.press('Shift+Tab');
      expect(await dialog.evaluate((el) => el.contains(document.activeElement))).toBe(true);

      // Esc chiude e il focus torna al trigger.
      await page.keyboard.press('Escape');
      await expect(dialog).toHaveCount(0);

      // Click sullo sfondo chiude.
      await button.click();
      await expect(dialog).toBeVisible();
      await page.mouse.click(187, 60);
      await expect(dialog).toHaveCount(0);

      // Bottone Chiudi.
      await button.click();
      await dialog.getByRole('button', { name: 'Chiudi' }).click();
      await expect(dialog).toHaveCount(0);
    });
  }

  for (const [trigger, label] of [
    ['kebab', 'Azioni della materia'],
    ['FAB', 'Assistente'],
  ] as const) {
    test(`Sheet Assistente da ${trigger}: alla chiusura il focus torna al trigger`, async ({
      page,
    }) => {
      test.setTimeout(90_000);
      await open(page, `/materie/${ctx.slug}`, ctx.name);
      const button = page.getByRole('button', { name: label, exact: true });
      await button.click();
      await expect(page.getByRole('dialog', { name: 'Assistente' })).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await expect(button).toBeFocused();
    });
  }

  test('Sulle sottorotte della materia (es. /piano) l’header globale resta visibile', async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await page.goto(`/materie/${ctx.slug}/piano`);
    await expect(page.locator('header').filter({ hasText: 'StudyHub' })).toBeVisible({
      timeout: 20_000,
    });
  });

  test('Lo swipe-down sullo sheet lo chiude; uno spostamento corto lo fa rientrare', async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await open(page, `/materie/${ctx.slug}`, ctx.name);
    await page.getByRole('button', { name: 'Assistente', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Assistente' });
    await expect(dialog).toBeVisible();

    const dragFromTitle = async (dy: number) => {
      const box = (await dialog.getByRole('heading', { name: 'Assistente' }).boundingBox())!;
      const x = box.x + 20;
      const y = box.y + box.height / 2;
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.mouse.move(x, y + dy / 2, { steps: 5 });
      await page.mouse.move(x, y + dy, { steps: 5 });
      await page.mouse.up();
    };

    // Sotto la soglia (96px): lo sheet resta aperto.
    await dragFromTitle(30);
    await expect(dialog).toBeVisible();

    // Oltre la soglia: si chiude.
    await dragFromTitle(200);
    await expect(dialog).toHaveCount(0);
  });

  test('"Modifica materia" dallo sheet apre il dialog; alla chiusura il focus torna al kebab', async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await open(page, `/materie/${ctx.slug}`, ctx.name);
    const kebab = page.getByRole('button', { name: 'Azioni della materia' });
    await kebab.click();
    await page
      .getByRole('dialog', { name: 'Assistente' })
      .getByRole('button', { name: 'Modifica materia' })
      .click();

    const edit = page.getByRole('dialog', { name: 'Modifica materia' });
    await expect(edit).toBeVisible();
    await expect(page.getByRole('dialog', { name: 'Assistente' })).toHaveCount(0);

    await page.keyboard.press('Escape');
    await expect(edit).toHaveCount(0);
    await expect(kebab).toBeFocused();
  });

  test('Tile genera: selezione con le frecce e CTA coerente', async ({ page }) => {
    test.setTimeout(90_000);
    await open(page, `/materie/${ctx.slug}`, ctx.name);
    await page.getByRole('button', { name: 'Assistente', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Assistente' });

    await expect(dialog.getByRole('radio', { name: /Flashcard/ })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await dialog.getByRole('radio', { name: /Flashcard/ }).focus();
    await page.keyboard.press('ArrowRight');
    await expect(dialog.getByRole('radio', { name: /Riassunto/ })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await expect(dialog.getByRole('button', { name: /^Genera riassunto$/ })).toBeVisible();
  });
});
