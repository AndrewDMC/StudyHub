import { test, expect, type Locator, type Page } from '@playwright/test';
import { cardExists, seedRedesign, type RedesignSeed } from './fixtures/flashcard-redesign-seed';
import { cardTopic } from './fixtures/flashcard-mazzi-seed';

/**
 * Tab Flashcard ridisegnata a 375×812 (criteri di accettazione 9 e 10 di
 * .claude/work/flashcard-redesign/plan.md): stessa IA del desktop con tab Panoramica / Card /
 * Statistiche, FAB che apre il dialog "Aggiungi flashcard", nessuno scroll orizzontale e target
 * di almeno 44px sui controlli principali. Gira solo nel progetto `mobile`.
 *
 * Seed (`seedRedesign`): 1 card in scadenza, 5 nuove, 1 segnalata, 1 sospesa, "Mazzo extra" con una
 * card e una bozza "Bozza e2e" con due card.
 */
test.use({ viewport: { width: 375, height: 812 } });

let s: RedesignSeed;

test.beforeEach(async ({ request, baseURL }) => {
  s = await seedRedesign(request, baseURL!);
});

test.afterEach(async ({ request, baseURL }) => {
  await request.delete(`${baseURL}/api/subjects/${s.slug}`);
});

const tab = (view?: string, extra = '') =>
  `/materie/${s.slug}?tab=flashcard${view ? `&view=${view}` : ''}${extra}`;

const viewNav = (page: Page) => page.getByRole('navigation', { name: 'Viste flashcard' });
const fab = (page: Page) => page.getByRole('button', { name: 'Aggiungi flashcard' });
const row = (page: Page, front: string) =>
  page.getByRole('button', { name: new RegExp(`^${front}, `) });
const toast = (page: Page, text: string) =>
  page.getByRole('status').filter({ hasText: text }).first();

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

/** Ogni elemento trovato è alto e largo almeno `min` px (area toccabile). */
async function expectTouchTarget(locator: Locator, min = 44, opts: { width?: boolean } = {}) {
  await expect(locator.first()).toBeVisible();
  for (const el of await locator.all()) {
    const box = await el.boundingBox();
    expect(box, 'elemento senza box').not.toBeNull();
    expect(box!.height).toBeGreaterThanOrEqual(min);
    if (opts.width) expect(box!.width).toBeGreaterThanOrEqual(min);
  }
}

test('Viste: Panoramica di default, poi Card e Statistiche, senza scroll orizzontale', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.goto(tab());
  const nav = viewNav(page);
  await expect(nav.getByRole('link')).toHaveText(['Panoramica', 'Card', 'Statistiche'], {
    timeout: 30_000,
  });
  await expect(nav.getByRole('link', { name: 'Panoramica' })).toHaveAttribute(
    'aria-current',
    'page',
  );

  // Panoramica: hero con totale e CTA, "Da sistemare", elenco per argomento.
  const hero = page.getByRole('region', { name: 'Ripasso di oggi' });
  await expect(hero.getByText('card da ripassare')).toBeVisible();
  await expect(hero.getByText(/^1 in scadenza · \d+ nuove/)).toBeVisible();
  await expect(hero.getByRole('link', { name: 'Ripassa ora' })).toHaveAttribute(
    'href',
    `/ripasso?materia=${s.slug}`,
  );
  await expect(hero.getByText(/al massimo 20 al giorno/)).toBeVisible();
  await expect(page.getByRole('link', { name: /1 mazzo da approvare/ })).toBeVisible();
  await expect(page.getByRole('link', { name: /2 card escluse/ })).toContainText(
    '1 segnalate · 1 sospese',
  );
  await expect(page.getByRole('heading', { name: /^Per argomento · \d+$/ })).toBeVisible();
  await expect(page.getByRole('list', { name: 'Mazzi per argomento' })).toBeVisible();
  await noHorizontalScroll(page);

  // Per mazzo e ritorno.
  await page.getByRole('button', { name: 'Vedi per mazzo' }).click();
  await expect(page).toHaveURL(/group=mazzo/);
  await expect(page.getByRole('heading', { name: /^Per mazzo · \d+$/ })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Da approvare · 1' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Attivi · 2' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Rivedi e approva' })).toHaveAttribute(
    'href',
    `/materie/${s.slug}/artifacts/${s.draftId}`,
  );
  await expect(page.getByRole('link', { name: 'Ripassa Mazzo extra' })).toHaveAttribute(
    'href',
    `/ripasso?materia=${s.slug}&mazzo=${s.extraDeckId}`,
  );
  await noHorizontalScroll(page);
  await page.getByRole('button', { name: 'Vedi per argomento' }).click();
  await expect(page).not.toHaveURL(/group=/);
  await expect(page.getByRole('list', { name: 'Mazzi per argomento' })).toBeVisible();

  // Card
  await nav.getByRole('link', { name: 'Card' }).click();
  await expect(page).toHaveURL(/view=card/);
  await expect(nav.getByRole('link', { name: 'Card' })).toHaveAttribute('aria-current', 'page');
  await expect(row(page, 'Entropia uno')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('group', { name: 'Filtra per argomento' })).toBeVisible();
  await noHorizontalScroll(page);

  // Statistiche
  await nav.getByRole('link', { name: 'Statistiche' }).click();
  await expect(page).toHaveURL(/view=statistiche/);
  const tiles = page.getByRole('region', { name: 'Card per stato' });
  await expect(tiles).toBeVisible({ timeout: 20_000 });
  await expect(tiles.getByRole('link', { name: /Escluse dal ripasso/ })).toContainText('2');
  for (const h of [
    'Prossimi 30 giorni',
    'Quanto ricordi',
    'Padronanza per argomento',
    'Sai quello che credi di sapere?',
  ]) {
    await expect(page.getByRole('heading', { name: h })).toBeVisible();
  }
  await noHorizontalScroll(page);

  // Tornando alla Panoramica i filtri della vista Card non restano.
  await nav.getByRole('link', { name: 'Panoramica' }).click();
  await expect(page).not.toHaveURL(/view=/);
});

test('"Da sistemare" porta alle card escluse; "Rimetti nel ripasso" dal dettaglio', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.goto(tab());
  await page.getByRole('link', { name: /2 card escluse/ }).click({ timeout: 30_000 });
  await expect(page).toHaveURL(/view=card/);
  await expect(page).toHaveURL(/escluse=1/);
  await expect(page.getByRole('button', { name: 'Solo escluse dal ripasso' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(row(page, 'Velocita due')).toHaveAccessibleName(/segnalata/, { timeout: 20_000 });
  await expect(row(page, 'Sfusa due')).toHaveAccessibleName(/sospesa/);
  await expect(row(page, 'Entropia uno')).toHaveCount(0);

  await row(page, 'Velocita due').click();
  const sheet = page.getByRole('dialog', { name: 'Card' });
  await expect(sheet).toContainText('Segnalata · esclusa dal ripasso');
  await expect(sheet).toContainText('Mai ripassata');
  await sheet.getByRole('button', { name: 'Rimetti nel ripasso' }).click();
  // Con lo sheet aperto il resto della pagina è nascosto alle API di accessibilità: chiudilo prima.
  await page.keyboard.press('Escape');
  await expect(sheet).toHaveCount(0);
  await expect(row(page, 'Velocita due')).toHaveCount(0, { timeout: 20_000 });
  await expect(row(page, 'Sfusa due')).toBeVisible();

  // "Azzera filtri" torna all'elenco completo.
  await page.getByRole('button', { name: 'Azzera filtri' }).click();
  await expect(row(page, 'Entropia uno')).toBeVisible({ timeout: 20_000 });
});

test('Dettaglio card: riepilogo con stato, prossimo ripasso e storico', async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto(tab('card'));
  await row(page, 'Entropia uno').click({ timeout: 30_000 });
  const sheet = page.getByRole('dialog', { name: 'Card' });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByText('Stato', { exact: true })).toBeVisible();
  await expect(sheet.getByText('In ripasso')).toBeVisible();
  await expect(sheet.getByText('Prossimo ripasso')).toBeVisible();
  await expect(sheet.getByText('oggi', { exact: true })).toBeVisible();
  await expect(sheet.getByText('2 ripassi · 0 errori')).toBeVisible();
  await expect(sheet.getByLabel('Mazzo')).toHaveValue(s.deckId);
  await noHorizontalScroll(page);
});

test('Mazzi: menu ⋯ in un foglio, rinomina, archivia e ripristina', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto(tab(undefined, '&group=mazzo'));
  const trigger = page.getByRole('button', { name: 'Azioni sul mazzo Mazzo extra' });
  await expectTouchTarget(trigger, 44, { width: true });
  await trigger.click();
  const sheet = page.getByRole('dialog', { name: 'Mazzo extra' });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole('link', { name: /Per Anki/ })).toHaveAttribute(
    'href',
    `/api/subjects/${s.slug}/artifacts/${s.extraDeckId}/export.apkg`,
  );
  await expectTouchTarget(
    sheet.getByRole('button', { name: /^(Rinomina|Unisci in un altro mazzo…|Archivia mazzo)$/ }),
    44,
  );

  await sheet.getByRole('button', { name: 'Rinomina' }).click();
  const rename = page.getByRole('dialog', { name: 'Rinomina mazzo' });
  await rename.getByLabel('Nome del mazzo').fill('Mazzo mobile');
  await rename.getByRole('button', { name: 'Salva' }).click();
  await expect(toast(page, 'Mazzo rinominato.')).toBeVisible({ timeout: 20_000 });

  await page.getByRole('button', { name: 'Azioni sul mazzo Mazzo mobile' }).click();
  await page
    .getByRole('dialog', { name: 'Mazzo mobile' })
    .getByRole('button', { name: 'Archivia mazzo' })
    .click();
  const confirm = page.getByRole('alertdialog', { name: 'Archiviare «Mazzo mobile»?' });
  await confirm.getByRole('button', { name: 'Archivia mazzo' }).click();
  await expect(page.getByRole('heading', { name: 'Attivi · 1' })).toBeVisible({ timeout: 20_000 });

  const archived = page.getByRole('button', { name: 'Archiviati · 1 mazzo' });
  await expectTouchTarget(archived, 44);
  await archived.click();
  await page.getByRole('button', { name: 'Ripristina Mazzo mobile' }).click();
  await expect(toast(page, 'Mazzo «Mazzo mobile» ripristinato.')).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByRole('heading', { name: 'Attivi · 2' })).toBeVisible({ timeout: 20_000 });
  await noHorizontalScroll(page);
});

test.describe('FAB e dialog "Aggiungi flashcard"', () => {
  test('il FAB è in tutte le viste, apre il dialog a schermo intero e restituisce il focus', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    for (const view of [undefined, 'card', 'statistiche']) {
      await page.goto(tab(view));
      await expect(fab(page)).toBeVisible({ timeout: 30_000 });
      await expectTouchTarget(fab(page), 44, { width: true });
    }

    await page.goto(tab());
    await fab(page).click();
    const dialog = page.getByRole('dialog', { name: 'Aggiungi flashcard' });
    await expect(dialog).toBeVisible();
    // A schermo intero, senza scroll orizzontale; il FAB si nasconde mentre è aperto.
    const box = (await dialog.boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual(374);
    expect(box.height).toBeGreaterThanOrEqual(800);
    // Il FAB si nasconde mentre il dialog è aperto: il nome appartiene solo al dialog.
    await expect(fab(page)).toHaveCount(0);
    await noHorizontalScroll(page);

    // Quattro modalità, ognuna ≥ 44px.
    const modes = dialog.getByRole('group', { name: 'Come vuoi aggiungerle' }).getByRole('button');
    await expect(modes).toHaveCount(4);
    await expectTouchTarget(modes, 44);
    await expectTouchTarget(dialog.getByRole('button', { name: 'Chiudi' }), 44, { width: true });
    await expectTouchTarget(dialog.getByRole('button', { name: 'Aggiungi card' }), 44);

    await dialog.getByRole('button', { name: 'Chiudi' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(fab(page)).toBeFocused();
  });

  test('crea una card a mano dal FAB, nel mazzo e argomento scelti', async ({ page }) => {
    test.setTimeout(120_000);
    const decksLoaded = page.waitForResponse(
      (r) => /\/api\/subjects\/[^/]+\/decks$/.test(new URL(r.url()).pathname) && r.ok(),
    );
    await page.goto(tab('card'));
    await decksLoaded;
    await fab(page).click({ timeout: 30_000 });
    const dialog = page.getByRole('dialog', { name: 'Aggiungi flashcard' });
    await dialog.getByLabel("Dopo, scrivine un'altra").uncheck();
    await dialog.getByLabel('Domanda').fill('Creata da mobile');
    await dialog.getByLabel('Risposta').fill('Risposta da mobile');
    await dialog.getByLabel('Argomento').selectOption({ label: 'Moto' });
    await dialog.getByLabel('Mazzo').selectOption({ label: 'Mazzo extra' });
    await dialog.getByRole('button', { name: 'Aggiungi card' }).click();
    await expect(dialog).toHaveCount(0, { timeout: 20_000 });
    await expect(toast(page, 'Card aggiunta.')).toBeVisible();
    expect(await cardExists({ deckId: s.extraDeckId }, 'Creata da mobile')).toBe(true);
    expect(await cardTopic({ ...s, deckId: s.extraDeckId }, 'Creata da mobile')).toBe(
      s.topicIds.moto,
    );
    await expect(row(page, 'Creata da mobile')).toBeVisible({ timeout: 20_000 });
    await noHorizontalScroll(page);
  });

  test('crea un mazzo vuoto dal FAB e lo mostra tra gli attivi', async ({
    page,
    request,
    baseURL,
  }) => {
    test.setTimeout(120_000);
    await page.goto(tab(undefined, '&group=mazzo'));
    await fab(page).click({ timeout: 30_000 });
    const dialog = page.getByRole('dialog', { name: 'Aggiungi flashcard' });
    await dialog.getByRole('button', { name: 'Nuovo mazzo vuoto' }).click();
    await expect(dialog.getByRole('button', { name: 'Nuovo mazzo vuoto' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await dialog.getByLabel('Nome del mazzo').fill('Mazzo dal FAB');
    await dialog.getByRole('button', { name: 'Crea mazzo' }).click();
    await expect(toast(page, 'Mazzo «Mazzo dal FAB» creato.')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole('heading', { name: 'Attivi · 3' })).toBeVisible({
      timeout: 20_000,
    });
    const decks = (await (await request.get(`${baseURL}/api/subjects/${s.slug}/decks`)).json())
      .decks as { title: string; status: string }[];
    expect(decks.find((d) => d.title === 'Mazzo dal FAB')?.status).toBe('approved');
  });

  test('Genera con l’AI e Importa si raggiungono dal dialog senza uscire dallo schermo', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await page.goto(tab());
    await fab(page).click({ timeout: 30_000 });
    const dialog = page.getByRole('dialog', { name: 'Aggiungi flashcard' });

    await dialog.getByRole('button', { name: "Genera con l'AI" }).click();
    await expect(dialog.getByText('Nessun documento pronto.')).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Genera flashcard' })).toBeDisabled();
    await noHorizontalScroll(page);

    await dialog.getByRole('button', { name: 'Importa' }).click();
    await dialog.locator('input[type="file"]').setInputFiles({
      name: 'mobile.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from('front,back\nImportata mobile,Risposta\n'),
    });
    const submit = dialog.locator('form').getByRole('button', { name: 'Importa' });
    await expectTouchTarget(submit, 44);
    await submit.click();
    await expect(toast(page, '1 card importate in')).toBeVisible({ timeout: 30_000 });
    await expect(dialog).toHaveCount(0);
  });
});

test('Target ≥ 44px sui controlli principali delle tre viste', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto(tab());
  const nav = viewNav(page);
  await expectTouchTarget(nav.getByRole('link'), 44);
  const hero = page.getByRole('region', { name: 'Ripasso di oggi' });
  await expectTouchTarget(hero.getByRole('link', { name: 'Ripassa ora' }), 44);
  await expectTouchTarget(page.getByRole('button', { name: 'Vedi per mazzo' }), 44);
  await expectTouchTarget(page.getByRole('link', { name: /1 mazzo da approvare/ }), 44);
  await expectTouchTarget(page.getByRole('link', { name: /2 card escluse/ }), 44);
  await expectTouchTarget(page.getByRole('link', { name: /^Ripassa (Calore|Moto)$/ }), 44, {
    width: true,
  });
  await expectTouchTarget(page.getByRole('button', { name: "Ordina con l'AI" }), 44);

  await page.goto(tab('card'));
  await expect(row(page, 'Entropia uno')).toBeVisible({ timeout: 30_000 });
  await expectTouchTarget(row(page, 'Entropia uno'), 44);
  await expectTouchTarget(page.getByRole('button', { name: 'Cerca tra le flashcard' }), 44, {
    width: true,
  });
  await expectTouchTarget(page.getByRole('button', { name: 'Solo escluse dal ripasso' }), 44);
  await expectTouchTarget(
    page.getByRole('group', { name: 'Filtra per argomento' }).getByRole('button'),
    44,
  );

  await page.goto(tab('statistiche'));
  const tiles = page.getByRole('region', { name: 'Card per stato' });
  await expect(tiles).toBeVisible({ timeout: 30_000 });
  await expectTouchTarget(tiles.getByRole('link', { name: /Escluse dal ripasso/ }), 44);
  await expectTouchTarget(page.getByRole('link', { name: /^Ripassa (Calore|Moto)$/ }), 44);
});
