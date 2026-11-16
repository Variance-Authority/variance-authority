import { CHANGING } from './adding-page.js';
import { test } from './shop-page.js';

// Every statement below ends in a comment naming it, which is how the test that
// records this file finds the line each one is on.

test.afterEach(async ({ page }) => {
  await page.click('#add'); // adds again
});

test('changes the page it chose on', async ({ page }) => {
  await page.setContent(CHANGING); // opens
  await page.click('#add'); // adds
  await page.locator('#added').waitFor(); // reads
});
