import { test, expect } from './journey.mjs';

test('search matches product names regardless of case', async ({ page }) => {
  await page.goto('/search.html?q=TEA');
  await expect(page.locator('#results[data-ready]')).toBeAttached();
  await expect(page.getByRole('listitem')).toHaveText(['Stoneware teapot', 'Tea cups, set of four']);
});

test('an empty search lists nothing', async ({ page }) => {
  await page.goto('/search.html');
  await expect(page.locator('#results[data-ready]')).toBeAttached();
  await expect(page.getByRole('listitem')).toHaveCount(0);
});
