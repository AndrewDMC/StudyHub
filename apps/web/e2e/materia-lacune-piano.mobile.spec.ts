import { randomUUID } from 'node:crypto';
import { test, expect, type Page } from '@playwright/test';
import { studyPlans, tasks } from '@studyhub/db';
import { eq } from 'drizzle-orm';
import {
  dayOffset,
  db,
  deleteSubject,
  planStatus,
  seedCoverage,
  seedEmptySubject,
  seedPlan,
  taskStatus,
  type CoverageSeed,
  type PlanSeed,
  type TopicKey,
} from './fixtures/lacune-piano-seed';

/**
 * Slice 5 della materia mobile (docs/design/materia-mobile): tab Lacune e pagina Piano a 375×812.
 * Gira solo nel progetto `mobile` (playwright.config.ts). Argomenti, piani e task si inseriscono
 * direttamente in Postgres/API; il worker non gira: la bozza generata si simula via DB.
 */

test.use({ viewport: { width: 375, height: 812 } });

async function noHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBe(0);
}

/** Controlli interattivi visibili più bassi di 44px. */
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

const FULL: TopicKey[] = ['termodinamica', 'entropia', 'ottica', 'cinematica'];

test.describe('Materia mobile — Lacune', () => {
  let slug: string | undefined;

  test.afterEach(async ({ request, baseURL }) => {
    if (slug) await deleteSubject(request, baseURL!, slug);
    slug = undefined;
  });

  const lacuneUrl = (s: CoverageSeed) => `/materie/${s.slug}?tab=lacune`;
  const cards = (page: Page) => page.getByTestId('coverage').getByRole('article');
  const card = (page: Page, name: string) =>
    page.getByRole('article').filter({ has: page.getByRole('heading', { name, exact: true }) });

  test('Vista mobile: card prioritaria con messaggio, filtri con conteggi, una card per argomento, niente scroll orizzontale e target da 44px', async ({
    page,
    request,
    baseURL,
  }) => {
    test.setTimeout(90_000);
    const seed = await seedCoverage(request, baseURL!, FULL);
    slug = seed.slug;
    await page.goto(lacuneUrl(seed));

    const priority = page.getByRole('region', { name: 'Cinematica' });
    await expect(priority).toBeVisible({ timeout: 30_000 });
    await expect(priority).toContainText('Da colmare per primo');
    await expect(priority).toContainText('Non hai materiale su "Cinematica"');
    await expect(priority).toContainText('Mastery non ancora calcolata');

    const filters = page.getByRole('group', { name: 'Filtra le lacune' });
    await expect(filters.getByRole('button', { name: /^Tutte\s*4$/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(filters.getByRole('button', { name: /^Deboli\s*2$/ })).toBeVisible();
    await expect(filters.getByRole('button', { name: /^Senza flashcard\s*2$/ })).toBeVisible();
    await expect(filters.getByRole('button', { name: /^Senza materiale\s*1$/ })).toBeVisible();

    await expect(cards(page)).toHaveCount(4);
    // Ordinati per priorità decrescente: Cinematica, Termodinamica, Entropia, Ottica.
    await expect(cards(page).locator('h3')).toHaveText([
      'Cinematica',
      'Termodinamica',
      'Entropia',
      'Ottica',
    ]);
    await expect(card(page, 'Ottica')).toContainText('In regola');
    await expect(card(page, 'Termodinamica')).toContainText('Debole');
    await expect(card(page, 'Termodinamica')).toContainText('Senza flashcard');
    await expect(card(page, 'Entropia')).toContainText('30%');
    await expect(card(page, 'Termodinamica').locator('dd').nth(2)).toHaveText('20%');

    // Vista mobile, non la tabella desktop.
    await expect(page.getByRole('columnheader', { name: 'Argomento' })).toHaveCount(0);

    await noHorizontalScroll(page);
    expect(await smallTargets(page, 'main')).toEqual([]);
  });

  test('Filtri: aria-pressed, un solo chip attivo e conteggi uguali alle card visibili', async ({
    page,
    request,
    baseURL,
  }) => {
    test.setTimeout(90_000);
    const seed = await seedCoverage(request, baseURL!, FULL);
    slug = seed.slug;
    await page.goto(lacuneUrl(seed));
    const filters = page.getByRole('group', { name: 'Filtra le lacune' });
    await expect(cards(page)).toHaveCount(4, { timeout: 30_000 });

    const cases: [RegExp, string[]][] = [
      [/^Deboli\s*2$/, ['Termodinamica', 'Entropia']],
      [/^Senza flashcard\s*2$/, ['Cinematica', 'Termodinamica']],
      [/^Senza materiale\s*1$/, ['Cinematica']],
    ];
    for (const [name, expected] of cases) {
      const chip = filters.getByRole('button', { name });
      await chip.click();
      await expect(chip).toHaveAttribute('aria-pressed', 'true');
      await expect(filters.getByRole('button', { pressed: true })).toHaveCount(1);
      await expect(cards(page)).toHaveCount(expected.length);
      await expect(cards(page).locator('h3')).toHaveText(expected);
    }

    const all = filters.getByRole('button', { name: /^Tutte\s*4$/ });
    await all.click();
    await expect(all).toHaveAttribute('aria-pressed', 'true');
    await expect(cards(page)).toHaveCount(4);
    await noHorizontalScroll(page);
  });

  test('CTA: Carica materiale → tab Materiale; Ripassa le card → /ripasso con argomento e sessione che parte', async ({
    page,
    request,
    baseURL,
  }) => {
    test.setTimeout(120_000);
    const seed = await seedCoverage(request, baseURL!, FULL);
    slug = seed.slug;
    await page.goto(lacuneUrl(seed));
    await expect(cards(page)).toHaveCount(4, { timeout: 30_000 });

    await expect(
      card(page, 'Cinematica').getByRole('link', { name: 'Carica materiale' }),
    ).toHaveAttribute('href', `/materie/${seed.slug}?tab=materiale`);
    const review = card(page, 'Entropia').getByRole('link', { name: /^Ripassa \d+ card$/ });
    await expect(review).toHaveAttribute(
      'href',
      `/ripasso?materia=${seed.slug}&argomento=${seed.topicIds.entropia}`,
    );
    // "In regola" ha card: l'azione è ancora il ripasso; la card Termodinamica ha il bottone sheet.
    await expect(
      card(page, 'Ottica').getByRole('link', { name: /^Ripassa \d+ card$/ }),
    ).toHaveAttribute('href', `/ripasso?materia=${seed.slug}&argomento=${seed.topicIds.ottica}`);

    await review.click();
    await expect(page).toHaveURL(
      new RegExp(`/ripasso\\?materia=${seed.slug}&argomento=${seed.topicIds.entropia}`),
      { timeout: 30_000 },
    );
    // Il deep link apre direttamente la sessione sulle 2 card dell'argomento.
    const session = page.getByRole('dialog');
    await expect(session.locator('p.font-mono').first()).toHaveText('1 / 2', { timeout: 30_000 });
    await expect(session.getByText('Entropia domanda').first()).toBeVisible();

    // Caricare materiale arriva sul tab Materiale.
    await page.goto(lacuneUrl(seed));
    await card(page, 'Cinematica').getByRole('link', { name: 'Carica materiale' }).click();
    await expect(page).toHaveURL(new RegExp(`/materie/${seed.slug}\\?tab=materiale`), {
      timeout: 30_000,
    });
  });

  test('"Genera flashcard" apre lo sheet con stima e avvia il job', async ({
    page,
    request,
    baseURL,
  }) => {
    test.setTimeout(90_000);
    const seed = await seedCoverage(request, baseURL!, FULL);
    slug = seed.slug;
    await page.goto(lacuneUrl(seed));
    await expect(cards(page)).toHaveCount(4, { timeout: 30_000 });

    // Termodinamica: senza flashcard, con materiale. (Cinematica ha "Carica materiale".)
    await card(page, 'Termodinamica').getByRole('button', { name: 'Genera flashcard' }).click();
    const sheet = page.getByRole('dialog', { name: 'Genera flashcard' });
    await expect(sheet).toBeVisible();
    await expect(sheet).toContainText('Argomento: Termodinamica');
    await expect(sheet).toContainText(/Costo stimato|Stima costo non disponibile/, {
      timeout: 20_000,
    });
    expect(await smallTargets(page, '[role="dialog"]')).toEqual([]);

    await sheet.getByRole('button', { name: 'Genera flashcard' }).click();
    const status = sheet.getByRole('status');
    await expect(status).toContainText('Job avviato', { timeout: 20_000 });
    await expect(status.getByRole('link', { name: 'Vai alle flashcard' })).toHaveAttribute(
      'href',
      `/materie/${seed.slug}?tab=flashcard`,
    );
  });

  test('"Fai un drill" apre lo sheet con l’argomento preselezionato e, dopo la POST, mostra il messaggio con link alle simulazioni', async ({
    page,
    request,
    baseURL,
  }) => {
    test.setTimeout(90_000);
    // Senza Cinematica la priorità massima è Termodinamica (materiale presente): primario = drill.
    const seed = await seedCoverage(request, baseURL!, ['termodinamica', 'entropia', 'ottica']);
    slug = seed.slug;
    await page.goto(lacuneUrl(seed));

    const priority = page.getByRole('region', { name: 'Termodinamica' });
    await expect(priority).toBeVisible({ timeout: 30_000 });
    await priority.getByRole('button', { name: 'Fai un drill' }).click();

    const sheet = page.getByRole('dialog', { name: 'Drill su un argomento' });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByLabel('Argomento')).toHaveValue(seed.topicIds.termodinamica!);
    expect(await smallTargets(page, '[role="dialog"]')).toEqual([]);

    await sheet.getByRole('button', { name: 'Genera', exact: true }).click();
    await expect(sheet).toHaveCount(0, { timeout: 30_000 });
    const status = page
      .getByRole('status')
      .filter({ hasText: 'Drill in generazione — lo trovi nella tab Simulazioni.' });
    await expect(status).toBeVisible();
    await expect(status.getByRole('link', { name: 'Vai alle simulazioni' })).toHaveAttribute(
      'href',
      `/materie/${seed.slug}?tab=simulazioni`,
    );
    await noHorizontalScroll(page);

    // Riaprendo da un'altra card lo sheet non conserva la scelta precedente.
    await page.keyboard.press('Escape');
  });

  test('Nessuna lacuna: card verde, filtri e pill "In regola"', async ({
    page,
    request,
    baseURL,
  }) => {
    test.setTimeout(90_000);
    const seed = await seedCoverage(request, baseURL!, ['ottica']);
    slug = seed.slug;
    await page.goto(lacuneUrl(seed));
    await expect(
      page.getByText(
        'Nessuna lacuna: ogni argomento ha materiale, flashcard e una mastery non bassa.',
      ),
    ).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText('Da colmare per primo')).toHaveCount(0);
    await expect(card(page, 'Ottica')).toContainText('In regola');

    // Filtro senza risultati.
    await page.getByRole('button', { name: /^Deboli\s*0$/ }).click();
    await expect(page.getByText('Nessun argomento in questa categoria.')).toBeVisible();
    await noHorizontalScroll(page);
  });

  test('Nessun argomento: stato vuoto con link al materiale', async ({
    page,
    request,
    baseURL,
  }) => {
    test.setTimeout(90_000);
    const seed = await seedEmptySubject(request, baseURL!);
    slug = seed.slug;
    await page.goto(`/materie/${seed.slug}?tab=lacune`);
    await expect(page.getByText(/Nessun argomento ancora/)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('link', { name: 'Vai al materiale' })).toHaveAttribute(
      'href',
      `/materie/${seed.slug}?tab=materiale`,
    );
  });

  test('Errore di caricamento: "Riprova" richiama la mappa', async ({ page, request, baseURL }) => {
    test.setTimeout(90_000);
    const seed = await seedCoverage(request, baseURL!, ['ottica']);
    slug = seed.slug;
    let fail = true;
    await page.route(`**/api/subjects/${seed.slug}/coverage`, async (route) => {
      if (fail) {
        await route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ error: { message: 'Caricamento fallito' } }),
        });
      } else await route.continue();
    });
    await page.goto(lacuneUrl(seed));
    await expect(page.getByText('Caricamento fallito')).toBeVisible({ timeout: 30_000 });
    fail = false;
    await page.getByRole('button', { name: 'Riprova' }).click();
    await expect(card(page, 'Ottica')).toBeVisible({ timeout: 20_000 });
  });
});

test.describe('Materia mobile — Piano', () => {
  let slug: string | undefined;

  test.afterEach(async ({ request, baseURL }) => {
    if (slug) await deleteSubject(request, baseURL!, slug);
    slug = undefined;
  });

  const pianoUrl = (s: { slug: string }) => `/materie/${s.slug}/piano`;

  /** Piano attivo: 1 task in ritardo, 3 oggi (una già fatta), 1 domani, 1 riposo. */
  const activeTasks = [
    { offset: -2, title: 'Capitolo arretrato di termodinamica' },
    {
      offset: 0,
      title:
        'Studia le macchine termiche con un titolo davvero molto molto lungo per vedere se va a capo',
    },
    { offset: 0, kind: 'flashcards' as const, title: 'Flashcard di oggi', minutes: 30 },
    { offset: 0, title: 'Già fatta oggi', minutes: 20, status: 'done' as const },
    { offset: 1, kind: 'simulation' as const, title: 'Simulazione di domani', minutes: 90 },
    { offset: 2, kind: 'rest' as const, title: 'Riposo', minutes: 0 },
  ];

  async function seedActive(
    request: Parameters<typeof seedPlan>[0],
    baseURL: string,
  ): Promise<PlanSeed> {
    return seedPlan(request, baseURL, {
      status: 'active',
      tasks: activeTasks,
      targetOffset: 10,
      examTitle: 'Scritto di fisica',
    });
  }

  test('Piano attivo: header, tab, riepilogo, giorni e task di oggi; nessuno scroll orizzontale e target da 44px', async ({
    page,
    request,
    baseURL,
  }) => {
    test.setTimeout(90_000);
    const seed = await seedActive(request, baseURL!);
    slug = seed.slug;
    await page.goto(pianoUrl(seed));

    await expect(page.getByRole('heading', { name: 'Piano di studio', level: 2 })).toBeVisible({
      timeout: 30_000,
    });
    // Header proprio: indietro, nome materia, tab "Piano" corrente; header globale nascosto.
    await expect(page.getByRole('link', { name: 'Torna alla materia' })).toHaveAttribute(
      'href',
      `/materie/${seed.slug}`,
    );
    await expect(page.getByRole('heading', { level: 1 })).toContainText('E2E Piano');
    await expect(page.getByRole('link', { name: 'Piano', exact: true })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await expect(page.locator('header').filter({ hasText: 'StudyHub' })).toBeHidden();
    await expect(page.getByRole('navigation', { name: 'Navigazione principale' })).toBeVisible();

    const summary = page.getByRole('region', { name: 'Piano di studio' });
    await expect(summary).toContainText('Attivo');
    await expect(summary).toContainText('Fino al');
    await expect(summary.getByLabel('1 task completate su 5')).toHaveText('1 / 5 task');
    const bar = summary.getByRole('progressbar', { name: 'Avanzamento del piano' });
    await expect(bar).toHaveAttribute('aria-valuenow', '1');
    await expect(bar).toHaveAttribute('aria-valuemax', '5');
    await expect(summary).toContainText('Standard');
    await expect(summary).toContainText('~80');

    // Giorni: oggi selezionato e un solo giorno in ritardo.
    const days = page.getByRole('group', { name: 'Giorni del piano' });
    const today = days.getByRole('button', { pressed: true });
    await expect(today).toHaveAttribute('aria-current', 'date');
    await expect(today).toHaveAccessibleName('Oggi, 3 task');
    await expect(days.getByRole('button', { name: /in ritardo$/ })).toHaveCount(1);

    await expect(page.getByRole('heading', { name: 'Oggi', level: 2 })).toBeVisible();
    await expect(page.getByRole('checkbox', { name: /^Segna come fatta:/ })).toHaveCount(3);
    await expect(
      page.getByRole('button', { name: /^Lettura, Studia le macchine termiche/ }),
    ).toHaveAttribute('aria-haspopup', 'dialog');
    await expect(
      page.getByRole('button', { name: /^Flashcard, Flashcard di oggi, 30 min/ }),
    ).toBeVisible();
    await expect(
      page.getByRole('checkbox', { name: 'Segna come fatta: Già fatta oggi' }),
    ).toHaveAttribute('aria-checked', 'true');

    await noHorizontalScroll(page);
    expect(await smallTargets(page, 'main')).toEqual([]);
    expect(await smallTargets(page, 'header')).toEqual([]);
  });

  test('Segnare una task fatta aggiorna riga, contatore e barra (e il DB)', async ({
    page,
    request,
    baseURL,
  }) => {
    test.setTimeout(90_000);
    const seed = await seedActive(request, baseURL!);
    slug = seed.slug;
    await page.goto(pianoUrl(seed));
    const summary = page.getByRole('region', { name: 'Piano di studio' });
    await expect(summary.getByLabel('1 task completate su 5')).toBeVisible({ timeout: 30_000 });

    const check = page.getByRole('checkbox', { name: 'Segna come fatta: Flashcard di oggi' });
    await expect(check).toHaveAttribute('aria-checked', 'false');
    await check.click();
    await expect(check).toHaveAttribute('aria-checked', 'true');
    await expect(summary.getByLabel('2 task completate su 5')).toHaveText('2 / 5 task');
    await expect(summary.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '2');
    await expect(
      page.getByRole('button', { name: /^Flashcard, Flashcard di oggi, 30 min · fatto/ }),
    ).toBeVisible();
    expect((await taskStatus(seed.taskIds[2]!))?.status).toBe('done');

    // Anche dopo il reload.
    await page.reload();
    await expect(
      page.getByRole('region', { name: 'Piano di studio' }).getByLabel('2 task completate su 5'),
    ).toBeVisible({
      timeout: 30_000,
    });
  });

  test('Task in ritardo: la card segnala 1 task e "Riassorbi" la porta a oggi o dopo', async ({
    page,
    request,
    baseURL,
  }) => {
    test.setTimeout(90_000);
    const seed = await seedActive(request, baseURL!);
    slug = seed.slug;
    await page.goto(pianoUrl(seed));
    const drift = page.getByRole('status').filter({ hasText: 'Sei indietro di 1 task' });
    await expect(drift).toBeVisible({ timeout: 30_000 });
    await noHorizontalScroll(page);

    await drift.getByRole('button', { name: 'Riassorbi' }).click();
    await expect(drift).toHaveCount(0, { timeout: 20_000 });
    const moved = await taskStatus(seed.taskIds[0]!);
    expect(moved?.date && moved.date >= dayOffset(0)).toBe(true);
  });

  test('Il testo della riga apre lo sheet; "Segna come fatta" dallo sheet funziona', async ({
    page,
    request,
    baseURL,
  }) => {
    test.setTimeout(90_000);
    const seed = await seedActive(request, baseURL!);
    slug = seed.slug;
    await page.goto(pianoUrl(seed));
    await page
      .getByRole('button', { name: /^Flashcard, Flashcard di oggi/ })
      .click({ timeout: 30_000 });
    const sheet = page.getByRole('dialog', { name: 'Flashcard di oggi' });
    await expect(sheet).toBeVisible();
    await expect(sheet).toContainText('Dettaglio: Flashcard di oggi');
    for (const name of ['Segna come fatta', 'Salta', 'Sposta di 1 giorno']) {
      await expect(sheet.getByRole('button', { name })).toBeVisible();
    }
    expect(await smallTargets(page, '[role="dialog"]')).toEqual([]);
    await sheet.getByRole('button', { name: 'Segna come fatta' }).click();
    await expect(sheet).toHaveCount(0, { timeout: 20_000 });
    expect((await taskStatus(seed.taskIds[2]!))?.status).toBe('done');
  });

  test('Indietro torna alla materia e i tab portano alle altre schede', async ({
    page,
    request,
    baseURL,
  }) => {
    test.setTimeout(90_000);
    const seed = await seedActive(request, baseURL!);
    slug = seed.slug;
    await page.goto(pianoUrl(seed));
    await page.getByRole('link', { name: 'Lacune', exact: true }).click({ timeout: 30_000 });
    await expect(page).toHaveURL(new RegExp(`/materie/${seed.slug}\\?tab=lacune`), {
      timeout: 30_000,
    });

    await page.goto(pianoUrl(seed));
    await page.getByRole('link', { name: 'Torna alla materia' }).click({ timeout: 30_000 });
    await expect(page).toHaveURL(new RegExp(`/materie/${seed.slug}$`), { timeout: 30_000 });
  });

  test('Nessun piano: stato vuoto, sheet di generazione, attesa della bozza e conferma', async ({
    page,
    request,
    baseURL,
  }) => {
    test.setTimeout(150_000);
    const seed = await seedEmptySubject(request, baseURL!);
    slug = seed.slug;
    await page.goto(pianoUrl(seed));
    await expect(page.getByText('Non hai ancora un piano di studio.')).toBeVisible({
      timeout: 30_000,
    });
    await noHorizontalScroll(page);
    await page.getByRole('button', { name: 'Genera il piano' }).click();

    const sheet = page.getByRole('dialog', { name: 'Genera il piano' });
    await expect(sheet).toBeVisible();
    await sheet.getByLabel('Data esame').fill(dayOffset(14));
    const rhythm = sheet.getByRole('group', { name: 'Ritmo del piano' });
    await rhythm.getByRole('button', { name: 'Sprint' }).click();
    await expect(rhythm.getByRole('button', { name: 'Sprint' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(rhythm.getByRole('button', { name: 'Standard' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    await sheet.getByLabel('Minuti al giorno').fill('120');
    expect(await smallTargets(page, '[role="dialog"]')).toEqual([]);

    // L'anteprima gratuita risponde sempre (fattibile, non fattibile o non disponibile).
    await expect(sheet.getByRole('status')).toContainText(
      /Tempo sufficiente|Tempo insufficiente|Anteprima non disponibile/,
      { timeout: 20_000 },
    );

    await sheet.getByRole('button', { name: 'Genera bozza' }).click();
    await expect(page.getByText('Generazione in corso — la bozza appare a breve.')).toBeVisible({
      timeout: 30_000,
    });

    // Il worker non gira: simula la bozza che compare.
    const planId = randomUUID();
    await db.insert(studyPlans).values({
      id: planId,
      subjectId: seed.subjectId,
      status: 'draft',
      startDate: dayOffset(0),
      targetDate: dayOffset(14),
      availability: { perWeekday: [120, 120, 120, 120, 120, 120, 120], blackoutDates: [] },
      prefs: {
        sessionLength: 50,
        intensity: 'sprint',
        simulationCount: 'auto',
        simulationMinutes: 90,
        reviewMinutesPerCard: 0.5,
      },
      feasibility: {
        feasible: true,
        requiredMinutes: 0,
        availableMinutes: 0,
        shortfallMinutes: 0,
        unscheduledTopicKeys: [],
        strategies: [],
      },
      warnings: [],
      model: 'fake-v1',
      promptVersion: 'estimate_topics/v1',
    });
    await db.insert(tasks).values({
      id: randomUUID(),
      subjectId: seed.subjectId,
      planId,
      taskKey: 'read:e2e:000',
      date: dayOffset(1),
      kind: 'read',
      minutes: 45,
      title: 'Studia Termodinamica',
      description: '',
      payload: { action: 'read' },
      status: 'proposed',
    });

    await expect(page.getByRole('button', { name: 'Conferma piano' })).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByRole('button', { name: 'Scarta bozza' })).toBeVisible();
    await expect(page.getByText('Generazione in corso')).toHaveCount(0);
    await noHorizontalScroll(page);
  });

  test('Bozza: "Conferma piano" la rende attiva; Fissa/Sblocca ed Escludi un argomento funzionano', async ({
    page,
    request,
    baseURL,
  }) => {
    test.setTimeout(120_000);
    const seed = await seedPlan(request, baseURL!, {
      status: 'draft',
      targetOffset: 10,
      tasks: [
        { offset: 1, title: 'Studia Termodinamica — cap. 1', topicKey: 'doc-a' },
        { offset: 2, title: 'Studia Ottica — cap. 2', topicKey: 'doc-b' },
        { offset: 3, title: 'Simulazione finale', kind: 'simulation', minutes: 90 },
      ],
    });
    slug = seed.slug;
    await page.goto(pianoUrl(seed));

    const summary = page.getByRole('region', { name: 'Piano di studio' });
    await expect(summary).toContainText('Bozza', { timeout: 30_000 });
    await expect(summary).toContainText('3 task proposte');
    await expect(page.getByText('Bozza — non ancora nel calendario')).toBeVisible();
    // In bozza niente checkbox.
    await expect(page.getByRole('checkbox')).toHaveCount(0);
    await noHorizontalScroll(page);

    // Fissa / Sblocca (giorno +1 è il primo con task; oggi non ha task → il default è il primo giorno ≥ oggi).
    const pin = page.getByRole('button', { name: 'Fissa', exact: true }).first();
    await pin.click({ timeout: 20_000 });
    await expect(page.getByRole('button', { name: 'Sblocca', exact: true })).toBeVisible({
      timeout: 20_000,
    });
    await page.getByRole('button', { name: 'Sblocca', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Sblocca', exact: true })).toHaveCount(0, {
      timeout: 20_000,
    });

    // Escludi un argomento.
    await page.getByRole('button', { name: 'Escludi un argomento…' }).click();
    const sheet = page.getByRole('dialog', { name: 'Escludi un argomento' });
    await expect(sheet.getByRole('radio')).toHaveCount(2);
    await expect(sheet.getByRole('button', { name: 'Escludi', exact: true })).toBeDisabled();
    await sheet.getByRole('radio', { name: /Ottica/ }).check();
    await sheet.getByRole('button', { name: 'Escludi', exact: true }).click();
    await expect(sheet).toHaveCount(0, { timeout: 20_000 });
    await expect(summary).toContainText('2 task proposte', { timeout: 20_000 });

    // Conferma.
    await page.getByRole('button', { name: 'Conferma piano' }).click();
    await expect(summary).toContainText('Attivo', { timeout: 20_000 });
    await expect(page.getByRole('button', { name: 'Conferma piano' })).toHaveCount(0);
    expect(await planStatus(seed.planId)).toBe('active');
    await noHorizontalScroll(page);
  });

  test('Elimina piano: sheet di conferma e ritorno allo stato vuoto', async ({
    page,
    request,
    baseURL,
  }) => {
    test.setTimeout(90_000);
    const seed = await seedActive(request, baseURL!);
    slug = seed.slug;
    await page.goto(pianoUrl(seed));
    await page.getByRole('button', { name: 'Elimina piano' }).click({ timeout: 30_000 });
    const sheet = page.getByRole('dialog', { name: 'Elimina piano' });
    await expect(sheet).toContainText('6 task');
    await sheet.getByRole('button', { name: 'Annulla' }).click();
    await expect(sheet).toHaveCount(0);
    expect(await planStatus(seed.planId)).toBe('active');

    await page.getByRole('button', { name: 'Elimina piano' }).click();
    await sheet.getByRole('button', { name: 'Elimina', exact: true }).click();
    await expect(page.getByText('Non hai ancora un piano di studio.')).toBeVisible({
      timeout: 20_000,
    });
    const left = await db.select().from(tasks).where(eq(tasks.planId, seed.planId));
    expect(left).toHaveLength(0);
  });
});

test.describe('Materia mobile — Piano: azioni sulle task e ritardo', () => {
  let slug: string | undefined;

  test.afterEach(async ({ request, baseURL }) => {
    if (slug) await deleteSubject(request, baseURL!, slug);
    slug = undefined;
  });

  const pianoUrl = (s: { slug: string }) => `/materie/${s.slug}/piano`;
  const conflict = (message: string) => ({
    status: 409,
    contentType: 'application/json',
    body: JSON.stringify({ error: { code: 'conflict', message } }),
  });

  /** Tre task in ritardo su tre giorni (due giorni saltati: il report consiglia di ricalcolare). */
  const lateTasks = [
    { offset: -3, title: 'Arretrata uno' },
    { offset: -2, title: 'Arretrata due' },
    { offset: -1, title: 'Arretrata tre' },
    { offset: 0, title: 'Task di oggi', minutes: 30 },
    { offset: 1, kind: 'rest' as const, title: 'Riposo', minutes: 0 },
  ];

  test('Riassorbi su più task con un 409 a metà: messaggio "(k di n riassorbite)" e lista aggiornata', async ({
    page,
    request,
    baseURL,
  }) => {
    test.setTimeout(90_000);
    const seed = await seedPlan(request, baseURL!, {
      status: 'active',
      tasks: lateTasks,
      targetOffset: 10,
    });
    slug = seed.slug;
    let calls = 0;
    await page.route('**/plan/tasks/*/reabsorb', async (route) => {
      calls += 1;
      if (calls === 2) await route.fulfill(conflict('Nessun giorno libero disponibile'));
      else await route.continue();
    });
    await page.goto(pianoUrl(seed));
    const drift = page.getByRole('status').filter({ hasText: 'Sei indietro di 3 task' });
    await expect(drift).toBeVisible({ timeout: 30_000 });
    // Due giorni saltati: il report consiglia di ricalcolare.
    await expect(drift.getByRole('button', { name: 'Ricalcola il piano' })).toBeVisible();

    await drift.getByRole('button', { name: 'Riassorbi' }).click();
    const refreshed = page.getByRole('status').filter({ hasText: 'Sei indietro di 2 task' });
    await expect(refreshed).toBeVisible({ timeout: 20_000 });
    await expect(refreshed.getByRole('alert')).toHaveText(
      'Nessun giorno libero disponibile (1 di 3 riassorbite)',
    );
    expect(calls).toBe(2);
    const first = await taskStatus(seed.taskIds[0]!);
    expect(first!.date >= dayOffset(0)).toBe(true);
    expect((await taskStatus(seed.taskIds[1]!))!.date).toBe(dayOffset(-2));
    await noHorizontalScroll(page);
  });

  test('"Ricalcola il piano" apre lo sheet di rigenerazione', async ({
    page,
    request,
    baseURL,
  }) => {
    test.setTimeout(90_000);
    const seed = await seedPlan(request, baseURL!, {
      status: 'active',
      tasks: lateTasks,
      targetOffset: 10,
    });
    slug = seed.slug;
    await page.goto(pianoUrl(seed));
    await page.getByRole('button', { name: 'Ricalcola il piano' }).click({ timeout: 30_000 });
    await expect(page.getByRole('dialog', { name: 'Rigenera bozza' })).toBeVisible();
  });

  test('"Sposta di 1 giorno": ok cambia la data; un 409 resta nello sheet con il motivo', async ({
    page,
    request,
    baseURL,
  }) => {
    test.setTimeout(90_000);
    const seed = await seedPlan(request, baseURL!, {
      status: 'active',
      tasks: lateTasks,
      targetOffset: 10,
    });
    slug = seed.slug;
    let refuse = true;
    await page.route('**/plan/tasks/*/move', async (route) => {
      if (refuse) await route.fulfill(conflict('Spostamento rifiutato: giorno senza tempo'));
      else await route.continue();
    });
    await page.goto(pianoUrl(seed));
    const row = page.getByRole('button', { name: /^Lettura, Task di oggi/ });

    await row.click({ timeout: 30_000 });
    const sheet = page.getByRole('dialog', { name: 'Task di oggi' });
    await expect(sheet).toContainText('Oggi');
    await expect(sheet).not.toContainText(dayOffset(0));
    await sheet.getByRole('button', { name: 'Sposta di 1 giorno' }).click();
    await expect(sheet.getByRole('alert')).toHaveText('Spostamento rifiutato: giorno senza tempo');
    await expect(sheet).toBeVisible();
    expect((await taskStatus(seed.taskIds[3]!))!.date).toBe(dayOffset(0));

    // Chiuso e riaperto: l'errore non resta.
    await page.keyboard.press('Escape');
    await expect(sheet).toHaveCount(0);
    await row.click();
    await expect(sheet.getByRole('alert')).toHaveCount(0);

    refuse = false;
    await sheet.getByRole('button', { name: 'Sposta di 1 giorno' }).click();
    await expect(sheet).toHaveCount(0, { timeout: 20_000 });
    expect((await taskStatus(seed.taskIds[3]!))!.date).toBe(dayOffset(1));
  });

  test('"Riapri" rimette a fare una task conclusa', async ({ page, request, baseURL }) => {
    test.setTimeout(90_000);
    const seed = await seedPlan(request, baseURL!, {
      status: 'active',
      tasks: [
        { offset: 0, title: 'Già fatta', status: 'done' },
        { offset: 0, title: 'Da fare' },
      ],
      targetOffset: 10,
    });
    slug = seed.slug;
    await page.goto(pianoUrl(seed));
    await page.getByRole('button', { name: /^Lettura, Già fatta/ }).click({ timeout: 30_000 });
    const sheet = page.getByRole('dialog', { name: 'Già fatta' });
    await sheet.getByRole('button', { name: 'Riapri' }).click();
    await expect(sheet).toHaveCount(0, { timeout: 20_000 });
    expect((await taskStatus(seed.taskIds[0]!))!.status).toBe('todo');
    await expect(
      page.getByRole('checkbox', { name: 'Segna come fatta: Già fatta' }),
    ).toHaveAttribute('aria-checked', 'false');
  });

  test('Bozza: "Elimina task" dallo sheet toglie la task; la descrizione mostra il giorno leggibile', async ({
    page,
    request,
    baseURL,
  }) => {
    test.setTimeout(90_000);
    const seed = await seedPlan(request, baseURL!, {
      status: 'draft',
      targetOffset: 10,
      tasks: [
        { offset: 1, title: 'Studia Alfa', topicKey: 'a' },
        { offset: 1, title: 'Studia Beta', topicKey: 'b' },
      ],
    });
    slug = seed.slug;
    await page.goto(pianoUrl(seed));
    const summary = page.getByRole('region', { name: 'Piano di studio' });
    await expect(summary).toContainText('2 task proposte', { timeout: 30_000 });
    await page.getByRole('button', { name: /^Lettura, Studia Beta/ }).click();
    const sheet = page.getByRole('dialog', { name: 'Studia Beta' });
    await expect(sheet).not.toContainText(dayOffset(1)); // niente data ISO
    await sheet.getByRole('button', { name: 'Elimina task' }).click();
    await expect(sheet).toHaveCount(0, { timeout: 20_000 });
    await expect(summary).toContainText('1 task proposte', { timeout: 20_000 });
    await expect(page.getByRole('button', { name: /^Lettura, Studia Beta/ })).toHaveCount(0);
  });

  test('Un giorno di riposo non ha la checkbox "fatta"', async ({ page, request, baseURL }) => {
    test.setTimeout(90_000);
    const seed = await seedPlan(request, baseURL!, {
      status: 'active',
      tasks: lateTasks,
      targetOffset: 10,
    });
    slug = seed.slug;
    await page.goto(pianoUrl(seed));
    const days = page.getByRole('group', { name: 'Giorni del piano' });
    await expect(days).toBeVisible({ timeout: 30_000 });
    await days.getByRole('button').last().click(); // +1: riposo
    await expect(
      page.getByRole('button', { name: /^Riposo, Riposo, giorno libero/ }),
    ).toBeVisible();
    await expect(page.getByRole('checkbox')).toHaveCount(0);
  });
});
