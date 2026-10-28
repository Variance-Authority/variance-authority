import { COLLECTOR, test } from '../src/collected.js';

for (const step of ['one', 'two', 'three']) {
  test(`one ${step}`, async ({ page }) => {
    await page.setContent(COLLECTOR);
  });
}
