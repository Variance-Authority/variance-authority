import { expect, test as base } from '@playwright/test';
import { varianceFixtures } from '@variance-authority/playwright-test';

const test = base.extend(varianceFixtures);

test('the dollar branch is entered by this spec and no other', async ({ page, events }) => {
  await page.goto('/?locale=en');
  await events.happened('pricing', 'quote', 'dollars');
  await expect(page.getByTestId('quote')).toHaveText('1200 USD', { timeout: 0 });
});
