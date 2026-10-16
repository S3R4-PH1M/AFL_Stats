import { expect, test } from '@playwright/test';

// Assertions hold for the fixture build (CI) and for the full 2025 season (step 10).

test('season page shows the ladder, a round selector and the results', async ({ page }) => {
  await page.goto('/season/2025');
  await expect(page.getByRole('heading', { level: 1, name: '2025 season' })).toBeVisible();

  const ladder = page.getByRole('table', { name: /^Ladder after / });
  await expect(ladder).toBeVisible();
  await expect(ladder.getByRole('columnheader')).toHaveText([
    '#',
    'Team',
    'P',
    'W',
    'L',
    'D',
    'PF',
    'PA',
    '%',
    'Pts',
  ]);
  await expect(ladder.getByRole('row', { name: /Richmond/ })).toBeVisible();

  const results = page.getByRole('region', { name: 'Results' });
  await expect(results.getByRole('heading', { level: 3, name: 'Grand Final' })).toBeVisible();
});

test('choosing a round updates the URL and the ladder', async ({ page }) => {
  await page.goto('/season/2025');
  const select = page.getByRole('combobox', { name: 'Ladder after' });
  // Round 2 (Squiggle numbering) is in the fixtures and in the full season.
  await select.selectOption({ label: 'Round 2' });
  await expect(page).toHaveURL(/\/season\/2025\?round=2$/);
  // Adelaide won Round 2 in both datasets; its totals differ (fixtures hold one game), and
  // "Port Adelaide" also matches /Adelaide/, so match the row header exactly.
  const ladder = page.getByRole('table', { name: 'Ladder after Round 2' });
  const adelaide = ladder.getByRole('row').filter({
    has: page.getByRole('rowheader', { name: 'Adelaide', exact: true }),
  });
  await expect(adelaide.getByRole('cell').nth(2)).toHaveText(/^[1-9]\d*$/); // W ≥ 1

  // The round survives a reload: it lives in the URL.
  await page.reload();
  await expect(page.getByRole('table', { name: 'Ladder after Round 2' })).toBeVisible();
});

test('a result links to its match', async ({ page }) => {
  await page.goto('/season/2025');
  await page.getByRole('link', { name: 'Richmond v West Coast' }).first().click();
  await expect(page).toHaveURL(/\/match\/2025\/141820250511$/);
  await expect(
    page.getByRole('heading', { level: 1, name: 'Richmond v West Coast' }),
  ).toBeVisible();
});
