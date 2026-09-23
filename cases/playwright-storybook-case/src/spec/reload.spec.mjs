import { expect, test } from './fixtures.mjs';

test('a premium price, reloaded', async ({ page }) => {
  await page.goto('/iframe.html?id=case-price--premium&viewMode=story');
  await expect(page.getByTestId('price')).toHaveText('100');
  await page.reload();
  await expect(page.getByTestId('price')).toHaveText('100');
});
