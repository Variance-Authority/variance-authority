import { expect, test } from './fixtures.mjs';

test.afterEach(async ({ page }) => {
  await page.getByRole('button').click();
  await expect(page.getByTestId('receipt')).toHaveText('Paid 490');
});

test('a payment, settled after the test', async ({ page }) => {
  await page.goto('/iframe.html?id=case-price--pay&viewMode=story');
  await expect(page.getByRole('button')).toHaveText('Pay 500');
});
