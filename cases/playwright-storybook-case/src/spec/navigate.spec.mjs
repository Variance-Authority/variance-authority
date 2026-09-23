import { expect, test } from './fixtures.mjs';

test('a plain price, then a payment, in one tab', async ({ page }) => {
  await page.goto('/iframe.html?id=case-price--plain&viewMode=story');
  await expect(page.getByTestId('price')).toHaveText('5');
  await page.goto('/iframe.html?id=case-price--pay&viewMode=story');
  await page.getByRole('button').click();
  await expect(page.getByTestId('receipt')).toHaveText('Paid 490');
});
