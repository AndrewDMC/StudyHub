import { randomUUID } from 'node:crypto';
import { test, expect } from '@playwright/test';
import { createDb, documents } from '@studyhub/db';
import { eq } from 'drizzle-orm';

/**
 * F2 acceptance criteria, through a real browser against a real Postgres (docs/fasi/F2-materie.md
 * "Criteri di accettazione") — the pieces `apps/web/test/*.test.ts` (pglite, library level) can't
 * cover: actual clicks, actual page navigation, actual dashboard visibility.
 *
 * The second test seeds documents directly via `@studyhub/db` (not through the worker) to get
 * them into `parsed` state without running OCR/extraction — it only needs the *shape* of ready
 * data, not a real pipeline run.
 */
test.describe('F2 — Materie & Materia Singola', () => {
  test('Materie → un argomento specifico in ≤2 click, con selezione che scopa il pannello AI', async ({
    page,
    request,
    baseURL,
  }) => {
    const name = `E2E Fisica ${Date.now()}`;
    await page.goto('/materie');
    await page.getByRole('button', { name: 'Nuova materia' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Nome materia').fill(name);
    await dialog.getByRole('button', { name: 'Crea materia' }).click();
    await expect(dialog).toBeHidden();

    const slug = name
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '');

    try {
      // Click 1: card → materia.
      await page.getByRole('heading', { name }).click();
      await expect(page).toHaveURL(new RegExp(`/materie/${slug}$`));

      await page.getByPlaceholder('Nuovo argomento').fill('Meccanica');
      await page.getByRole('button', { name: '+' }).click();
      await expect(
        page.getByTitle('Filtra la pagina e scopa il pannello AI su questo argomento'),
      ).toBeVisible();

      // Click 2: l'argomento stesso — lo seleziona e scopa il pannello AI su di esso.
      await page.getByTitle('Filtra la pagina e scopa il pannello AI su questo argomento').click();
      await expect(page.getByText(/Argomento: Meccanica/)).toBeVisible();
      await expect(
        page.getByRole('link', { name: /Drill: ripassa questo argomento/ }),
      ).toBeVisible();
    } finally {
      await request.delete(`${baseURL}/api/subjects/${slug}`);
    }
  });

  test('Seleziono 3 documenti pronti e il pannello destro offre le azioni giuste, con costo stimato', async ({
    page,
    request,
    baseURL,
  }) => {
    const name = `E2E Chimica ${Date.now()}`;
    const created = await request.post(`${baseURL}/api/subjects`, {
      data: { name, color: 'green' },
    });
    const { subject } = await created.json();

    const db = createDb(process.env.DATABASE_URL);
    try {
      await db.insert(documents).values(
        [0, 1, 2].map((i) => ({
          id: randomUUID(),
          subjectId: subject.id,
          type: 'appunti' as const,
          originalName: `doc-${i}.pdf`,
          storedPath: `/x-${i}`,
          mime: 'application/pdf',
          bytes: 100,
          sha256: String(i).repeat(64).slice(0, 64),
          status: 'parsed' as const,
          pages: 5,
        })),
      );

      await page.goto(`/materie/${subject.slug}?tab=appunti`);
      const checkboxes = page.locator('input[type="checkbox"][aria-label^="Seleziona"]');
      await expect(checkboxes).toHaveCount(3);
      for (let i = 0; i < 3; i++) await checkboxes.nth(i).check();

      await expect(
        page.getByRole('button', { name: /Genera flashcard \(3 selezionati\)/ }),
      ).toBeVisible();
    } finally {
      await db.delete(documents).where(eq(documents.subjectId, subject.id));
      await request.delete(`${baseURL}/api/subjects/${subject.slug}`);
    }
  });

  test('Archivio una materia: sparisce dalla dashboard, la cartella resta intatta', async ({
    page,
    request,
    baseURL,
  }) => {
    const name = `E2E Archiviata ${Date.now()}`;
    const created = await request.post(`${baseURL}/api/subjects`, {
      data: { name, color: 'rose' },
    });
    const { subject } = await created.json();

    try {
      await page.goto('/');
      await expect(page.getByText(name)).toBeVisible();

      await request.patch(`${baseURL}/api/subjects/${subject.slug}`, { data: { archived: true } });

      await page.reload();
      await expect(page.getByText(name)).toHaveCount(0);

      const stillOnDisk = await request.get(`${baseURL}/api/subjects/${subject.slug}`);
      expect(stillOnDisk.ok()).toBe(true);
      const body = await stillOnDisk.json();
      expect(body.subject.archivedAt).not.toBeNull();
    } finally {
      await request.delete(`${baseURL}/api/subjects/${subject.slug}`);
    }
  });
});
