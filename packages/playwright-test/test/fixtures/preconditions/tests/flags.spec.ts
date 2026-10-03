import { test as base, expect } from '@playwright/test';
import { varianceFixtures, type VarianceFixtures, type VarianceWorkerFixtures } from '@variance-authority/playwright-test';
import { variancePrecondition } from '@variance-authority/sense/precondition';

// A default said at the top of the file and an exception said by one describe:
// every call ends in a comment naming it, as in `checkout.spec.ts`.

const test = base.extend<VarianceFixtures, VarianceWorkerFixtures>(varianceFixtures);

test.beforeEach(() => {
  variancePrecondition('flag', 'ff-off'); // file flag
});

test.describe('flag on', () => {
  test.beforeEach(() => {
    variancePrecondition('flag', 'ff-on'); // describe flag
  });

  test('reads the exception', () => {
    expect(1).toBe(1);
  });
});

test.describe('flag left alone', () => {
  test('reads the default', () => {
    expect(2).toBe(2);
  });
});

// One line declaring a `beforeEach` at two depths of the same test, as a
// helper called in a describe and again in one inside it does.
const tiered = (tier: string) =>
  test.beforeEach(() => {
    variancePrecondition('tier', tier); // helper tier
  });

test.describe('tier outer', () => {
  tiered('gold');

  test.describe('tier inner', () => {
    tiered('silver');

    test('reads the inner tier', () => {
      expect(3).toBe(3);
    });
  });
});
