import { test, expect, type Page } from '@playwright/test';
import { eq } from 'drizzle-orm';
import { studySessions } from '@studyhub/db';
import {
  DOC_NAME,
  NEXT_TASK_TITLE,
  TASK_TITLE,
  db,
  deleteSubject,
  endSession,
  itemRow,
  seedBriefingJob,
  seedSession,
  sessionUrl,
  type SessionSeed,
} from './fixtures/sessione-seed';

/**
 * Slice 6 della materia mobile (docs/design/materia-mobile): Sessione e Chiusura a 375×812.
 * Gira solo nel progetto `mobile` (playwright.config.ts). Il worker non gira: punti chiave ed
 * esercizi si inseriscono in `session_items`; correzione AI e chat usano il FakeProvider del server.
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

const tabKeyPoints = (page: Page) => page.getByRole('tab', { name: 'Punti chiave ed esercizi' });
const tabChat = (page: Page) => page.getByRole('tab', { name: /Chiedi all.AI/ });
const exercise = (page: Page, n: number) =>
  page.getByRole('region', { name: new RegExp(`Esercizio ${n} di 3`) });

async function openSession(page: Page, seed: SessionSeed) {
  await page.goto(sessionUrl(seed));
  await expect(page.getByRole('heading', { level: 1, name: TASK_TITLE })).toBeVisible({
    timeout: 30_000,
  });
}

test.describe('Materia mobile — Sessione', () => {
  let slug: string | undefined;

  test.afterEach(async ({ request, baseURL }) => {
    if (slug) await deleteSubject(request, baseURL!, slug);
    slug = undefined;
  });

  test('Layout: header proprio, header globale e tab bar nascosti, niente scroll orizzontale e target da 44px', async ({
    page,
    request,
    baseURL,
  }) => {
    test.setTimeout(90_000);
    const seed = await seedSession(request, baseURL!);
    slug = seed.slug;
    await openSession(page, seed);

    await expect(page.getByRole('link', { name: 'Torna alla materia' })).toHaveAttribute(
      'href',
      `/materie/${seed.slug}`,
    );
    await expect(page.getByRole('button', { name: 'Termina', exact: true })).toBeVisible();
    await expect(page.locator('header').filter({ hasText: 'StudyHub' })).toBeHidden();
    await expect(page.getByRole('navigation', { name: 'Navigazione principale' })).toBeHidden();
    await expect(page.getByRole('region', { name: 'Punti chiave' })).toBeVisible({
      timeout: 20_000,
    });

    await noHorizontalScroll(page);
    expect(await smallTargets(page, 'body')).toEqual([]);
  });

  test('Timer: pausa e riprendi; tab con aria-selected e frecce', async ({
    page,
    request,
    baseURL,
  }) => {
    test.setTimeout(90_000);
    const seed = await seedSession(request, baseURL!);
    slug = seed.slug;
    await openSession(page, seed);

    await expect(page.getByRole('timer', { name: 'Tempo rimasto nella fase' })).toBeVisible();
    await page.getByRole('button', { name: 'Metti in pausa' }).click();
    await expect(page.getByRole('button', { name: 'Riprendi' })).toBeVisible();
    // In pausa l'orologio è fermo.
    const timer = page.getByRole('timer', { name: 'Tempo rimasto nella fase' });
    const frozen = await timer.innerText();
    await page.waitForTimeout(2200);
    await expect(timer).toHaveText(frozen);
    await page.getByRole('button', { name: 'Riprendi' }).click();
    await expect(page.getByRole('button', { name: 'Metti in pausa' })).toBeVisible();

    await expect(tabKeyPoints(page)).toHaveAttribute('aria-selected', 'true');
    await expect(tabChat(page)).toHaveAttribute('aria-selected', 'false');
    await tabChat(page).click();
    await expect(tabChat(page)).toHaveAttribute('aria-selected', 'true');
    await expect(tabKeyPoints(page)).toHaveAttribute('aria-selected', 'false');
    await expect(page.getByLabel('Domanda al tutor')).toBeVisible();

    await tabChat(page).focus();
    await page.keyboard.press('ArrowLeft');
    await expect(tabKeyPoints(page)).toHaveAttribute('aria-selected', 'true');
    await noHorizontalScroll(page);
  });

  test('Briefing: punti chiave con fonte ed esercizi visibili; "Capito" e fonte aprono il dettaglio', async ({
    page,
    request,
    baseURL,
  }) => {
    test.setTimeout(90_000);
    const seed = await seedSession(request, baseURL!);
    slug = seed.slug;
    await openSession(page, seed);

    const points = page.getByRole('region', { name: 'Punti chiave' });
    await expect(points).toBeVisible({ timeout: 20_000 });
    await expect(points).toContainText('Punto chiave 1: primo principio');
    await expect(points).toContainText('Punto chiave 3: primo principio');
    await expect(points).toContainText('0/3 capiti');

    const capito = points.getByRole('button', { name: 'Capito', pressed: false }).first();
    await capito.click();
    await expect(points).toContainText('1/3 capiti');

    await points.getByRole('button', { name: `Fonte: ${DOC_NAME}, pagina 3` }).click();
    const dialog = page.getByRole('dialog', { name: 'Fonte' });
    await expect(dialog).toContainText('Citazione del punto 1');
    await expect(dialog.getByRole('link', { name: 'Apri il documento' })).toHaveAttribute(
      'href',
      `/materie/${seed.slug}/documenti/${seed.docId}`,
    );
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);

    for (const n of [1, 2, 3]) await expect(exercise(page, n)).toBeAttached();
    await exercise(page, 1).scrollIntoViewIfNeeded();
    await expect(exercise(page, 1)).toContainText('Calcola il rendimento della macchina 1');
    await expect(exercise(page, 1)).toContainText('Facile');
    await noHorizontalScroll(page);
  });

  test('Esercizio: risposta + correzione AI aggiorna l’esito e persiste dopo il reload', async ({
    page,
    request,
    baseURL,
  }) => {
    test.setTimeout(90_000);
    const seed = await seedSession(request, baseURL!);
    slug = seed.slug;
    await openSession(page, seed);

    const ex = exercise(page, 1);
    await ex.scrollIntoViewIfNeeded();
    const grade = ex.getByRole('button', { name: /Correggi con l.AI/ });
    await expect(grade).toBeDisabled();
    await ex.getByLabel('La tua risposta').fill('Il rendimento vale 0,4 perché lavoro su calore.');
    await expect(grade).toBeEnabled();
    await grade.click();

    const outcome = ex.getByRole('status').filter({ hasText: /Giusto|Da rivedere/ });
    await expect(outcome).toBeVisible({ timeout: 30_000 });
    await expect(outcome).toContainText(/Correzione dell.AI · \d+%/);
    const state = (await itemRow(seed.itemIds[3]!))!;
    expect(['correct', 'wrong']).toContain(state.state);
    expect(state.feedback).not.toBeNull();

    await page.reload();
    const again = exercise(page, 1);
    await expect(again.getByRole('status').filter({ hasText: /Giusto|Da rivedere/ })).toBeVisible({
      timeout: 30_000,
    });
  });

  test('Esercizio: "Vedi soluzione" e autovalutazione ("Ho risposto bene" / "Ho sbagliato")', async ({
    page,
    request,
    baseURL,
  }) => {
    test.setTimeout(90_000);
    const seed = await seedSession(request, baseURL!);
    slug = seed.slug;
    await openSession(page, seed);

    const ex = exercise(page, 2);
    await ex.scrollIntoViewIfNeeded();
    await ex.getByRole('button', { name: 'Vedi soluzione' }).click();
    await expect(ex).toContainText("Soluzione attesa dell'esercizio 2");
    await ex.getByRole('button', { name: 'Ho risposto bene' }).click();
    await expect(ex.getByRole('status')).toContainText('Giusto');
    expect((await itemRow(seed.itemIds[4]!))!.state).toBe('correct');

    await ex.getByRole('button', { name: 'Ho sbagliato' }).click();
    await expect(ex.getByRole('status')).toContainText('Da rivedere');
    expect((await itemRow(seed.itemIds[4]!))!.state).toBe('wrong');

    await page.reload();
    await expect(
      exercise(page, 2).getByRole('status').filter({ hasText: 'Da rivedere' }),
    ).toBeVisible({ timeout: 30_000 });
    await noHorizontalScroll(page);
  });

  test('Chat: l’invio di un messaggio mostra domanda e risposta del tutor', async ({
    page,
    request,
    baseURL,
  }) => {
    test.setTimeout(90_000);
    const seed = await seedSession(request, baseURL!);
    slug = seed.slug;
    await openSession(page, seed);
    await tabChat(page).click();

    const input = page.getByLabel('Domanda al tutor');
    const send = page.getByRole('button', { name: 'Invia' });
    await expect(send).toBeDisabled();
    await input.fill('Che cos’è il primo principio?');
    await send.click();

    const log = page.getByRole('log', { name: 'Conversazione con il tutor' });
    await expect(log).toContainText('Che cos’è il primo principio?', { timeout: 30_000 });
    // Oltre alla domanda c'è una risposta del tutor (FakeProvider).
    await expect
      .poll(
        async () =>
          (await log.innerText()).replace('Che cos’è il primo principio?', '').trim().length,
        {
          timeout: 30_000,
        },
      )
      .toBeGreaterThan(0);
    await expect(input).toHaveValue('');
    await noHorizontalScroll(page);
    expect(await smallTargets(page, 'body')).toEqual([]);
  });

  test('Senza punti chiave: stato vuoto con il bottone di generazione; job in corso e fallito', async ({
    page,
    request,
    baseURL,
  }) => {
    test.setTimeout(90_000);
    const seed = await seedSession(request, baseURL!, { items: false });
    slug = seed.slug;
    await openSession(page, seed);
    await expect(
      page.getByRole('heading', { name: 'Punti chiave ed esercizi', level: 2 }),
    ).toBeVisible({ timeout: 20_000 });
    await expect(
      page.getByRole('button', { name: /^Genera punti chiave ed esercizi/ }),
    ).toBeVisible();

    await seedBriefingJob(seed, 'running');
    await page.reload();
    await expect(page.getByRole('status').filter({ hasText: 'Sto preparando' })).toBeVisible({
      timeout: 30_000,
    });

    await seedBriefingJob(seed, 'failed', 'Provider non raggiungibile');
    await page.reload();
    await expect(
      page.getByRole('alert').filter({ hasText: 'Generazione non riuscita' }),
    ).toBeVisible({
      timeout: 30_000,
    });
    await noHorizontalScroll(page);
  });

  test('Rientro dal documento: dopo "Apri il documento" e indietro l’orologio di studio non torna indietro', async ({
    page,
    request,
    baseURL,
  }) => {
    test.setTimeout(90_000);
    const seed = await seedSession(request, baseURL!);
    slug = seed.slug;
    await db
      .update(studySessions)
      .set({ activeMs: 5 * 60_000 })
      .where(eq(studySessions.id, seed.sessionId));
    await openSession(page, seed);

    const studied = page.getByText(/^Studio \d+:\d+$/);
    const seconds = async () => {
      const [m, s] = (await studied.innerText()).replace('Studio ', '').split(':').map(Number);
      return m! * 60 + s!;
    };
    await expect(studied).toBeVisible({ timeout: 20_000 });
    await page.waitForTimeout(4000);
    const before = await seconds();
    expect(before).toBeGreaterThanOrEqual(5 * 60 + 3);

    const points = page.getByRole('region', { name: 'Punti chiave' });
    await points.getByRole('button', { name: `Fonte: ${DOC_NAME}, pagina 3` }).click();
    await page
      .getByRole('dialog', { name: 'Fonte' })
      .getByRole('link', { name: 'Apri il documento' })
      .click();
    await expect(page).toHaveURL(new RegExp(`/documenti/${seed.docId}`), { timeout: 30_000 });
    await page.goBack();
    await expect(page.getByRole('heading', { level: 1, name: TASK_TITLE })).toBeVisible({
      timeout: 30_000,
    });
    await expect(studied).toBeVisible();
    expect(await seconds()).toBeGreaterThanOrEqual(before);
  });

  test('Sessione senza documenti: scegliere un argomento sblocca la generazione', async ({
    page,
    request,
    baseURL,
  }) => {
    test.setTimeout(90_000);
    const seed = await seedSession(request, baseURL!, { items: false });
    slug = seed.slug;
    await openSession(page, seed);
    const generate = page.getByRole('button', { name: /^Genera punti chiave ed esercizi/ });
    await expect(generate).toBeDisabled({ timeout: 20_000 });
    await expect(page.getByText(/Nessun documento in questa sessione/)).toBeVisible();

    await page.getByRole('button', { name: /^Argomenti \(0\)$/ }).click();
    const sheet = page.getByRole('dialog', { name: 'Argomenti della sessione' });
    // Il pallino del dev overlay di Next copre il checkbox: si clicca sull'etichetta.
    await sheet.getByText('Termodinamica', { exact: true }).click({ timeout: 20_000 });
    await expect(sheet.getByRole('checkbox', { name: 'Termodinamica' })).toBeChecked();
    // L'input è 20px ma l'area toccabile è l'etichetta intera.
    const label = sheet.locator('label').filter({ hasText: 'Termodinamica' });
    expect((await label.boundingBox())!.height).toBeGreaterThanOrEqual(43.5);
    await page.keyboard.press('Escape');
    await expect(sheet).toHaveCount(0);

    await expect(page.getByRole('button', { name: /^Argomenti \(1\)$/ })).toBeVisible({
      timeout: 20_000,
    });
    await expect(generate).toBeEnabled({ timeout: 20_000 });
    await expect(page.getByText(/Nessun documento in questa sessione/)).toHaveCount(0);
  });

  test('Termina: lo sheet di conferma si può annullare; confermando si passa alla chiusura con minuti e conteggi', async ({
    page,
    request,
    baseURL,
  }) => {
    test.setTimeout(90_000);
    const seed = await seedSession(request, baseURL!, {
      exerciseStates: ['correct', 'wrong', 'wrong'],
    });
    slug = seed.slug;
    // 25 minuti di studio già accumulati: il timer riparte da qui.
    await db
      .update(studySessions)
      .set({ activeMs: 25 * 60_000 })
      .where(eq(studySessions.id, seed.sessionId));
    await openSession(page, seed);

    await page.getByRole('button', { name: 'Termina', exact: true }).click();
    const sheet = page.getByRole('dialog', { name: 'Terminare la sessione?' });
    await expect(sheet).toBeVisible();
    expect(await smallTargets(page, '[role="dialog"]')).toEqual([]);
    await sheet.getByRole('button', { name: 'Continua a studiare' }).click();
    await expect(sheet).toHaveCount(0);
    await expect(page.getByRole('heading', { level: 1, name: TASK_TITLE })).toBeVisible();

    await page.getByRole('button', { name: 'Termina', exact: true }).click();
    await sheet.getByRole('button', { name: 'Termina la sessione' }).click();

    const closing = page.getByRole('heading', { level: 1, name: 'Sessione terminata' });
    await expect(closing).toBeVisible({ timeout: 30_000 });
    await expect(closing).toBeFocused();
    const summary = page.getByRole('region', { name: 'Riepilogo della sessione' });
    await expect(summary.locator('dd').nth(0)).toHaveText(/^(25|26)m$/);
    await expect(summary.locator('dd').nth(1)).toHaveText('1');
    await expect(summary.locator('dd').nth(2)).toHaveText('2');
    expect(
      (await db.select().from(studySessions).where(eq(studySessions.id, seed.sessionId)))[0]!
        .status,
    ).toBe('ended');

    await expect(page.locator('header').filter({ hasText: 'StudyHub' })).toBeHidden();
    await noHorizontalScroll(page);
    expect(await smallTargets(page, 'body')).toEqual([]);
  });
});

test.describe('Materia mobile — Chiusura', () => {
  let slug: string | undefined;

  test.afterEach(async ({ request, baseURL }) => {
    if (slug) await deleteSubject(request, baseURL!, slug);
    slug = undefined;
  });

  test('Sessione già terminata aperta da URL: chiusura diretta con i conteggi', async ({
    page,
    request,
    baseURL,
  }) => {
    test.setTimeout(90_000);
    const seed = await seedSession(request, baseURL!, {
      exerciseStates: ['correct', 'correct', 'wrong'],
    });
    slug = seed.slug;
    await endSession(request, baseURL!, seed, 48 * 60_000);
    await page.goto(sessionUrl(seed));

    await expect(page.getByRole('heading', { level: 1, name: 'Sessione terminata' })).toBeVisible({
      timeout: 30_000,
    });
    const summary = page.getByRole('region', { name: 'Riepilogo della sessione' });
    await expect(summary.locator('dd').nth(0)).toHaveText('48m');
    await expect(summary.locator('dd').nth(1)).toHaveText('2', { timeout: 20_000 });
    await expect(summary.locator('dd').nth(2)).toHaveText('1');
    await expect(page.getByRole('link', { name: 'Chiudi' })).toHaveAttribute(
      'href',
      `/materie/${seed.slug}`,
    );
    await noHorizontalScroll(page);
    expect(await smallTargets(page, 'body')).toEqual([]);
  });

  test('Crea flashcard dai punti chiave: mostra il mazzo creato col link e lo ricorda dopo il reload', async ({
    page,
    request,
    baseURL,
  }) => {
    test.setTimeout(90_000);
    const seed = await seedSession(request, baseURL!);
    slug = seed.slug;
    await endSession(request, baseURL!, seed, 20 * 60_000);
    await page.goto(sessionUrl(seed));

    const region = page.getByRole('region', { name: 'Flashcard dai punti chiave' });
    await region.getByRole('button', { name: /^Crea 3 flashcard$/ }).click({ timeout: 30_000 });
    await expect(region).toContainText('Mazzo creato', { timeout: 30_000 });
    const link = region.getByRole('link', { name: /Apri il mazzo/ });
    await expect(link).toHaveAttribute('href', new RegExp(`/materie/${seed.slug}/artifacts/.+`));

    await page.reload();
    await expect(
      page
        .getByRole('region', { name: 'Flashcard dai punti chiave' })
        .getByRole('link', { name: /Apri il mazzo/ }),
    ).toBeVisible({ timeout: 30_000 });
  });

  test('Crea il drill dagli esercizi sbagliati: mostra il drill creato col link; senza errori il drill non è proposto', async ({
    page,
    request,
    baseURL,
  }) => {
    test.setTimeout(90_000);
    const seed = await seedSession(request, baseURL!, {
      exerciseStates: ['correct', 'wrong', 'wrong'],
    });
    slug = seed.slug;
    await endSession(request, baseURL!, seed, 20 * 60_000);
    await page.goto(sessionUrl(seed));

    const region = page.getByRole('region', { name: 'Esercizi sbagliati nei drill' });
    await expect(region).toContainText('2 esercizi da rifare', { timeout: 30_000 });
    await region.getByRole('button', { name: 'Crea il drill' }).click();
    await expect(region).toContainText('Drill creato', { timeout: 30_000 });
    await expect(region.getByRole('link', { name: /Apri il drill/ })).toHaveAttribute(
      'href',
      new RegExp(`/materie/${seed.slug}/simulations/.+`),
    );
    await noHorizontalScroll(page);
  });

  test('Nessun esercizio sbagliato: niente bottone "Crea il drill"', async ({
    page,
    request,
    baseURL,
  }) => {
    test.setTimeout(90_000);
    const seed = await seedSession(request, baseURL!, {
      exerciseStates: ['correct', 'correct', 'correct'],
    });
    slug = seed.slug;
    await endSession(request, baseURL!, seed, 10 * 60_000);
    await page.goto(sessionUrl(seed));
    const region = page.getByRole('region', { name: 'Esercizi sbagliati nei drill' });
    await expect(region).toContainText('Nessun esercizio segnato come sbagliato', {
      timeout: 30_000,
    });
    await expect(region.getByRole('button', { name: 'Crea il drill' })).toHaveCount(0);
  });

  test('Esercizi sbagliati senza fonte: nessun "Crea il drill", compare il motivo', async ({
    page,
    request,
    baseURL,
  }) => {
    test.setTimeout(90_000);
    const seed = await seedSession(request, baseURL!, {
      exerciseStates: ['wrong', 'wrong', 'correct'],
      exerciseCitations: false,
    });
    slug = seed.slug;
    await endSession(request, baseURL!, seed, 10 * 60_000);
    await page.goto(sessionUrl(seed));
    const region = page.getByRole('region', { name: 'Esercizi sbagliati nei drill' });
    await expect(region).toContainText(
      'Gli esercizi sbagliati non hanno una fonte: niente drill.',
      {
        timeout: 30_000,
      },
    );
    await expect(region.getByRole('button', { name: 'Crea il drill' })).toHaveCount(0);
  });

  test('"Alla materia" torna alla materia', async ({ page, request, baseURL }) => {
    test.setTimeout(90_000);
    const seed = await seedSession(request, baseURL!);
    slug = seed.slug;
    await endSession(request, baseURL!, seed, 10 * 60_000);
    await page.goto(sessionUrl(seed));
    await page.getByRole('link', { name: 'Alla materia' }).click({ timeout: 30_000 });
    await expect(page).toHaveURL(new RegExp(`/materie/${seed.slug}$`), { timeout: 30_000 });
  });

  test('"Prossima task" è presente solo se c’è un’altra task aperta di oggi', async ({
    page,
    request,
    baseURL,
  }) => {
    test.setTimeout(120_000);
    const seed = await seedSession(request, baseURL!, { nextTask: true });
    slug = seed.slug;
    await endSession(request, baseURL!, seed, 10 * 60_000);
    await page.goto(sessionUrl(seed));
    await expect(page.getByText(`Prossima: ${NEXT_TASK_TITLE} · 30 min`)).toBeVisible({
      timeout: 30_000,
    });
    const next = page.getByRole('button', { name: 'Prossima task' });
    await expect(next).toBeVisible();
    expect((await next.boundingBox())!.height).toBeGreaterThanOrEqual(43.5);
    await expect(page.getByRole('link', { name: 'Alla materia' })).toBeVisible();
    await noHorizontalScroll(page);
  });

  test('Senza altre task di oggi la CTA "Prossima task" è omessa', async ({
    page,
    request,
    baseURL,
  }) => {
    test.setTimeout(90_000);
    const seed = await seedSession(request, baseURL!, { nextTask: false });
    slug = seed.slug;
    await endSession(request, baseURL!, seed, 10 * 60_000);
    await page.goto(sessionUrl(seed));
    await expect(page.getByRole('link', { name: 'Alla materia' })).toBeVisible({
      timeout: 30_000,
    });
    // Aspetta che le task di oggi siano arrivate prima di asserire l'assenza.
    await expect(page.getByRole('region', { name: 'Flashcard dai punti chiave' })).toBeVisible();
    await page.waitForLoadState('networkidle');
    await expect(page.getByRole('button', { name: 'Prossima task' })).toHaveCount(0);
    await expect(page.getByText(/^Prossima:/)).toHaveCount(0);
  });
});
