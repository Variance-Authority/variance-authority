import { FRAMED, reported } from './frames-page.js';
import { test } from './shop-page.js';

// Every statement below ends in a comment naming it, which is how the test that
// records this file finds the line each one is on.

test('paints, holds a frame and moves its layout', async ({ page }) => {
  await page.setContent(FRAMED); await reported(page, 'largest-contentful-paint'); // opens
  await page.click('#hold'); await reported(page, 'long-animation-frame'); // holds
  await page.click('#push'); await reported(page, 'layout-shift'); // pushes
});
