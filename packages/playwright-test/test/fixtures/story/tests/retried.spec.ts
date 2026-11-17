import { expect } from '@playwright/test';
import { holdApi, SAVING } from './answers-page.js';
import { test } from './shop-page.js';

test.describe.configure({ retries: 1 });

// Fails its first attempt, before it pays, and passes its second: the case a
// retry hides. Each attempt hears the two answers it waits on in the other order.
test('pays on its second attempt', async ({ page }, info) => {
  const api = await holdApi(page);
  await page.setContent(SAVING);
  await page.click('#choose');
  await Promise.all([page.click('#save'), api.sent('/api/order'), api.sent('/api/price')]);
  for (const path of info.retry > 0 ? ['/api/order', '/api/price'] : ['/api/price', '/api/order']) await api.answer(path, 200);
  if (info.retry > 0) await page.click('#pay');
  expect(info.retry).toBe(1);
});
