import { randomUUID } from 'node:crypto';
import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { and, eq } from 'drizzle-orm';
import { chunks, documents, jobs, settings } from '@studyhub/db';
import { db, deleteSubject, seedCoverage, type CoverageSeed } from './fixtures/lacune-piano-seed';

/**
 * Slice D dei residui mobile: nello sheet Azioni, "Chiedi" (risposta singola in streaming con
 * citazioni, nessuno storico) e la tile "Esercizi" (drill su 1..5 argomenti) a 375×812.
 * L'AI è il FakeProvider del server (AI_PROVIDER=fake). Gira solo nel progetto `mobile`.
 */

test.use({ viewport: { width: 375, height: 812 } });

const QUESTION = 'Cosa afferma il primo principio della termodinamica?';
const PASSAGE = 'Il primo principio della termodinamica afferma che l’energia si conserva.';

async function noHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBe(0);
}

async function docIdOf(subjectId: string, name: string): Promise<string> {
  const [row] = await db
    .select({ id: documents.id })
    .from(documents)
    .where(and(eq(documents.subjectId, subjectId), eq(documents.originalName, name)));
  return row!.id;
}

/** Il parser non gira in e2e: il testo recuperabile del documento si inserisce a mano. */
async function addChunk(documentId: string, text: string, page = 3) {
  await db.insert(chunks).values({
    id: randomUUID(),
    documentId,
    pageFrom: page,
    pageTo: page,
    ord: 0,
    text,
    tokens: text.split(/\s+/).length,
  });
}

async function addTopics(
  request: APIRequestContext,
  baseURL: string,
  slug: string,
  names: string[],
): Promise<string[]> {
  const ids: string[] = [];
  for (const name of names) {
    const res = await request.post(`${baseURL}/api/subjects/${slug}/topics`, { data: { name } });
    expect(res.status()).toBe(201);
    ids.push((await res.json()).topic.id as string);
  }
  return ids;
}

async function openSheet(page: Page, slug: string) {
  await page.goto(`/materie/${slug}`);
  await page.getByRole('button', { name: 'Azioni della materia' }).click({ timeout: 30_000 });
  const dialog = page.getByRole('dialog', { name: 'Assistente' });
  await expect(dialog).toBeVisible();
  return dialog;
}

test.describe('Materia mobile — Chiedi nello sheet Azioni (slice D)', () => {
  let slug: string | undefined;
  let seed: CoverageSeed;

  test.afterEach(async ({ request, baseURL }) => {
    if (slug) await deleteSubject(request, baseURL!, slug);
    slug = undefined;
  });

  test('domanda → risposta dal materiale con citazione cliccabile, senza model nella richiesta e costo nel ledger', async ({
    page,
    request,
    baseURL,
  }) => {
    test.setTimeout(120_000);
    seed = await seedCoverage(request, baseURL!, ['termodinamica']);
    slug = seed.slug;
    await addChunk(await docIdOf(seed.subjectId, 'Termodinamica.pdf'), PASSAGE, 3);

    const dialog = await openSheet(page, seed.slug);
    const input = dialog.getByTestId('ask-input');
    const submit = dialog.getByTestId('ask-submit');
    await expect(submit).toBeDisabled();

    const post = page.waitForRequest(
      (r) => r.method() === 'POST' && r.url().endsWith(`/api/subjects/${seed.slug}/ask`),
    );
    await input.fill(QUESTION);
    await expect(submit).toBeEnabled();
    await submit.click();

    const body = (await post).postDataJSON();
    expect(body.question).toBe(QUESTION);
    expect(body).not.toHaveProperty('model');
    // Nessuna selezione: scope = tutta la materia (né docIds né topicIds).
    expect(body).not.toHaveProperty('docIds');
    expect(body).not.toHaveProperty('topicIds');

    const answer = dialog.getByTestId('ask-answer');
    await expect(dialog.getByTestId('ask-question')).toHaveText(QUESTION);
    await expect(answer).toContainText('Dal materiale', { timeout: 30_000 });
    await expect(answer).toContainText('primo principio');
    await expect(answer).toHaveAttribute('aria-busy', 'false');

    const citation = dialog.getByTestId('ask-citation');
    await expect(citation).toHaveCount(1);
    await expect(citation).toHaveText('[1] Termodinamica.pdf · p. 3');
    await expect(input).toHaveValue('');
    await noHorizontalScroll(page);

    // Costo registrato nel ledger, nessun messaggio salvato (non c'è sessione).
    const ledger = await db
      .select()
      .from(jobs)
      .where(and(eq(jobs.subjectId, seed.subjectId), eq(jobs.type, 'subject_ask')));
    expect(ledger).toHaveLength(1);
    expect(ledger[0]!.status).toBe('succeeded');

    // La citazione porta al documento e chiude lo sheet.
    await citation.click();
    // La pagina documento può compilare a freddo in dev: timeout più largo.
    await expect(page).toHaveURL(/\/documenti\/[0-9a-f-]{36}/, { timeout: 20_000 });
    await expect(page.getByRole('dialog', { name: 'Assistente' })).toHaveCount(0, {
      timeout: 20_000,
    });
  });

  test('con un argomento scelto la richiesta manda topicIds; senza fonti avvisa che la risposta non è ancorata', async ({
    page,
    request,
    baseURL,
  }) => {
    test.setTimeout(120_000);
    seed = await seedCoverage(request, baseURL!, ['termodinamica', 'entropia']);
    slug = seed.slug;
    // Solo il documento di Termodinamica ha testo: l'argomento Entropia non ha fonti recuperabili.
    await addChunk(await docIdOf(seed.subjectId, 'Termodinamica.pdf'), PASSAGE);

    const dialog = await openSheet(page, seed.slug);
    await dialog
      .getByRole('group', { name: 'Materiale selezionato' })
      .getByRole('button', { name: 'Entropia' })
      .click();

    const post = page.waitForRequest(
      (r) => r.method() === 'POST' && r.url().endsWith(`/api/subjects/${seed.slug}/ask`),
    );
    await dialog.getByTestId('ask-input').fill(QUESTION);
    await dialog.getByTestId('ask-submit').click();
    const body = (await post).postDataJSON();
    expect(body.topicIds).toEqual([seed.topicIds.entropia]);
    expect(body).not.toHaveProperty('docIds');

    const answer = dialog.getByTestId('ask-answer');
    await expect(answer).toContainText('Le fonti selezionate non bastano', { timeout: 30_000 });
    await expect(dialog.getByTestId('ask-citation')).toHaveCount(0);
    await expect(answer).toContainText('Nessuna fonte citata');
  });

  test('chiudere lo sheet scarta la risposta (nessuno storico)', async ({
    page,
    request,
    baseURL,
  }) => {
    test.setTimeout(120_000);
    seed = await seedCoverage(request, baseURL!, ['termodinamica']);
    slug = seed.slug;
    await addChunk(await docIdOf(seed.subjectId, 'Termodinamica.pdf'), PASSAGE);

    const dialog = await openSheet(page, seed.slug);
    await dialog.getByTestId('ask-input').fill(QUESTION);
    await dialog.getByTestId('ask-submit').click();
    await expect(dialog.getByTestId('ask-answer')).toContainText('Dal materiale', {
      timeout: 30_000,
    });

    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await page.getByRole('button', { name: 'Azioni della materia' }).click();
    const reopened = page.getByRole('dialog', { name: 'Assistente' });
    await expect(reopened).toBeVisible();
    await expect(reopened.getByTestId('ask-question')).toHaveCount(0);
    await expect(reopened.getByTestId('ask-citation')).toHaveCount(0);
    await expect(reopened.getByTestId('ask-input')).toHaveValue('');
  });

  test('domanda vuota o di soli spazi: invio disabilitato e nessuna richiesta', async ({
    page,
    request,
    baseURL,
  }) => {
    test.setTimeout(90_000);
    seed = await seedCoverage(request, baseURL!, ['termodinamica']);
    slug = seed.slug;
    let asked = 0;
    page.on('request', (r) => {
      if (r.method() === 'POST' && r.url().endsWith('/ask')) asked++;
    });

    const dialog = await openSheet(page, seed.slug);
    const input = dialog.getByTestId('ask-input');
    const submit = dialog.getByTestId('ask-submit');
    await expect(submit).toBeDisabled();
    await input.fill('    ');
    await expect(submit).toBeDisabled();
    await input.press('Enter');
    expect(asked).toBe(0);
    await expect(dialog.getByTestId('ask-question')).toHaveCount(0);
  });

  test('429 budget_exceeded: messaggio chiaro, domanda ripristinata, nessun "Riprova"', async ({
    page,
    request,
    baseURL,
  }) => {
    test.setTimeout(90_000);
    seed = await seedCoverage(request, baseURL!, ['termodinamica']);
    slug = seed.slug;
    await page.route(`**/api/subjects/${seed.slug}/ask`, (route) =>
      route.fulfill({
        status: 429,
        contentType: 'application/json',
        json: {
          error: {
            code: 'budget_exceeded',
            message: 'Budget giornaliero raggiunto. Riprova domani.',
          },
        },
      }),
    );

    const dialog = await openSheet(page, seed.slug);
    await dialog.getByTestId('ask-input').fill(QUESTION);
    await dialog.getByTestId('ask-submit').click();

    const error = dialog.getByTestId('ask-error');
    await expect(error).toHaveText('Budget giornaliero raggiunto. Riprova domani.');
    await expect(dialog.getByTestId('ask-retry')).toHaveCount(0);
    await expect(dialog.getByTestId('ask-input')).toHaveValue(QUESTION);
    await noHorizontalScroll(page);
  });

  test('errore di rete/server durante lo stream: messaggio con "Riprova" che rinvia la stessa domanda', async ({
    page,
    request,
    baseURL,
  }) => {
    test.setTimeout(90_000);
    seed = await seedCoverage(request, baseURL!, ['termodinamica']);
    slug = seed.slug;
    let calls = 0;
    await page.route(`**/api/subjects/${seed.slug}/ask`, (route) => {
      calls++;
      if (calls === 1) {
        return route.fulfill({
          status: 200,
          contentType: 'text/event-stream',
          body: `data: ${JSON.stringify({ type: 'delta', text: 'Inizio…' })}\n\ndata: ${JSON.stringify({ type: 'error', message: 'Servizio AI non raggiungibile' })}\n\n`,
        });
      }
      return route.continue();
    });

    const dialog = await openSheet(page, seed.slug);
    await dialog.getByTestId('ask-input').fill(QUESTION);
    await dialog.getByTestId('ask-submit').click();
    await expect(dialog.getByTestId('ask-error')).toHaveText('Servizio AI non raggiungibile');
    const retry = dialog.getByTestId('ask-retry');
    await expect(retry).toBeVisible();
    await retry.click();
    await expect(dialog.getByTestId('ask-error')).toHaveCount(0, { timeout: 30_000 });
    expect(calls).toBe(2);
    await expect(dialog.getByTestId('ask-question')).toHaveText(QUESTION);
  });

  test('API: 400 su domanda vuota/troppo lunga e su documenti di un’altra materia, 404 materia ignota, 429 con budget a zero', async ({
    request,
    baseURL,
  }) => {
    test.setTimeout(90_000);
    seed = await seedCoverage(request, baseURL!, ['termodinamica']);
    slug = seed.slug;
    const url = `${baseURL}/api/subjects/${seed.slug}/ask`;

    const empty = await request.post(url, { data: { question: '' } });
    expect(empty.status()).toBe(400);
    expect((await empty.json()).error.code).toBe('invalid_request');
    expect((await request.post(url, { data: { question: 'x'.repeat(2001) } })).status()).toBe(400);
    const foreign = await request.post(url, {
      data: { question: QUESTION, docIds: [randomUUID()] },
    });
    expect(foreign.status()).toBe(400);
    const unknown = await request.post(`${baseURL}/api/subjects/non-esiste-${randomUUID()}/ask`, {
      data: { question: QUESTION },
    });
    expect(unknown.status()).toBe(404);
    expect((await unknown.json()).error.code).toBe('subject_not_found');

    // Budget giornaliero a zero: 429 prima dello stream. Si ripristina il valore precedente.
    const [prev] = await db.select().from(settings).where(eq(settings.key, 'budget.dailyCapEur'));
    await db
      .insert(settings)
      .values({ key: 'budget.dailyCapEur', value: 0 })
      .onConflictDoUpdate({ target: settings.key, set: { value: 0 } });
    try {
      const over = await request.post(url, { data: { question: QUESTION } });
      expect(over.status()).toBe(429);
      const err = (await over.json()).error;
      expect(err.code).toBe('budget_exceeded');
      expect(err.message).toBe('Budget giornaliero raggiunto. Riprova domani.');
    } finally {
      if (prev) {
        await db.update(settings).set({ value: prev.value }).where(eq(settings.key, prev.key));
      } else {
        await db.delete(settings).where(eq(settings.key, 'budget.dailyCapEur'));
      }
    }
  });
});

test.describe('Materia mobile — Esercizi nello sheet Azioni (slice D)', () => {
  let slug: string | undefined;

  test.afterEach(async ({ request, baseURL }) => {
    if (slug) await deleteSubject(request, baseURL!, slug);
    slug = undefined;
  });

  test('1..5 argomenti: hint, blocco oltre 5, avvio del drill con topicIds e link a Simulazioni', async ({
    page,
    request,
    baseURL,
  }) => {
    test.setTimeout(150_000);
    const seed = await seedCoverage(request, baseURL!, ['termodinamica']);
    slug = seed.slug;
    const extra = ['Entropia', 'Ottica', 'Cinematica', 'Onde', 'Fluidi'];
    const extraIds = await addTopics(request, baseURL!, seed.slug, extra);
    const allNames = ['Termodinamica', ...extra];
    const allIds = [seed.topicIds.termodinamica!, ...extraIds];

    const dialog = await openSheet(page, seed.slug);
    const group = dialog.getByRole('group', { name: 'Materiale selezionato' });
    await dialog.getByTestId('gen-tile-exercises').click();
    await expect(dialog.getByTestId('gen-tile-exercises')).toHaveAttribute('aria-checked', 'true');

    const submit = dialog.getByTestId('gen-submit');
    await expect(submit).toHaveText('Genera esercizi');
    await expect(dialog.getByTestId('exercises-hint')).toHaveText('Scegli almeno un argomento');
    await expect(submit).toBeDisabled();

    // 1 argomento: abilitato, riepilogo singolare.
    await group.getByRole('button', { name: allNames[0]! }).click();
    await expect(dialog.getByTestId('exercises-hint')).toHaveCount(0);
    await expect(dialog.getByText(/^Esercizi su 1 argomento/)).toBeVisible();
    await expect(submit).toBeEnabled();

    // 5 argomenti: ancora ok. Il sesto blocca con l'hint.
    for (const name of allNames.slice(1, 5)) await group.getByRole('button', { name }).click();
    await expect(dialog.getByText(/^Esercizi su 5 argomenti/)).toBeVisible();
    await expect(submit).toBeEnabled();
    await group.getByRole('button', { name: allNames[5]! }).click();
    await expect(dialog.getByTestId('exercises-hint')).toHaveText('Massimo 5 argomenti');
    await expect(submit).toBeDisabled();
    await expect(submit).toHaveAttribute('aria-describedby', 'exercises-hint');

    // Tornato a 5, si avvia.
    await group.getByRole('button', { name: allNames[5]! }).click();
    await expect(submit).toBeEnabled();
    const post = page.waitForResponse(
      (r) => r.request().method() === 'POST' && r.url().endsWith(`/${seed.slug}/simulations`),
    );
    await submit.click();
    const res = await post;
    expect(res.status()).toBe(202);
    const sent = res.request().postDataJSON();
    expect(sent.mode).toBe('drill_argomento');
    expect([...sent.topicIds].sort()).toEqual([...allIds.slice(0, 5)].sort());
    expect(sent).not.toHaveProperty('topicId');

    const started = dialog.getByTestId('exercises-started');
    await expect(started).toContainText('Esercizi in preparazione.');
    const link = started.getByRole('link', { name: 'Vai a Simulazioni' });
    await expect(link).toHaveAttribute('href', `/materie/${seed.slug}?tab=simulazioni`);
    await noHorizontalScroll(page);

    await link.click();
    await expect(page).toHaveURL(new RegExp(`/materie/${seed.slug}\\?tab=simulazioni`));
    await expect(page.getByRole('dialog', { name: 'Assistente' })).toHaveCount(0);
  });

  test('i documenti selezionati sono ignorati dagli esercizi (avviso) e cambiare tile azzera lo stato di avvio', async ({
    page,
    request,
    baseURL,
  }) => {
    test.setTimeout(120_000);
    const seed = await seedCoverage(request, baseURL!, ['termodinamica', 'entropia']);
    slug = seed.slug;
    await page.route(`**/api/subjects/${seed.slug}/simulations`, (route) =>
      route.request().method() === 'POST'
        ? route.fulfill({ status: 202, json: { jobId: randomUUID() } })
        : route.continue(),
    );

    await page.goto(`/materie/${seed.slug}?tab=materiale`);
    const seleziona = page.getByRole('button', { name: 'Seleziona', exact: true });
    await expect(seleziona).toHaveAttribute('aria-pressed', 'false', { timeout: 30_000 });
    await seleziona.click();
    await page.locator('input[type="checkbox"][aria-label^="Seleziona "]').first().check();
    await page.getByRole('button', { name: 'Azioni della materia' }).click();
    const dialog = page.getByRole('dialog', { name: 'Assistente' });
    await dialog.getByTestId('gen-tile-exercises').click();
    await expect(
      dialog.getByText('Gli esercizi usano gli argomenti, non i documenti.'),
    ).toBeVisible();
    await expect(dialog.getByTestId('exercises-hint')).toHaveText('Scegli almeno un argomento');
    await expect(dialog.getByTestId('gen-submit')).toBeDisabled();

    await dialog
      .getByRole('group', { name: 'Materiale selezionato' })
      .getByRole('button', { name: 'Entropia' })
      .click();
    await dialog.getByTestId('gen-submit').click();
    await expect(dialog.getByTestId('exercises-started')).toBeVisible();

    await dialog.getByTestId('gen-tile-flashcards').click();
    await expect(dialog.getByTestId('exercises-started')).toHaveCount(0);
  });

  test('API drill: topicId singolo invariato (202); topicIds vuoto, oltre 5 o di un’altra materia → 400', async ({
    request,
    baseURL,
  }) => {
    test.setTimeout(90_000);
    const seed = await seedCoverage(request, baseURL!, ['termodinamica']);
    slug = seed.slug;
    const other = await seedCoverage(request, baseURL!, ['entropia']);
    try {
      const url = `${baseURL}/api/subjects/${seed.slug}/simulations`;
      const six = await addTopics(request, baseURL!, seed.slug, ['A1', 'A2', 'A3', 'A4', 'A5']);
      const legacy = await request.post(url, {
        data: { mode: 'drill_argomento', topicId: seed.topicIds.termodinamica },
      });
      expect(legacy.status()).toBe(202);
      const multi = await request.post(url, {
        data: { mode: 'drill_argomento', topicIds: [seed.topicIds.termodinamica, six[0]] },
      });
      expect(multi.status()).toBe(202);

      for (const data of [
        { mode: 'drill_argomento' },
        { mode: 'drill_argomento', topicIds: [] },
        { mode: 'drill_argomento', topicIds: [seed.topicIds.termodinamica, ...six] },
        { mode: 'drill_argomento', topicIds: [other.topicIds.entropia] },
      ]) {
        const res = await request.post(url, { data });
        expect(res.status(), JSON.stringify(data)).toBe(400);
      }
    } finally {
      await deleteSubject(request, baseURL!, other.slug);
    }
  });
});
