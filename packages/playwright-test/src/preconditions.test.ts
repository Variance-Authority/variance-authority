import { test, type TestInfo } from '@playwright/test';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { playwrightStanding } from './preconditions.js';

// What a call is placed on is decided by what `test.info()` says when it is
// made, so `test.info` is the seam: a worker's `TestInfo` cut to what is read.

const infoWith = (hookType: unknown, slot: unknown, fixture?: object): TestInfo =>
  ({
    titlePath: ['checkout.spec.ts', 'mocked', 'pays'],
    project: { name: '' },
    file: '/repo/tests/checkout.spec.ts',
    testId: 't1',
    _currentHookType: hookType,
    _timeoutManager: slot === null ? undefined : { currentSlotType: () => slot, _running: { runnable: { type: slot, fixture } } },
  }) as unknown as TestInfo;

const standingUnder = (hookType: unknown, slot: unknown = 'test', fixture?: object) => {
  vi.spyOn(test, 'info').mockReturnValue(infoWith(hookType, slot, fixture));
  return playwrightStanding(() => 'tests/checkout.spec.ts')();
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('playwrightStanding', () => {
  it('places a call in the body on its case, and one in a beforeEach on the case it runs for', () => {
    expect(standingUnder(() => undefined)).toEqual({ at: 'case', key: 'tests/checkout.spec.ts\u0000t1' });
    expect(standingUnder(() => 'beforeEach')).toMatchObject({ at: 'beforeEach', key: 'tests/checkout.spec.ts\u0000t1' });
    expect(standingUnder(() => 'afterEach')).toEqual({ at: 'after' });
  });

  it('places a call in a beforeAll or an afterAll on no case', () => {
    expect(standingUnder(() => 'beforeAll')).toMatchObject({ at: 'outside', because: expect.stringMatching(/beforeAll/) });
    expect(standingUnder(() => 'afterAll')).toMatchObject({ at: 'outside', because: expect.stringMatching(/afterAll/) });
  });

  it('places a call in a modifier’s callback on no case, naming the modifier', () => {
    expect(standingUnder(() => undefined, 'skip')).toMatchObject({ at: 'outside', because: expect.stringMatching(/test\.skip modifier/) });
    expect(standingUnder(() => undefined, 'fixme')).toMatchObject({ at: 'outside', because: expect.stringMatching(/test\.fixme modifier/) });
    expect(standingUnder(() => undefined, 'fail')).toMatchObject({ at: 'outside', because: expect.stringMatching(/test\.fail modifier/) });
    expect(standingUnder(() => undefined, 'slow')).toMatchObject({ at: 'outside', because: expect.stringMatching(/test\.slow modifier/) });
  });

  it('places a call in a test fixture a modifier set up on its case', () => {
    expect(standingUnder(() => undefined, 'skip', { title: 'cart' })).toEqual({ at: 'case', key: 'tests/checkout.spec.ts\u0000t1' });
  });

  it('guesses no body where the worker does not say which hook is running', () => {
    expect(standingUnder(undefined)).toMatchObject({ at: 'outside' });
    expect(standingUnder('beforeEach')).toMatchObject({ at: 'outside' });
  });

  it('guesses no body where the worker does not say whether the body is running', () => {
    expect(standingUnder(() => undefined, null)).toMatchObject({ at: 'outside' });
    expect(standingUnder(() => undefined, 'teardown')).toMatchObject({ at: 'outside' });
  });

  it('places a call outside a running test on no case', () => {
    vi.spyOn(test, 'info').mockImplementation(() => {
      throw new Error('test.info() can only be called while test is running');
    });
    expect(playwrightStanding(() => 'tests/checkout.spec.ts')()).toMatchObject({ at: 'outside' });
  });
});
