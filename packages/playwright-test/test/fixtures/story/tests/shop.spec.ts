import { expect } from '@playwright/test';
import { PAGE, test } from './shop-page.js';

// Every statement below ends in a comment naming it, which is how the test that
// records this file finds the line each one is on.

test('pays for what it chose', async ({ page }) => {
  await page.setContent(PAGE); // opens
  await page.evaluate(() => (globalThis as unknown as { shop: { open(): string } }).shop.open()); // looks
  await page.click('#choose'); // chooses
  await page.click('#pay'); // pays
  expect(await page.title()).toBe(''); // checks
});
