import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { eq } from 'drizzle-orm';
import { flashcards, studySessions } from '@studyhub/db';
import { deleteSubject, endSession, seedSession, sessionUrl, db } from './fixtures/sessione-seed';
import { seedMazzi } from './fixtures/flashcard-mazzi-seed';

/**
 * Slice B dei residui mobile (.claude/work/materia-mobile-residui-b) a 375×812: mood in Chiusura,
 * flashcard per punto chiave, stima "~ N min" sulla hero Flashcard, confidenza nel ripasso rapido.
 * Gira solo nel progetto `mobile`.
 */

test.use({ viewport: { width: 375, height: 812 } });

async function noHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBe(0);
}

test.describe('Materia mobile — Chiusura: mood e flashcard per punto chiave (slice B)', () => {
  let slug: string | undefined;

  test.afterEach(async ({ request, baseURL }) => {
    if (slug) await deleteSubject(request, baseURL!, slug);
    slug = undefined;
  });

  test('Mood: scelto in Chiusura resta dopo il reload; il secondo tap lo deseleziona', async ({
    page,
    request,
    baseURL,
  }) => {
    test.setTimeout(120_000);
    const seed = await seedSession(request, baseURL!);
    slug = seed.slug;
    await endSession(request, baseURL!, seed, 20 * 60_000);
    await page.goto(sessionUrl(seed));

    const section = page.getByTestId('closing-mood');
    await expect(section).toBeVisible({ timeout: 30_000 });
    await expect(section.getByRole('heading', { name: "Com'è andata?" })).toBeVisible();
    for (const id of ['mood-hard', 'mood-ok', 'mood-good']) {
      await expect(page.getByTestId(id)).toHaveAttribute('aria-checked', 'false');
    }
    const box = (await page.getByTestId('mood-hard').boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(44);

    const saved = page.waitForResponse(
      (r) =>
        r.url().includes(`/sessions/${seed.sessionId}/mood`) && r.request().method() === 'PATCH',
    );
    await section.getByRole('radio', { name: 'Così così' }).click();
    expect((await saved).status()).toBe(200);
    await expect(page.getByTestId('mood-ok')).toHaveAttribute('aria-checked', 'true');
    await expect
      .poll(async () => {
        const [row] = await db
          .select()
          .from(studySessions)
          .where(eq(studySessions.id, seed.sessionId));
        return row?.mood;
      })
      .toBe('ok');

    await page.reload();
    await expect(page.getByTestId('mood-ok')).toHaveAttribute('aria-checked', 'true', {
      timeout: 30_000,
    });
    await expect(page.getByTestId('mood-hard')).toHaveAttribute('aria-checked', 'false');
    await noHorizontalScroll(page);

    // Toggle: il tap sulla scelta attuale la toglie.
    const cleared = page.waitForResponse(
      (r) => r.url().includes('/mood') && r.request().method() === 'PATCH',
    );
    await page.getByTestId('mood-ok').click();
    expect((await cleared).status()).toBe(200);
    await expect(page.getByTestId('mood-ok')).toHaveAttribute('aria-checked', 'false');
    await expect
      .poll(async () => {
        const [row] = await db
          .select()
          .from(studySessions)
          .where(eq(studySessions.id, seed.sessionId));
        return row?.mood;
      })
      .toBeNull();
  });

  test('Flashcard: deselezionando un punto chiave il bottone dice "Crea 2 flashcard" e il mazzo ha 2 card', async ({
    page,
    request,
    baseURL,
  }) => {
    test.setTimeout(120_000);
    const seed = await seedSession(request, baseURL!);
    slug = seed.slug;
    await endSession(request, baseURL!, seed, 20 * 60_000);
    await page.goto(sessionUrl(seed));

    const region = page.getByTestId('closing-deck');
    const checks = region.getByTestId('keypoint-check');
    await expect(checks).toHaveCount(3, { timeout: 30_000 });
    for (let i = 0; i < 3; i++) await expect(checks.nth(i)).toBeChecked();
    await expect(region.getByRole('button', { name: /^Crea 3 flashcard$/ })).toBeEnabled();

    await region.getByRole('checkbox', { name: /Punto chiave 2/ }).uncheck();
    const create = region.getByRole('button', { name: /^Crea 2 flashcard$/ });
    await expect(create).toBeVisible();
    await noHorizontalScroll(page);

    const post = page.waitForRequest(
      (r) => r.url().includes(`/sessions/${seed.sessionId}/flashcards`) && r.method() === 'POST',
    );
    await create.click();
    const body = (await post).postDataJSON() as { itemIds: string[] };
    expect(body.itemIds).toHaveLength(2);
    expect(body.itemIds).not.toContain(seed.itemIds[1]);
    await expect(region).toContainText('Mazzo creato', { timeout: 30_000 });
    await expect(region.getByRole('link', { name: /Apri il mazzo/ })).toBeVisible();

    const [row] = await db.select().from(studySessions).where(eq(studySessions.id, seed.sessionId));
    expect(row?.flashcardDeckId).toBeTruthy();
    const cards = await db
      .select()
      .from(flashcards)
      .where(eq(flashcards.deckId, row!.flashcardDeckId!));
    expect(cards).toHaveLength(2);
  });

  test('Flashcard: deselezionandoli tutti il bottone è disabilitato e compare l’avviso', async ({
    page,
    request,
    baseURL,
  }) => {
    test.setTimeout(90_000);
    const seed = await seedSession(request, baseURL!);
    slug = seed.slug;
    await endSession(request, baseURL!, seed, 20 * 60_000);
    await page.goto(sessionUrl(seed));

    const region = page.getByTestId('closing-deck');
    const checks = region.getByTestId('keypoint-check');
    await expect(checks).toHaveCount(3, { timeout: 30_000 });
    for (let i = 0; i < 3; i++) await checks.nth(i).uncheck();
    await expect(region.getByRole('button', { name: /^Crea 0 flashcard$/ })).toBeDisabled();
    await expect(region).toContainText('Seleziona almeno un punto chiave.');
  });
});

test.describe('Materia mobile — Hero Flashcard: stima (slice B)', () => {
  let slug: string | undefined;

  test.afterEach(async ({ request, baseURL }) => {
    if (slug) await request.delete(`${baseURL}/api/subjects/${slug}`);
    slug = undefined;
  });

  test('"~ N min" con card in scadenza, assente quando non ce ne sono', async ({
    page,
    request,
    baseURL,
  }) => {
    test.setTimeout(120_000);
    const s = await seedMazzi(request, baseURL!);
    slug = s.slug;
    await page.goto(`/materie/${s.slug}?tab=flashcard`);

    const hero = page.getByRole('region', { name: 'Ripasso di oggi' });
    await expect(hero).toBeVisible({ timeout: 30_000 });
    const estimate = hero.getByTestId('review-estimate');
    await expect(estimate.locator('[aria-hidden=true]')).toHaveText(/^~ \d+ min$/, {
      timeout: 30_000,
    });
    await expect(estimate.locator('.sr-only')).toHaveText(/^circa \d+ minuti$/);
    await noHorizontalScroll(page);

    // Nessuna card in scadenza: tutte nel futuro, la stima sparisce.
    const future = new Date(Date.now() + 30 * 86_400_000);
    await db
      .update(flashcards)
      .set({
        state: 'review',
        reps: 2,
        stability: 30,
        difficulty: 5,
        dueAt: future,
        lastReviewAt: new Date(),
      })
      .where(eq(flashcards.deckId, s.deckId));
    await page.reload();
    await expect(hero.getByRole('button', { name: 'Nessuna card da ripassare' })).toBeVisible({
      timeout: 30_000,
    });
    await expect(hero.getByTestId('review-estimate')).toHaveCount(0);
  });
});

async function seedRipasso(request: APIRequestContext, baseURL: string) {
  const { subject } = await (
    await request.post(`${baseURL}/api/subjects`, {
      data: { name: `E2E Confidenza ${Date.now()}`, color: 'teal' },
    })
  ).json();
  const slug: string = subject.slug;
  const { deck } = await (
    await request.post(`${baseURL}/api/subjects/${slug}/decks`, { data: { title: 'Mazzo e2e' } })
  ).json();
  const { topic } = await (
    await request.post(`${baseURL}/api/subjects/${slug}/topics`, { data: { name: 'Argomento' } })
  ).json();
  for (const i of [1, 2, 3]) {
    const res = await request.post(`${baseURL}/api/subjects/${slug}/flashcards`, {
      data: { deckId: deck.id, topicId: topic.id, front: `Domanda ${i}`, back: `Risposta ${i}` },
    });
    expect(res.status()).toBe(201);
  }
  return slug;
}

test.describe('Ripasso mobile — confidenza (slice B)', () => {
  let slug: string | undefined;

  test.afterEach(async ({ request, baseURL }) => {
    if (slug) await request.delete(`${baseURL}/api/subjects/${slug}`);
    slug = undefined;
  });

  test('La confidenza scelta è inviata nel POST; "Mostra risposta" senza scelta non la invia', async ({
    page,
    request,
    baseURL,
  }) => {
    test.setTimeout(120_000);
    slug = await seedRipasso(request, baseURL!);
    await page.goto(`/ripasso?materia=${slug}&n=3`);
    const session = page.getByRole('dialog');
    await expect(session.locator('p.font-mono').first()).toHaveText('1 / 3', { timeout: 30_000 });

    // Step "Quanto sei sicuro?" con tre opzioni a 375px.
    await expect(session.getByText('Quanto sei sicuro?')).toBeVisible();
    const group = session.getByTestId('confidence-group');
    await expect(group.getByRole('radio')).toHaveCount(3);
    for (const [id, label] of [
      ['confidence-1', 'Non lo so'],
      ['confidence-2', 'Forse'],
      ['confidence-3', 'Lo so'],
    ] as const) {
      await expect(session.getByTestId(id)).toHaveText(label);
      expect((await session.getByTestId(id).boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }
    await noHorizontalScroll(page);

    // Con confidenza "Forse" (2).
    await session.getByTestId('confidence-2').click();
    await expect(session.getByTestId('confidence-2')).toHaveAttribute('aria-checked', 'true');
    await session.getByRole('button', { name: 'Mostra risposta' }).click();
    const withConf = page.waitForRequest(
      (r) => /\/review\/[^/]+$/.test(r.url()) && r.method() === 'POST',
    );
    await session.getByRole('button', { name: /^Bene, prossimo ripasso/ }).click();
    const sent = (await withConf).postDataJSON() as Record<string, unknown>;
    expect(sent.confidence).toBe(2);
    expect(sent.rating).toBeDefined();

    // Card successiva: nessuna selezione residua; "Mostra risposta" diretto = nessuna confidenza.
    await expect(session.locator('p.font-mono').first()).toHaveText('2 / 3');
    await expect(session.getByTestId('confidence-2')).toHaveAttribute('aria-checked', 'false');
    await session.getByRole('button', { name: 'Mostra risposta' }).click();
    const noConf = page.waitForRequest(
      (r) => /\/review\/[^/]+$/.test(r.url()) && r.method() === 'POST',
    );
    await session.getByRole('button', { name: /^Bene, prossimo ripasso/ }).click();
    const sent2 = (await noConf).postDataJSON() as Record<string, unknown>;
    expect(sent2).not.toHaveProperty('confidence');
    expect(sent2.rating).toBeDefined();

    // Gli intervalli restano sotto i bottoni di valutazione.
    await expect(session.locator('p.font-mono').first()).toHaveText('3 / 3');
    await session.getByRole('button', { name: 'Mostra risposta' }).click();
    await expect(
      session.getByRole('button', { name: /^Di nuovo, prossimo ripasso/ }),
    ).toBeVisible();
    await noHorizontalScroll(page);
  });
});
