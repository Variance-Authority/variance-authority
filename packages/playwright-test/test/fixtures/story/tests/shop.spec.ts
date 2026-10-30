import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test as base, expect } from '@playwright/test';
import { varianceFixtures, type VarianceFixtures, type VarianceWorkerFixtures } from '@variance-authority/playwright-test';
import { executionCollectorSource, testSelectionProbes } from '@variance-authority/sense/journal';

// Every statement below ends in a comment naming it, which is how the test that
// records this file finds the line each one is on.

const test = base.extend<VarianceFixtures, VarianceWorkerFixtures>(varianceFixtures);

// The page an instrumented build serves: the collector the build hoists, then
// `src/shop.js` as the build's probes leave it.
const file = fileURLToPath(new URL('../src/shop.js', import.meta.url));
const probed = testSelectionProbes({ root: fileURLToPath(new URL('../../../../../..', import.meta.url)) })
  .transform.handler(readFileSync(file, 'utf8'), file)!
  .code.replace(/\n;import "[^"]+";$/, '');
const PAGE = `<script>${executionCollectorSource()}</script>
<script>${probed}</script>
<button id="choose" onclick="shop.choose('tea')">Choose</button>
<button id="pay" onclick="shop.pay(20)">Pay</button>`;

test('pays for what it chose', async ({ page }) => {
  await page.setContent(PAGE); // opens
  await page.evaluate(() => (globalThis as unknown as { shop: { open(): string } }).shop.open()); // looks
  await page.click('#choose'); // chooses
  await page.click('#pay'); // pays
  expect(await page.title()).toBe(''); // checks
});
