import { expect, test } from './fixtures.mjs';

test('a premium price in a second tab', async ({ page, context }) => {
  await page.goto('/iframe.html?id=case-price--plain&viewMode=story');
  const second = await context.newPage();
  await second.goto('/iframe.html?id=case-price--premium&viewMode=story');
  await expect(second.getByTestId('price')).toHaveText('100');
});
