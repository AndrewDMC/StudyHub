import { randomUUID } from 'node:crypto';
import { test, expect } from '@playwright/test';
import { artifacts, createDb, flashcards } from '@studyhub/db';

/**
 * Slice 3 (flashcard mobile): su desktop (>= md) la tab Flashcard è quella desktop (viste Panoramica /
 * Card / Statistiche, nessun FAB) e la pagina di revisione del mazzo resta quella di prima.
 */
test.use({ viewport: { width: 1280, height: 800 } });

const db = createDb(process.env.DATABASE_URL);

test('Desktop: tab Flashcard con le viste desktop e pagina artifacts invariata', async ({
  page,
  request,
  baseURL,
}) => {
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
    // Vista desktop: Panoramica con hero, bottone "Aggiungi" nella barra, nessun FAB mobile.
    const nav = page.getByRole('navigation', { name: 'Viste flashcard' });
    await expect(nav.getByRole('link', { name: 'Panoramica' })).toHaveAttribute(
      'aria-current',
      'page',
      { timeout: 30_000 },
    );
    await expect(page.getByRole('region', { name: 'Ripasso di oggi' })).toHaveCount(1);
    await expect(page.getByRole('button', { name: 'Aggiungi', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Aggiungi flashcard' })).toHaveCount(0);

    // Vista Card: filtri a pulsante (non più select) e riga della card in bozza.
    await nav.getByRole('link', { name: 'Card' }).click();
    await expect(page.getByRole('button', { name: /^Mazzo/ })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('button', { name: /^Stato/ })).toBeVisible();
    await expect(page.getByRole('combobox', { name: 'Filtra per mazzo' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^Domanda desktop/ })).toBeVisible();

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
