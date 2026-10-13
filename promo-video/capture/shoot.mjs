import { chromium } from 'playwright';

const BASE = 'http://localhost:3000';
const SLUG = 'analisi-matematica-ii';
const pages = [
  ['dashboard', '/'],
  ['materie', '/materie'],
  ['materia', `/materie/${SLUG}`],
  ['review', `/materie/${SLUG}/review`],
  ['piano', `/materie/${SLUG}/piano`],
  ['calendario', '/calendario'],
];

const browser = await chromium.launch({ channel: 'msedge' });
const hideE2E = () =>
  document.querySelectorAll('a,li,tr,div[role],article').forEach((el) => {
    if (/E2E/.test(el.textContent ?? '') && el.children.length < 12) el.style.display = 'none';
  });

async function run(name, ctxOpts, suffix) {
  const ctx = await browser.newContext({ ...ctxOpts, colorScheme: 'dark', locale: 'it-IT' });
  const page = await ctx.newPage();
  for (const [key, path] of pages) {
    await page.goto(BASE + path, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1500);
    await page.evaluate(hideE2E);
    await page.evaluate(() => document.querySelectorAll('nextjs-portal').forEach((e) => e.remove()));
    await page.screenshot({ path: `public/shots/${key}${suffix}.png` });
    console.log('ok', key + suffix);
  }
  await ctx.close();
}

await run('desktop', { viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 }, '');
await run('mobile', { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }, '-m');
await browser.close();
