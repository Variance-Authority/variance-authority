import { test, expect } from './journey.mjs';

test('an order of 100.00 or more is ten percent off', async ({ page }) => {
  await page.goto('/cart.html?items=kettle,teapot,cups');
  await expect(page.locator('#subtotal')).toHaveText('105.00');
  await expect(page.locator('#discount')).toHaveText('10.50');
  await expect(page.locator('#total')).toHaveText('94.50');
});

test('a small order pays full price', async ({ page }) => {
  await page.goto('/cart.html?items=tin');
  await expect(page.locator('#discount')).toHaveText('0.00');
  await expect(page.locator('#total')).toHaveText('9.00');
});
