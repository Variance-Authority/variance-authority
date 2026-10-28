import { test as base, expect } from '@playwright/test';
import { varianceFixtures, type VarianceFixtures, type VarianceWorkerFixtures } from '@variance-authority/playwright-test';

const test = base.extend<VarianceFixtures, VarianceWorkerFixtures>(varianceFixtures);

test('opens the page in the region the project declares', async ({ page }) => {
  expect(
    await page.evaluate('[Intl.DateTimeFormat().resolvedOptions().timeZone, navigator.language]'),
  ).toEqual(['Asia/Tokyo', 'de-DE']);
});
