import { test, type TestInfo } from '@playwright/test';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { playwrightStanding } from './preconditions.js';

// What a call is placed on is decided by what `test.info()` says when it is
// made, so `test.info` is the seam: a worker's `TestInfo` cut to what is read.

const infoWith = (hookType: unknown): TestInfo =>
  ({
    titlePath: ['checkout.spec.ts', 'mocked', 'pays'],
    project: { name: '' },
    file: '/repo/tests/checkout.spec.ts',
    testId: 't1',
    _currentHookType: hookType,
  }) as unknown as TestInfo;

const standingUnder = (hookType: unknown) => {
  vi.spyOn(test, 'info').mockReturnValue(infoWith(hookType));
  return playwrightStanding(() => 'tests/checkout.spec.ts')();
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('playwrightStanding', () => {
  it('places a call in the body on its case, and one in afterEach after it', () => {
    expect(standingUnder(() => undefined)).toEqual({ at: 'case', key: 'tests/checkout.spec.ts\u0000t1' });
    expect(standingUnder(() => 'afterEach')).toEqual({ at: 'after' });
  });

  // Where a beforeEach call lands, and at which describe's level, is pinned by a
  // real run in `preconditions.chromium.test.ts`: the describe is read from the
  // worker's suite tree, which no cut-down `TestInfo` carries.
  it('places a call in a beforeEach whose describe was never read on no case', () => {
    expect(standingUnder(() => 'beforeEach')).toMatchObject({ at: 'outside', because: expect.stringMatching(/describe/) });
  });

  it('places a call in a beforeAll or an afterAll on no case', () => {
    expect(standingUnder(() => 'beforeAll')).toMatchObject({ at: 'outside', because: expect.stringMatching(/beforeAll/) });
    expect(standingUnder(() => 'afterAll')).toMatchObject({ at: 'outside', because: expect.stringMatching(/afterAll/) });
  });

  it('guesses no body where the worker does not say which hook is running', () => {
    expect(standingUnder(undefined)).toMatchObject({ at: 'outside' });
    expect(standingUnder('beforeEach')).toMatchObject({ at: 'outside' });
  });

  it('places a call outside a running test on no case', () => {
    vi.spyOn(test, 'info').mockImplementation(() => {
      throw new Error('test.info() can only be called while test is running');
    });
    expect(playwrightStanding(() => 'tests/checkout.spec.ts')()).toMatchObject({ at: 'outside' });
  });
});
