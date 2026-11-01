import { test, expect, type Page } from '@playwright/test';
import {
  deleteSubject,
  expectMinSize,
  expectNoHorizontalScroll,
  lessonUrl,
  seedSprintLesson,
  seedStandardLesson,
  smallTargets,
} from './fixtures/lezioni-mobile-seed';

/**
 * Lezione mobile (S7, C13) a 375×812: stepper compatto, blocchi a tutta larghezza, barra azioni
 * fissa in basso, Materiale/Tutor e indice come sheet, avanzamento di fase. Standard e sprint.
 * Gira solo nel progetto `mobile`. Blocchi ed esercizi sono seminati (il worker non gira);
 * la correzione del controllo usa il FakeProvider del server.
 */

test.use({ viewport: { width: 375, height: 812 } });

const stepper = (page: Page, label = 'Fasi della lezione') =>
  page.getByRole('navigation', { name: label });
const bar = (page: Page) => page.getByRole('toolbar', { name: 'Azioni della lezione' });
const sideDialog = (page: Page) => page.getByRole('dialog', { name: 'Materiale e tutor' });

async function open(page: Page, url: string) {
  await page.goto(url);
  await expect(bar(page)).toBeVisible({ timeout: 30_000 });
}

test.describe('Lezione standard mobile (C13)', () => {
  let slug: string | undefined;

  test.afterEach(async ({ request, baseURL }) => {
    if (slug) await deleteSubject(request, baseURL!, slug);
    slug = undefined;
  });

  test('Guscio: stepper compatto con la fase corrente, barra fissa, nessuno scroll orizzontale e target da 44px', async ({
    page,
    request,
    baseURL,
  }) => {
    test.setTimeout(90_000);
    const seed = await seedStandardLesson(request, baseURL!, 'understand');
    slug = seed.slug;
    await open(page, lessonUrl(seed));

    // Testata: indietro alla materia (≥ 44), titolo, metodo, pausa del timer.
    await expect(page.getByRole('link', { name: 'Torna alla materia' })).toHaveAttribute(
      'href',
      `/materie/${seed.slug}`,
    );
    await expectMinSize(page.getByRole('link', { name: 'Torna alla materia' }), {
      width: 44,
      height: 44,
    });
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Termodinamica');
    await expect(page.locator('header').getByText('Standard', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Metti in pausa' })).toBeVisible();
    await expect(page.getByText('blocco 1 di 2', { exact: true })).toBeVisible();

    // Stepper: cinque fasi, una sola corrente, lo stato è anche nel nome.
    const phases = stepper(page).getByRole('button');
    await expect(phases).toHaveCount(5);
    await expect(stepper(page).locator('[aria-current="step"]')).toHaveCount(1);
    await expect(
      stepper(page).getByRole('button', { name: 'Fase 2 di 5: Studia, fase corrente' }),
    ).toHaveAttribute('aria-current', 'step');
    await expect(
      stepper(page).getByRole('button', { name: 'Fase 1 di 5: Esplora, fatta' }),
    ).toBeVisible();
    await expect(
      stepper(page).getByRole('button', { name: 'Fase 3 di 5: Rielabora, da fare' }),
    ).toBeVisible();

    // Barra: fissa in basso, indietro + materiale/tutor + primario, tutti ≥ 52 px.
    const box = await bar(page).boundingBox();
    expect(box).not.toBeNull();
    expect(Math.round(box!.y + box!.height)).toBe(812);
    await expect(bar(page).getByRole('button', { name: 'Fase precedente: Esplora' })).toBeVisible();
    await expect(bar(page).getByTestId('lesson-open-side')).toHaveAccessibleName(
      'Apri materiale e tutor',
    );
    await expect(bar(page).getByRole('button', { name: 'Controlla' })).toBeDisabled();
    for (const b of await bar(page).getByRole('button').all()) {
      await expectMinSize(b, { height: 52 });
    }
    await expectMinSize(bar(page).getByTestId('lesson-open-side'), { width: 52, height: 52 });

    // La barra resta al suo posto anche scorrendo la pagina.
    await page.mouse.wheel(0, 600);
    const after = await bar(page).boundingBox();
    expect(Math.round(after!.y + after!.height)).toBe(812);

    await expectNoHorizontalScroll(page);
    for (const scope of ['[role="toolbar"]', 'nav[aria-label="Fasi della lezione"]', 'header']) {
      expect(await smallTargets(page, scope)).toEqual([]);
    }
  });

  test('Blocco: controllo dalla barra, Blocco successivo, indietro e indice', async ({
    page,
    request,
    baseURL,
  }) => {
    test.setTimeout(120_000);
    const seed = await seedStandardLesson(request, baseURL!, 'understand');
    slug = seed.slug;
    await open(page, lessonUrl(seed));

    await expect(page.getByRole('heading', { level: 2, name: /Blocco 1/ })).toBeVisible();
    await expect(page.getByText('Blocco 1 di 2', { exact: true })).toBeVisible();
    // Niente carta con bordo e nessun pulsante "Controlla" in pagina: è nella barra.
    await expect(page.getByRole('button', { name: 'Controlla' })).toHaveCount(1);
    await expect(bar(page).getByRole('button', { name: 'Controlla' })).toBeDisabled();

    // Esempio a passaggi, uno alla volta.
    await expect(page.getByText('Passo uno del blocco 1')).toBeVisible();
    const step = page.getByRole('button', { name: 'Passaggio successivo' });
    await expectMinSize(step, { height: 44 });
    await step.click();
    await expect(page.getByText('Passo due')).toBeVisible();

    // Controllo: la risposta si scrive in pagina, "Controlla" si tocca nella barra.
    const answer = page.getByLabel(/Che cosa si conserva nel blocco 1/);
    await expectMinSize(answer, { height: 44 });
    await answer.fill('L’energia totale del sistema');
    const check = bar(page).getByRole('button', { name: 'Controlla' });
    await expect(check).toBeEnabled();
    await check.click();
    const next = bar(page).getByRole('button', { name: 'Blocco successivo →' });
    await expect(next).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText('Risposta attesa')).toBeVisible();
    await expectNoHorizontalScroll(page);

    await next.click();
    await expect(page.getByRole('heading', { level: 2, name: /Blocco 2/ })).toBeFocused();
    await expect(page.getByText('blocco 2 di 2', { exact: true })).toBeVisible();
    // Dal secondo blocco la barra offre il blocco precedente.
    const back = bar(page).getByRole('button', { name: 'Blocco precedente' });
    await expect(back).toBeVisible();

    // Indice dei blocchi: sheet con i blocchi, quello corrente segnato.
    await page.getByRole('button', { name: 'Indice' }).click();
    const index = page.getByRole('dialog', { name: 'Indice della lezione' });
    await expect(index).toBeVisible();
    await expect(index.getByRole('navigation', { name: 'Indice della lezione' })).toBeVisible();
    await expect(index.locator('[aria-current="step"]')).toContainText('Blocco 2');
    for (const b of await index.getByRole('button').all()) {
      await expectMinSize(b, { height: 44 });
    }
    // Scegliere il blocco 1 chiude lo sheet e porta al suo titolo.
    await index.getByRole('button', { name: /Blocco 1/ }).click();
    await expect(index).toHaveCount(0);
    await expect(page.getByRole('heading', { level: 2, name: /Blocco 1/ })).toBeFocused();
  });

  test('Materiale e tutor: sheet dalla barra, due schede, il contenuto resta e il focus torna al pulsante', async ({
    page,
    request,
    baseURL,
  }) => {
    test.setTimeout(90_000);
    const seed = await seedStandardLesson(request, baseURL!, 'understand');
    slug = seed.slug;
    await open(page, lessonUrl(seed));

    // Sheet chiuso: il pannello non occupa la pagina.
    await expect(sideDialog(page)).toHaveCount(0);
    const side = bar(page).getByTestId('lesson-open-side');
    await side.click();
    await expect(sideDialog(page)).toBeVisible();
    await expect(sideDialog(page).getByRole('tab', { name: 'Materiale' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(sideDialog(page).getByRole('tab', { name: 'Tutor' })).toBeVisible();
    await expectMinSize(sideDialog(page).getByRole('tab', { name: 'Tutor' }), { height: 44 });
    await expectMinSize(sideDialog(page).getByRole('button', { name: 'Chiudi' }), {
      width: 44,
      height: 44,
    });

    // Scrivo nel tutor, chiudo e riapro: la bozza è ancora lì (i pannelli restano montati).
    await sideDialog(page).getByRole('tab', { name: 'Tutor' }).click();
    await sideDialog(page).getByLabel('Domanda al tutor').fill('Una domanda di prova');
    await sideDialog(page).getByRole('button', { name: 'Chiudi' }).click();
    await expect(sideDialog(page)).toHaveCount(0);
    await expect(side).toBeFocused();
    await side.click();
    await expect(sideDialog(page).getByLabel('Domanda al tutor')).toHaveValue(
      'Una domanda di prova',
    );
    await page.keyboard.press('Escape');
    await expect(sideDialog(page)).toHaveCount(0);
    await expectNoHorizontalScroll(page);
  });

  test('Interruzione del tutor: il chip apre lo sheet sulla scheda Tutor con la domanda precompilata', async ({
    page,
    request,
    baseURL,
  }) => {
    test.setTimeout(90_000);
    const seed = await seedStandardLesson(request, baseURL!, 'understand');
    slug = seed.slug;
    await open(page, lessonUrl(seed));

    const group = page.getByRole('group', { name: 'Interrompi il tutor' });
    await expect(group.getByRole('button')).toHaveText([
      'Non ho capito questo passaggio',
      'Fammi un altro esempio',
      'Spiegalo più semplice',
      'Perché?',
    ]);
    for (const chip of await group.getByRole('button').all()) {
      await expectMinSize(chip, { height: 44 });
    }
    await expectNoHorizontalScroll(page);

    await group.getByRole('button', { name: 'Fammi un altro esempio' }).click();
    await expect(sideDialog(page)).toBeVisible();
    await expect(sideDialog(page).getByRole('tab', { name: 'Tutor' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(sideDialog(page).getByLabel('Domanda al tutor')).toHaveValue(
      /Nel blocco 1 \(«Blocco 1/,
    );
  });

  test('Avanzamento di fase: dalla barra, dallo stepper e "Termina" porta a Ricorda', async ({
    page,
    request,
    baseURL,
  }) => {
    test.setTimeout(120_000);
    const seed = await seedStandardLesson(request, baseURL!, 'explore');
    slug = seed.slug;
    await open(page, lessonUrl(seed));

    await expect(
      stepper(page).getByRole('button', { name: 'Fase 1 di 5: Esplora, fase corrente' }),
    ).toBeVisible();
    // Alla prima fase non c'è "indietro"; il primario è l'azione della fase.
    await expect(bar(page).getByRole('button', { name: /^Fase precedente/ })).toHaveCount(0);
    await bar(page).getByRole('button', { name: 'Inizia a studiare →' }).click();
    await expect(
      stepper(page).getByRole('button', { name: 'Fase 2 di 5: Studia, fase corrente' }),
    ).toBeVisible();
    await expect(
      stepper(page).getByRole('button', { name: 'Fase 1 di 5: Esplora, fatta' }),
    ).toBeVisible();

    // Indietro dalla barra, poi di nuovo avanti dallo stepper (navigazione libera).
    await bar(page).getByRole('button', { name: 'Fase precedente: Esplora' }).click();
    await expect(
      stepper(page).getByRole('button', { name: /^Fase 1 di 5: Esplora, fase corrente/ }),
    ).toBeVisible();
    await stepper(page)
      .getByRole('button', { name: /^Fase 3 di 5: Rielabora/ })
      .click();
    await expect(
      stepper(page).getByRole('button', { name: 'Fase 3 di 5: Rielabora, fase corrente' }),
    ).toBeVisible();
    await expect(bar(page).getByRole('button', { name: 'Passa agli esercizi →' })).toBeVisible();
    await expectNoHorizontalScroll(page);

    // "Termina" non chiude: porta a Ricorda, dove la barra non ha più il primario.
    const terminate = page.getByRole('button', { name: 'Termina: vai a Ricorda' });
    await expectMinSize(terminate, { height: 44 });
    await terminate.click();
    await expect(
      stepper(page).getByRole('button', { name: 'Fase 5 di 5: Ricorda, fase corrente' }),
    ).toBeVisible();
    await expect(terminate).toHaveCount(0);
    await expect(bar(page).getByRole('button', { name: /→$/ })).toHaveCount(0);
    await expect(bar(page).getByTestId('lesson-open-side')).toBeVisible();
    await expectNoHorizontalScroll(page);
  });
});

test.describe('Lezione sprint mobile (C13)', () => {
  let slug: string | undefined;

  test.afterEach(async ({ request, baseURL }) => {
    if (slug) await deleteSubject(request, baseURL!, slug);
    slug = undefined;
  });

  test('Sprint: stepper a quattro fasi, barra con il primario di fase, sheet e nessuno scroll orizzontale', async ({
    page,
    request,
    baseURL,
  }) => {
    test.setTimeout(90_000);
    const seed = await seedSprintLesson(request, baseURL!, 'exercises');
    slug = seed.slug;
    await open(page, lessonUrl(seed));

    const phases = stepper(page, 'Fasi della lezione sprint');
    await expect(phases.getByRole('button')).toHaveCount(4);
    await expect(
      phases.getByRole('button', { name: 'Fase 1 di 4: Esercizi, fase corrente' }),
    ).toHaveAttribute('aria-current', 'step');
    await expect(phases.getByRole('button', { name: /^Fase 2 di 4: Teoria/ })).toBeVisible();
    await expect(phases.getByRole('button', { name: /^Fase 3 di 4: Riprova/ })).toBeVisible();
    await expect(phases.getByRole('button', { name: /^Fase 4 di 4: Ricorda/ })).toBeVisible();
    await expect(page.locator('header').getByText('Sprint', { exact: true })).toBeVisible();

    // Primo esercizio nell'area di lavoro; la barra porta alla teoria (secondario finché non sono valutati).
    await expect(page.getByText('Esercizio di prova 1')).toBeVisible();
    await expect(bar(page).getByRole('button', { name: 'Vediamo cosa ti manca →' })).toBeVisible();
    await expect(bar(page).getByRole('button', { name: /^Fase precedente/ })).toHaveCount(0);
    for (const b of await bar(page).getByRole('button').all()) {
      await expectMinSize(b, { height: 52 });
    }
    await expectNoHorizontalScroll(page);
    for (const scope of ['[role="toolbar"]', 'nav[aria-label="Fasi della lezione sprint"]']) {
      expect(await smallTargets(page, scope)).toEqual([]);
    }

    // Materiale e tutor: lo stesso sheet della lezione standard.
    await bar(page).getByTestId('lesson-open-side').click();
    await expect(sideDialog(page)).toBeVisible();
    await sideDialog(page).getByRole('button', { name: 'Chiudi' }).click();
    await expect(sideDialog(page)).toHaveCount(0);

    // Navigazione libera dallo stepper: Riprova, e indietro dalla barra.
    await phases.getByRole('button', { name: /^Fase 3 di 4: Riprova/ }).click();
    await expect(
      phases.getByRole('button', { name: 'Fase 3 di 4: Riprova, fase corrente' }),
    ).toBeVisible();
    await expect(bar(page).getByRole('button', { name: /^Fase precedente: Teoria/ })).toBeVisible();
    await expectNoHorizontalScroll(page);
  });
});
