// The shop saying nothing, reached through `@variance-authority/page-broker`:
// the outcomes the spike's broker sensed from `aria-busy` and announced events
// are told here from the page and its requests alone.
import { expect, test, type Page } from '@playwright/test';
import { action, stay } from '@variance-authority/page-broker';

const submit = action(
  'submit',
  {
    payment: (page) => page.getByRole('form', { name: 'Payment' }),
    signIn: (page) => page.getByRole('dialog', { name: 'Sign in' }),
    invalid: stay,
  },
  async (page) => {
    await page.getByRole('button', { name: 'Continue' }).click();
  },
);

const signIn = action(
  'signIn',
  { payment: (page) => page.getByRole('form', { name: 'Payment' }) },
  async (page) => {
    await page.getByRole('button', { name: 'Sign in' }).click();
  },
);

const like = action('like', { liked: stay }, async (page) => {
  await page.getByRole('button', { name: 'Like' }).click();
});

/**
 * Opens the checkout and waits out its hydration. The silent shop gives no sign
 * of it, to a test or to a person, and a click before it loses the form: when an
 * action may start is not something a declared outcome answers.
 */
async function checkout(page: Page, user: 'guest' | 'member'): Promise<void> {
  await page.goto(`/checkout?user=${user}`);
  await page.waitForTimeout(650);
}

async function address(page: Page): Promise<void> {
  await page.getByLabel('Country').selectOption('NL');
  await page.getByLabel('Street').fill('Damrak 1');
}

test('a member with an address reaches payment', async ({ page }) => {
  await checkout(page, 'member');
  await address(page);

  const reached = await submit(page);

  expect(reached.outcome).toBe('payment');
  await expect(reached.at!.getByLabel('Card')).toBeVisible({ timeout: 0 });
});

test('a guest reaches the sign-in, and a test that insisted on payment hears it', async ({ page }) => {
  await checkout(page, 'guest');
  await address(page);

  await expect(submit(page).to('payment')).rejects.toThrow('submit: expected payment, reached signIn');
});

test('a guest who signs in reaches payment', async ({ page }) => {
  await checkout(page, 'guest');
  await address(page);

  await submit(page).to('signIn');
  await signIn(page).to('payment');
});

test('an empty form stays, and its errors are there when it is said to', async ({ page }) => {
  await checkout(page, 'member');

  await submit(page).to('invalid');

  expect(await page.getByRole('alert').allInnerTexts()).toEqual(['Choose a country', 'Enter a street']);
});

test('a like stays on the product, with the count already moved', async ({ page }) => {
  await page.goto('/product');
  const count = page.getByTestId('likes');
  await expect(count).not.toHaveText('…');
  const before = Number(await count.innerText());

  await like(page).to('liked');

  expect(Number(await count.innerText())).toBeGreaterThan(before);
});
