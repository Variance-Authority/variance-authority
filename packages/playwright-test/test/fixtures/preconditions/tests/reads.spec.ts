import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test as base, expect } from '@playwright/test';
import { varianceBreadcrumb } from '@variance-authority/event';
import { varianceFixtures, type VarianceFixtures, type VarianceWorkerFixtures } from '@variance-authority/playwright-test';
import { executionCollectorSource } from '@variance-authority/sense/journal';

// What the code under test read, in the worker and in the page: every call
// ends in a comment naming it, as in `checkout.spec.ts`.

const test = base.extend<VarianceFixtures, VarianceWorkerFixtures>(varianceFixtures);

// The page is served the way a dev server serves a file outside its root, at
// `/@fs/` and the file's path, with the collector an instrumented build carries.
const EVENT = fileURLToPath(import.meta.resolve('@variance-authority/event'));
const FLAGS = fileURLToPath(new URL('../src/flags.js', import.meta.url));
const PAGE = `<script>{${executionCollectorSource()}}</script>
<script type="importmap">${JSON.stringify({ imports: { '@variance-authority/event': `/@fs${EVENT}` } })}</script>
<script type="module" src="/@fs${FLAGS}"></script>`;

test('reads a flag in the worker and in the page', async ({ page }) => {
  expect(varianceBreadcrumb('flags', 'worker', 'on')).toBe('on'); // worker read
  await page.route('http://app.test/**', (route) => {
    const path = new URL(route.request().url()).pathname;
    return path.startsWith('/@fs/')
      ? route.fulfill({ contentType: 'text/javascript', body: readFileSync(path.slice('/@fs'.length), 'utf8') })
      : route.fulfill({ contentType: 'text/html', body: PAGE });
  });
  await page.goto('http://app.test/');
  await page.waitForFunction(() => (globalThis as { flagsRead?: boolean }).flagsRead === true);
});
