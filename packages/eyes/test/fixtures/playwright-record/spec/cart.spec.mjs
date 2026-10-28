import { test as base, expect } from '@playwright/test';
import { eyesFixtures } from '@variance-authority/eyes/playwright';
import { varianceFixtures } from '@variance-authority/playwright-test';

// What a suite that records composes: the recording, and Eyes on its page.
const test = base.extend(varianceFixtures).extend(eyesFixtures);

const CART = `
  <button aria-label="Add">Add</button>
  <output aria-label="Count">0</output>`;

/** The cart, with its script built the way a recording run builds it. */
async function cart(page) {
  await page.setContent(CART);
  await page.addScriptTag({ content: process.env.EYES_PAGE });
}

test('adds one item', async ({ page, eyes }) => {
  eyes.phase('arrange');
  await cart(page);
  eyes.phase('act');
  await page.getByRole('button', { name: 'Add' }).click();
  eyes.phase('assert');
  await expect(page.getByLabel('Count')).toHaveText('1');
});

test('passes on its second attempt', async ({ page }, testInfo) => {
  await cart(page);
  await page.getByRole('button', { name: 'Add' }).click();
  expect(testInfo.retry).toBe(1);
});
