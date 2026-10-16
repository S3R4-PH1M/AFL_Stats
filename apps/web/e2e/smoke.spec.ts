import { expect, test } from '@playwright/test';

test('home page renders and links to the 2025 season', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle('AFL Stats');
  await expect(page.getByRole('heading', { level: 1, name: 'AFL Stats' })).toBeVisible();
  await page.getByRole('main').getByRole('link', { name: '2025 season' }).click();
  await expect(page).toHaveURL(/\/season\/2025$/);
  await expect(page.getByRole('heading', { level: 1, name: '2025 season' })).toBeVisible();
});

test('an unknown path shows the not-found page', async ({ page }) => {
  await page.goto('/no/such/page');
  await expect(page.getByRole('heading', { level: 1, name: 'Not found' })).toBeVisible();
});
