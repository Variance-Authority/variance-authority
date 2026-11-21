// The shop saying nothing, reached through `@variance-authority/page-broker`:
// its outcomes are told from the page and its requests alone.
import { expect, test, type Page } from '@playwright/test';
import { broker, leads, stay } from '@variance-authority/page-broker';
import { surface } from '@variance-authority/page-broker/playwright';

const Payment = broker('payment', { probe: { role: 'form', name: 'Payment' } });

const SignIn = broker('signIn', {
  probe: { role: 'dialog', name: 'Sign in' },
  actions: {
    signIn: leads({ payment: Payment }, (on) => on.click({ role: 'button', name: 'Sign in' })),
  },
});

const Billing = broker('billing', {
  probe: { role: 'form', name: 'Billing details' },
  actions: {
    address: async (on, country: string, street: string) => {
      await on.select({ label: 'Country' }, country);
      await on.fill({ label: 'Street' }, street);
    },
    submit: leads({ payment: Payment, signIn: SignIn, invalid: stay }, (on) =>
      on.click({ role: 'button', name: 'Continue' }),
    ),
  },
});

const Product = broker('product', {
  probe: { role: 'article', name: 'Product' },
  actions: {
    like: leads({ liked: stay }, (on) => on.click({ role: 'button', name: 'Like' })),
  },
});

/**
 * Opens the checkout. The shop keeps Continue disabled until the form
 * hydrates, and Playwright's click waits for that: when an action may start is
 * not something a declared outcome answers.
 */
async function checkout(page: Page, user: 'guest' | 'member') {
  await page.goto(`/checkout?user=${user}`);
  return Billing.on(surface(page));
}

test('a member with an address reaches payment', async ({ page }) => {
  const billing = await checkout(page, 'member');
  await billing.address('NL', 'Damrak 1');

  const payment = await billing.submit().to('payment');

  await expect(payment.root.getByLabel('Card')).toBeVisible({ timeout: 0 });
});

test('a guest reaches the sign-in, and a test that insisted on payment hears it', async ({ page }) => {
  const billing = await checkout(page, 'guest');
  await billing.address('NL', 'Damrak 1');

  await expect(billing.submit().to('payment')).rejects.toThrow('billing.submit: expected payment, reached signIn');
});

test('a guest who signs in reaches payment', async ({ page }) => {
  const billing = await checkout(page, 'guest');
  await billing.address('NL', 'Damrak 1');

  const signIn = await billing.submit().to('signIn');
  await signIn.signIn().to('payment');
});

test('an empty form stays, and its errors are there when it is said to', async ({ page }) => {
  const billing = await checkout(page, 'member');

  await billing.submit().to('invalid');

  expect(await page.getByRole('alert').allInnerTexts()).toEqual(['Choose a country', 'Enter a street']);
});

test('a like stays on the product, with the count already moved', async ({ page }) => {
  await page.goto('/product');
  const count = page.getByTestId('likes');
  await expect(count).not.toHaveText('…');
  const before = Number(await count.innerText());
  const product = await Product.on(surface(page));

  await product.like().to('liked');

  expect(Number(await count.innerText())).toBeGreaterThan(before);
});
