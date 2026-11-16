import { PAGE, test } from './shop-page.js';

// Every statement below ends in a comment naming it, which is how the test that
// records this file finds the line each one is on.

const CHANGING = `${PAGE}
<button id="add" onclick="document.body.append(Object.assign(document.createElement('p'), { id: 'added', textContent: 'Added' }))">Add</button>`;

test.afterEach(async ({ page }) => {
  await page.click('#add'); // adds again
});

test('changes the page it chose on', async ({ page }) => {
  await page.setContent(CHANGING); // opens
  await page.click('#add'); // adds
  await page.locator('#added').waitFor(); // reads
});
