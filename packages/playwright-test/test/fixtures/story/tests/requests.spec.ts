import { expect } from '@playwright/test';
import { holdApi, SAVING } from './answers-page.js';
import { test } from './shop-page.js';

// Every statement below ends in a comment naming it, which is how the test that
// records this file finds the line each one is on.

test('saves an order while its price is still out', async ({ page }) => {
  const api = await holdApi(page); // holds
  await page.setContent(SAVING); // opens
  await Promise.all([page.click('#save'), api.sent('/api/order'), api.sent('/api/price'), api.sent('/api/stock')]); // saves
  await api.answer('/api/order', 201); // answers the order
  expect(await page.title()).toBe(''); // checks
  await api.fail('/api/stock'); // loses the stock
  await api.answer('/api/price', 200); // answers the price
});
