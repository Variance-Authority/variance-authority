import { addsAfterEach, CHANGING } from './adding-page.js';
import { test } from './shop-page.js';

// Every statement below ends in a comment naming it, which is how the test that
// records this file finds the line each one is on.

addsAfterEach();

test('changes the page before a cleanup declared in another file', async ({ page }) => {
  await page.setContent(CHANGING); // opens
  await page.click('#add'); // adds
});
