import { test, expect, type Page } from '@playwright/test';
import {
  deleteSubject,
  expectMinSize,
  expectNoHorizontalScroll,
  seedVerify,
  smallTargets,
  verifyUrl,
  VERIFY_TOPIC,
} from './fixtures/lezioni-mobile-seed';

/**
 * Verifica mobile (S7, regole di C13 applicate a C10) a 375×812: testata, barra azioni fissa con
 * Correggi / Non me lo ricordo / Avanti, sheet "Materiale" dal punto chiave, esito senza barra.
 * Gira solo nel progetto `mobile`. Le due domande sono seminate (nessun job); la correzione AI non
 * si usa: si procede con "Non me lo ricordo", che è deterministico.
 */

test.use({ viewport: { width: 375, height: 812 } });

const bar = (page: Page) => page.getByRole('toolbar', { name: 'Azioni della verifica' });
const answerBox = (page: Page) => page.getByPlaceholder('Rispondi a memoria, poi correggi.');

test.describe('Verifica mobile', () => {
  let slug: string | undefined;

  test.afterEach(async ({ request, baseURL }) => {
    if (slug) await deleteSubject(request, baseURL!, slug);
    slug = undefined;
  });

  test('Testata e barra: Correggi attivo solo con una risposta, Non me lo ricordo sempre; target da 44px e nessuno scroll orizzontale', async ({
    page,
    request,
    baseURL,
  }) => {
    test.setTimeout(90_000);
    const seed = await seedVerify(request, baseURL!);
    slug = seed.slug;
    await page.goto(verifyUrl(seed));
    await expect(bar(page)).toBeVisible({ timeout: 30_000 });

    // Testata: indietro (≥ 44), titolo con l'argomento, +3 giorni, materiale chiuso.
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(`Verifica · ${VERIFY_TOPIC}`);
    await expect(page.getByText('+3 giorni')).toBeVisible();
    await expect(page.getByText('Materiale chiuso')).toBeVisible();
    await expectMinSize(page.getByRole('link', { name: /^Torna alla materia/ }), { height: 44 });

    // Prima domanda con la casella di risposta; nessun pulsante di correzione in pagina.
    await expect(
      page.getByText('Domanda 1: che cosa afferma il primo principio?').first(),
    ).toBeVisible();
    await expect(answerBox(page)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Correggi' })).toHaveCount(1);

    // Barra fissa in basso con i due pulsanti.
    const box = await bar(page).boundingBox();
    expect(Math.round(box!.y + box!.height)).toBe(812);
    const correct = bar(page).getByRole('button', { name: 'Correggi' });
    const unknown = bar(page).getByRole('button', { name: 'Non me lo ricordo' });
    await expect(correct).toBeDisabled();
    await expect(unknown).toBeEnabled();
    await expectMinSize(correct, { height: 52 });
    await expectMinSize(unknown, { height: 52 });

    await answerBox(page).fill('Il calore meno il lavoro.');
    await expect(correct).toBeEnabled();

    // La barra non copre la nota in fondo né la casella: si può scorrere fino alla nota.
    const note = page.getByText(/Una verifica non è una rilettura/);
    await note.scrollIntoViewIfNeeded();
    const noteBox = await note.boundingBox();
    const barBox = await bar(page).boundingBox();
    expect(noteBox!.y + noteBox!.height).toBeLessThanOrEqual(barBox!.y + 0.5);

    await expectNoHorizontalScroll(page);
    for (const scope of ['[role="toolbar"]', 'header']) {
      expect(await smallTargets(page, scope)).toEqual([]);
    }
  });

  test('Non me lo ricordo → punto chiave → sheet Materiale; poi Avanti, Vedi l’esito e nessuna barra sull’esito', async ({
    page,
    request,
    baseURL,
  }) => {
    test.setTimeout(120_000);
    const seed = await seedVerify(request, baseURL!);
    slug = seed.slug;
    await page.goto(verifyUrl(seed));
    await expect(bar(page)).toBeVisible({ timeout: 30_000 });

    // Domanda 1: non me lo ricordo, dalla barra.
    await bar(page).getByRole('button', { name: 'Non me lo ricordo' }).click();
    const next = bar(page).getByRole('button', { name: 'Avanti →' });
    await expect(next).toBeVisible({ timeout: 20_000 });
    await expectMinSize(next, { height: 52 });

    // Il punto chiave si riapre e la citazione apre lo sheet "Materiale" (non una pagina in fondo).
    const reopen = page.getByRole('button', { name: /^Riapri il punto chiave/ });
    await expectMinSize(reopen, { height: 44 });
    await reopen.click();
    const cite = page.getByRole('button', { name: /↗ .*Termodinamica\.pdf · p\. 3/ });
    await expectMinSize(cite, { height: 44 });
    await cite.click();
    const sheet = page.getByRole('dialog', { name: 'Materiale' });
    await expect(sheet).toBeVisible();
    await expectMinSize(sheet.getByRole('button', { name: 'Chiudi' }), { width: 44, height: 44 });
    await expectNoHorizontalScroll(page);
    await page.keyboard.press('Escape');
    await expect(sheet).toHaveCount(0);
    await expect(cite).toBeFocused();

    // Avanti → domanda 2 (ultima): il primario diventa "Vedi l'esito".
    await next.click();
    await expect(
      page.getByText('Domanda 2: che cosa afferma il primo principio?').first(),
    ).toBeVisible();
    await bar(page).getByRole('button', { name: 'Non me lo ricordo' }).click();
    const finish = bar(page).getByRole('button', { name: 'Vedi l’esito →' });
    await expect(finish).toBeVisible({ timeout: 20_000 });
    await finish.click();

    // Esito: i pulsanti sono in pagina, la barra non c'è.
    await expect(bar(page)).toHaveCount(0, { timeout: 20_000 });
    await expect(page.getByRole('link', { name: /Torna alla materia/ }).first()).toBeVisible();
    await expectNoHorizontalScroll(page);
  });
});
