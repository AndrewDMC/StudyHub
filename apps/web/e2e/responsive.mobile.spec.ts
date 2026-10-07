import { test, expect, type Page } from '@playwright/test';

/**
 * Phone-width smoke (docs/09-ripasso-mobile.md §A3): every page renders at 412 px (Pixel 7)
 * without pushing the layout sideways, and the tab bar replaces the sidebar. Runs only in the
 * `mobile` project (playwright.config.ts).
 */

/** Neither the document nor the shell's scrolling `<main>` may be wider than the screen. */
async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => {
    const main = document.querySelector('main');
    return {
      document: document.documentElement.scrollWidth - window.innerWidth,
      main: main ? main.scrollWidth - main.clientWidth : 0,
    };
  });
  expect(overflow).toEqual({ document: 0, main: 0 });
}

test.describe('Mobile — layout a larghezza telefono', () => {
  test('Nessuna pagina scorre in orizzontale', async ({ page, request, baseURL }) => {
    test.setTimeout(180_000); // a dozen routes, each compiled on first hit by `next dev`
    const name = `E2E Mobile ${Date.now()} con un nome di materia piuttosto lungo`;
    const created = await request.post(`${baseURL}/api/subjects`, {
      data: { name, color: 'blue' },
    });
    const { subject } = await created.json();
    await request.post(`${baseURL}/api/subjects/${subject.slug}/exams`, {
      data: {
        title: 'Scritto finale',
        kind: 'scritto',
        date: new Date(Date.now() + 14 * 86_400_000).toISOString(),
      },
    });

    const base = `/materie/${subject.slug}`;
    const routes = [
      '/',
      '/materie',
      '/calendario',
      '/admin',
      base,
      ...['appunti', 'esami', 'flashcard', 'simulazioni', 'lacune'].map((t) => `${base}?tab=${t}`),
      `${base}/piano`,
      `${base}/review`,
    ];

    try {
      for (const route of routes) {
        await test.step(route, async () => {
          await page.goto(route);
          // Pages fetch their data client-side: measure once it has rendered.
          await page.waitForLoadState('networkidle');
          await expect(page.getByText('Caricamento…')).toHaveCount(0);
          await expectNoHorizontalScroll(page);
        });
      }
    } finally {
      await request.delete(`${baseURL}/api/subjects/${subject.slug}`);
    }
  });

  test('La tab bar sostituisce la sidebar e segna la voce attiva', async ({ page }) => {
    await page.goto('/materie');
    const tabBar = page.getByRole('navigation', { name: 'Navigazione principale' });
    await expect(tabBar).toBeVisible();
    await expect(tabBar.getByRole('link', { name: 'Materie' })).toHaveAttribute(
      'aria-current',
      'page',
    );

    await tabBar.getByRole('link', { name: 'Calendario' }).click();
    // Generous: under `next dev` the first hit on a route compiles it.
    await expect(page).toHaveURL(/\/calendario$/, { timeout: 15_000 });
    await expect(tabBar.getByRole('link', { name: 'Calendario' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });
});
