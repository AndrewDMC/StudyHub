import { test, expect } from '@playwright/test';

/** Desktop counterpart of responsive.mobile.spec.ts: the phone tab bar never shows at ≥ md. */
test('Su desktop c’è la sidebar e la tab bar mobile resta nascosta', async ({ page }) => {
  await page.goto('/materie');
  await expect(page.getByRole('complementary', { name: 'Navigazione principale' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Navigazione principale' })).toBeHidden();
});

test('Su desktop il Ripasso rapido non è in navigazione e rimanda ai ripassi per materia', async ({
  page,
}) => {
  await page.goto('/ripasso');
  await expect(page.getByText('Il ripasso rapido è pensato per il telefono.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Ripasso' })).toBeHidden();
  await expect(page.getByRole('button', { name: /Ripassa tutto/ })).toBeHidden();
});
