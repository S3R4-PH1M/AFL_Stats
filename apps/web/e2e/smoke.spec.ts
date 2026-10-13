import { expect, test } from '@playwright/test';

test('home page renders', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle('AFL Stats');
  await expect(page.getByRole('heading', { level: 1, name: 'AFL Stats' })).toBeVisible();
});
