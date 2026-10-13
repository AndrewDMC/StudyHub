// Registra flussi di interazione reali (solo click di navigazione e letture, nessuna scrittura sul DB):
// per ogni stato salva uno screenshot e il punto in cui il cursore cliccherà per passare allo stato dopo.
import { chromium } from 'playwright';
import fs from 'node:fs';

const BASE = 'http://localhost:3000';
const OUT = 'public/flows';
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ channel: 'msedge' });
const manifest = {};

const cleanup = () => {
  document.querySelectorAll('nextjs-portal').forEach((e) => e.remove());
  document.querySelectorAll('a,li,tr,article').forEach((el) => {
    if (/E2E/.test(el.textContent ?? '') && el.children.length < 12) el.style.display = 'none';
  });
  document.querySelectorAll('div').forEach((el) => {
    if (/Tempo insufficiente/.test(el.textContent ?? '') && el.children.length < 4 && el.textContent.length < 120) el.style.display = 'none';
  });
};

async function shot(page, flow, name, target, extra = {}) {
  await page.waitForTimeout(900);
  await page.evaluate(cleanup);
  const img = `${flow}-${name}.png`;
  let el = null;
  if (target) {
    // il bersaglio deve essere visibile nello screenshot, altrimenti il cursore cliccherebbe fuori schermo
    el = target(page).first();
    await el.waitFor({ state: 'visible', timeout: 8000 });
    await el.scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
  }
  await page.screenshot({ path: `${OUT}/${img}` });
  const box = el ? await el.boundingBox() : null;
  manifest[flow].push({ img, ...(box ? { x: box.x + box.width / 2, y: box.y + box.height / 2, w: box.width, h: box.height } : {}), ...extra });
}

async function newPage(mobile) {
  const ctx = await browser.newContext(
    mobile
      ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: 'dark', locale: 'it-IT' }
      : { viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2, colorScheme: 'dark', locale: 'it-IT' },
  );
  return ctx.newPage();
}

// 1) Navigazione: dashboard -> materie -> materia -> ripasso -> risposta
{
  const f = 'nav';
  manifest[f] = [];
  const p = await newPage(false);
  await p.goto(BASE + '/', { waitUntil: 'networkidle' });
  await shot(p, f, 'dash', (pg) => pg.getByRole('link', { name: /^Materie/ }));
  await p.getByRole('link', { name: /^Materie/ }).first().click();
  await p.waitForURL('**/materie');
  await shot(p, f, 'list', (pg) => pg.getByRole('link', { name: /Analisi Matematica II/ }));
  await p.getByRole('link', { name: /Analisi Matematica II/ }).first().click();
  await p.waitForURL('**/materie/analisi-matematica-ii');
  await shot(p, f, 'subject', (pg) => pg.getByRole('link', { name: /Ripassa/ }));
  await p.getByRole('link', { name: /Ripassa/ }).first().click();
  await p.waitForURL('**/review');
  await shot(p, f, 'question', (pg) => pg.getByRole('button', { name: /Mostra risposta/ }));
  await p.getByRole('button', { name: /Mostra risposta/ }).first().click();
  await shot(p, f, 'answer', null);
  await p.context().close();
}

// 2) Ricerca con la command palette
{
  const f = 'search';
  manifest[f] = [];
  const p = await newPage(false);
  await p.goto(BASE + '/', { waitUntil: 'networkidle' });
  await shot(p, f, 'closed', (pg) => pg.locator('button', { hasText: /Cerca/ }));
  await p.locator('button', { hasText: /Cerca/ }).first().click();
  await shot(p, f, 'open', null);
  let typed = '';
  for (const part of ['fi', 'si', 'ca']) {
    await p.keyboard.type(part, { delay: 40 });
    typed += part;
    await shot(p, f, `t-${typed}`, null, { hold: typed === 'fisica' ? 40 : 7 });
  }
  await p.waitForTimeout(1500);
  await shot(p, f, 'results', null, { hold: 70 });
  await p.context().close();
}

// 3) Piano: pagina intera per l'effetto scroll
{
  const f = 'piano';
  manifest[f] = [];
  const p = await newPage(false);
  await p.setViewportSize({ width: 1600, height: 2400 });
  await p.goto(BASE + '/materie/analisi-matematica-ii/piano', { waitUntil: 'networkidle' });
  await p.waitForTimeout(1200);
  await p.evaluate(cleanup);
  await p.screenshot({ path: `${OUT}/piano-full.png` });
  manifest[f].push({ img: 'piano-full.png', full: true });
  await p.context().close();
}

// 4) Mobile: dashboard -> materie -> materia
{
  const f = 'mobile';
  manifest[f] = [];
  const p = await newPage(true);
  await p.goto(BASE + '/', { waitUntil: 'networkidle' });
  await shot(p, f, 'dash', (pg) => pg.getByRole('link', { name: /Materie/ }).last());
  await p.getByRole('link', { name: /Materie/ }).last().click();
  await p.waitForURL('**/materie');
  await shot(p, f, 'list', (pg) => pg.getByRole('link', { name: /Analisi Matematica II/ }));
  await p.getByRole('link', { name: /Analisi Matematica II/ }).first().click();
  await p.waitForURL('**/materie/analisi-matematica-ii');
  await shot(p, f, 'subject', null);
  await p.context().close();
}

// 5) Reel: flusso mobile completo fino al ripasso
{
  const f = 'mnav';
  manifest[f] = [];
  const p = await newPage(true);
  await p.goto(BASE + '/', { waitUntil: 'networkidle' });
  await shot(p, f, 'dash', (pg) => pg.getByRole('link', { name: /Materie/ }).last());
  await p.getByRole('link', { name: /Materie/ }).last().click();
  await p.waitForURL('**/materie');
  await shot(p, f, 'list', (pg) => pg.getByRole('link', { name: /Analisi Matematica II/ }));
  await p.getByRole('link', { name: /Analisi Matematica II/ }).first().click();
  await p.waitForURL('**/materie/analisi-matematica-ii');
  await shot(p, f, 'subject', (pg) => pg.getByRole('link', { name: /Ripassa/ }));
  await p.getByRole('link', { name: /Ripassa/ }).first().click();
  await p.waitForURL('**/review');
  await shot(p, f, 'question', (pg) => pg.getByRole('button', { name: /Mostra risposta/ }));
  await p.getByRole('button', { name: /Mostra risposta/ }).first().click();
  await shot(p, f, 'answer', null);
  await p.context().close();
}

// 6) Reel: piano su telefono, viewport alto per lo scroll
{
  const f = 'mpiano';
  manifest[f] = [];
  const p = await newPage(true);
  await p.setViewportSize({ width: 390, height: 2600 });
  await p.goto(BASE + '/materie/analisi-matematica-ii/piano', { waitUntil: 'networkidle' });
  await p.waitForTimeout(1200);
  await p.evaluate(cleanup);
  await p.screenshot({ path: `${OUT}/mpiano-full.png` });
  manifest[f].push({ img: 'mpiano-full.png', full: true });
  await p.context().close();
}

await browser.close();
fs.writeFileSync(`${OUT}/manifest.json`, JSON.stringify(manifest, null, 2));
console.log(Object.fromEntries(Object.entries(manifest).map(([k, v]) => [k, v.length])));
