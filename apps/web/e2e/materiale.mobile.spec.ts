import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { resolveDocumentDerivedDir } from '@studyhub/core';
import { createDb, documents, schemaBlocks } from '@studyhub/db';

/**
 * Slice 2 della materia mobile (docs/design/materia-mobile): Materiale, Documento, Originale e
 * Verifica a 375×812. Gira solo nel progetto `mobile` (playwright.config.ts).
 *
 * I documenti sono inseriti direttamente con `@studyhub/db` (stato `parsed`, `failed`… senza
 * passare dal worker); `content.md` finisce nella cartella derived della materia e i file originali
 * in una cartella temporanea. Il server e il test devono condividere STUDYHUB_DATA_DIR.
 */

test.use({ viewport: { width: 375, height: 812 } });

const PDF_BYTES = Buffer.from(
  '%PDF-1.1\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n' +
    '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n',
);
const PNG_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

const MARKDOWN = [
  '# Termodinamica',
  '',
  'Il primo principio afferma che l’energia si conserva.',
  '',
  'Parola_molto_lunga_senza_spazi_' + 'x'.repeat(120),
  '',
  '```',
  'una riga di codice molto molto molto molto molto molto molto molto lunga che non deve far scorrere la pagina',
  '```',
].join('\n');

interface Seed {
  name: string;
  slug: string;
  notes: string; // appunti parsed con testo e argomento
  schema: string; // schemi parsed con blocchi da verificare
  exam: string; // esami parsed, senza testo
  failed: string;
  parsing: string;
  ids: Record<'notes' | 'schema' | 'exam' | 'failed' | 'parsing', string>;
}

const tmpFiles = mkdtempSync(join(tmpdir(), 'studyhub-e2e-'));
const db = createDb(process.env.DATABASE_URL);

async function seed(
  request: import('@playwright/test').APIRequestContext,
  baseURL: string,
): Promise<Seed> {
  const name = `E2E Materiale ${Date.now()}`;
  const { subject } = await (
    await request.post(`${baseURL}/api/subjects`, { data: { name, color: 'teal' } })
  ).json();
  const slug: string = subject.slug;
  const { topic } = await (
    await request.post(`${baseURL}/api/subjects/${slug}/topics`, { data: { name: 'Calore' } })
  ).json();

  const pdfPath = join(tmpFiles, `${slug}.pdf`);
  const pngPath = join(tmpFiles, `${slug}.png`);
  writeFileSync(pdfPath, PDF_BYTES);
  writeFileSync(pngPath, PNG_BYTES);

  const ids = {
    notes: randomUUID(),
    schema: randomUUID(),
    exam: randomUUID(),
    failed: randomUUID(),
    parsing: randomUUID(),
  };
  const now = Date.now();
  const base = (n: number) => ({
    subjectId: subject.id as string,
    storedPath: pdfPath,
    mime: 'application/pdf',
    bytes: PDF_BYTES.length,
    sha256: String(n).repeat(64).slice(0, 64),
    createdAt: new Date(now - n * 60_000),
  });

  await db.insert(documents).values([
    {
      ...base(1),
      id: ids.notes,
      type: 'appunti' as const,
      originalName: 'appunti-fisica.pdf',
      status: 'parsed' as const,
      pages: 18,
      mdPath: 'content.md',
    },
    {
      ...base(2),
      id: ids.schema,
      type: 'schemi' as const,
      originalName: 'schema-mano.png',
      storedPath: pngPath,
      mime: 'image/png',
      status: 'parsed' as const,
      verificationStatus: 'partial' as const,
      blockedBlocks: 2,
    },
    {
      ...base(3),
      id: ids.exam,
      type: 'esami' as const,
      originalName: 'esame-2023.pdf',
      status: 'parsed' as const,
      pages: 4,
    },
    {
      ...base(4),
      id: ids.failed,
      type: 'appunti' as const,
      originalName: 'rotto.pdf',
      status: 'failed' as const,
    },
    {
      ...base(5),
      id: ids.parsing,
      type: 'appunti' as const,
      originalName: 'in-corso.pdf',
      status: 'parsing' as const,
    },
  ]);

  await db.insert(schemaBlocks).values([
    {
      id: randomUUID(),
      documentId: ids.schema,
      ord: 1,
      text: 'F = m a',
      confidence: 'ok' as const,
      verified: true,
    },
    {
      id: randomUUID(),
      documentId: ids.schema,
      ord: 2,
      text: 'E = m c^2',
      confidence: 'uncertain' as const,
      verified: false,
    },
    {
      id: randomUUID(),
      documentId: ids.schema,
      ord: 3,
      text: '??',
      confidence: 'illegible' as const,
      verified: false,
    },
  ]);

  const derived = resolveDocumentDerivedDir(slug, ids.notes);
  mkdirSync(derived, { recursive: true });
  writeFileSync(join(derived, 'content.md'), MARKDOWN);

  // Collega gli appunti all'argomento (serve a "Studialo ora").
  const link = await request.put(`${baseURL}/api/subjects/${slug}/documents/${ids.notes}/topics`, {
    data: { topicIds: [topic.id] },
  });
  expect(link.ok()).toBe(true);

  return {
    name,
    slug,
    notes: 'appunti-fisica.pdf',
    schema: 'schema-mano.png',
    exam: 'esame-2023.pdf',
    failed: 'rotto.pdf',
    parsing: 'in-corso.pdf',
    ids,
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

const materialUrl = (s: Seed, filter?: string) => `/materie/${s.slug}?tab=${filter ?? 'materiale'}`;
const docUrl = (s: Seed, id: string, sub = '') => `/materie/${s.slug}/documenti/${id}${sub}`;
const filterGroup = (page: Page) => page.getByRole('group', { name: 'Filtra per tipo' });

test.describe('Materia mobile — Materiale e documenti', () => {
  let s: Seed;

  test.beforeEach(async ({ request, baseURL }) => {
    s = await seed(request, baseURL!);
  });

  test.afterEach(async ({ request, baseURL }) => {
    await request.delete(`${baseURL}/api/subjects/${s.slug}`);
  });

  test.afterAll(() => {
    rmSync(tmpFiles, { recursive: true, force: true });
  });

  test('Materiale: card Aggiungi, chip con aria-pressed, righe con pill di stato, nessuno scroll orizzontale', async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await page.goto(materialUrl(s));
    await expect(page.getByText('Aggiungi materiale')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole('button', { name: 'Scatta' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Scegli file' })).toBeVisible();

    // L'input di "Scatta" apre la fotocamera posteriore e accetta solo immagini.
    const camera = page.locator('input[type="file"][capture="environment"]');
    await expect(camera).toHaveAttribute('accept', 'image/*');

    // Chip: Tutti premuto, uno solo; con conteggi.
    const group = filterGroup(page);
    await expect(group.getByRole('button', { name: /^Tutti/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(group.locator('[aria-pressed="true"]')).toHaveCount(1);
    await expect(group.getByRole('button', { name: /^Tutti/ })).toContainText('5');
    await expect(group.getByRole('button', { name: /^Appunti/ })).toContainText('3');
    await expect(group.getByRole('button', { name: /^Schemi/ })).toContainText('1');

    // Righe con pill di stato (testo, non solo colore).
    await expect(page.getByRole('heading', { level: 2, name: '5 documenti' })).toBeVisible();
    await expect(page.getByRole('link', { name: `${s.notes}, Pronto` })).toBeVisible();
    await expect(page.getByRole('link', { name: `${s.schema}, Da verificare` })).toBeVisible();
    await expect(page.getByRole('link', { name: `${s.exam}, Pronto` })).toBeVisible();
    await expect(page.getByRole('link', { name: `${s.failed}, Errore` })).toBeVisible();
    await expect(page.getByRole('link', { name: `${s.parsing}, Estrazione…` })).toBeVisible();

    // Cambiare chip filtra la lista e sposta aria-pressed.
    await group.getByRole('button', { name: /^Schemi/ }).click();
    await expect(page).toHaveURL(/filtro=schemi|tab=schemi/);
    await expect(group.getByRole('button', { name: /^Schemi/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(group.locator('[aria-pressed="true"]')).toHaveCount(1);
    await expect(page.getByRole('heading', { level: 2, name: '1 documento' })).toBeVisible();

    await noHorizontalScroll(page);
  });

  test('Materiale: il tap su una riga porta alla route giusta per stato', async ({ page }) => {
    test.setTimeout(150_000);
    const cases: [string, RegExp][] = [
      [`${s.notes}, Pronto`, new RegExp(`/documenti/${s.ids.notes}$`)],
      [`${s.schema}, Da verificare`, new RegExp(`/documenti/${s.ids.schema}/verifica$`)],
      [`${s.exam}, Pronto`, new RegExp(`/documenti/${s.ids.exam}/originale$`)],
      [`${s.failed}, Errore`, new RegExp(`/documenti/${s.ids.failed}$`)],
      [`${s.parsing}, Estrazione…`, new RegExp(`/documenti/${s.ids.parsing}$`)],
    ];
    for (const [label, url] of cases) {
      await page.goto(materialUrl(s));
      await page.getByRole('link', { name: label }).click();
      await expect(page).toHaveURL(url, { timeout: 20_000 });
    }

    // Per failed/parsing: pannello di stato, nessun 404.
    await page.goto(docUrl(s, s.ids.failed));
    await expect(
      page.getByRole('alert').filter({ hasText: 'Estrazione non riuscita.' }),
    ).toBeVisible({
      timeout: 20_000,
    });
    await page.goto(docUrl(s, s.ids.parsing));
    await expect(page.getByRole('status').filter({ hasText: 'Estrazione in corso…' })).toBeVisible({
      timeout: 20_000,
    });
  });

  test('Materiale: "Seleziona" abilita le checkbox solo sui documenti pronti', async ({ page }) => {
    test.setTimeout(90_000);
    await page.goto(materialUrl(s));
    const seleziona = page.getByRole('button', { name: 'Seleziona', exact: true });
    await expect(seleziona).toHaveAttribute('aria-pressed', 'false', { timeout: 20_000 });
    await seleziona.click();
    await expect(seleziona).toHaveAttribute('aria-pressed', 'true');

    // 3 documenti parsed (appunti, schema, esame); failed/parsing sono aria-disabled.
    const boxes = page.locator('input[type="checkbox"][aria-label^="Seleziona "]');
    await expect(boxes).toHaveCount(3);
    await expect(page.locator('[aria-disabled="true"]')).toHaveCount(2);
    await expect(page.getByRole('link', { name: /Pronto$/ })).toHaveCount(0);

    await boxes.first().check();
    await expect(page.getByText('1 selezionati')).toBeVisible();
    await page.getByRole('button', { name: 'Deseleziona tutti' }).click();
    await expect(page.getByText('1 selezionati')).toHaveCount(0);
  });

  test('Documento: header, switch Testo|Originale, CTA e ritorno a ?tab=materiale', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await page.goto(docUrl(s, s.ids.notes));
    await expect(page.getByRole('heading', { level: 1, name: s.notes })).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByRole('heading', { level: 1, name: 'Termodinamica' })).toBeVisible();

    // Header globale nascosto, azioni presenti.
    await expect(page.locator('header').filter({ hasText: 'StudyHub' })).toBeHidden();
    await expect(page.getByRole('button', { name: 'Modifica il testo' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Altre azioni sul documento' })).toBeVisible();

    // Switch: "Testo" attivo.
    const switchNav = page.getByRole('navigation', { name: 'Vista del documento' });
    await expect(switchNav.getByRole('link', { name: 'Testo' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await expect(switchNav.getByRole('link', { name: 'Originale' })).not.toHaveAttribute(
      'aria-current',
      'page',
    );

    // CTA: "Studialo ora" abilitato (argomento collegato); "Genera flashcard" apre lo sheet.
    await expect(page.getByRole('button', { name: 'Studialo ora' })).toBeEnabled();
    await page.getByRole('button', { name: 'Genera flashcard', exact: true }).click();
    const sheet = page.getByRole('dialog', { name: 'Genera flashcard' });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByText(s.notes)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(sheet).toHaveCount(0);

    // Testo lungo/codice: nessuno scroll orizzontale della pagina.
    await noHorizontalScroll(page);

    // Switch → Originale.
    await switchNav.getByRole('link', { name: 'Originale' }).click();
    await expect(page).toHaveURL(new RegExp(`/documenti/${s.ids.notes}/originale$`), {
      timeout: 20_000,
    });

    // Indietro → Materiale, filtro del tipo (appunti).
    await page.getByRole('link', { name: 'Torna al materiale' }).click();
    await expect(page).toHaveURL(new RegExp(`/materie/${s.slug}\\?(.*&)?(tab|filtro)=`), {
      timeout: 20_000,
    });
    await expect(page.getByText('Aggiungi materiale')).toBeVisible();
    await expect(filterGroup(page).getByRole('button', { name: /^Appunti/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  test('Documento senza testo estratto: pannello di stato e nessuno scroll orizzontale', async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await page.goto(docUrl(s, s.ids.exam));
    await expect(page.getByText('Nessun testo estratto per questo documento.')).toBeVisible({
      timeout: 20_000,
    });
    await noHorizontalScroll(page);
  });

  test('Originale PDF: footer con zoom e pagine, tab bar nascosta, nessuno scroll orizzontale', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await page.goto(materialUrl(s));
    await expect(page.getByRole('navigation', { name: 'Navigazione principale' })).toBeVisible({
      timeout: 20_000,
    });

    await page.goto(docUrl(s, s.ids.notes, '/originale'));
    await expect(page.locator('iframe')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole('navigation', { name: 'Navigazione principale' })).toBeHidden();

    await expect(page.getByRole('link', { name: 'Scarica' })).toBeVisible();
    await expect(page.getByRole('link', { name: "Apri in un'altra app" })).toHaveAttribute(
      'href',
      `/api/subjects/${s.slug}/documents/${s.ids.notes}/file`,
    );

    // Pagine: 1 / 18, prev disabilitato, successiva avanza.
    await expect(page.getByText('1 / 18')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Pagina precedente' })).toBeDisabled();
    await page.getByRole('button', { name: 'Pagina successiva' }).click();
    await expect(page.getByText('2 / 18')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Pagina precedente' })).toBeEnabled();
    await expect(page.locator('iframe')).toHaveAttribute('src', /#page=2&zoom=100$/);

    // Zoom: 100% → 125%, "Riduci" disabilitato a 100%.
    await expect(page.getByRole('button', { name: 'Riduci' })).toBeDisabled();
    await page.getByRole('button', { name: 'Ingrandisci' }).click();
    await expect(page.getByText('125%')).toBeVisible();
    await expect(page.locator('iframe')).toHaveAttribute('src', /zoom=125$/);

    await noHorizontalScroll(page);

    // Uscendo, la tab bar torna visibile.
    await page.getByRole('link', { name: 'Torna al materiale' }).click();
    await expect(page.getByRole('navigation', { name: 'Navigazione principale' })).toBeVisible({
      timeout: 20_000,
    });
  });

  test('Originale immagine: zoom senza pagine; "Testo" non è un link senza testo estratto', async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await page.goto(docUrl(s, s.ids.schema, '/originale'));
    await expect(page.getByRole('img', { name: s.schema })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole('button', { name: 'Pagina successiva' })).toHaveCount(0);
    await expect(page.getByText('100%')).toBeVisible();
    await page.getByRole('button', { name: 'Ingrandisci' }).click();
    await expect(page.getByText('150%')).toBeVisible();

    const switchNav = page.getByRole('navigation', { name: 'Vista del documento' });
    await expect(switchNav.getByRole('link', { name: 'Testo' })).toHaveCount(0);
    await expect(switchNav.getByText('Testo')).toHaveAttribute('aria-disabled', 'true');
    await expect(switchNav.getByRole('link', { name: 'Originale' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  test('Verifica: progresso, stati per blocco, "Segna tutto verificato", pill in Materiale', async ({
    page,
  }) => {
    test.setTimeout(150_000);
    await page.goto(docUrl(s, s.ids.schema, '/verifica'));
    await expect(
      page.getByRole('heading', { level: 1, name: 'Verifica trascrizione' }),
    ).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.locator('header').filter({ hasText: 'StudyHub' })).toBeHidden();

    // Progresso iniziale: 1 blocco su 3 verificato.
    await expect(page.getByText('1 di 3 blocchi verificati')).toBeVisible({ timeout: 20_000 });
    const bar = page.getByRole('progressbar', { name: 'Blocchi verificati' });
    await expect(bar).toHaveAttribute('aria-valuenow', '33');
    await noHorizontalScroll(page);

    // Blocco 2 (incerto): "Incerto" premuto; "Verificato" lo conferma.
    const group2 = page.getByRole('group', { name: 'Stato del blocco 2' });
    await expect(group2.getByRole('button', { name: 'Incerto' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(group2.getByRole('button', { name: 'Verificato' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    await group2.getByRole('button', { name: 'Verificato' }).click();
    // Il primo PATCH in dev può compilare la route: timeout largo.
    await expect(group2.getByRole('button', { name: 'Verificato' })).toHaveAttribute(
      'aria-pressed',
      'true',
      {
        timeout: 30_000,
      },
    );
    await expect(page.getByText('2 di 3 blocchi verificati')).toBeVisible();

    // Blocco 3 (illeggibile) premuto di default.
    const group3 = page.getByRole('group', { name: 'Stato del blocco 3' });
    await expect(group3.getByRole('button', { name: 'Illeggibile' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    // Tornare a "Incerto" sul blocco 2 toglie la verifica.
    await group2.getByRole('button', { name: 'Incerto' }).click();
    await expect(group2.getByRole('button', { name: 'Incerto' })).toHaveAttribute(
      'aria-pressed',
      'true',
      {
        timeout: 20_000,
      },
    );
    await expect(group2.getByRole('button', { name: 'Verificato' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    await expect(page.getByText('1 di 3 blocchi verificati')).toBeVisible();

    // "Segna tutto verificato": c'è un illeggibile → conferma inline.
    await page.getByRole('button', { name: 'Segna tutto verificato' }).click();
    await expect(page.getByText(/illeggibil[ei] (sarà|saranno) segnat[oi]/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Annulla' })).toBeFocused();
    await page.getByRole('button', { name: 'Sì, segna tutto' }).click();

    await expect(page.getByText('3 di 3 blocchi verificati')).toBeVisible({ timeout: 20_000 });
    await expect(bar).toHaveAttribute('aria-valuenow', '100');
    await expect(page.getByRole('status').filter({ hasText: 'Tutto verificato' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Segna tutto verificato' })).toBeDisabled();

    // In Materiale il documento non è più "Da verificare".
    await page.goto(materialUrl(s));
    await expect(page.getByRole('link', { name: `${s.schema}, Pronto` })).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByText('Da verificare', { exact: true })).toHaveCount(0);
  });

  test('Sheet Assistente: la conferma "Sposta nel cestino" porta il primo focus su Annulla', async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await page.goto(materialUrl(s));
    await page.getByRole('button', { name: 'Azioni della materia' }).click({ timeout: 30_000 });
    const sheet = page.getByRole('dialog', { name: 'Assistente' });
    await sheet.getByRole('button', { name: 'Sposta nel cestino' }).click();
    const confirm = page.getByRole('dialog', { name: 'Sposta nel cestino' });
    await expect(confirm).toBeVisible();
    await expect(confirm.getByRole('button', { name: 'Annulla' })).toBeFocused();
    await confirm.getByRole('button', { name: 'Annulla' }).click();
    await expect(page.getByRole('dialog', { name: 'Assistente' })).toBeVisible();
  });

  test('Nessuno scroll orizzontale su Materiale, Documento, Originale e Verifica', async ({
    page,
  }) => {
    test.setTimeout(150_000);
    const screens: [string, () => Promise<unknown>][] = [
      [
        materialUrl(s),
        () => expect(page.getByText('Aggiungi materiale')).toBeVisible({ timeout: 20_000 }),
      ],
      [
        docUrl(s, s.ids.notes),
        () =>
          expect(page.getByRole('heading', { level: 1, name: 'Termodinamica' })).toBeVisible({
            timeout: 20_000,
          }),
      ],
      [
        docUrl(s, s.ids.notes, '/originale'),
        () => expect(page.locator('iframe')).toBeVisible({ timeout: 20_000 }),
      ],
      [
        docUrl(s, s.ids.schema, '/verifica'),
        () => expect(page.getByText(/blocchi verificati/)).toBeVisible({ timeout: 20_000 }),
      ],
    ];
    for (const [url, ready] of screens) {
      await page.goto(url);
      await ready();
      await noHorizontalScroll(page);
    }
  });
});
