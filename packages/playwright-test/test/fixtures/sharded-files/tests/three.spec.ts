import { COLLECTOR, test } from '../src/collected.js';

// The slow file: once its time is recorded, it outweighs the other two together.
for (const step of ['one', 'two', 'three']) {
  test(`three ${step}`, async ({ page }) => {
    await page.setContent(COLLECTOR);
    await page.waitForTimeout(600);
  });
}
