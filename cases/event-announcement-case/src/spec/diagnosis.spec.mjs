import { test as base } from '@playwright/test';
import { varianceFixtures } from '@variance-authority/playwright-test';

const test = base.extend(varianceFixtures);

// Both of these are written to fail. What is under test is what they print.

test('diagnosis of coordinates that drifted', async ({ page, events }) => {
  await page.goto('/?show=yes');
  await events.happened('checkout', 'upsell-modal', 'decidd', { timeoutMs: 2000 });
});

test('diagnosis of a run where nothing announced', async ({ events }) => {
  await events.happened('checkout', 'upsell-modal', 'decided', { timeoutMs: 500 });
});
