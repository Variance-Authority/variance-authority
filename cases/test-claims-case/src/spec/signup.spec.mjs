import { test as base, expect } from '@playwright/test';
import { eyesFixtures } from '@variance-authority/eyes/playwright';
import { varianceFixtures } from '@variance-authority/playwright-test';
import { MARKUP, script } from '../page.mjs';

const test = base.extend(varianceFixtures).extend(eyesFixtures);
const PAGE = script();

async function open(page) {
  await page.setContent(MARKUP);
  await page.addScriptTag({ content: PAGE });
}

async function fillValid(page) {
  await page.locator('#name').fill('Ada');
  await page.locator('#email').fill('ada@example.com');
  await page.locator('#surname').fill('Lovelace');
}

test.describe('signup', () => {
  test('renders the form', async ({ page }) => {
    await open(page);
    await expect(page.getByRole('textbox')).toHaveCount(4);
  });

  for (const field of ['surname', 'phone']) {
    test(`types into ${field}`, async ({ page }) => {
      await open(page);
      await page.locator(`#${field}`).fill('7');
      await expect(page.locator(`#${field}`)).toHaveValue('7');
    });
  }

  test('submits the form', async ({ page }) => {
    await open(page);
    await fillValid(page);
    await page.getByRole('button', { name: 'Sign up' }).click();
    await expect(page.getByRole('status')).toHaveText(/^Saved/);
  });

  test('rejects an invalid email', async ({ page }) => {
    await open(page);
    await page.locator('#name').fill('Ada');
    await page.locator('#email').fill('nope');
    await page.getByRole('button', { name: 'Sign up' }).click();
    await expect(page.locator('#email-hint')).toHaveText('not an email');
    await expect(page.getByRole('status')).toHaveText('');
  });

  test('submits as a guest', async ({ page }) => {
    await open(page);
    await page.evaluate(() => { globalThis.session = { kind: 'guest' }; });
    await fillValid(page);
    await page.getByRole('button', { name: 'Sign up' }).click();
    await expect(page.getByRole('status')).toHaveText(/^Saved/);
  });

  test('retries a failed post', async ({ page }) => {
    await open(page);
    await fillValid(page);
    await page.getByRole('button', { name: 'Sign up' }).click();
    await expect(page.getByRole('status')).toHaveText(/^Saved/);
  });

  test('shows an error for a missing name', async ({ page }) => {
    await open(page);
    await page.locator('#email').fill('ada@example.com');
    await page.getByRole('button', { name: 'Sign up' }).click();
    await expect(page.locator('#name-hint')).not.toBeEmpty();
  });
});
