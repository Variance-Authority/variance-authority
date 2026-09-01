import { expect, test as base } from '@playwright/test';
import { varianceFixtures } from '@variance-authority/playwright-test';

const test = base.extend(varianceFixtures);

test('the euro branch is entered by this spec and no other', async ({ page, events }) => {
  await page.goto('/?locale=de');
  await events.happened('pricing', 'quote', 'euros');
  await expect(page.getByTestId('quote')).toHaveText('1200 EUR', { timeout: 0 });
});
