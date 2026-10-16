import { expect, test } from '@playwright/test';

const MATCH = '/match/2025/141820250511'; // R9 2025, Richmond 11.15 (81) v West Coast 11.13 (79)

test('a match deep link loads, and survives a reload', async ({ page }) => {
  await page.goto(MATCH);
  await expect(
    page.getByRole('heading', { level: 1, name: 'Richmond v West Coast' }),
  ).toBeVisible();
  await expect(page.getByText('Richmond won by 2 points')).toBeVisible();

  const quarters = page.getByRole('table', { name: 'Scores by quarter' });
  await expect(quarters.getByRole('row', { name: /Richmond/ })).toContainText('11.15 (81)');
  await expect(quarters.getByRole('row', { name: /West Coast/ })).toContainText('11.13 (79)');

  for (const team of ['Richmond', 'West Coast']) {
    const box = page.getByRole('table', { name: `${team} box score` });
    await expect(box.locator('tbody tr')).toHaveCount(23);
    await expect(box.locator('tfoot').getByRole('row', { name: /Totals/ })).toBeVisible();
  }

  await page.reload();
  await expect(
    page.getByRole('heading', { level: 1, name: 'Richmond v West Coast' }),
  ).toBeVisible();
});

test('the match page links back to its round of the season', async ({ page }) => {
  await page.goto(MATCH);
  await page.getByRole('main').getByRole('link', { name: '2025 season' }).click();
  await expect(page).toHaveURL(/\/season\/2025\?round=9$/);
  await expect(page.getByRole('table', { name: 'Ladder after Round 9' })).toBeVisible();
});

test('an unknown match shows the not-found page', async ({ page }) => {
  await page.goto('/match/2025/999999999999');
  await expect(page.getByRole('heading', { level: 1, name: 'Not found' })).toBeVisible();
});
