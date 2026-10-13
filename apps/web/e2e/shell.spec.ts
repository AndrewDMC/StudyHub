import { test, expect } from '@playwright/test';

/** Desktop counterpart of responsive.mobile.spec.ts: the phone tab bar never shows at ≥ md. */
test('Su desktop c’è la sidebar e la tab bar mobile resta nascosta', async ({ page }) => {
  await page.goto('/materie');
  await expect(page.getByRole('complementary', { name: 'Navigazione principale' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Navigazione principale' })).toBeHidden();
});
