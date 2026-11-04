import { readFileSync } from 'node:fs';
import { test as base, expect } from '@playwright/test';
import { varianceFixtures, type VarianceFixtures, type VarianceWorkerFixtures } from '@variance-authority/playwright-test';
import { moduleId } from '@variance-authority/sense/journal';

// Every statement below ends in a comment naming it, which is how the test that
// records this file finds the line each region should be charged to.

const test = base.extend<VarianceFixtures, VarianceWorkerFixtures>(varianceFixtures);

// The page enters a region of `src/shop.ts` for each thing it does, the way an
// instrumented build's collector would, and hands over what it entered since
// it was last drained.
const SHOP = moduleId(
  'packages/playwright-test/test/fixtures/cadence/src/shop.ts',
  readFileSync(new URL('../src/shop.ts', import.meta.url), 'utf8'),
);
const PAGE = `<script>
const entered = new Set([0, 1]);
globalThis.__variance_authority_execution__ = {
  drain: () => {
    const hits = [...entered];
    entered.clear();
    return { instrumentation: 'sense:instrument/presence-v6', modules: [{ id: '${SHOP}', hits, shared: [] }] };
  },
};
</script>
<button id="choose" onclick="entered.add(2)">Choose</button>
<button id="pay" onclick="entered.add(3)">Pay</button>`;

test.beforeEach(async ({ page }) => {
  await page.setContent(PAGE); // opens
});

test('pays for what it chose', async ({ page }) => {
  await page.click('#choose'); // chooses
  expect(await page.title()).toBe(''); // looks
  await page.click('#pay'); // pays
});
