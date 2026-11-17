// The same shop driven the usual way, with `timeout: 0` so each assertion asks
// the screen once. Each test below passes, and that is the finding: it passes
// on a state the broker would never let a test stand in.
// Each case navigates on purpose: the broker senses where a walk arrives across
// page loads, so a page switched in place would not exercise it.
import { expect, test } from '@playwright/test';

test('an empty form "has no errors" when asked before the answer', async ({ page }) => {
  await page.goto('/checkout?user=member');
  await page.getByRole('form', { name: 'Billing details' }).and(page.locator('[aria-busy="false"]')).waitFor();
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('alert')).toHaveCount(0, { timeout: 0 });
});

test('a like "did nothing" when the count is read before it lands', async ({ page }) => {
  await page.goto('/product');
  const count = page.getByTestId('likes');
  await expect(count).not.toHaveText('…');
  const before = await count.innerText();
  await page.getByRole('button', { name: 'Like' }).click();
  expect(await count.innerText()).toBe(before);
});

test('a click before hydration submits nothing the app hears', async ({ page }) => {
  let posted = false;
  page.on('request', (request) => {
    if (request.url().endsWith('/api/billing')) posted = true;
  });
  await page.goto('/checkout?user=member', { waitUntil: 'commit' });
  await page.getByLabel('Street').fill('Damrak 1');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.waitForLoadState('load');
  expect(posted).toBe(false);
});

test('a paid order still "shows the billing form" while it fades out', async ({ page }) => {
  await page.goto('/checkout?user=member');
  const form = page.getByRole('form', { name: 'Billing details' });
  await form.and(page.locator('[aria-busy="false"]')).waitFor();
  await page.getByLabel('Country').selectOption('NL');
  await page.getByLabel('Street').fill('Damrak 1');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.waitForResponse('**/api/billing');
  await expect(form).toBeVisible({ timeout: 0 });
  await expect(page.getByRole('form', { name: 'Payment' })).toBeVisible();
});
