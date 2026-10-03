import { test as base, expect } from '@playwright/test';
import { varianceFixtures, type VarianceFixtures, type VarianceWorkerFixtures } from '@variance-authority/playwright-test';
import { variancePrecondition } from '@variance-authority/sense/precondition';

// A modifier with a callback decides whether its case runs: it is neither the
// case body nor a beforeEach, so a call in the callback itself throws. Every call ends in a
// comment naming it, which is how the test that runs this file finds its line.

// `cart` says its precondition as it is set up: a fixture arranges for the case
// that asked for it, whichever callback asked first.
const test = base.extend<VarianceFixtures & { cart: string }, VarianceWorkerFixtures>({
  ...varianceFixtures,
  // eslint-disable-next-line no-empty-pattern -- Playwright reads a fixture's dependencies from this pattern.
  cart: async ({}, use) => {
    variancePrecondition({ cart: 'filled' }); // fixture
    await use('filled');
  },
});

// The page hands over one crossing of `src/plan.ts`, the way an instrumented
// build's collector would.
const PLAN = 'packages/playwright-test/test/fixtures/precondition-modifiers/src/plan.ts';
const COLLECTOR = `globalThis.__variance_authority_execution__ = {
  drain: () => ({ instrumentation: 'sense:instrument/presence-v5', modules: [{ id: '${PLAN}', hits: [0], shared: [] }] }),
};`;

test.beforeEach(async ({ page }) => {
  await page.setContent(`<script>${COLLECTOR}</script>`);
});

// Runs first, so the recorder is set up before the worker-fixture modifier,
// which runs before any case of its describe.
test('says it in its body', () => {
  variancePrecondition({ seeded: true }); // body
});

test.describe('skipped by a fixture', () => {
  // Asks for `cart` before the case does, so `cart` is set up under this modifier.
  test.skip(({ cart }) => cart === 'empty');

  test('runs past a fixture skip', () => {
    expect(3).toBe(3);
  });
});

test.describe('slowed by a worker fixture', () => {
  // Reads only a worker fixture, so Playwright runs it once, before the describe.
  test.slow(({ browserName }) => {
    variancePrecondition({ engine: browserName }); // slow modifier
    return false;
  });

  test('runs past a slow', () => {
    expect(2).toBe(2);
  });
});

test.describe('skipped by a page', () => {
  // Reads a test fixture, so Playwright runs it for each case, after the file's
  // beforeEach and before any beforeEach in this describe.
  test.skip(({ page }) => {
    variancePrecondition({ viewport: 'narrow' }); // skip modifier
    return page.viewportSize() === null;
  });

  test('runs past a skip', () => {
    expect(1).toBe(1);
  });
});

// `stock` is a worker fixture: it is set up once for the worker, under whichever
// callback asks for it first, and every later case reuses it.
// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- the worker fixture adds no test fixture.
const stocked = test.extend<{}, { stock: string }>({
  stock: [
    // eslint-disable-next-line no-empty-pattern -- Playwright reads a fixture's dependencies from this pattern.
    async ({}, use) => {
      variancePrecondition({ stock: 'warm' }); // worker fixture
      await use('warm');
    },
    { scope: 'worker' },
  ],
});

stocked.describe('skipped by a worker fixture and a page', () => {
  // Reads `page`, so it runs for each case, and asks for `stock` first.
  stocked.skip(({ stock, page }) => stock === 'cold' && page.viewportSize() === null);

  stocked('runs past a worker fixture skip', () => {
    expect(4).toBe(4);
  });
});
