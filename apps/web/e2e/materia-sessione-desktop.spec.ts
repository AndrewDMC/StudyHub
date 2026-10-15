import { test, expect } from '@playwright/test';
import {
  TASK_TITLE,
  deleteSubject,
  endSession,
  seedSession,
  sessionUrl,
} from './fixtures/sessione-seed';

/**
 * Slice 6 della materia mobile: a 1280px la sessione resta quella desktop (briefing, chat,
 * pomodoro e chiusura di sempre), nessuna vista mobile.
 */
test.use({ viewport: { width: 1280, height: 800 } });

test('Desktop: la sessione attiva mostra briefing e chat, senza tab né header mobile', async ({
  page,
  request,
  baseURL,
}) => {
  test.setTimeout(90_000);
  const seed = await seedSession(request, baseURL!);
  try {
    await page.goto(sessionUrl(seed));
    // Layout a tre colonne: documento/briefing al centro (tab), timer a lato, chat in basso.
    await expect(page.getByRole('region', { name: 'Timer Pomodoro' })).toBeVisible({
      timeout: 30_000,
    });
    await page.getByRole('tab', { name: 'Punti chiave ed esercizi' }).click();
    await expect(page.getByRole('tab', { name: 'Punti chiave 0/3' })).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByText('Punto chiave 1: primo principio').first()).toBeVisible();
    await page.getByRole('tab', { name: 'Esercizi (3)' }).click();
    await expect(page.getByText('Calcola il rendimento della macchina 1').first()).toBeVisible();
    await expect(page.getByLabel('Domanda al tutor')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Termina', exact: true })).toBeVisible();
    // Nessun chrome mobile.
    await expect(page.getByRole('tablist', { name: 'Contenuto della sessione' })).toHaveCount(0);
    // L'header globale desktop resta.
    await expect(page.locator('header').filter({ hasText: 'StudyHub' })).toBeVisible();
    expect(await page.getByText(TASK_TITLE).count()).toBeGreaterThan(0);
  } finally {
    await deleteSubject(request, baseURL!, seed.slug);
  }
});

test('Desktop: la chat invia un messaggio e riceve la risposta', async ({
  page,
  request,
  baseURL,
}) => {
  test.setTimeout(90_000);
  const seed = await seedSession(request, baseURL!);
  try {
    await page.goto(sessionUrl(seed));
    const input = page.getByLabel('Domanda al tutor');
    await expect(input).toBeVisible({ timeout: 30_000 });
    await input.fill('Spiegami il secondo principio');
    await input.press('Enter');
    await expect(page.getByText('Spiegami il secondo principio').first()).toBeVisible({
      timeout: 30_000,
    });
  } finally {
    await deleteSubject(request, baseURL!, seed.slug);
  }
});

test('Desktop: la sessione terminata mostra la chiusura di sempre ("Com’è andata")', async ({
  page,
  request,
  baseURL,
}) => {
  test.setTimeout(90_000);
  const seed = await seedSession(request, baseURL!, {
    exerciseStates: ['correct', 'wrong', 'open'],
  });
  try {
    await endSession(request, baseURL!, seed, 12 * 60_000);
    await page.goto(sessionUrl(seed));
    await expect(page.getByRole('heading', { name: /Com.è andata/ })).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByText(/Hai studiato 12 min/)).toBeVisible();
    await expect(page.getByText('Flashcard dai punti chiave')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Crea flashcard', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Sessione terminata' })).toHaveCount(0);
  } finally {
    await deleteSubject(request, baseURL!, seed.slug);
  }
});
