import { expect, test } from './fixtures.mjs';

test('a payment through the manager', async ({ page }) => {
  await page.goto('/?path=/story/case-price--pay');
  const preview = page.frameLocator('#storybook-preview-iframe');
  await preview.getByRole('button').click();
  await expect(preview.getByTestId('receipt')).toHaveText('Paid 490');
});
