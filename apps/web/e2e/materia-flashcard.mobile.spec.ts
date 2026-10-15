import { randomUUID } from 'node:crypto';
import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { artifacts, createDb, flashcards } from '@studyhub/db';

/**
 * Slice 3 della materia mobile (docs/design/materia-mobile): tab Flashcard, Revisione della bozza e
 * Ripasso a 375×812. Gira solo nel progetto `mobile` (playwright.config.ts).
 *
 * Le card "vere" si creano via API; la bozza del mazzo (e le card in più per la paginazione) si
 * inseriscono direttamente con `@studyhub/db`, senza passare dal provider AI.
 */

test.use({ viewport: { width: 375, height: 812 } });

const db = createDb(process.env.DATABASE_URL);

interface Seed {
  name: string;
  slug: string;
  draftId: string;
  subjectId: string;
  deckId: string;
  topicIds: { calore: string; moto: string };
}

const FRONTS = {
  calore: ['Entropia uno', 'Entropia due', 'Entropia tre'],
  moto: ['Velocita uno', 'Velocita due', 'Velocita tre'],
};
const DRAFT_TITLE = 'Bozza termodinamica';
const DRAFT_FRONTS = ['Bozza alfa', 'Bozza beta', 'Bozza gamma'];

async function seed(request: APIRequestContext, baseURL: string, extra = 0): Promise<Seed> {
  const name = `E2E Flashcard ${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  const { subject } = await (
    await request.post(`${baseURL}/api/subjects`, { data: { name, color: 'teal' } })
  ).json();
  const slug: string = subject.slug;
  const { deck } = await (
    await request.post(`${baseURL}/api/subjects/${slug}/decks`, { data: { title: 'Mazzo e2e' } })
  ).json();
  const topic = async (n: string) =>
    (
      await (
        await request.post(`${baseURL}/api/subjects/${slug}/topics`, { data: { name: n } })
      ).json()
    ).topic.id as string;
  const calore = await topic('Calore');
  const moto = await topic('Moto');

  for (const [topicId, fronts] of [
    [calore, FRONTS.calore],
    [moto, FRONTS.moto],
  ] as const) {
    for (const front of fronts) {
      const res = await request.post(`${baseURL}/api/subjects/${slug}/flashcards`, {
        data: { deckId: deck.id, topicId, front, back: `Risposta a ${front}` },
      });
      expect(res.status()).toBe(201);
    }
  }

  if (extra > 0) {
    await db.insert(flashcards).values(
      Array.from({ length: extra }, (_, i) => ({
        id: randomUUID(),
        deckId: deck.id as string,
        topicId: calore,
        type: 'basic' as const,
        front: `Riempitivo ${String(i).padStart(3, '0')}`,
        back: 'x',
      })),
    );
  }

  const draftId = randomUUID();
  await db.insert(artifacts).values({
    id: draftId,
    subjectId: subject.id as string,
    kind: 'flashcard_deck',
    title: DRAFT_TITLE,
    path: `decks/${draftId}.json`,
    status: 'draft',
    model: 'fake',
    promptVersion: 'e2e',
  });
  await db.insert(flashcards).values(
    DRAFT_FRONTS.map((front) => ({
      id: randomUUID(),
      deckId: draftId,
      topicId: null,
      type: 'basic' as const,
      front,
      back: `Risposta a ${front}`,
    })),
  );

  return {
    name,
    slug,
    draftId,
    subjectId: subject.id as string,
    deckId: deck.id as string,
    topicIds: { calore, moto },
  };
}

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

const tabUrl = (s: Seed) => `/materie/${s.slug}?tab=flashcard`;

test.describe('Materia mobile — Flashcard, Revisione e Ripasso', () => {
  let s: Seed;

  test.beforeEach(async ({ request, baseURL }, info) => {
    s = await seed(request, baseURL!, info.title.includes('Mostra altre') ? 55 : 0);
  });

  test.afterEach(async ({ request, baseURL }) => {
    await request.delete(`${baseURL}/api/subjects/${s.slug}`);
  });

  test('Tab Flashcard: vista mobile con ripasso, grafici, lista e nessuno scroll orizzontale', async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await page.goto(tabUrl(s));

    const hero = page.getByRole('region', { name: 'Ripasso di oggi' });
    await expect(hero).toBeVisible({ timeout: 30_000 });
    await expect(hero.getByRole('link', { name: 'Inizia il ripasso' })).toHaveAttribute(
      'href',
      `/ripasso?materia=${s.slug}`,
    );
    for (const label of ['Nuove', 'In apprendimento', 'In ripasso', 'Da rinforzare']) {
      await expect(hero.getByText(label, { exact: true })).toBeVisible();
    }
    await expect(page.getByRole('region', { name: 'Prossimi 30 giorni' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Ritenzione: reale vs prevista' })).toBeVisible();

    // Righe con nome "front, stato" (le card sono nuove).
    await expect(page.getByRole('button', { name: 'Entropia uno, Nuova' })).toBeVisible();
    await expect(page.getByRole('group', { name: 'Filtra per argomento' })).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Strumenti del mazzo e calibrazione' }),
    ).toHaveAttribute('aria-expanded', 'false');

    // È la vista mobile: nessun pannello desktop con i filtri per mazzo/stato.
    await expect(page.getByLabel('Filtra per mazzo')).toHaveCount(0);
    await noHorizontalScroll(page);
  });

  test('Ricerca e filtro per argomento riducono la lista', async ({ page }) => {
    test.setTimeout(90_000);
    await page.goto(tabUrl(s));
    const row = (front: string) => page.getByRole('button', { name: new RegExp(`^${front}, `) });
    await expect(row('Entropia uno')).toBeVisible({ timeout: 30_000 });
    await expect(row('Velocita uno')).toBeVisible();

    // Chip argomento
    const group = page.getByRole('group', { name: 'Filtra per argomento' });
    await expect(group.getByRole('button', { name: /^Tutte/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await group.getByRole('button', { name: /^Moto/ }).click();
    await expect(group.getByRole('button', { name: /^Moto/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(group.getByRole('button', { name: /^Tutte/ })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    await expect(row('Velocita uno')).toBeVisible();
    await expect(row('Entropia uno')).toHaveCount(0);
    await group.getByRole('button', { name: /^Tutte/ }).click();
    await expect(row('Entropia uno')).toBeVisible();

    // Ricerca testuale (debounce 250 ms)
    await page.getByRole('button', { name: 'Cerca tra le flashcard' }).click();
    await page.getByRole('searchbox', { name: 'Cerca nelle card' }).fill('Entropia due');
    await expect(row('Entropia due')).toBeVisible();
    await expect(row('Entropia uno')).toHaveCount(0);
    await expect(row('Velocita uno')).toHaveCount(0);

    // Nessun risultato
    await page.getByRole('searchbox', { name: 'Cerca nelle card' }).fill('zzzzqqq');
    await expect(page.getByText('Nessuna flashcard corrisponde ai filtri.')).toBeVisible();
    await noHorizontalScroll(page);
  });

  test('Mostra altre carica la pagina successiva', async ({ page }) => {
    test.setTimeout(90_000);
    await page.goto(tabUrl(s));
    const rows = page.locator('button[aria-haspopup="dialog"][aria-label*=", "]');
    await expect(rows.first()).toBeVisible({ timeout: 30_000 });
    const first = await rows.count();
    expect(first).toBeGreaterThanOrEqual(50);
    await page.getByRole('button', { name: 'Mostra altre' }).click();
    await expect.poll(() => rows.count(), { timeout: 20_000 }).toBeGreaterThan(first);
  });

  test('Dettaglio card: apre lo sheet e Sospendi aggiorna la riga', async ({ page }) => {
    test.setTimeout(90_000);
    await page.goto(tabUrl(s));
    await page.getByRole('button', { name: 'Entropia uno, Nuova' }).click({ timeout: 30_000 });
    const sheet = page.getByRole('dialog', { name: 'Card' });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByText('Risposta a Entropia uno')).toBeVisible();
    await expect(sheet.getByRole('button', { name: 'Modifica' })).toBeVisible();

    await sheet.getByRole('button', { name: 'Sospendi' }).click();
    await expect(sheet).toHaveCount(0, { timeout: 20_000 });
    await expect(page.getByRole('button', { name: 'Entropia uno, Nuova, sospesa' })).toBeVisible({
      timeout: 20_000,
    });

    // Riattiva
    await page.getByRole('button', { name: 'Entropia uno, Nuova, sospesa' }).click();
    await page
      .getByRole('dialog', { name: 'Card' })
      .getByRole('button', { name: 'Riattiva' })
      .click();
    await expect(
      page.getByRole('button', { name: 'Entropia uno, Nuova', exact: true }),
    ).toBeVisible({ timeout: 20_000 });
  });

  test('Dettaglio card: Elimina chiede conferma e rimuove la riga', async ({ page }) => {
    test.setTimeout(90_000);
    await page.goto(tabUrl(s));
    await page.getByRole('button', { name: 'Velocita tre, Nuova' }).click({ timeout: 30_000 });
    const sheet = page.getByRole('dialog', { name: 'Card' });
    await sheet.getByRole('button', { name: 'Elimina' }).click();
    await expect(sheet.getByRole('button', { name: 'Annulla' })).toBeFocused();
    await sheet.getByRole('button', { name: 'Sì, elimina' }).click();
    await expect(sheet).toHaveCount(0, { timeout: 20_000 });
    await expect(page.getByRole('button', { name: 'Velocita tre, Nuova' })).toHaveCount(0, {
      timeout: 20_000,
    });
    await expect(page.getByRole('button', { name: 'Velocita due, Nuova' })).toBeVisible();
  });

  test('Il link della bozza apre la Revisione: Tieni, Scarta, Modifica, Approva e ritorno', async ({
    page,
  }) => {
    test.setTimeout(150_000);
    await page.goto(tabUrl(s));
    const draftLink = page.getByRole('link', { name: /1 mazzo da approvare/ });
    await expect(draftLink).toBeVisible({ timeout: 30_000 });
    await expect(draftLink).toContainText(DRAFT_TITLE);
    await expect(draftLink).toContainText('3 card');
    await expect(draftLink).toHaveAttribute('href', `/materie/${s.slug}/artifacts/${s.draftId}`);
    await draftLink.click();
    await expect(page).toHaveURL(new RegExp(`/artifacts/${s.draftId}$`), { timeout: 30_000 });

    // Header globale e tab bar nascosti, header di sottopagina con contatore.
    await expect(page.locator('header').filter({ hasText: 'StudyHub' })).toBeHidden();
    await expect(page.getByRole('navigation', { name: 'Navigazione principale' })).toBeHidden();
    await expect(page.getByRole('link', { name: 'Chiudi la revisione' })).toHaveAttribute(
      'href',
      `/materie/${s.slug}?tab=flashcard`,
    );
    await expect(page.getByRole('heading', { level: 1, name: DRAFT_TITLE })).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByLabel('0 card esaminate su 3')).toBeVisible();
    const status = page.getByRole('status').filter({ hasText: 'da vedere' });
    await expect(status).toHaveText(/0 tenute\s*·\s*0 scartate\s*·\s*3 da vedere/);
    await noHorizontalScroll(page);

    // Tieni alfa, Scarta beta (reversibile), Modifica gamma.
    const keepAlfa = page.getByRole('button', { name: 'Tieni: Bozza alfa' });
    const dropBeta = page.getByRole('button', { name: 'Scarta: Bozza beta' });
    await keepAlfa.click();
    await expect(keepAlfa).toHaveAttribute('aria-pressed', 'true');
    await dropBeta.click();
    await expect(dropBeta).toHaveAttribute('aria-pressed', 'true');
    await expect(status).toHaveText(/1 tenute\s*·\s*1 scartate\s*·\s*1 da vedere/);
    await expect(page.getByLabel('2 card esaminate su 3')).toBeVisible();

    // Scarta è reversibile
    await dropBeta.click();
    await expect(dropBeta).toHaveAttribute('aria-pressed', 'false');
    await expect(status).toHaveText(/1 tenute\s*·\s*0 scartate\s*·\s*2 da vedere/);
    await dropBeta.click();
    await expect(status).toHaveText(/1 tenute\s*·\s*1 scartate\s*·\s*1 da vedere/);

    await page.getByRole('button', { name: 'Modifica: Bozza gamma' }).click();
    const edit = page.getByRole('dialog', { name: 'Modifica card' });
    await expect(edit).toBeVisible();
    await edit.getByLabel('Fronte').fill('Bozza gamma corretta');
    await edit.getByRole('button', { name: 'Salva' }).click();
    await expect(edit).toHaveCount(0, { timeout: 20_000 });
    await expect(page.getByText('Bozza gamma corretta').first()).toBeVisible();
    // I marchi non si perdono con la modifica.
    await expect(keepAlfa).toHaveAttribute('aria-pressed', 'true');
    await expect(dropBeta).toHaveAttribute('aria-pressed', 'true');

    // Annulla non salva.
    await page.getByRole('button', { name: 'Modifica: Bozza gamma corretta' }).click();
    await edit.getByLabel('Fronte').fill('non salvare');
    await edit.getByRole('button', { name: 'Annulla' }).click();
    await expect(edit).toHaveCount(0);
    await expect(page.getByText('non salvare')).toHaveCount(0);

    // Approva: la scartata sparisce, si torna alla tab e la bozza non c'è più.
    await page.getByRole('button', { name: 'Approva il mazzo' }).click();
    await expect(page).toHaveURL(new RegExp(`/materie/${s.slug}\\?tab=flashcard`), {
      timeout: 30_000,
    });
    await expect(page.getByRole('region', { name: 'Ripasso di oggi' })).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByRole('link', { name: /mazzo da approvare/ })).toHaveCount(0, {
      timeout: 20_000,
    });
    await expect(page.getByRole('button', { name: /^Bozza alfa, / })).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByRole('button', { name: /^Bozza gamma corretta, / })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Bozza beta, / })).toHaveCount(0);

    // La scartata è stata eliminata davvero.
    const left = await page.request.get(
      `/api/subjects/${s.slug}/artifacts/${s.draftId}/flashcards`,
    );
    const body = await left.json();
    const fronts = (body.cards ?? body.flashcards ?? []).map((c: { front: string }) => c.front);
    expect(fronts).not.toContain('Bozza beta');
  });

  test('Revisione: "Chiudi la revisione" torna a ?tab=flashcard senza cambiare il mazzo', async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await page.goto(`/materie/${s.slug}/artifacts/${s.draftId}`);
    await page.getByRole('button', { name: 'Scarta: Bozza alfa' }).click({ timeout: 30_000 });
    await page.getByRole('link', { name: 'Chiudi la revisione' }).click();
    await expect(page).toHaveURL(new RegExp(`/materie/${s.slug}\\?tab=flashcard`), {
      timeout: 30_000,
    });
    // Nulla è stato inviato: la bozza c'è ancora con 3 card.
    await expect(page.getByRole('link', { name: /1 mazzo da approvare/ })).toContainText('3 card', {
      timeout: 30_000,
    });
    await expect(page.getByRole('navigation', { name: 'Navigazione principale' })).toBeVisible();
  });

  test('Ripasso dalla CTA della materia: sessione completa e "Torna alla materia"', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await page.goto(tabUrl(s));
    await page.getByRole('link', { name: 'Inizia il ripasso' }).click({ timeout: 30_000 });
    await expect(page).toHaveURL(new RegExp(`/ripasso\\?materia=${s.slug}`), { timeout: 30_000 });

    const session = page.getByRole('dialog');
    const position = session.locator('p.font-mono').first();
    // La coda include anche le 3 card della bozza (review.ts non filtra per stato dell'artefatto).
    await expect(position).toHaveText(/^1 \/ \d+$/, { timeout: 30_000 });
    const total = Number((await position.innerText()).split('/')[1]);
    expect(total).toBeGreaterThanOrEqual(6);
    await expect(page.getByRole('navigation', { name: 'Navigazione principale' })).toBeHidden();

    for (let i = 0; i < total; i += 1) {
      await session.getByRole('button', { name: 'Mostra risposta' }).click();
      await session.getByRole('button', { name: /^Bene, prossimo ripasso/ }).click();
    }
    await expect(session.getByRole('heading', { name: 'Sessione completata' })).toBeVisible({
      timeout: 20_000,
    });
    // Le valutazioni in volo devono essersi salvate, altrimenti la chiusura resta su /ripasso.
    await page.waitForLoadState('networkidle');
    await session.getByRole('button', { name: 'Torna alla materia' }).click();
    await expect(page).toHaveURL(new RegExp(`/materie/${s.slug}\\?tab=flashcard`), {
      timeout: 30_000,
    });
    // Numeri aggiornati: nessuna card da ripassare.
    await expect(
      page.getByRole('region', { name: 'Ripasso di oggi' }).getByText('Nessuna card da ripassare'),
    ).toBeVisible({ timeout: 30_000 });
  });

  test('Ripasso: la fonte è un link che non rivela la card; senza sourceRef non compare', async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await page.goto(`/ripasso?materia=${s.slug}&n=2`);
    const session = page.getByRole('dialog');
    await expect(session.locator('p.font-mono').first()).toHaveText('1 / 2', { timeout: 30_000 });
    // Le card del seed non hanno sourceRef.
    await expect(session.getByRole('link', { name: 'Apri la fonte nel documento' })).toHaveCount(0);
    await session.getByRole('button', { name: 'Chiudi sessione' }).click();
    await expect(page).toHaveURL(new RegExp(`/materie/${s.slug}\\?tab=flashcard`), {
      timeout: 30_000,
    });
  });

  test('Revisione: durante l’approvazione Tieni, Scarta e Modifica sono disabilitati', async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await page.route('**/api/subjects/*/artifacts/*/approve', async (route) => {
      await new Promise((r) => setTimeout(r, 4_000));
      await route.continue();
    });
    await page.goto(`/materie/${s.slug}/artifacts/${s.draftId}`);
    const keep = page.getByRole('button', { name: 'Tieni: Bozza alfa' });
    await expect(keep).toBeEnabled({ timeout: 30_000 });
    await page.getByRole('button', { name: 'Approva il mazzo' }).click();
    await expect(page.getByRole('button', { name: 'Approvo…' })).toBeDisabled();
    await expect(keep).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Scarta: Bozza alfa' })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Modifica: Bozza alfa' })).toBeDisabled();
    await expect(page).toHaveURL(new RegExp(`/materie/${s.slug}\\?tab=flashcard`), {
      timeout: 30_000,
    });
  });

  test('Revisione: un mazzo già approvato è in sola lettura', async ({
    page,
    request,
    baseURL,
  }) => {
    test.setTimeout(90_000);
    const res = await request.post(
      `${baseURL}/api/subjects/${s.slug}/artifacts/${s.draftId}/approve`,
    );
    expect(res.ok()).toBe(true);
    await page.goto(`/materie/${s.slug}/artifacts/${s.draftId}`);
    await expect(page.getByText('Mazzo già approvato.')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('button', { name: 'Tieni: Bozza alfa' })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Scarta: Bozza alfa' })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Approva il mazzo' })).toHaveCount(0);
  });

  test('Ripasso con deep link: se la valutazione non si salva, chiudere non naviga', async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await page.route('**/api/subjects/*/review/*', (route) =>
      route.request().method() === 'POST'
        ? route.fulfill({ status: 500, json: { error: { message: 'boom' } } })
        : route.continue(),
    );
    await page.goto(`/ripasso?materia=${s.slug}&n=2`);
    const session = page.getByRole('dialog');
    await expect(session.locator('p.font-mono').first()).toHaveText('1 / 2', { timeout: 30_000 });
    await session.getByRole('button', { name: 'Mostra risposta' }).click();
    await session.getByRole('button', { name: /^Bene, prossimo ripasso/ }).click();
    const toast = page.getByRole('alert').filter({ hasText: 'Valutazione non salvata' });
    await expect(toast).toBeVisible({ timeout: 30_000 });

    await session.getByRole('button', { name: 'Chiudi sessione' }).click();
    // Con la valutazione in errore la chiusura è bloccata: sessione e toast restano, niente navigazione.
    await page.waitForTimeout(1_000);
    expect(new URL(page.url()).pathname).toBe('/ripasso');
    await expect(toast).toBeVisible();
    await expect(toast.getByRole('button', { name: 'Riprova' })).toBeVisible();
  });

  test('Ripasso con deep link: a fine sessione non si torna a una materia diversa', async ({
    page,
    request,
    baseURL,
  }) => {
    test.setTimeout(120_000);
    // Materia A (deep link) senza card dovute; la sessione parte da B, avviata dalla home.
    const { subject: a } = await (
      await request.post(`${baseURL}/api/subjects`, {
        data: { name: `E2E Vuota ${Date.now()}`, color: 'blue' },
      })
    ).json();
    try {
      await page.goto(`/ripasso?materia=${a.slug}`);
      await page
        .getByRole('button', { name: new RegExp(`^Ripassa ${s.name}, `) })
        .click({ timeout: 30_000 });
      const session = page.getByRole('dialog');
      await expect(session.locator('p.font-mono').first()).toHaveText(/^1 \/ \d+$/, {
        timeout: 30_000,
      });
      const total = Number(
        (await session.locator('p.font-mono').first().innerText()).split('/')[1],
      );
      for (let i = 0; i < total; i += 1) {
        await session.getByRole('button', { name: 'Mostra risposta' }).click();
        await session.getByRole('button', { name: /^Bene, prossimo ripasso/ }).click();
      }
      await expect(session.getByRole('heading', { name: 'Sessione completata' })).toBeVisible({
        timeout: 20_000,
      });
      await expect(session.getByRole('button', { name: 'Torna alla materia' })).toHaveCount(0);
      await session.getByRole('button', { name: 'Torna alle materie' }).click();
      await page.waitForTimeout(1_000);
      expect(page.url()).not.toContain(`/materie/${a.slug}`);
      expect(new URL(page.url()).pathname).toBe('/ripasso');
    } finally {
      await request.delete(`${baseURL}/api/subjects/${a.slug}`);
    }
  });

  test('Ripasso con deep link: "Torna alla materia" con l’ultima valutazione ancora in volo', async ({
    page,
  }) => {
    test.setTimeout(60_000);
    await page.route('**/api/subjects/*/review/*', async (route) => {
      if (route.request().method() === 'POST') await new Promise((r) => setTimeout(r, 3_000));
      await route.continue();
    });
    await page.goto(`/ripasso?materia=${s.slug}&n=2`);
    const session = page.getByRole('dialog');
    await expect(session.locator('p.font-mono').first()).toHaveText('1 / 2', { timeout: 30_000 });
    for (let i = 0; i < 2; i += 1) {
      await session.getByRole('button', { name: 'Mostra risposta' }).click();
      await session.getByRole('button', { name: /^Bene, prossimo ripasso/ }).click();
    }
    await session.getByRole('button', { name: 'Torna alla materia' }).click();
    await expect(page).toHaveURL(new RegExp(`/materie/${s.slug}\\?tab=flashcard`), {
      timeout: 15_000,
    });
  });

  test('Nessuno scroll orizzontale su tab Flashcard, Revisione e Ripasso', async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto(tabUrl(s));
    await expect(page.getByRole('region', { name: 'Ripasso di oggi' })).toBeVisible({
      timeout: 30_000,
    });
    await noHorizontalScroll(page);
    await page.goto(`/materie/${s.slug}/artifacts/${s.draftId}`);
    await expect(page.getByRole('button', { name: 'Tieni: Bozza alfa' })).toBeVisible({
      timeout: 30_000,
    });
    await noHorizontalScroll(page);
    await page.goto(`/ripasso?materia=${s.slug}`);
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 30_000 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
    ).toBe(0);
  });
});
