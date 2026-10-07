import { readFileSync } from 'node:fs';
import { test as base, expect } from '@playwright/test';
import { varianceFixtures, type VarianceFixtures, type VarianceWorkerFixtures } from '@variance-authority/playwright-test';
import { moduleId } from '@variance-authority/sense/journal';
import { variancePrecondition } from '@variance-authority/sense/precondition';

// Every call below ends in a comment naming it, which is how the test that
// records this file finds the line each row should cite.

const test = base.extend<VarianceFixtures, VarianceWorkerFixtures>(varianceFixtures);

// The page hands over one crossing of `src/cart.ts`, the way an instrumented
// build's collector would, naming the text on disk.
const CART = moduleId(
  'packages/playwright-test/test/fixtures/preconditions/src/cart.ts',
  readFileSync(new URL('../src/cart.ts', import.meta.url), 'utf8'),
);
const COLLECTOR = `globalThis.__variance_authority_execution__ = {
  drain: () => ({ instrumentation: 'sense:instrument/presence-v5', modules: [{ id: '${CART}', hits: [0], shared: [] }] }),
};`;

test.beforeEach(async ({ page }) => {
  await page.setContent(`<script>${COLLECTOR}</script>`);
});

test.afterEach(() => {
  variancePrecondition({ cleaned: true }); // after each
});

test.describe('mocked', () => {
  test.beforeEach(() => {
    variancePrecondition({ network: 'mocked' }); // mocked each
  });

  test('pays', () => {
    expect(1 + 2).toBe(3);
  });

  test('refunds behind a flag', () => {
    variancePrecondition({ flag: 'ff-on' }); // case flag
    expect(0).toBe(0);
  });

  test('photographs the receipt', async ({ page, variance }) => {
    variancePrecondition({ flag: 'ff-on' }); // receipt flag
    // Navigated rather than set, so the page runs the fixture's init script.
    await page.route('http://receipt.test/', (route) => route.fulfill({ contentType: 'text/html', body: `<script>${COLLECTOR}</script><p>Paid</p>` }));
    await page.goto('http://receipt.test/');
    await variance(page.locator('p'), { subjectId: 'receipt--ff-on' });
    variancePrecondition({ seeded: true }); // receipt seeded
  });
});

test.describe('live', () => {
  test('replays a recording', () => {
    variancePrecondition({ network: 'recorded' }); // case network
    expect(5).toBe(5);
  });
});

test('contradicted', () => {
  variancePrecondition({ flag: 'ff-on' }); // contradicted on
  variancePrecondition({ flag: 'ff-off' }); // contradicted off
});

test('crosses nothing', () => {
  variancePrecondition({ seeded: true }); // seeded
});

test('says nothing', () => {
  expect(9).toBe(9);
});
