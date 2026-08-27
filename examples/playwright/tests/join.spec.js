import { expect, test } from '@playwright/test';
import { assertUnchanged, observe } from '@variance-authority/playwright-test';

test('the empty form', async ({ page }, testInfo) => {
  await page.goto('/');

  const observation = await observe(page, page.getByRole('main'), testInfo, {
    subjectId: 'join/empty',
  });

  assertUnchanged(observation);
});

test('the form after submitting nothing', async ({ page }, testInfo) => {
  await page.goto('/');

  // This is the whole reason to observe from a test. There is no URL that
  // serves this state — you have to press the button to get here.
  await page.getByRole('button', { name: 'Request an invite' }).click();
  await expect(page.getByRole('alert')).toBeVisible();

  const observation = await observe(page, page.getByRole('main'), testInfo, {
    subjectId: 'join/rejected',
  });

  assertUnchanged(observation);
});
