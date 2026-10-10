import { test as base, expect } from '@playwright/test';
import { createPlaywrightRenderer } from '@variance-authority/playwright/renderer';
import { varianceFixtures, type VarianceFixtures, type VarianceWorkerFixtures } from '@variance-authority/playwright-test';

const test = base.extend<VarianceFixtures, VarianceWorkerFixtures>(varianceFixtures);

test.use({ timezoneId: 'Asia/Tokyo', locale: 'de-DE' });

test('paints in the timezone and locale the page ran in', async ({ varianceRenderer }) => {
  const tokyo = await createPlaywrightRenderer({ timezoneId: 'Asia/Tokyo', locale: 'de-DE' });
  try {
    expect(varianceRenderer.identity).toEqual(tokyo.identity);
  } finally {
    await tokyo.close();
  }
});
