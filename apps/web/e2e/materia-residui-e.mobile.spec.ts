import { randomUUID } from 'node:crypto';
import { test, expect, type Page } from '@playwright/test';
import { eq } from 'drizzle-orm';
import { attemptAnswerPhotos, documents, examProfiles, simulationAttempts } from '@studyhub/db';
import {
  deleteSubject as deleteSessionSubject,
  seedSession,
  sessionUrl,
} from './fixtures/sessione-seed';
import { db, markGraded, seedSimulations, type SimulationSeed } from './fixtures/simulazioni-seed';

/**
 * Slice E dei residui mobile (.claude/work/materia-mobile-residui-e) a 375×812: verdetto
 * Sufficiente/Insufficiente, pill ×N degli argomenti ricorrenti, foto del foglio nell'esame,
 * controlli del timer di sessione, tipo suggerito nel Materiale, etichetta "(default)" dei modelli.
 * Gira solo nel progetto `mobile`. Il worker non gira: la correzione si simula via DB (`markGraded`).
 */

test.use({ viewport: { width: 375, height: 812 } });

const PNG_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);
const png = (name = 'foglio.png') => ({ name, mimeType: 'image/png', buffer: PNG_BYTES });

async function noHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBe(0);
}

const resultsUrl = (s: SimulationSeed) => `/materie/${s.slug}/attempts/${s.done.attemptId}/results`;

test.describe('Materia mobile — Risultati, profilo e foto (slice E)', () => {
  let s: SimulationSeed;

  test.beforeEach(async ({ request, baseURL }) => {
    s = await seedSimulations(request, baseURL!);
  });

  test.afterEach(async ({ request, baseURL }) => {
    await request.delete(`${baseURL}/api/subjects/${s.slug}`);
  });

  test('Verdetto: 6/10 (0,6 esatto) è Sufficiente, 5/10 Insufficiente, e convive con "sotto la metà"', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await page.goto(resultsUrl(s));
    const verdict = page.getByTestId('attempt-verdict');
    await expect(verdict).toBeVisible({ timeout: 30_000 });
    await expect(verdict).toHaveText('Sufficiente');
    await expect(verdict).toHaveAttribute('data-verdict', 'pass');
    await expect(page.getByTestId('attempt-verdict-line')).toContainText(
      '1 esercizio sotto la metà',
    );
    await noHorizontalScroll(page);

    await db
      .update(simulationAttempts)
      .set({ totalAwarded: 5 })
      .where(eq(simulationAttempts.id, s.done.attemptId));
    await page.reload();
    await expect(verdict).toHaveText('Insufficiente', { timeout: 30_000 });
    await expect(verdict).toHaveAttribute('data-verdict', 'fail');
    await noHorizontalScroll(page);
  });

  test('Argomenti ricorrenti: ×N con il conteggio, solo il nome per i profili con stringhe', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const tab = `/materie/${s.slug}?tab=simulazioni`;

    // Profilo del seed: stringhe vecchie, nessun ×.
    await page.goto(tab);
    const pills = page.getByTestId('recurring-topic');
    await expect(pills.first()).toBeVisible({ timeout: 30_000 });
    await expect(pills.filter({ hasText: 'Integrali' })).toHaveText('Integrali');
    await expect(pills.filter({ hasText: '×' })).toHaveCount(0);

    // Profilo nuovo: { name, count }.
    const [row] = await db
      .select()
      .from(examProfiles)
      .where(eq(examProfiles.subjectId, s.subjectId));
    await db
      .update(examProfiles)
      .set({
        profile: {
          ...row!.profile,
          recurringTopics: [
            { name: 'Integrali', count: 6 },
            { name: 'Serie numeriche', count: null },
          ],
        },
      })
      .where(eq(examProfiles.id, row!.id));
    await page.reload();
    await expect(pills.first()).toBeVisible({ timeout: 30_000 });
    await expect(pills.filter({ hasText: 'Integrali' })).toContainText('×6');
    await expect(pills.filter({ hasText: 'Serie numeriche' })).not.toContainText('×');
    await noHorizontalScroll(page);
  });

  test('Foto del foglio: allega, rimuovi, file non immagine rifiutato, il risultato mostra le foto', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await page.goto(`/materie/${s.slug}/simulations/${s.fresh.id}`);
    await expect(page.getByLabel('La tua risposta')).toBeVisible({ timeout: 30_000 });

    const gallery = page.getByTestId('photo-gallery-input');
    const tiles = page.getByTestId('photo-tile');
    const strip = page.getByRole('group', { name: 'Esercizi' });

    // Una foto: tile pronto, esercizio contato come risposto.
    await gallery.setInputFiles(png());
    await expect(tiles).toHaveCount(1, { timeout: 30_000 });
    await expect(tiles.first()).toHaveAttribute('data-status', 'ready', { timeout: 30_000 });
    await expect(
      strip.getByRole('button', { name: 'Esercizio 1, con risposta, corrente' }),
    ).toBeVisible();

    // Rimozione.
    await page.getByTestId('photo-remove').first().click();
    await expect(tiles).toHaveCount(0, { timeout: 30_000 });
    await expect(
      strip.getByRole('button', { name: 'Esercizio 1, senza risposta, corrente' }),
    ).toBeVisible();

    // File non immagine: errore chiaro, nessun tile.
    await gallery.setInputFiles({
      name: 'appunti.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.1'),
    });
    await expect(page.getByTestId('answer-photos').getByRole('alert')).toContainText(
      'Formato non supportato',
    );
    await expect(tiles).toHaveCount(0);

    // HEIC finto (non decodificabile): stesso errore, nessun tile.
    await gallery.setInputFiles({
      name: 'foglio.heic',
      mimeType: 'image/heic',
      buffer: Buffer.from('non-e-un-heic-vero'),
    });
    await expect(page.getByTestId('answer-photos').getByRole('alert')).toContainText(
      'Formato non supportato',
    );
    await expect(tiles).toHaveCount(0);

    // Foto di nuovo allegata, poi consegna.
    await gallery.setInputFiles(png());
    await expect(tiles.first()).toHaveAttribute('data-status', 'ready', { timeout: 30_000 });
    await noHorizontalScroll(page);

    await strip.getByRole('button', { name: /^Esercizio 3/ }).click();
    await page.getByRole('button', { name: 'Consegna' }).click();
    await page
      .getByRole('dialog', { name: "Consegnare l'esame?" })
      .getByRole('button', { name: 'Consegna' })
      .click();
    await expect(page).toHaveURL(/\/attempts\/[^/]+\/results$/, { timeout: 30_000 });
    const attemptId = page.url().split('/attempts/')[1]!.split('/')[0]!;

    // Il worker non gira: la correzione è simulata via DB.
    await markGraded(attemptId, s.fresh.itemIds, [1, 4, 4]);
    await expect(page.getByTestId('attempt-score')).toBeVisible({ timeout: 30_000 });
    const photos = page.getByTestId('result-photos');
    await expect(page.getByTestId('result-item')).toHaveCount(3, { timeout: 30_000 });
    const toggle = page.getByTestId('result-item').first().locator('button[aria-expanded]');
    if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
    await expect(photos).toBeVisible({ timeout: 30_000 });
    // Il worker marca la foto `failed`: la nota dice che non è stata letta.
    await db
      .update(attemptAnswerPhotos)
      .set({ transcriptStatus: 'failed' })
      .where(eq(attemptAnswerPhotos.attemptId, attemptId));
    await page.reload();
    await expect(page.getByTestId('attempt-score')).toBeVisible({ timeout: 30_000 });
    const reloadedToggle = page.getByTestId('result-item').first().locator('button[aria-expanded]');
    if ((await reloadedToggle.getAttribute('aria-expanded')) !== 'true')
      await reloadedToggle.click();
    await expect(page.getByTestId('photo-transcript-note')).toContainText(
      'Non è stato possibile leggere 1 foto',
      { timeout: 30_000 },
    );
    await expect(photos.locator('img')).toHaveCount(1);
    await expect(page.getByText('Foto allegate (1)')).toBeVisible();
    await noHorizontalScroll(page);
  });

  test('Foto del foglio: dopo il reload le foto già allegate tornano visibili', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await page.goto(`/materie/${s.slug}/simulations/${s.fresh.id}`);
    await expect(page.getByLabel('La tua risposta')).toBeVisible({ timeout: 30_000 });
    const tiles = page.getByTestId('photo-tile');
    await page.getByTestId('photo-gallery-input').setInputFiles(png());
    await expect(tiles.first()).toHaveAttribute('data-status', 'ready', { timeout: 30_000 });
    await page.reload();
    await expect(page.getByLabel('La tua risposta')).toBeVisible({ timeout: 30_000 });
    await expect(tiles).toHaveCount(1, { timeout: 10_000 });
  });
});

test.describe('Materia mobile — Sessione: timer e modelli (slice E)', () => {
  let slug: string | undefined;

  test.afterEach(async ({ request, baseURL }) => {
    if (slug) await deleteSessionSubject(request, baseURL!, slug);
    slug = undefined;
  });

  test('Timer: lo sheet salta al riposo, applica le durate e cambia modalità', async ({
    page,
    request,
    baseURL,
  }) => {
    test.setTimeout(120_000);
    const seed = await seedSession(request, baseURL!);
    slug = seed.slug;
    await page.goto(sessionUrl(seed));
    await page.getByTestId('timer-settings-button').click({ timeout: 30_000 });
    const sheet = page.getByRole('dialog', { name: 'Timer' });
    await expect(sheet).toBeVisible();

    // Pomodoro: fase Focus, "Salta al riposo" porta alla pausa.
    await expect(sheet.getByTestId('timer-mode-pomodoro')).toHaveAttribute('aria-pressed', 'true');
    await expect(sheet.getByTestId('timer-phase')).toHaveText('Focus');
    await sheet.getByTestId('timer-skip').click();
    await expect(sheet.getByTestId('timer-phase')).toHaveText(/^Pausa/);

    // Durate: il focus passa a 10 minuti e riparte un nuovo focus.
    await sheet.getByTestId('timer-focus-min').fill('10');
    await sheet.getByTestId('timer-apply-durations').click();
    await expect(sheet.getByText('Durate aggiornate')).toBeVisible();
    await expect(sheet.getByTestId('timer-phase')).toHaveText('Focus');
    await expect(sheet.getByText(/^(09|10):\d{2}$/).first()).toBeVisible();

    // Modalità libera: niente fasi né durate.
    await sheet.getByTestId('timer-mode-free').click();
    await expect(sheet.getByTestId('timer-mode-free')).toHaveAttribute('aria-pressed', 'true');
    await expect(sheet.getByTestId('timer-skip')).toHaveCount(0);
    await expect(sheet.getByTestId('timer-focus-min')).toHaveCount(0);

    // Persistenza (stesse preferenze del desktop): dopo il reload la modalità libera resta.
    await sheet.getByRole('button', { name: 'Fatto' }).click();
    await page.reload();
    await page.getByTestId('timer-settings-button').click({ timeout: 30_000 });
    await expect(page.getByTestId('timer-mode-free')).toHaveAttribute('aria-pressed', 'true');
    await page.getByTestId('timer-mode-pomodoro').click();
    await expect(page.getByTestId('timer-focus-min')).toHaveValue('10');
    await noHorizontalScroll(page);
  });

  test('Chat: l’opzione Haiku ha "(default)", Sonnet no', async ({ page, request, baseURL }) => {
    test.setTimeout(90_000);
    const seed = await seedSession(request, baseURL!);
    slug = seed.slug;
    await page.goto(sessionUrl(seed));
    await page.getByRole('tab', { name: /Chiedi all.AI/ }).click({ timeout: 30_000 });
    const select = page.getByLabel('Modello');
    await expect(select.locator('option', { hasText: 'Haiku' })).toContainText('(default)');
    await expect(select.locator('option', { hasText: 'Sonnet' })).not.toContainText('(default)');
    await expect(select.locator('option', { hasText: '(default)' })).toHaveCount(1);
  });
});

test.describe('Materia mobile — Materiale: tipo suggerito (slice E)', () => {
  let slug: string | undefined;

  test.afterEach(async ({ request, baseURL }) => {
    if (slug) await request.delete(`${baseURL}/api/subjects/${slug}`);
    slug = undefined;
  });

  test('Chip "Suggerito": Applica cambia il tipo, Ignora lo nasconde senza cambiarlo', async ({
    page,
    request,
    baseURL,
  }) => {
    test.setTimeout(120_000);
    const created = await request.post(`${baseURL}/api/subjects`, {
      data: { name: `E2E Tipo ${Date.now()}`, color: 'teal' },
    });
    expect(created.status()).toBe(201);
    const { subject } = await created.json();
    slug = subject.slug as string;
    const mk = (n: number, name: string, typeSuggested: 'esami' | 'appunti') => ({
      id: randomUUID(),
      subjectId: subject.id as string,
      type: 'appunti' as const,
      typeSuggested,
      originalName: name,
      storedPath: '/x',
      mime: 'application/pdf',
      bytes: 1,
      sha256: String(n).repeat(64).slice(0, 64),
      status: 'parsed' as const,
      pages: 3,
      createdAt: new Date(Date.now() - n * 60_000),
    });
    const apply = mk(1, 'da-applicare.pdf', 'esami');
    const ignore = mk(2, 'da-ignorare.pdf', 'esami');
    const same = mk(3, 'uguale.pdf', 'appunti'); // suggerimento uguale al tipo: niente chip
    await db.insert(documents).values([apply, ignore, same]);

    await page.goto(`/materie/${slug}?tab=materiale`);
    const chips = page.getByTestId('type-suggestion');
    await expect(chips).toHaveCount(2, { timeout: 30_000 });
    await expect(chips.first()).toContainText('Suggerito: Esame passato');
    await expect(page.getByRole('group', { name: 'Tipo suggerito per uguale.pdf' })).toHaveCount(0);

    const applyChip = page.getByRole('group', { name: 'Tipo suggerito per da-applicare.pdf' });
    await applyChip.getByTestId('type-suggestion-apply').click();
    await expect(applyChip).toHaveCount(0, { timeout: 30_000 });
    await expect
      .poll(async () => {
        const [r] = await db.select().from(documents).where(eq(documents.id, apply.id));
        return [r?.type, r?.typeSuggested];
      })
      .toEqual(['esami', null]);

    const ignoreChip = page.getByRole('group', { name: 'Tipo suggerito per da-ignorare.pdf' });
    await ignoreChip.getByTestId('type-suggestion-dismiss').click();
    await expect(ignoreChip).toHaveCount(0, { timeout: 30_000 });
    await expect
      .poll(async () => {
        const [r] = await db.select().from(documents).where(eq(documents.id, ignore.id));
        return [r?.type, r?.typeSuggested];
      })
      .toEqual(['appunti', null]);
    await noHorizontalScroll(page);
  });
});
