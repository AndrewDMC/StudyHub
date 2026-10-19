import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import {
  cardExists,
  cardState,
  seedRedesign,
  type RedesignSeed,
} from './fixtures/flashcard-redesign-seed';
import { cardTopic } from './fixtures/flashcard-mazzi-seed';

/**
 * Tab Flashcard ridisegnata, desktop (criteri di accettazione 1-8 di
 * .claude/work/flashcard-redesign/plan.md): Panoramica con hero, raggruppamento per argomento / mazzo,
 * menu dei mazzi, vista Card (filtri, conteggio, menu ⋯, conferme non native, selezione), pannello
 * di dettaglio, dialog "Aggiungi" nelle 4 modalità e Statistiche.
 *
 * Seed (`seedRedesign`): 1 card in scadenza, 5 nuove, 1 segnalata, 1 sospesa, "Mazzo extra" con una
 * card e una bozza "Bozza e2e" con due card.
 */
test.use({ viewport: { width: 1440, height: 900 } });

let s: RedesignSeed;

test.beforeEach(async ({ request, baseURL }) => {
  s = await seedRedesign(request, baseURL!);
});

test.afterEach(async ({ request, baseURL }) => {
  await request.delete(`${baseURL}/api/subjects/${s.slug}`);
});

const tab = (view?: string, extra = '') =>
  `/materie/${s.slug}?tab=flashcard${view ? `&view=${view}` : ''}${extra}`;

const viewLink = (page: Page, name: string) =>
  page.getByRole('navigation', { name: 'Viste flashcard' }).getByRole('link', { name });
/** Riga di "Le tue card" (vista Card). */
const cardRow = (page: Page, front: string) =>
  page.locator('li[data-card-id]').filter({ hasText: front });
const rowBody = (page: Page, front: string) =>
  cardRow(page, front).getByRole('button', { name: new RegExp(`^${front}`) });
/** Pannello di dettaglio: inline (>= 896px di colonna) oppure drawer. */
const detail = (page: Page) =>
  page
    .getByRole('complementary', { name: 'Modifica card' })
    .or(page.getByRole('dialog', { name: 'Modifica card' }));
/**
 * Va alla tab e apre il dialog "Aggiungi" solo dopo che l'elenco dei mazzi è arrivato: il form a mano
 * sceglie il mazzo predefinito alla prima apertura.
 */
async function openAdd(page: Page, url: string) {
  const decksLoaded = page.waitForResponse(
    (r) => /\/api\/subjects\/[^/]+\/decks$/.test(new URL(r.url()).pathname) && r.ok(),
  );
  await page.goto(url);
  await decksLoaded;
  await page.getByRole('button', { name: 'Aggiungi', exact: true }).click({ timeout: 30_000 });
  const dialog = page.getByRole('dialog', { name: 'Aggiungi flashcard' });
  await expect(dialog).toBeVisible();
  return dialog;
}

const toast = (page: Page, text: string) =>
  page.getByRole('status').filter({ hasText: text }).first();

/** Registra i dialog nativi (alert/confirm/prompt): nel tab non ce ne devono essere. */
function trackNativeDialogs(page: Page): string[] {
  const seen: string[] = [];
  page.on('dialog', (d) => {
    seen.push(d.type());
    void d.dismiss();
  });
  return seen;
}

async function decksOf(request: APIRequestContext, baseURL: string | undefined, slug: string) {
  const res = await request.get(`${baseURL}/api/subjects/${slug}/decks`);
  expect(res.ok()).toBe(true);
  return (await res.json()).decks as { id: string; title: string; status: string }[];
}

test.describe('Panoramica', () => {
  test('di default: hero con totale = in scadenza + nuove, Ripassa ora, forecast e regola del piano', async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await page.goto(tab());
    await expect(viewLink(page, 'Panoramica')).toHaveAttribute('aria-current', 'page', {
      timeout: 30_000,
    });
    await expect(viewLink(page, 'Card')).not.toHaveAttribute('aria-current', 'page');

    const hero = page.getByRole('region', { name: 'Ripasso di oggi' });
    await expect(hero.getByText('card da ripassare')).toBeVisible({ timeout: 30_000 });
    const summary = hero.getByText(/in scadenza/);
    await expect(summary).toHaveText(/^1 in scadenza · \d+ nuove · circa \d+ minut/);
    const [, due, nuove] = (await summary.innerText()).match(/^(\d+) in scadenza · (\d+) nuove/)!;
    // Il numero grande è la somma dei due addendi.
    await expect(hero.locator('p').first().locator('span').first()).toHaveText(
      String(Number(due) + Number(nuove)),
    );

    await expect(hero.getByRole('link', { name: 'Ripassa ora' })).toHaveAttribute(
      'href',
      `/ripasso?materia=${s.slug}`,
    );
    await expect(hero.getByRole('img', { name: /^Card in scadenza: oggi/ })).toBeVisible();
    await expect(hero.getByRole('link', { name: /Tutte le statistiche/ })).toHaveAttribute(
      'href',
      /view=statistiche/,
    );
    await expect(
      hero.getByText(
        'Le card nuove entrano solo per gli argomenti già trattati nel piano, al massimo 20 al giorno.',
      ),
    ).toBeVisible();

    // Nessun pulsante "Ripassa N" nella barra: in Panoramica l'azione primaria è quella dell'hero.
    await expect(page.getByRole('link', { name: /^Ripassa \d+ card$/ })).toHaveCount(0);
    // "Ripassa ora" porta davvero alla sessione.
    await hero.getByRole('link', { name: 'Ripassa ora' }).click();
    await expect(page).toHaveURL(new RegExp(`/ripasso\\?materia=${s.slug}`), { timeout: 30_000 });
  });

  test('"Da sistemare" mostra bozze ed escluse e i link portano alla vista giusta', async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await page.goto(tab());
    const att = page.getByRole('region', { name: 'Da sistemare' });
    await expect(att).toBeVisible({ timeout: 30_000 });
    await expect(att).toContainText('1 mazzo in bozza da approvare');
    await expect(att).toContainText('Le sue 2 card non entrano nel ripasso finché non lo approvi.');
    await expect(att).toContainText('2 card escluse dal ripasso');
    await expect(att).toContainText('1 segnalata durante il ripasso, 1 sospesa da te.');

    await att.getByRole('link', { name: 'Controlla' }).click();
    await expect(page).toHaveURL(/view=card/);
    await expect(page).toHaveURL(/escluse=1/);
    await expect(page.getByRole('button', { name: 'Solo escluse dal ripasso' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(cardRow(page, 'Velocita due')).toBeVisible({ timeout: 20_000 });
    await expect(cardRow(page, 'Sfusa due')).toBeVisible();
    await expect(page.locator('li[data-card-id]')).toHaveCount(2);

    await viewLink(page, 'Panoramica').click();
    await page
      .getByRole('region', { name: 'Da sistemare' })
      .getByRole('link', { name: 'Rivedi i mazzi' })
      .click();
    await expect(page).toHaveURL(/group=mazzo/);
    await expect(page.getByRole('heading', { name: 'Da approvare · 1' })).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByRole('link', { name: 'Rivedi e approva' })).toHaveAttribute(
      'href',
      `/materie/${s.slug}/artifacts/${s.draftId}`,
    );
  });

  test('"Da sistemare" non compare se non c’è nulla da sistemare', async ({
    page,
    request,
    baseURL,
  }) => {
    test.setTimeout(90_000);
    const { subject } = await (
      await request.post(`${baseURL}/api/subjects`, {
        data: { name: `E2E Pulita ${Date.now()}`, color: 'blue' },
      })
    ).json();
    try {
      const { deck } = await (
        await request.post(`${baseURL}/api/subjects/${subject.slug}/decks`, {
          data: { title: 'Solo approvate' },
        })
      ).json();
      const res = await request.post(`${baseURL}/api/subjects/${subject.slug}/flashcards`, {
        data: { deckId: deck.id, front: 'Pulita uno', back: 'R' },
      });
      expect(res.status()).toBe(201);
      await page.goto(`/materie/${subject.slug}?tab=flashcard`);
      await expect(page.getByRole('region', { name: 'Ripasso di oggi' })).toBeVisible({
        timeout: 30_000,
      });
      await expect(page.getByRole('heading', { name: /Le tue card/ })).toBeVisible();
      await expect(page.getByRole('region', { name: 'Da sistemare' })).toHaveCount(0);
    } finally {
      await request.delete(`${baseURL}/api/subjects/${subject.slug}`);
    }
  });

  test('toggle Argomento / Mazzo cambia il raggruppamento e resta nell’URL', async ({ page }) => {
    test.setTimeout(90_000);
    await page.goto(tab());
    const group = page.getByRole('group', { name: 'Raggruppa' });
    await expect(group.getByRole('button', { name: 'Argomento' })).toHaveAttribute(
      'aria-pressed',
      'true',
      { timeout: 30_000 },
    );
    await expect(page.getByRole('list', { name: 'Mazzi per argomento' })).toBeVisible();

    await group.getByRole('button', { name: 'Mazzo' }).click();
    await expect(page).toHaveURL(/group=mazzo/);
    await expect(group.getByRole('button', { name: 'Mazzo' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(page.getByRole('heading', { name: 'Attivi · 2' })).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByRole('heading', { name: 'Da approvare · 1' })).toBeVisible();
    await expect(page.getByRole('heading', { name: /Le tue card/ })).toContainText(
      /in 2 mazzi attivi/,
    );
    await expect(page.getByRole('list', { name: 'Mazzi per argomento' })).toHaveCount(0);

    // Persistito: sopravvive a un reload.
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Attivi · 2' })).toBeVisible({
      timeout: 30_000,
    });

    // Ripassa del mazzo → coda limitata al mazzo.
    await expect(page.getByRole('link', { name: 'Ripassa Mazzo extra' })).toHaveAttribute(
      'href',
      `/ripasso?materia=${s.slug}&mazzo=${s.extraDeckId}`,
    );
    await expect(page.getByRole('link', { name: 'Ripassa Mazzo e2e' })).toHaveAttribute(
      'href',
      `/ripasso?materia=${s.slug}&mazzo=${s.deckId}`,
    );

    await group.getByRole('button', { name: 'Argomento' }).click();
    await expect(page).not.toHaveURL(/group=/);
    await expect(page.getByRole('list', { name: 'Mazzi per argomento' })).toBeVisible({
      timeout: 20_000,
    });
  });

  test('menu del mazzo: esporta, rinomina, archivia e ripristina', async ({
    page,
    request,
    baseURL,
  }) => {
    test.setTimeout(120_000);
    const native = trackNativeDialogs(page);
    await page.goto(tab(undefined, '&group=mazzo'));
    const trigger = page.getByRole('button', { name: 'Azioni sul mazzo Mazzo extra' });
    await trigger.click({ timeout: 30_000 });
    const menu = page.getByRole('menu', { name: 'Azioni sul mazzo' });
    await expect(menu.getByRole('menuitem')).toHaveText([
      'Rinomina',
      'Unisci in un altro mazzo…',
      /Per Anki \(\.apkg\)/,
      /Foglio CSV/,
      'Archivia mazzo',
    ]);
    await expect(menu.getByRole('menuitem', { name: /Per Anki/ })).toHaveAttribute(
      'href',
      `/api/subjects/${s.slug}/artifacts/${s.extraDeckId}/export.apkg`,
    );
    await expect(menu.getByRole('menuitem', { name: /Foglio CSV/ })).toHaveAttribute(
      'href',
      `/api/subjects/${s.slug}/artifacts/${s.extraDeckId}/export.csv`,
    );

    // Rinomina
    await menu.getByRole('menuitem', { name: 'Rinomina' }).click();
    const rename = page.getByRole('dialog', { name: 'Rinomina mazzo' });
    const input = rename.getByLabel('Nome del mazzo');
    await expect(input).toHaveValue('Mazzo extra');
    await input.fill('');
    await rename.getByRole('button', { name: 'Salva' }).click();
    await expect(rename.getByRole('alert')).toHaveText('Scrivi un nome.');
    await input.fill('Mazzo rinominato');
    await rename.getByRole('button', { name: 'Salva' }).click();
    await expect(toast(page, 'Mazzo rinominato.')).toBeVisible({ timeout: 20_000 });
    await expect(
      page.getByRole('button', { name: 'Azioni sul mazzo Mazzo rinominato' }),
    ).toBeVisible();
    expect((await decksOf(request, baseURL, s.slug)).map((d) => d.title)).toContain(
      'Mazzo rinominato',
    );

    // Archivia, con conferma non nativa
    await page.getByRole('button', { name: 'Azioni sul mazzo Mazzo rinominato' }).click();
    await page.getByRole('menuitem', { name: 'Archivia mazzo' }).click();
    const confirm = page.getByRole('alertdialog', { name: 'Archiviare «Mazzo rinominato»?' });
    await expect(confirm).toContainText('Le sue 1 card escono dal ripasso.');
    await expect(confirm.getByRole('button', { name: 'Annulla' })).toBeFocused();
    await confirm.getByRole('button', { name: 'Archivia mazzo' }).click();
    await expect(page.getByRole('heading', { name: 'Attivi · 1' })).toBeVisible({
      timeout: 20_000,
    });
    const archived = page.getByRole('button', { name: 'Archiviati · 1 mazzo' });
    await expect(archived).toHaveAttribute('aria-expanded', 'false');
    await archived.click();
    await expect(archived).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByText('1 card · archiviato')).toBeVisible();
    expect(
      (await decksOf(request, baseURL, s.slug)).find((d) => d.title === 'Mazzo rinominato')?.status,
    ).toBe('archived');

    // Ripristina
    await page.getByRole('button', { name: 'Ripristina Mazzo rinominato' }).click();
    await expect(toast(page, 'Mazzo «Mazzo rinominato» ripristinato.')).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByRole('heading', { name: 'Attivi · 2' })).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByRole('button', { name: /^Archiviati/ })).toHaveCount(0);
    expect(native).toEqual([]);
  });

  test('menu del mazzo: unisci in un altro mazzo', async ({ page, request, baseURL }) => {
    test.setTimeout(90_000);
    await page.goto(tab(undefined, '&group=mazzo'));
    await page.getByRole('button', { name: 'Azioni sul mazzo Mazzo extra' }).click({
      timeout: 30_000,
    });
    await page.getByRole('menuitem', { name: 'Unisci in un altro mazzo…' }).click();
    const dialog = page.getByRole('dialog', { name: 'Unisci «Mazzo extra» in un altro mazzo' });
    await dialog.getByLabel('Mazzo di destinazione').selectOption({ label: 'Mazzo e2e' });
    await dialog.getByRole('button', { name: 'Unisci' }).click();
    await expect(toast(page, '1 card spostate: mazzi uniti.')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole('heading', { name: 'Attivi · 1' })).toBeVisible({
      timeout: 20_000,
    });
    expect((await decksOf(request, baseURL, s.slug)).map((d) => d.title)).not.toContain(
      'Mazzo extra',
    );
    expect(await cardExists({ deckId: s.deckId }, 'Extra uno')).toBe(true);
  });
});

test.describe('Vista Card', () => {
  test('filtri a pulsante con riepilogo, conteggio, "Azzera filtri" e ordinamento', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await page.goto(tab('card'));
    await expect(viewLink(page, 'Card')).toHaveAttribute('aria-current', 'page', {
      timeout: 30_000,
    });
    await expect(cardRow(page, 'Entropia uno')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('button', { name: 'Azzera filtri' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: /^Ripassa \d+ card$/ })).toBeVisible();

    // Ricerca testuale (debounce 250 ms) + conteggio
    const search = page.getByRole('searchbox', { name: 'Cerca nelle card' });
    await search.fill('Entropia');
    await expect(page.locator('li[data-card-id]')).toHaveCount(3, { timeout: 20_000 });
    await expect(page.getByText(/^3 card/).first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Azzera filtri' })).toBeVisible();
    await search.fill('zzzzqqq');
    await expect(page.getByText('Nessuna flashcard corrisponde ai filtri.')).toBeVisible({
      timeout: 20_000,
    });
    await page.getByRole('button', { name: 'Azzera filtri' }).first().click();
    await expect(search).toHaveValue('');
    await expect(cardRow(page, 'Velocita uno')).toBeVisible({ timeout: 20_000 });

    // Stato
    await page.getByRole('button', { name: /^Stato/ }).click();
    await page
      .getByRole('group', { name: 'Filtra per stato' })
      .getByRole('radio', { name: 'In ripasso' })
      .click();
    await expect(page.getByRole('button', { name: 'Stato: In ripasso' })).toBeVisible();
    await expect(page).toHaveURL(/stato=review/);
    await expect(page.locator('li[data-card-id]')).toHaveCount(1, { timeout: 20_000 });
    await expect(cardRow(page, 'Entropia uno')).toBeVisible();
    await expect(page.getByText(/^1 card/).first()).toBeVisible();

    // Mazzo (si aggiunge allo Stato: nessuna card in ripasso nel Mazzo extra)
    await page.getByRole('button', { name: /^Mazzo/ }).click();
    await page
      .getByRole('group', { name: 'Filtra per mazzo' })
      .getByRole('radio', { name: 'Mazzo extra' })
      .click();
    await expect(page.getByText('Nessuna flashcard corrisponde ai filtri.')).toBeVisible({
      timeout: 20_000,
    });
    await page.getByRole('button', { name: 'Azzera filtri' }).first().click();
    await expect(page).not.toHaveURL(/stato=|mazzo=/);

    // Solo Mazzo extra
    await page.getByRole('button', { name: /^Mazzo/ }).click();
    await page
      .getByRole('group', { name: 'Filtra per mazzo' })
      .getByRole('radio', { name: 'Mazzo extra' })
      .click();
    await expect(page.locator('li[data-card-id]')).toHaveCount(1, { timeout: 20_000 });
    await expect(cardRow(page, 'Extra uno')).toBeVisible();
    await expect(page.getByText(/1 card in Mazzo extra/)).toBeVisible();
    await page.getByRole('button', { name: 'Azzera filtri' }).first().click();

    // Argomento
    await page.getByRole('button', { name: /^Argomento/ }).click();
    await page
      .getByRole('group', { name: 'Filtra per argomento' })
      .getByRole('radio', { name: 'Calore' })
      .click();
    await expect(page.locator('li[data-card-id]')).toHaveCount(3, { timeout: 20_000 });
    await expect(page.getByText(/3 card in Calore/)).toBeVisible();
    await page.getByRole('button', { name: 'Azzera filtri' }).first().click();

    // Escluse: segnalata e sospesa, con il motivo scritto
    const excluded = page.getByRole('button', { name: 'Solo escluse dal ripasso' });
    await excluded.click();
    await expect(excluded).toHaveAttribute('aria-pressed', 'true');
    await expect(page).toHaveURL(/escluse=1/);
    await expect(page.locator('li[data-card-id]')).toHaveCount(2, { timeout: 20_000 });
    await expect(cardRow(page, 'Velocita due')).toContainText('Segnalata');
    await expect(cardRow(page, 'Velocita due')).toContainText('esclusa');
    await expect(cardRow(page, 'Sfusa due')).toContainText('Sospesa');
    await expect(cardRow(page, 'Sfusa due')).toContainText('esclusa');
    await excluded.click();
    await expect(excluded).toHaveAttribute('aria-pressed', 'false');

    // Ordinamento: prima in scadenza (default) / più recenti
    const order = page.getByRole('button', { name: /^Ordina:/ });
    await expect(order).toHaveText(/Ordina: prima in scadenza/);
    await expect(page.locator('li[data-card-id]').first()).toContainText('Entropia uno', {
      timeout: 20_000,
    });
    await order.click();
    await page
      .getByRole('menu', { name: 'Ordina' })
      .getByRole('menuitemradio', { name: 'Più recenti' })
      .click();
    await expect(order).toHaveText(/Ordina: più recenti/);
    await expect(page).toHaveURL(/ordine=recenti/);
  });

  test('menu ⋯ della riga: sospendi, rimetti nel ripasso ed elimina con conferma non nativa', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const native = trackNativeDialogs(page);
    await page.goto(tab('card'));
    await expect(cardRow(page, 'Entropia due')).toBeVisible({ timeout: 30_000 });

    // Sospendi / Riattiva
    await page.getByRole('button', { name: 'Altre azioni: Entropia due' }).click();
    const menu = page.getByRole('menu', { name: 'Azioni sulla card' });
    await expect(menu.getByRole('menuitem')).toHaveText([
      'Sospendi',
      'Sposta in un altro mazzo…',
      'Cambia argomento…',
      'Elimina card',
    ]);
    await menu.getByRole('menuitem', { name: 'Sospendi' }).click();
    await expect(toast(page, 'Card sospesa.')).toBeVisible({ timeout: 20_000 });
    await expect(cardRow(page, 'Entropia due')).toContainText('Sospesa', { timeout: 20_000 });
    expect((await cardState(s.deckId, 'Entropia due'))?.suspended).toBe(true);
    await page.getByRole('button', { name: 'Altre azioni: Entropia due' }).click();
    await page.getByRole('menuitem', { name: 'Riattiva' }).click();
    await expect(cardRow(page, 'Entropia due')).not.toContainText('Sospesa', { timeout: 20_000 });
    expect((await cardState(s.deckId, 'Entropia due'))?.suspended).toBe(false);

    // Una segnalata offre "Rimetti nel ripasso"
    await page.getByRole('button', { name: 'Altre azioni: Velocita due' }).click();
    await expect(
      page.getByRole('menu', { name: 'Azioni sulla card' }).getByRole('menuitem').first(),
    ).toHaveText('Rimetti nel ripasso');
    await page.getByRole('menuitem', { name: 'Rimetti nel ripasso' }).click();
    await expect(toast(page, 'Card rimessa nel ripasso.')).toBeVisible({ timeout: 20_000 });
    await expect(cardRow(page, 'Velocita due')).not.toContainText('Segnalata', {
      timeout: 20_000,
    });

    // Sposta in un altro mazzo…
    await page.getByRole('button', { name: 'Altre azioni: Sfusa uno' }).click();
    await page.getByRole('menuitem', { name: 'Sposta in un altro mazzo…' }).click();
    const move = page.getByRole('dialog', { name: 'Sposta in un altro mazzo' });
    await move.getByLabel('Mazzo').selectOption({ label: 'Mazzo extra' });
    await move.getByRole('button', { name: 'Applica' }).click();
    await expect(toast(page, 'Card spostata.')).toBeVisible({ timeout: 20_000 });
    expect(await cardExists({ deckId: s.extraDeckId }, 'Sfusa uno')).toBe(true);

    // Elimina: Annulla non toglie nulla, Elimina sì
    await page.getByRole('button', { name: 'Altre azioni: Velocita uno' }).click();
    await page.getByRole('menuitem', { name: 'Elimina card' }).click();
    const confirm = page.getByRole('alertdialog', { name: 'Eliminare questa card?' });
    await expect(confirm).toContainText("L'azione non è reversibile.");
    await expect(confirm.getByRole('button', { name: 'Annulla' })).toBeFocused();
    await confirm.getByRole('button', { name: 'Annulla' }).click();
    await expect(confirm).toHaveCount(0);
    await expect(cardRow(page, 'Velocita uno')).toBeVisible();
    expect(await cardExists({ deckId: s.deckId }, 'Velocita uno')).toBe(true);

    await page.getByRole('button', { name: 'Altre azioni: Velocita uno' }).click();
    await page.getByRole('menuitem', { name: 'Elimina card' }).click();
    await page
      .getByRole('alertdialog', { name: 'Eliminare questa card?' })
      .getByRole('button', { name: 'Elimina' })
      .click();
    await expect(toast(page, 'Card eliminata.')).toBeVisible({ timeout: 20_000 });
    await expect(cardRow(page, 'Velocita uno')).toHaveCount(0, { timeout: 20_000 });
    expect(await cardExists({ deckId: s.deckId }, 'Velocita uno')).toBe(false);
    expect(native).toEqual([]);
  });

  test('selezione multipla: barra flottante, sospendi, annulla ed elimina con conferma', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const native = trackNativeDialogs(page);
    await page.goto(tab('card'));
    await expect(cardRow(page, 'Entropia due')).toBeVisible({ timeout: 30_000 });
    const bar = page.getByRole('toolbar', { name: 'Azioni sulle card selezionate' });
    await expect(bar).toHaveCount(0);

    const check = (front: string) =>
      page.getByRole('checkbox', { name: `Seleziona card: ${front}` }).check();
    await check('Entropia due');
    await expect(bar).toBeVisible();
    await expect(bar).toContainText('1 selezionata');
    await check('Entropia tre');
    await expect(bar).toContainText('2 selezionate');
    for (const name of ['Sospendi', 'Sposta…', 'Tag…', 'Elimina', 'Annulla selezione']) {
      await expect(bar.getByRole('button', { name })).toBeVisible();
    }
    await expect(bar.getByRole('button', { name: 'Riattiva' })).toHaveCount(0);

    // Annulla selezione
    await bar.getByRole('button', { name: 'Annulla selezione' }).click();
    await expect(bar).toHaveCount(0);

    // Sospendi in blocco
    await check('Entropia due');
    await check('Entropia tre');
    await bar.getByRole('button', { name: 'Sospendi' }).click();
    await expect(toast(page, 'Card sospese.')).toBeVisible({ timeout: 20_000 });
    await expect(bar).toHaveCount(0);
    expect((await cardState(s.deckId, 'Entropia tre'))?.suspended).toBe(true);
    await expect(cardRow(page, 'Entropia tre')).toContainText('Sospesa', { timeout: 20_000 });

    // Tag…
    await check('Entropia due');
    await bar.getByRole('button', { name: 'Tag…' }).click();
    const tags = page.getByRole('dialog', { name: 'Tag delle card' });
    await tags.getByLabel('Tag').fill('orale');
    await tags.getByRole('button', { name: 'Applica' }).click();
    await expect(toast(page, 'Tag aggiunto.')).toBeVisible({ timeout: 20_000 });

    // Elimina in blocco, con conferma
    await check('Entropia due');
    await check('Entropia tre');
    await bar.getByRole('button', { name: 'Elimina' }).click();
    const confirm = page.getByRole('alertdialog', { name: 'Eliminare 2 card?' });
    await expect(confirm).toBeVisible();
    await confirm.getByRole('button', { name: 'Elimina' }).click();
    await expect(toast(page, '2 card eliminate.')).toBeVisible({ timeout: 20_000 });
    await expect(cardRow(page, 'Entropia due')).toHaveCount(0, { timeout: 20_000 });
    await expect(cardRow(page, 'Entropia tre')).toHaveCount(0);
    expect(await cardExists({ deckId: s.deckId }, 'Entropia due')).toBe(false);
    expect(native).toEqual([]);
  });
});

test.describe('Pannello di dettaglio', () => {
  test('mostra stato, prossimo ripasso e storico, e salva le modifiche', async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto(tab('card'));
    await rowBody(page, 'Entropia uno').click({ timeout: 30_000 });
    await expect(page).toHaveURL(/card=/);
    const panel = detail(page);
    await expect(panel).toBeVisible();
    // Entropia uno: in ripasso, scaduta ieri, 2 ripassi.
    await expect(panel).toContainText('In ripasso');
    await expect(panel).toContainText('oggi');
    await expect(panel).toContainText('2 ripassi · 0 errori');

    const front = panel.getByLabel('Domanda');
    await expect(front).toHaveValue('Entropia uno');
    await expect(panel.getByRole('button', { name: 'Salva' })).toBeDisabled();

    // Validazione
    await front.fill('');
    await panel.getByRole('button', { name: 'Salva' }).click();
    await expect(panel).toContainText('Scrivi la domanda.');

    // Modifica e salva
    await front.fill('Entropia uno rivista');
    await panel.getByLabel('Risposta').fill('Risposta rivista');
    await panel.getByLabel('Argomento').selectOption({ label: 'Moto' });
    await panel.getByRole('button', { name: 'Salva' }).click();
    await expect(toast(page, 'Card salvata.')).toBeVisible({ timeout: 20_000 });
    await expect(panel).toBeVisible();
    await expect(panel.getByRole('button', { name: 'Salva' })).toBeDisabled();
    const saved = await cardState(s.deckId, 'Entropia uno rivista');
    expect(saved).toMatchObject({ back: 'Risposta rivista' });
    expect(await cardTopic(s, 'Entropia uno rivista')).toBe(s.topicIds.moto);
    await expect(cardRow(page, 'Entropia uno rivista')).toBeVisible({ timeout: 20_000 });

    // Modifiche non salvate: Annulla chiede conferma
    await panel.getByLabel('Domanda').fill('Da scartare');
    await panel.getByRole('button', { name: 'Annulla' }).click();
    const discard = page.getByRole('alertdialog', { name: 'Scartare le modifiche?' });
    await expect(discard).toBeVisible();
    await discard.getByRole('button', { name: 'Continua a modificare' }).click();
    await expect(panel.getByLabel('Domanda')).toHaveValue('Da scartare');
    await panel.getByRole('button', { name: 'Annulla' }).click();
    await page
      .getByRole('alertdialog', { name: 'Scartare le modifiche?' })
      .getByRole('button', { name: 'Scarta' })
      .click();
    await expect(panel).toHaveCount(0);
    await expect(page).not.toHaveURL(/card=/);
    expect(await cardState(s.deckId, 'Da scartare')).toBeNull();
  });

  test('Sospendi ed Elimina card dal pannello; una card di bozza dice perché è esclusa', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await page.goto(tab('card'));
    await rowBody(page, 'Entropia tre').click({ timeout: 30_000 });
    const panel = detail(page);
    await panel.getByRole('button', { name: 'Sospendi' }).click();
    await expect(toast(page, 'Card sospesa.')).toBeVisible({ timeout: 20_000 });
    await expect(panel).toContainText('Sospesa · esclusa dal ripasso');
    await expect(panel.getByRole('button', { name: 'Riattiva' })).toBeVisible();

    await panel.getByRole('button', { name: 'Elimina card' }).click();
    await page
      .getByRole('alertdialog', { name: 'Eliminare questa card?' })
      .getByRole('button', { name: 'Elimina' })
      .click();
    await expect(toast(page, 'Card eliminata.')).toBeVisible({ timeout: 20_000 });
    await expect(cardRow(page, 'Entropia tre')).toHaveCount(0, { timeout: 20_000 });
    await expect(page).not.toHaveURL(/card=/);

    // Card di una bozza: motivo di esclusione con il rimando alla revisione.
    await page.getByRole('searchbox', { name: 'Cerca nelle card' }).fill('Bozza uno');
    await rowBody(page, 'Bozza uno').click({ timeout: 20_000 });
    const draftPanel = detail(page);
    await expect(draftPanel).toContainText(
      'Il mazzo «Bozza e2e» non è approvato · esclusa dal ripasso',
    );
    await expect(draftPanel.getByRole('link', { name: 'Rivedi e approva' })).toHaveAttribute(
      'href',
      `/materie/${s.slug}/artifacts/${s.draftId}`,
    );
  });

  test('deep link ?card=<id> apre il dettaglio', async ({ page }) => {
    test.setTimeout(90_000);
    await page.goto(tab('card'));
    await rowBody(page, 'Velocita uno').click({ timeout: 30_000 });
    const url = page.url();
    expect(url).toMatch(/card=/);
    await page.goto(url);
    await expect(detail(page).getByLabel('Domanda')).toHaveValue('Velocita uno', {
      timeout: 30_000,
    });
  });
});

test.describe('Dialog "Aggiungi flashcard"', () => {
  test('si apre dal bottone Aggiungi con le 4 modalità e riporta il focus alla chiusura', async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await page.goto(tab());
    const add = page.getByRole('button', { name: 'Aggiungi', exact: true });
    await add.click({ timeout: 30_000 });
    const dialog = page.getByRole('dialog', { name: 'Aggiungi flashcard' });
    await expect(dialog).toBeVisible();
    const modes = dialog.getByRole('group', { name: 'Come vuoi aggiungerle' });
    for (const m of ['Scrivi a mano', "Genera con l'AI", 'Importa', 'Nuovo mazzo vuoto']) {
      await expect(modes.getByRole('button', { name: m })).toBeVisible();
    }
    await expect(modes.getByRole('button', { name: 'Scrivi a mano' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(dialog.getByLabel('Domanda')).toBeFocused();

    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(add).toBeFocused();
  });

  test('Scrivi a mano crea la card, anche di seguito, e rispetta argomento e mazzo', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const dialog = await openAdd(page, tab());

    // Dopo, scrivine un'altra (default): resta aperto e svuota i campi.
    await expect(dialog.getByLabel("Dopo, scrivine un'altra")).toBeChecked();
    await dialog.getByLabel('Domanda').fill('Creata uno');
    await dialog.getByLabel('Risposta').fill('Risposta uno');
    await dialog.getByLabel('Argomento').selectOption({ label: 'Moto' });
    await dialog.getByLabel('Mazzo').selectOption({ label: 'Mazzo extra' });
    await dialog.getByRole('button', { name: 'Aggiungi card' }).click();
    await expect(dialog.getByRole('status').filter({ hasText: 'Card aggiunta.' })).toBeVisible({
      timeout: 20_000,
    });
    await expect(dialog.getByLabel('Domanda')).toHaveValue('');
    await expect(dialog.getByLabel('Domanda')).toBeFocused();
    expect(await cardState(s.extraDeckId, 'Creata uno')).toMatchObject({ back: 'Risposta uno' });
    expect(await cardTopic({ ...s, deckId: s.extraDeckId }, 'Creata uno')).toBe(s.topicIds.moto);

    // Senza "un'altra": chiude e annuncia.
    await dialog.getByLabel("Dopo, scrivine un'altra").uncheck();
    await dialog.getByLabel('Domanda').fill('Creata due');
    await dialog.getByLabel('Risposta').fill('Risposta due');
    await dialog.getByRole('button', { name: 'Aggiungi card' }).click();
    await expect(dialog).toHaveCount(0, { timeout: 20_000 });
    await expect(toast(page, 'Card aggiunta.')).toBeVisible();
    expect(await cardExists({ deckId: s.deckId }, 'Creata due')).toBe(true);

    // E la card compare nella vista Card.
    await viewLink(page, 'Card').click();
    await expect(cardRow(page, 'Creata due')).toBeVisible({ timeout: 20_000 });
  });

  test('Scrivi a mano chiede domanda e risposta', async ({ page }) => {
    test.setTimeout(90_000);
    const dialog = await openAdd(page, tab());
    await dialog.getByRole('button', { name: 'Aggiungi card' }).click();
    await expect(dialog.getByRole('alert')).toHaveText('Scrivi la domanda.');
    await dialog.getByLabel('Domanda').fill('Solo domanda');
    await dialog.getByRole('button', { name: 'Aggiungi card' }).click();
    await expect(dialog.getByRole('alert')).toHaveText('Scrivi la risposta.');
  });

  test('Genera con l’AI senza documenti pronti avvisa e non invia', async ({ page }) => {
    test.setTimeout(90_000);
    const dialog = await openAdd(page, tab());
    await dialog.getByRole('button', { name: "Genera con l'AI" }).click();
    await expect(dialog.getByRole('button', { name: "Genera con l'AI" })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(dialog.getByText('Nessun documento pronto.')).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Genera flashcard' })).toBeDisabled();
  });

  test('Importa un CSV crea le card; un formato non valido è rifiutato', async ({ page }) => {
    test.setTimeout(120_000);
    const dialog = await openAdd(page, tab());
    await dialog.getByRole('button', { name: 'Importa' }).click();
    const submit = dialog.locator('form').getByRole('button', { name: 'Importa' });
    await expect(submit).toBeDisabled();

    const input = dialog.locator('input[type="file"]');
    await input.setInputFiles({
      name: 'documento.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF'),
    });
    await expect(dialog.getByRole('alert')).toHaveText(
      'Formato non supportato: usa .apkg, .csv, .tsv o .txt.',
    );
    await expect(submit).toBeDisabled();

    await input.setInputFiles({
      name: 'carte.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from('front,back\nImportata uno,Risposta uno\nImportata due,Risposta due\n'),
    });
    await expect(dialog.getByText('carte.csv')).toBeVisible();
    await expect(submit).toBeEnabled();
    await submit.click();
    await expect(toast(page, '2 card importate in')).toBeVisible({ timeout: 30_000 });
    await expect(dialog).toHaveCount(0);

    await viewLink(page, 'Card').click();
    await page.getByRole('searchbox', { name: 'Cerca nelle card' }).fill('Importata');
    await expect(page.locator('li[data-card-id]')).toHaveCount(2, { timeout: 20_000 });
  });

  test('Nuovo mazzo vuoto crea il mazzo', async ({ page, request, baseURL }) => {
    test.setTimeout(90_000);
    const dialog = await openAdd(page, tab(undefined, '&group=mazzo'));
    await dialog.getByRole('button', { name: 'Nuovo mazzo vuoto' }).click();
    await dialog.getByRole('button', { name: 'Crea mazzo' }).click();
    await expect(dialog.getByRole('alert')).toHaveText('Scrivi un nome.');
    await dialog.getByLabel('Nome del mazzo').fill('Mazzo creato e2e');
    await dialog.getByRole('button', { name: 'Crea mazzo' }).click();
    await expect(toast(page, 'Mazzo «Mazzo creato e2e» creato.')).toBeVisible({ timeout: 20_000 });
    await expect(dialog).toHaveCount(0);
    const created = (await decksOf(request, baseURL, s.slug)).find(
      (d) => d.title === 'Mazzo creato e2e',
    );
    expect(created?.status).toBe('approved');
    // Compare tra gli attivi.
    await expect(page.getByRole('heading', { name: 'Attivi · 3' })).toBeVisible({
      timeout: 20_000,
    });
  });
});

test.describe('Statistiche', () => {
  test('mostra stati, escluse, previsione, ritenzione, padronanza e calibrazione', async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await page.goto(tab('statistiche'));
    await expect(viewLink(page, 'Statistiche')).toHaveAttribute('aria-current', 'page', {
      timeout: 30_000,
    });
    const tiles = page.getByRole('region', { name: 'Card per stato' });
    await expect(tiles).toBeVisible({ timeout: 30_000 });
    for (const label of ['Nuove', 'In apprendimento', 'In ripasso', 'Da rinforzare']) {
      await expect(tiles.getByText(label, { exact: true })).toBeVisible();
    }
    const excluded = tiles.getByRole('link', { name: /Escluse dal ripasso/ });
    await expect(excluded).toContainText('2');
    await expect(excluded).toHaveAttribute('href', /view=card/);
    await expect(excluded).toHaveAttribute('href', /escluse=1/);

    for (const h of [
      'Prossimi 30 giorni',
      'Quanto ricordi',
      'Padronanza per argomento',
      'Sai quello che credi di sapere?',
    ]) {
      await expect(page.getByRole('heading', { name: h })).toBeVisible();
    }
    await expect(
      page.getByRole('img', { name: /^Card in scadenza nei prossimi 30 giorni/ }),
    ).toBeVisible();
    await expect(
      page.getByText('Servono ripassi ripetuti sulle stesse card per calcolarla.'),
    ).toBeVisible();
    await expect(page.getByText('Ancora nessuna risposta con fiducia.')).toBeVisible();
    await expect(
      page.getByText(
        'In ripasso indica la tua sicurezza con i tasti 1, 2, 3 prima di girare la card.',
      ),
    ).toBeVisible();
    await expect(page.getByRole('link', { name: 'Ripassa Calore' })).toHaveAttribute(
      'href',
      `/ripasso?materia=${s.slug}&argomento=${s.topicIds.calore}`,
    );
    // Senza esame in programma non c'è il banner di rischio.
    await expect(page.getByText(/card a rischio per l'esame/)).toHaveCount(0);
    // Azione "Ripassa N" nella barra.
    await expect(page.getByRole('link', { name: /^Ripassa \d+ card$/ })).toHaveAttribute(
      'href',
      `/ripasso?materia=${s.slug}`,
    );

    // La tile "Escluse" porta alla vista Card filtrata.
    await excluded.click();
    await expect(page).toHaveURL(/view=card/);
    await expect(page.locator('li[data-card-id]')).toHaveCount(2, { timeout: 20_000 });
  });
});
