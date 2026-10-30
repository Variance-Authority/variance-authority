import { PAGE, test } from './shop-page.js';

// Every statement below ends in a comment naming it, which is how the test that
// records this file finds the line each one is on.

// A page served from a place, so leaving it loads a second document.
const SHOP = 'http://shop.test/';
const LEAVING = `${PAGE}
<button id="leave" onclick="shop.choose('jam'); location.href = '${SHOP}'">Leave</button>`;

test('pays after the page it chose on was replaced', async ({ page }) => {
  await page.route(SHOP, (route) => route.fulfill({ contentType: 'text/html', body: LEAVING })); // serves
  await page.goto(SHOP); // opens
  await page.click('#leave'); // leaves
  await page.click('#pay'); // pays
});
