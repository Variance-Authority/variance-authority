import { PAGE, test } from './shop-page.js';

// Every statement below ends in a comment naming it, which is how the test that
// records this file finds the line each one is on.

// A page that reloads itself a moment after it is told to, as a dev server's
// client does when its server restarts: no statement of the spec navigates.
const SHOP = 'http://reloading.test/';
const RELOADING = `${PAGE}
<button id="restart" onclick="console.log('server connection lost'); setTimeout(() => { console.log('reloading now'); location.reload(); }, 300)">Restart</button>`;

test('reads across a reload the page made itself', async ({ page }) => {
  await page.route(SHOP, (route) => route.fulfill({ contentType: 'text/html', body: RELOADING })); // serves
  await page.goto(SHOP); // opens
  await page.click('#choose'); // chooses
  await page.click('#restart'); // restarts
  const read = await page.evaluate(() => new Promise((done) => setTimeout(() => done('read'), 1000))).catch((error: unknown) => `lost: ${String(error).split('\n')[0]}`); // reads
  console.log(read); // says
  await page.click('#pay'); // pays
});
