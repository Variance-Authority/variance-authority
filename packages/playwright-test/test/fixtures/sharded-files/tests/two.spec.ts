import { COLLECTOR, test } from '../src/collected.js';

for (const step of ['one', 'two', 'three']) {
  test(`two ${step}`, async ({ page }) => {
    await page.setContent(COLLECTOR);
  });
}
