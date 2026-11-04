import { PAGE, test } from './shop-page.js';

// Every statement below ends in a comment naming it, which is how the test that
// records this file finds the line each one is on.

test('pays in a context it made', async ({ browser }) => {
  const context = await browser.newContext(); // makes
  const page = await context.newPage(); // opens a page
  await page.setContent(PAGE); // opens
  await page.click('#choose'); // chooses
  await page.click('#pay'); // pays
  await context.close(); // closes
});
