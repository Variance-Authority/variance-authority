import { expect } from '@playwright/test';
import { PAGE, test } from './shop-page.js';

test.describe.configure({ retries: 1 });

// Fails its first attempt, before it pays, and passes its second: the case a retry hides.
test('pays on its second attempt', async ({ page }, info) => {
  await page.setContent(PAGE);
  await page.click('#choose');
  if (info.retry > 0) await page.click('#pay');
  expect(info.retry).toBe(1);
});
