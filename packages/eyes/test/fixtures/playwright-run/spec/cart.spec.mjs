import { test as base, expect } from '@playwright/test';
import { eyesFixtures } from '@variance-authority/eyes/playwright';

const test = base.extend(eyesFixtures);

const CART = `
  <button aria-label="Add">Add</button>
  <output aria-label="Count">0</output>
  <script>
    document.querySelector('button').addEventListener('click', () => {
      const count = document.querySelector('output');
      count.textContent = String(Number(count.textContent) + 1);
    });
  </script>`;

test('adds one item', async ({ page, eyes }) => {
  eyes.phase('arrange');
  await page.setContent(CART);
  eyes.phase('act');
  await page.getByRole('button', { name: 'Add' }).click();
  eyes.phase('assert');
  await expect(page.getByLabel('Count')).toHaveText('1');
});

test('passes on its second attempt', async ({ page }, testInfo) => {
  await page.setContent(CART);
  await page.getByRole('button', { name: 'Add' }).click();
  expect(testInfo.retry).toBe(1);
});
