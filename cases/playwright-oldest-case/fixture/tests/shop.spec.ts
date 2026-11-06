import { variancePrecondition } from '@variance-authority/sense/precondition';
import { PAGE, test } from './shop-page.js';

// Every statement below ends in a comment naming it, which is how the test that
// records this file finds the line each one is on.

test.describe('at the till', () => {
  test.beforeEach(() => {
    variancePrecondition('fixture', { network: 'mocked' }); // arranges
  });

  test('pays for what it chose', async ({ page }) => {
    await page.setContent(PAGE); // opens
    await page.click('#choose'); // chooses
    await page.click('#pay'); // pays
  });
});
