import { randomUUID } from 'node:crypto';
import { test, expect, type APIRequestContext } from '@playwright/test';
import { and, eq } from 'drizzle-orm';
import { documents, flashcards, schemaBlocks, schemaNodes } from '@studyhub/db';
import { db, deleteSubject, seedCoverage, seedPlan } from './fixtures/lacune-piano-seed';
import { seedMazzi } from './fixtures/flashcard-mazzi-seed';
import {
  endSession,
  seedSession,
  sessionUrl,
  deleteSubject as deleteSessionSubject,
} from './fixtures/sessione-seed';
import { seedSimulations } from './fixtures/simulazioni-seed';

/**
 * Rifiniture del flusso mobile della materia (.claude/work/materia-mobile-residui) a 375×812:
 * #3 argomenti nello sheet Azioni, #6 scadenza sulla riga flashcard, #21 "Ripassa N card" nelle
 * Lacune, #25 trascrizione in Chiusura, #27 "Esporta .canvas", più smoke di #13, #22, #24, #26.
 * (#11 "Salvato · HH:MM" è già verificato in materia-simulazioni.mobile.spec.ts.)
 * Gira solo nel progetto `mobile` (playwright.config.ts).
 */

test.use({ viewport: { width: 375, height: 812 } });

const DAY = 86_400_000;

async function createSubject(request: APIRequestContext, baseURL: string, label: string) {
  const name = `E2E ${label} ${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  const res = await request.post(`${baseURL}/api/subjects`, { data: { name, color: 'teal' } });
  expect(res.status()).toBe(201);
  const { subject } = await res.json();
  return { slug: subject.slug as string, id: subject.id as string };
}

test.describe('Materia mobile — Sheet Azioni e argomenti (#3)', () => {
  let slug: string | undefined;

  test.afterEach(async ({ request, baseURL }) => {
    if (slug) await deleteSubject(request, baseURL!, slug);
    slug = undefined;
  });

  test('Selezionare un argomento (aria-pressed) e generare invia topicIds nella richiesta', async ({
    page,
    request,
    baseURL,
  }) => {
    test.setTimeout(90_000);
    const seed = await seedCoverage(request, baseURL!, ['termodinamica', 'entropia']);
    slug = seed.slug;

    const posted: unknown[] = [];
    await page.route(`**/api/subjects/${seed.slug}/artifacts/flashcards`, async (route) => {
      posted.push(route.request().postDataJSON());
      await route.fulfill({ json: { jobId: randomUUID() }, status: 202 });
    });

    await page.goto(`/materie/${seed.slug}`);
    await page.getByRole('button', { name: 'Azioni della materia' }).click({ timeout: 30_000 });
    const dialog = page.getByRole('dialog', { name: 'Assistente' });
    const group = dialog.getByRole('group', { name: 'Materiale selezionato' });

    const entropia = group.getByRole('button', { name: 'Entropia' });
    await expect(entropia).toHaveAttribute('aria-pressed', 'false');
    await expect(group.getByText(/^Tutti i documenti pronti/)).toBeVisible();
    await entropia.click();
    await expect(entropia).toHaveAttribute('aria-pressed', 'true');
    await expect(group.getByRole('button', { name: 'Termodinamica' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    await expect(group.getByText(/^Tutti i documenti pronti/)).toHaveCount(0);

    await dialog.getByRole('button', { name: 'Genera flashcard' }).click();
    await expect(dialog.getByRole('status')).toContainText('Job avviato');
    expect(posted).toHaveLength(1);
    expect((posted[0] as { scope: unknown }).scope).toEqual({
      topicIds: [seed.topicIds.entropia!],
    });

    // Togliere l'argomento riporta allo scope per documenti (niente topicIds).
    await entropia.click();
    await expect(entropia).toHaveAttribute('aria-pressed', 'false');
    await dialog.getByRole('button', { name: 'Genera flashcard' }).click();
    await expect.poll(() => posted.length).toBe(2);
    expect((posted[1] as { scope: Record<string, unknown> }).scope).not.toHaveProperty('topicIds');
    expect((posted[1] as { scope: Record<string, unknown> }).scope).toHaveProperty('docIds');
  });

  test('Con documenti selezionati compare l’avviso e il pill li toglie', async ({
    page,
    request,
    baseURL,
  }) => {
    test.setTimeout(90_000);
    const seed = await seedCoverage(request, baseURL!, ['termodinamica', 'entropia']);
    slug = seed.slug;

    // La selezione vive sopra i tab: la si fa in Materiale e poi si apre lo sheet.
    await page.goto(`/materie/${seed.slug}?tab=materiale`);
    const seleziona = page.getByRole('button', { name: 'Seleziona', exact: true });
    await expect(seleziona).toHaveAttribute('aria-pressed', 'false', { timeout: 30_000 });
    await seleziona.click();
    await page.locator('input[type="checkbox"][aria-label^="Seleziona "]').first().check();

    await page.getByRole('button', { name: 'Azioni della materia' }).click();
    const dialog = page.getByRole('dialog', { name: 'Assistente' });
    const group = dialog.getByRole('group', { name: 'Materiale selezionato' });
    const pill = group.getByRole('button', {
      name: '1 documento selezionato: tocca per toglierli',
    });
    await expect(pill).toBeVisible();

    const warning = dialog.getByText(
      'Hai scelto dei documenti: gli argomenti selezionati non vengono usati.',
    );
    await expect(warning).toHaveCount(0);
    await group.getByRole('button', { name: 'Entropia' }).click();
    await expect(warning).toBeVisible();

    await pill.click();
    await expect(pill).toHaveCount(0);
    await expect(warning).toHaveCount(0);
    await expect(group.getByRole('button', { name: 'Entropia' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  test('Un documento selezionato ma non più elaborato non conta: niente avviso, scope per argomento', async ({
    page,
    request,
    baseURL,
  }) => {
    test.setTimeout(90_000);
    const seed = await seedCoverage(request, baseURL!, ['termodinamica', 'entropia']);
    slug = seed.slug;
    const posted: unknown[] = [];
    await page.route(`**/api/subjects/${seed.slug}/artifacts/flashcards`, async (route) => {
      posted.push(route.request().postDataJSON());
      await route.fulfill({ json: { jobId: randomUUID() }, status: 202 });
    });

    await page.goto(`/materie/${seed.slug}?tab=materiale`);
    const seleziona = page.getByRole('button', { name: 'Seleziona', exact: true });
    await expect(seleziona).toHaveAttribute('aria-pressed', 'false', { timeout: 30_000 });
    await seleziona.click();
    await page.locator('input[type="checkbox"][aria-label^="Seleziona "]').first().check();

    // Il documento torna "non pronto" (es. riparsing) mentre resta nella selezione.
    await db
      .update(documents)
      .set({ status: 'failed' })
      .where(eq(documents.subjectId, seed.subjectId));
    await page.evaluate(() => {
      window.dispatchEvent(new Event('focus'));
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await page.waitForResponse(
      (r) =>
        r.url().includes(`/api/subjects/${seed.slug}/documents`) && r.request().method() === 'GET',
    );

    await page.getByRole('button', { name: 'Azioni della materia' }).click();
    const dialog = page.getByRole('dialog', { name: 'Assistente' });
    const group = dialog.getByRole('group', { name: 'Materiale selezionato' });
    await group.getByRole('button', { name: 'Entropia' }).click();
    await expect(group.getByRole('button', { name: /documenti? selezionat/ })).toHaveCount(0);
    await expect(
      dialog.getByText('Hai scelto dei documenti: gli argomenti selezionati non vengono usati.'),
    ).toHaveCount(0);
    await dialog.getByRole('button', { name: 'Genera flashcard' }).click();
    await expect.poll(() => posted.length).toBe(1);
    expect((posted[0] as { scope: unknown }).scope).toEqual({
      topicIds: [seed.topicIds.entropia!],
    });
  });
});

test.describe('Materia mobile — Scadenza sulla riga flashcard (#6)', () => {
  let slug: string | undefined;

  test.afterEach(async ({ request, baseURL }) => {
    if (slug) await deleteSubject(request, baseURL!, slug);
    slug = undefined;
  });

  test('card-due mostra oggi / domani / tra N g / — secondo la scadenza della card', async ({
    page,
    request,
    baseURL,
  }) => {
    test.setTimeout(90_000);
    const seed = await seedMazzi(request, baseURL!);
    slug = seed.slug;
    const setDue = async (front: string, dueAt: Date, extra: { suspended?: boolean } = {}) =>
      db
        .update(flashcards)
        .set({
          state: 'review',
          reps: 2,
          stability: 3,
          difficulty: 5,
          dueAt,
          lastReviewAt: new Date(Date.now() - DAY),
          ...extra,
        })
        .where(and(eq(flashcards.deckId, seed.deckId), eq(flashcards.front, front)));
    // A mezzogiorno UTC di giorni diversi: nessun rischio di scavalcare il giorno locale.
    const noon = (n: number) => {
      const d = new Date();
      d.setUTCDate(d.getUTCDate() + n);
      d.setUTCHours(12, 0, 0, 0);
      return d;
    };
    await setDue('Entropia uno', new Date(Date.now() - 3_600_000)); // già scaduta → oggi
    await setDue('Entropia due', noon(1));
    await setDue('Entropia tre', noon(5));
    await setDue('Velocita uno', noon(5), { suspended: true }); // sospesa → —
    // Velocita due resta nuova → —

    await page.goto(`/materie/${seed.slug}?tab=flashcard`);
    const rowDue = (name: RegExp) => page.getByRole('button', { name }).getByTestId('card-due');
    await expect(rowDue(/^Entropia uno,/)).toHaveText('oggi', { timeout: 30_000 });
    await expect(rowDue(/^Entropia due,/)).toHaveText('domani');
    await expect(rowDue(/^Entropia tre,/)).toHaveText('tra 5 g');
    await expect(rowDue(/^Velocita uno,/)).toHaveText('—');
    await expect(rowDue(/^Velocita due,/)).toHaveText('—');
    // Il nome accessibile annuncia la scadenza solo quando c'è.
    await expect(page.getByRole('button', { name: /^Entropia due,.*scade domani$/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Velocita due,.*scade/ })).toHaveCount(0);
  });
});

test.describe('Materia mobile — Lacune: Ripassa N card (#21)', () => {
  let slug: string | undefined;

  test.afterEach(async ({ request, baseURL }) => {
    if (slug) await deleteSubject(request, baseURL!, slug);
    slug = undefined;
  });

  test('"Ripassa N card" ha N giusto e href con argomento; senza card in scadenza il link manca', async ({
    page,
    request,
    baseURL,
  }) => {
    test.setTimeout(90_000);
    const seed = await seedCoverage(request, baseURL!, ['entropia', 'ottica']);
    slug = seed.slug;
    // Ottica: 2 card già ripassate e in scadenza tra 5 giorni → 0 in scadenza oggi.
    const later = new Date(Date.now() + 5 * DAY);
    await db
      .update(flashcards)
      .set({
        state: 'review',
        reps: 2,
        stability: 3,
        difficulty: 5,
        dueAt: later,
        lastReviewAt: new Date(),
      })
      .where(eq(flashcards.topicId, seed.topicIds.ottica!));

    await page.goto(`/materie/${seed.slug}?tab=lacune`);
    const card = (name: string) =>
      page.getByRole('article').filter({ has: page.getByRole('heading', { name, exact: true }) });

    // Entropia: 2 card nuove = 2 in scadenza.
    const review = card('Entropia').getByRole('link', { name: /^Ripassa \d+ card$/ });
    await expect(review).toHaveText('Ripassa 2 card', { timeout: 30_000 });
    await expect(review).toHaveAttribute(
      'href',
      `/ripasso?materia=${seed.slug}&argomento=${seed.topicIds.entropia}`,
    );

    // Ottica: nulla da ripassare oggi → niente link, messaggio al suo posto.
    await expect(card('Ottica').getByRole('link', { name: /^Ripassa/ })).toHaveCount(0);
    await expect(card('Ottica').getByText('Niente da ripassare oggi.')).toBeVisible();
    await expect(card('Entropia').getByText('Niente da ripassare oggi.')).toHaveCount(0);
  });
});

test.describe('Materia mobile — Sessione: modello e trascrizione (#24, #25)', () => {
  let slug: string | undefined;

  test.afterEach(async ({ request, baseURL }) => {
    if (slug) await deleteSessionSubject(request, baseURL!, slug);
    slug = undefined;
  });

  test('Chat: la select "Modello" ha le opzioni, il default e si cambia', async ({
    page,
    request,
    baseURL,
  }) => {
    test.setTimeout(90_000);
    const seed = await seedSession(request, baseURL!);
    slug = seed.slug;
    await page.goto(sessionUrl(seed));
    await page.getByRole('tab', { name: /Chiedi all.AI/ }).click({ timeout: 30_000 });

    const select = page.getByLabel('Modello');
    await expect(select).toBeVisible();
    await expect(select.locator('option')).toHaveCount(3);
    // Stesso default del desktop (primo di MODEL_OPTIONS).
    await expect(select).toHaveValue('claude-haiku-4-5-20251001');
    await select.selectOption('claude-sonnet-5-5');
    await expect(select).toHaveValue('claude-sonnet-5-5');
  });

  test('Chiusura: "Trascrizione della chat" si espande e mostra i messaggi', async ({
    page,
    request,
    baseURL,
  }) => {
    test.setTimeout(120_000);
    const seed = await seedSession(request, baseURL!);
    slug = seed.slug;
    await page.goto(sessionUrl(seed));
    await page.getByRole('tab', { name: /Chiedi all.AI/ }).click({ timeout: 30_000 });
    await page.getByLabel('Domanda al tutor').fill('Che cos’è il primo principio?');
    await page.getByRole('button', { name: 'Invia' }).click();
    const log = page.getByRole('log', { name: 'Conversazione con il tutor' });
    await expect(log).toContainText('Che cos’è il primo principio?', { timeout: 30_000 });
    await expect
      .poll(
        async () =>
          (await log.innerText()).replace('Che cos’è il primo principio?', '').trim().length,
        { timeout: 30_000 },
      )
      .toBeGreaterThan(0);

    await endSession(request, baseURL!, seed, 10 * 60_000);
    await page.goto(sessionUrl(seed));
    await expect(page.getByRole('heading', { level: 1, name: 'Sessione terminata' })).toBeVisible({
      timeout: 30_000,
    });

    const toggle = page.getByRole('button', { name: 'Trascrizione della chat' });
    await expect(toggle).toHaveAttribute('aria-expanded', 'false', { timeout: 20_000 });
    await expect(page.getByText('questa è la trascrizione salvata')).toHaveCount(0);
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByText(/questa è la trascrizione salvata/)).toBeVisible();
    await expect(page.getByText('Che cos’è il primo principio?')).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow).toBe(0);

    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  });

  test('Chiusura senza chat: la disclosure della trascrizione è omessa', async ({
    page,
    request,
    baseURL,
  }) => {
    test.setTimeout(90_000);
    const seed = await seedSession(request, baseURL!);
    slug = seed.slug;
    await endSession(request, baseURL!, seed, 5 * 60_000);
    await page.goto(sessionUrl(seed));
    await expect(page.getByRole('heading', { level: 1, name: 'Sessione terminata' })).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByRole('region', { name: 'Riepilogo della sessione' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Trascrizione della chat' })).toHaveCount(0);
  });
});

test.describe('Materia mobile — Documento: export canvas e verifica (#26, #27)', () => {
  let slug: string | undefined;

  test.afterEach(async ({ request, baseURL }) => {
    if (slug) await deleteSubject(request, baseURL!, slug);
    slug = undefined;
  });

  async function seedDocs(request: APIRequestContext, baseURL: string) {
    const subject = await createSubject(request, baseURL, 'Documento');
    const mk = async (name: string) => {
      const id = randomUUID();
      await db.insert(documents).values({
        id,
        subjectId: subject.id,
        type: 'schemi',
        originalName: name,
        storedPath: '/x',
        mime: 'image/png',
        bytes: 1,
        sha256: id.replaceAll('-', '').padEnd(64, 'b'),
        status: 'parsed',
        verificationStatus: 'partial',
        blockedBlocks: 2,
      });
      return id;
    };
    const withGraph = await mk('con-grafo.png');
    const noGraph = await mk('senza-grafo.png');
    await db.insert(schemaNodes).values({
      id: randomUUID(),
      documentId: withGraph,
      nodeKey: 'n1',
      label: 'Entropia',
      kind: 'concetto',
      confidence: 'ok',
    });
    return { slug: subject.slug, id: subject.id, withGraph, noGraph };
  }

  test('"Esporta .canvas" compare solo se il documento ha un grafo, con l’href giusto', async ({
    page,
    request,
    baseURL,
  }) => {
    test.setTimeout(90_000);
    const s = await seedDocs(request, baseURL!);
    slug = s.slug;
    const kebab = page.getByRole('button', { name: 'Altre azioni sul documento' });

    await page.goto(`/materie/${s.slug}/documenti/${s.withGraph}`);
    await kebab.click({ timeout: 30_000 });
    const sheet = page.getByRole('dialog');
    await expect(sheet.getByRole('link', { name: 'Scarica' })).toBeVisible();
    await expect(sheet.getByRole('link', { name: 'Esporta .canvas' })).toHaveAttribute(
      'href',
      `/api/subjects/${s.slug}/documents/${s.withGraph}/schema-graph/canvas`,
      { timeout: 20_000 },
    );

    await page.goto(`/materie/${s.slug}/documenti/${s.noGraph}`);
    await kebab.click({ timeout: 30_000 });
    await expect(page.getByRole('dialog').getByRole('link', { name: 'Scarica' })).toBeVisible();
    // Il grafo è già stato richiesto e risolto vuoto: la voce non compare.
    await expect(page.getByRole('link', { name: 'Esporta .canvas' })).toHaveCount(0);
  });

  test('Verifica: "Prossimo incerto" porta il focus sul blocco incerto/illeggibile successivo e riparte da capo', async ({
    page,
    request,
    baseURL,
  }) => {
    test.setTimeout(90_000);
    const s = await seedDocs(request, baseURL!);
    slug = s.slug;
    const blocks: [string, 'ok' | 'uncertain' | 'illegible', boolean][] = [
      ['F = m a', 'ok', true],
      ['E = m c^2', 'uncertain', false],
      ['v = s / t', 'ok', false],
      ['??', 'illegible', false],
    ];
    await db.insert(schemaBlocks).values(
      blocks.map(([text, confidence, verified], i) => ({
        id: randomUUID(),
        documentId: s.noGraph,
        ord: i + 1,
        text,
        confidence,
        verified,
      })),
    );

    await page.goto(`/materie/${s.slug}/documenti/${s.noGraph}/verifica`);
    const items = page.getByTestId('verify-item');
    await expect(items).toHaveCount(4, { timeout: 30_000 });
    await expect(items.nth(1)).toHaveAttribute('data-state', 'uncertain');
    await expect(items.nth(3)).toHaveAttribute('data-state', 'illegible');

    const next = page.getByRole('button', { name: /^Prossimo incerto/ });
    await expect(next).toContainText('2 da controllare');
    const focusedIndex = () =>
      page.evaluate(() => {
        const all = Array.from(document.querySelectorAll('[data-testid="verify-item"]'));
        const active = document.activeElement;
        return all.findIndex((el) => el.contains(active));
      });

    await next.click();
    await expect.poll(focusedIndex).toBe(1);
    await expect(page.getByRole('status').filter({ hasText: 'Blocco 2 di 4' })).toHaveText(
      'Blocco 2 di 4: Incerto',
    );
    await expect(items.nth(1)).toBeInViewport();

    await next.click();
    await expect.poll(focusedIndex).toBe(3);
    await expect(page.getByRole('status').filter({ hasText: 'Blocco 4 di 4' })).toHaveText(
      'Blocco 4 di 4: Illeggibile',
    );

    // Giro completo: si torna al primo.
    await next.click();
    await expect.poll(focusedIndex).toBe(1);
  });
});

test.describe('Materia mobile — Piano e Simulazioni: smoke (#13, #22)', () => {
  let slug: string | undefined;

  test.afterEach(async ({ request, baseURL }) => {
    if (slug) await deleteSubject(request, baseURL!, slug);
    slug = undefined;
  });

  test('Piano: il kebab "Azioni della materia" apre lo sheet "Assistente"', async ({
    page,
    request,
    baseURL,
  }) => {
    test.setTimeout(90_000);
    const seed = await seedPlan(request, baseURL!, {
      status: 'active',
      tasks: [{ offset: 0, title: 'Studia il calore' }],
    });
    slug = seed.slug;
    await page.goto(`/materie/${seed.slug}/piano`);
    const kebab = page.getByRole('button', { name: 'Azioni della materia' });
    await kebab.click({ timeout: 30_000 });
    await expect(page.getByRole('dialog', { name: 'Assistente' })).toBeVisible({ timeout: 20_000 });
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Assistente' })).toHaveCount(0);
    await expect(kebab).toBeFocused();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow).toBe(0);
  });

  test('Simulazioni: la riga corretta mostra "Corretta · <data di correzione>"', async ({
    page,
    request,
    baseURL,
  }) => {
    test.setTimeout(90_000);
    const seed = await seedSimulations(request, baseURL!);
    slug = seed.slug;
    await page.goto(`/materie/${seed.slug}?tab=simulazioni`);
    const beta = page.getByTestId('simulation-row').filter({ hasText: 'Simulazione Beta' });
    // Il tentativo del seed è corretto adesso.
    await expect(beta).toContainText('Corretta · oggi', { timeout: 30_000 });
    await expect(beta).not.toContainText('creata');
    // Una simulazione mai fatta non ha data di correzione.
    await expect(
      page.getByTestId('simulation-row').filter({ hasText: 'Simulazione Alfa' }),
    ).toContainText('Pronta · 3 esercizi · 30 min');
  });
});
