// The shop saying nothing, reached through `@variance-authority/page-broker`:
// its outcomes are told from the page and its requests alone.
import { expect, test, type Page } from '@playwright/test';
import { action, region, stay } from '@variance-authority/page-broker';
import { surface } from '@variance-authority/page-broker/playwright';

const billing = region('billing', { role: 'form', name: 'Billing details' });
const payment = region('payment', { role: 'form', name: 'Payment' });
const signInDialog = region('signIn', { role: 'dialog', name: 'Sign in' });
const product = region('product', { role: 'article', name: 'Product' });

const submit = action('submit', { from: billing, to: { payment, signIn: signInDialog, invalid: stay } }, (on) =>
  on.click({ role: 'button', name: 'Continue' }),
);

const signIn = action('signIn', { from: signInDialog, to: { payment } }, (on) =>
  on.click({ role: 'button', name: 'Sign in' }),
);

// The count is on the page before the like, and still there once the page is quiet: the like rests there.
const like = action('like', { from: product, to: { liked: product } }, (on) => on.click({ role: 'button', name: 'Like' }));

/**
 * Opens the checkout. The shop keeps Continue disabled until the form
 * hydrates, and Playwright's click waits for that: when an action may start is
 * not something a declared outcome answers.
 */
async function checkout(page: Page, user: 'guest' | 'member'): Promise<void> {
  await page.goto(`/checkout?user=${user}`);
}

async function address(page: Page): Promise<void> {
  const on = surface(page);
  await on.select({ label: 'Country' }, 'NL');
  await on.fill({ label: 'Street' }, 'Damrak 1');
}

test('a member with an address reaches payment', async ({ page }) => {
  await checkout(page, 'member');
  await address(page);

  const reached = await submit(surface(page));

  expect(reached.outcome).toBe('payment');
  await expect(reached.at!.getByLabel('Card')).toBeVisible({ timeout: 0 });
});

test('a guest reaches the sign-in, and a test that insisted on payment hears it', async ({ page }) => {
  await checkout(page, 'guest');
  await address(page);

  await expect(submit(surface(page)).to('payment')).rejects.toThrow('submit: expected payment, reached signIn');
});

test('a guest who signs in reaches payment', async ({ page }) => {
  await checkout(page, 'guest');
  await address(page);

  await submit(surface(page)).to('signIn');
  await signIn(surface(page)).to('payment');
});

test('an empty form stays, and its errors are there when it is said to', async ({ page }) => {
  await checkout(page, 'member');

  await submit(surface(page)).to('invalid');

  expect(await page.getByRole('alert').allInnerTexts()).toEqual(['Choose a country', 'Enter a street']);
});

test('a like stays on the product, with the count already moved', async ({ page }) => {
  await page.goto('/product');
  const count = page.getByTestId('likes');
  await expect(count).not.toHaveText('…');
  const before = Number(await count.innerText());

  await like(surface(page)).to('liked');

  expect(Number(await count.innerText())).toBeGreaterThan(before);
});
