import { test as base, expect } from '@playwright/test';
import { varianceFixtures, type VarianceFixtures, type VarianceWorkerFixtures } from '@variance-authority/playwright-test';
import { variancePrecondition } from '@variance-authority/sense/precondition';

// Every call below ends in a comment naming it, which is how the test that
// records this file finds the line each row should cite.

const test = base.extend<VarianceFixtures, VarianceWorkerFixtures>(varianceFixtures);

// The page hands over one crossing of `src/cart.ts`, the way an instrumented
// build's collector would.
const CART = 'packages/playwright-test/test/fixtures/preconditions/src/cart.ts';
const COLLECTOR = `globalThis.__variance_authority_execution__ = {
  drain: () => ({ instrumentation: 'sense:instrument/presence-v5', modules: [{ id: '${CART}', hits: [0], shared: [] }] }),
};`;

test.beforeEach(async ({ page }) => {
  await page.setContent(`<script>${COLLECTOR}</script>`);
});

test.afterEach(() => {
  variancePrecondition('cleaned'); // after each
});

test.describe('mocked', () => {
  test.beforeEach(() => {
    variancePrecondition('network', 'mocked'); // mocked each
  });

  test('pays', () => {
    expect(1 + 2).toBe(3);
  });

  test('refunds behind a flag', () => {
    variancePrecondition({ flag: 'ff-on' }); // case flag
    expect(0).toBe(0);
  });
});

test.describe('live', () => {
  test('replays a recording', () => {
    variancePrecondition('network', 'recorded'); // case network
    expect(5).toBe(5);
  });
});

test('contradicted', () => {
  variancePrecondition('flag', 'ff-on'); // contradicted on
  variancePrecondition('flag', 'ff-off'); // contradicted off
});

test('crosses nothing', () => {
  variancePrecondition('seeded'); // seeded
});

test('says nothing', () => {
  expect(9).toBe(9);
});
