import { randomUUID } from 'node:crypto';
import { test, expect } from '@playwright/test';
import { artifacts, createDb, flashcards } from '@studyhub/db';

/**
 * Slice 3 (flashcard mobile): su desktop (>= md) la tab Flashcard e la pagina di revisione del
 * mazzo restano quelle di prima.
 */
test.use({ viewport: { width: 1280, height: 800 } });

const db = createDb(process.env.DATABASE_URL);

test('Desktop: tab Flashcard e pagina artifacts invariate', async ({ page, request, baseURL }) => {
  test.setTimeout(90_000);
  const name = `E2E Flashcard Desktop ${Date.now()}`;
  const { subject } = await (
    await request.post(`${baseURL}/api/subjects`, { data: { name, color: 'blue' } })
  ).json();
  const draftId = randomUUID();
  await db.insert(artifacts).values({
    id: draftId,
    subjectId: subject.id as string,
    kind: 'flashcard_deck',
    title: 'Bozza desktop',
    path: `decks/${draftId}.json`,
    status: 'draft',
    model: 'fake',
    promptVersion: 'e2e',
  });
  await db.insert(flashcards).values({
    id: randomUUID(),
    deckId: draftId,
    type: 'basic' as const,
    front: 'Domanda desktop',
    back: 'Risposta desktop',
  });

  try {
    await page.goto(`/materie/${subject.slug}?tab=flashcard`);
    // Pannello desktop: filtri per mazzo/stato; nessuna vista mobile.
    await expect(page.getByLabel('Filtra per mazzo')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByLabel('Filtra per stato')).toBeVisible();
    await expect(page.getByRole('region', { name: 'Ripasso di oggi' })).toHaveCount(0);

    await page.goto(`/materie/${subject.slug}/artifacts/${draftId}`);
    await expect(page.getByRole('heading', { level: 1, name: 'Revisione flashcard' })).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByRole('link', { name: 'Esporta CSV' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Approva il mazzo' })).toBeEnabled({
      timeout: 20_000,
    });
    await expect(page.getByRole('link', { name: 'Chiudi la revisione' })).toHaveCount(0);
  } finally {
    await request.delete(`${baseURL}/api/subjects/${subject.slug}`);
  }
});
