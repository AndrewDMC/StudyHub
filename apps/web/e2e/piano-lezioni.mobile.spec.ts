import { test, expect, type Page } from '@playwright/test';
import { planStatus } from './fixtures/lacune-piano-seed';
import {
  deleteSubject,
  expectMinSize,
  expectNoHorizontalScroll,
  seedLessonPlan,
  smallTargets,
  type LessonPlanSeed,
} from './fixtures/lezioni-mobile-seed';

/**
 * Piano mobile a lezioni (S7, C12) a 375×812: intensità con metodo, "Cosa entra", giorni a lezioni
 * con tipo e durata, argomenti in ordine di studio con badge di metodo. Gira solo nel progetto `mobile`.
 * Piano, task e metodo si inseriscono in DB; il worker non gira.
 */

test.use({ viewport: { width: 375, height: 812 } });

const pianoUrl = (s: { slug: string }) => `/materie/${s.slug}/piano`;

async function openPlan(page: Page, seed: LessonPlanSeed) {
  await page.goto(pianoUrl(seed));
  await expect(page.getByRole('region', { name: 'Piano di studio' })).toBeVisible({
    timeout: 30_000,
  });
}

test.describe('Piano mobile — lezioni (C12)', () => {
  let slug: string | undefined;

  test.afterEach(async ({ request, baseURL }) => {
    if (slug) await deleteSubject(request, baseURL!, slug);
    slug = undefined;
  });

  test('Ordine delle sezioni, nessuno scroll orizzontale e target da 44px', async ({
    page,
    request,
    baseURL,
  }) => {
    test.setTimeout(90_000);
    const seed = await seedLessonPlan(request, baseURL!, { problem: false });
    slug = seed.slug;
    await openPlan(page, seed);
    await expect(page.getByTestId('plan-topics')).toBeVisible();

    // Intensità, Cosa entra, striscia dei giorni, giorno, Argomenti: in quest'ordine.
    const order = await page.evaluate(() => {
      const top = (el: Element | null) =>
        el ? el.getBoundingClientRect().top + window.scrollY : -1;
      return [
        top(document.querySelector('[data-testid="plan-intensity"]')),
        top(document.querySelector('[data-testid="plan-fit"]')),
        top(document.querySelector('[aria-label="Giorni del piano"]')),
        top(document.querySelector('#plan-day-title')),
        top(document.querySelector('[data-testid="plan-topics"]')),
      ];
    });
    expect(order.every((y) => y >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);

    await expectNoHorizontalScroll(page);
    for (const scope of ['[data-testid="plan-intensity"]', '[data-testid="plan-fit"]', 'main']) {
      expect(await smallTargets(page, scope)).toEqual([]);
    }
  });

  test('Intensità: tre scelte con il metodo; scegliere un’altra apre il foglio e il piano non cambia', async ({
    page,
    request,
    baseURL,
  }) => {
    test.setTimeout(90_000);
    const seed = await seedLessonPlan(request, baseURL!, { problem: false });
    slug = seed.slug;
    await openPlan(page, seed);

    const card = page.getByTestId('plan-intensity');
    await expect(card.getByRole('heading', { name: 'Intensità', level: 2 })).toBeVisible();
    const group = card.getByRole('radiogroup', { name: 'Intensità' });
    await expect(group.getByRole('radio')).toHaveText(['Sostenibile', 'Standard', 'Sprint']);
    const standard = group.getByRole('radio', { name: 'Standard' });
    await expect(standard).toBeChecked();
    for (const radio of await group.getByRole('radio').all()) {
      await expectMinSize(radio, { height: 44 });
    }
    await expect(card).toContainText('Usa il 90% del tempo che hai indicato.');
    await expect(card).toContainText('Fasi di ogni lezione');

    // Un’altra intensità: si apre il foglio (nuova bozza), il radio attivo e il piano restano com’erano.
    await group.getByRole('radio', { name: 'Sprint' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(card).toContainText(
      'Per cambiare intensità si prepara una nuova bozza: scegli le date e conferma.',
    );
    await expect(standard).toBeChecked();
    expect(await planStatus(seed.planId)).toBe('active');
  });

  test('Cosa entra: piano che entra tutto', async ({ page, request, baseURL }) => {
    test.setTimeout(90_000);
    const seed = await seedLessonPlan(request, baseURL!, { problem: false });
    slug = seed.slug;
    await openPlan(page, seed);

    const fit = page.getByTestId('plan-fit');
    await expect(fit.getByRole('heading', { name: 'Entra tutto' })).toBeVisible();
    await expect(fit).toContainText('2 argomenti su 2');
    await expect(fit.getByRole('button', { name: 'Aggiungi disponibilità' })).toHaveCount(0);
    await expect(fit.getByText('Fuori dal piano')).toHaveCount(0);
  });

  test('Cosa entra: lezione passata a sprint, argomento fuori e come recuperare tempo', async ({
    page,
    request,
    baseURL,
  }) => {
    test.setTimeout(90_000);
    const seed = await seedLessonPlan(request, baseURL!, { problem: true });
    slug = seed.slug;
    await openPlan(page, seed);

    const fit = page.getByTestId('plan-fit');
    await expect(
      fit.getByRole('heading', { name: 'Qualcosa resta fuori dal piano' }),
    ).toBeVisible();
    await expect(fit).toContainText('1 lezione passata a sprint');
    await expect(fit).toContainText('Entropia');
    await expect(fit.getByRole('heading', { name: 'Fuori dal piano', level: 3 })).toBeVisible();
    await expect(fit.getByRole('listitem').filter({ hasText: 'Cinematica' })).toBeVisible();

    const recover = fit.getByText('Come recuperare tempo');
    await expectMinSize(recover, { height: 44 });
    await recover.click();
    await expect(fit).toContainText('Tempo insufficiente: mancano ~120 min su 600 richiesti.');
    await expect(fit).toContainText('Sposta l’esame');

    const add = fit.getByRole('button', { name: 'Aggiungi disponibilità' });
    await expectMinSize(add, { height: 44 });
    await add.click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expectNoHorizontalScroll(page);
  });

  test('Giorni a lezioni: tipo, titolo, durata e pagine; verifica e flashcard distinte', async ({
    page,
    request,
    baseURL,
  }) => {
    test.setTimeout(90_000);
    const seed = await seedLessonPlan(request, baseURL!, { problem: false });
    slug = seed.slug;
    await openPlan(page, seed);

    const days = page.getByRole('group', { name: 'Giorni del piano' });
    await expect(days.getByRole('button', { pressed: true })).toHaveAccessibleName('Oggi, 2 task');
    await expect(page.getByRole('heading', { name: 'Oggi', level: 2 })).toBeVisible();

    const standard = page.getByRole('button', {
      name: /^Lezione, Termodinamica · parte 1 di 2, 45 min · pag\. 12–31/,
    });
    const sprint = page.getByRole('button', { name: /^Lezione, Entropia, 30 min · sprint/ });
    await expect(standard).toBeVisible();
    await expect(sprint).toBeVisible();
    // Il tipo è testo (non solo colore): "Lezione" e "Lezione · sprint".
    await expect(standard.getByText('Lezione', { exact: true })).toBeVisible();
    await expect(sprint.getByText('Lezione · sprint', { exact: true })).toBeVisible();
    // Una sola "Inizia" primaria per volta tra le due lezioni di oggi, entrambe toccabili.
    for (const start of await page.getByRole('button', { name: 'Inizia' }).all()) {
      await expectMinSize(start, { height: 44 });
    }

    await days.getByRole('button', { name: /^Domani/ }).click();
    await expect(
      page.getByRole('button', {
        name: /^Verifica, Verifica · Termodinamica, 15 min · a libro chiuso · \+3 g/,
      }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: /^Flashcard, Flashcard di termodinamica, 20 min/ }),
    ).toBeVisible();
    await expectNoHorizontalScroll(page);
  });

  test('Argomenti in ordine di studio: nomi, metodo e quando; sola lettura', async ({
    page,
    request,
    baseURL,
  }) => {
    test.setTimeout(90_000);
    const seed = await seedLessonPlan(request, baseURL!, { problem: true });
    slug = seed.slug;
    await openPlan(page, seed);

    const section = page.getByTestId('plan-topics');
    await expect(section.getByRole('heading', { level: 2 })).toHaveText(
      /Argomenti\s*· in ordine di studio/,
    );
    const rows = section.getByRole('listitem');
    await expect(rows).toHaveCount(3);

    // Ordine: le lezioni per data, poi l’argomento fuori dal piano.
    await expect(rows.nth(0)).toContainText('Termodinamica');
    await expect(rows.nth(0)).toContainText('1 lezione');
    await expect(rows.nth(0).getByText('Standard', { exact: true })).toBeVisible();
    await expect(rows.nth(0)).toContainText('oggi');

    await expect(rows.nth(1)).toContainText('Entropia');
    await expect(rows.nth(1).getByText('Sprint', { exact: true })).toBeVisible();

    await expect(rows.nth(2)).toContainText('Cinematica');
    await expect(rows.nth(2)).toContainText('Fuori dal piano');
    await expect(rows.nth(2).getByText('Fuori', { exact: true })).toBeVisible();

    // Nessun riordino manuale: la lista non ha controlli.
    await expect(section.getByRole('button')).toHaveCount(0);
    await expectNoHorizontalScroll(page);
  });

  test('Sprint scelto dall’utente: la riga lo dice', async ({ page, request, baseURL }) => {
    test.setTimeout(90_000);
    // Intensità standard e lezione sprint non scelta dal planner: "sprint scelto da te".
    const seed = await seedLessonPlan(request, baseURL!, { problem: false });
    slug = seed.slug;
    await openPlan(page, seed);
    const row = page
      .getByTestId('plan-topics')
      .getByRole('listitem')
      .filter({ hasText: 'Entropia' });
    await expect(row).toContainText('sprint scelto da te');
  });
});
