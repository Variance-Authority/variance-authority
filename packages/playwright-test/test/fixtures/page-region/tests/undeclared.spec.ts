import { test as base, expect } from '@playwright/test';
import { createPlaywrightRenderer } from '@variance-authority/playwright/renderer';
import { varianceFixtures, type VarianceFixtures, type VarianceWorkerFixtures } from '@variance-authority/playwright-test';

const test = base.extend<VarianceFixtures, VarianceWorkerFixtures>(varianceFixtures);

test('opens the page in UTC and en-US when nothing declares a region', async ({ page, varianceRenderer }) => {
  expect(
    await page.evaluate('[Intl.DateTimeFormat().resolvedOptions().timeZone, navigator.language]'),
  ).toEqual(['UTC', 'en-US']);
  const pinned = await createPlaywrightRenderer({});
  try {
    expect(varianceRenderer.identity).toEqual(pinned.identity);
  } finally {
    await pinned.close();
  }
});
