import { readFileSync } from 'node:fs';
import { test as base, expect } from '@playwright/test';
import { varianceFixtures, type VarianceFixtures, type VarianceWorkerFixtures } from '@variance-authority/playwright-test';
import { moduleId } from '@variance-authority/sense/journal';

// Every statement below ends in a comment naming it, which is how the test that
// records this file finds the line each region should be charged to.

const test = base.extend<VarianceFixtures, VarianceWorkerFixtures>(varianceFixtures);

// The page enters a region of `src/page.ts` for each thing it does, the way an
// instrumented build's collector would: `wire` once it has wired its button,
// `handle` when the wired button is clicked, and `tick` on a timer.
const PAGE = moduleId(
  'packages/playwright-test/test/fixtures/flake/src/page.ts',
  readFileSync(new URL('../src/page.ts', import.meta.url), 'utf8'),
);
const page = (tickAfter: number): string => `<script>
const entered = new Set([0]);
globalThis.__variance_authority_execution__ = {
  drain: () => {
    const hits = [...entered];
    entered.clear();
    return { instrumentation: 'sense:instrument/presence-v6', modules: [{ id: '${PAGE}', hits, shared: [] }] };
  },
};
addEventListener('DOMContentLoaded', () => {
  const go = document.getElementById('go');
  setTimeout(() => {
    entered.add(1);
    go.onclick = () => { entered.add(2); document.getElementById('done').textContent = 'done'; };
    go.dataset.ready = '1';
  }, 1_000);
  setTimeout(() => { entered.add(3); document.getElementById('tick').textContent = 'tick'; }, ${tickAfter});
});
</script>
<button id="go">Go</button><p id="done"></p><p id="tick"></p>`;

// Throws when it clicks before the page has wired its button.
test('clicks', async ({ page: tab }) => {
  await tab.setContent(page(60_000)); // opens
  if (process.env['CLICK_FIRST'] !== '1') await tab.locator('#go[data-ready]').waitFor(); // waits
  await tab.click('#go'); // clicks
  await expect(tab.locator('#done')).toHaveText('done', { timeout: 2_500 }); // checks
});

// Throws as `THROW` says, and a timer lands under whichever statement is running.
test('ticks', async ({ page: tab }) => {
  await tab.setContent(page(process.env['TICK_EARLY'] === '1' ? 0 : 1_200)); // opens
  if (process.env['TICK_EARLY'] === '1') await tab.locator('#tick:has-text("tick")').waitFor(); // waits
  await tab.locator('#go[data-ready]').waitFor(); // readies
  await expect(tab.locator('#tick')).toHaveText('tick'); // looks
  expect(process.env['THROW']).toBeUndefined(); // checks
});
