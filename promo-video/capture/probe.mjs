import { chromium } from 'playwright';
const b = await chromium.launch({ channel: 'msedge' });
const p = await (await b.newContext({ viewport: { width: 1600, height: 900 } })).newPage();
for (const path of ['/materie', '/materie/analisi-matematica-ii']) {
  await p.goto('http://localhost:3000' + path, { waitUntil: 'networkidle' });
  await p.waitForTimeout(1200);
  const items = await p.$$eval('a,button', (els) => els.filter((e) => e.offsetParent).map((e) => `${e.tagName} ${(e.textContent || '').trim().slice(0, 40)} ${e.getAttribute('href') || ''}`));
  console.log(path, '\n' + items.join('\n'));
}
await b.close();
