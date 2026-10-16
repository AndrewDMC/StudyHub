import { test, expect } from '@playwright/test';
import {
  CALORE_TITLE,
  deleteSubject,
  lezioniSessionUrl,
  seedLezioni,
  taskLinks,
} from './fixtures/flashcard-lezioni-seed';

/** Smoke desktop della Slice 2 "flashcard attaccate alle lezioni" (piano e sessione, >= md). */
test.use({ viewport: { width: 1280, height: 800 } });

test('Piano: badge "N card", dialog con attacca/stacca', async ({ page, request, baseURL }) => {
  test.setTimeout(120_000);
  const s = await seedLezioni(request, baseURL!);
  try {
    await page.goto(`/materie/${s.slug}/piano`);
    const badge = page.getByTestId('task-card-badge');
    await expect(badge).toHaveText('2 card', { timeout: 30_000 });
    await expect(badge).toHaveCount(1);

    await badge.click();
    const dialog = page.getByRole('dialog', { name: CALORE_TITLE });
    await expect(dialog).toBeVisible();
    const rows = dialog.getByTestId('task-flashcard-row');
    await expect(rows).toHaveCount(2, { timeout: 20_000 });
    await expect(dialog.getByText('manuale')).toHaveCount(1);

    // Stacca
    await dialog.getByRole('button', { name: /^Stacca: Entropia uno/ }).click();
    await expect(rows).toHaveCount(1, { timeout: 20_000 });
    expect(await taskLinks(s, s.taskIds.calore)).toEqual(['Entropia due:user']);

    // Attacca dal picker (filtro preselezionato su Calore)
    await dialog.getByRole('button', { name: 'Attacca card…' }).click();
    const picker = dialog.getByTestId('attach-picker');
    await expect(picker.getByRole('combobox', { name: 'Filtra per argomento' })).toHaveValue(
      s.topicIds.calore,
    );
    const uno = picker.getByRole('checkbox', { name: /Entropia uno/ });
    await expect(uno).toBeEnabled({ timeout: 20_000 });
    await uno.check();
    await picker.getByRole('button', { name: 'Attacca (1)' }).click();
    await expect(rows).toHaveCount(2, { timeout: 20_000 });
    expect(await taskLinks(s, s.taskIds.calore)).toEqual([
      'Entropia due:user',
      'Entropia uno:user',
    ]);

    // Esc chiude e il badge e' aggiornato.
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(badge).toHaveText('2 card');
  } finally {
    await deleteSubject(request, baseURL!, s.slug);
  }
});

test('Sessione: blocco "Flashcard della lezione (2)" con link Ripassa', async ({
  page,
  request,
  baseURL,
}) => {
  test.setTimeout(120_000);
  const s = await seedLezioni(request, baseURL!);
  try {
    await page.goto(lezioniSessionUrl(s));
    const block = page.getByTestId('session-lesson-cards');
    await expect(block.getByRole('heading', { name: 'Flashcard della lezione (2)' })).toBeVisible({
      timeout: 30_000,
    });
    await expect(
      block.getByRole('link', { name: 'Ripassa le flashcard della lezione' }),
    ).toHaveAttribute('href', `/ripasso?materia=${s.slug}&task=${s.taskIds.calore}`);
  } finally {
    await deleteSubject(request, baseURL!, s.slug);
  }
});
