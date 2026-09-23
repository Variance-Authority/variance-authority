import { expect, test } from './fixtures.mjs';

test('a premium price, drained by the variance fixture', async ({ page, variance }) => {
  void variance;
  await page.goto('/iframe.html?id=case-price--premium&viewMode=story');
  await expect(page.getByTestId('price')).toHaveText('100');
});
