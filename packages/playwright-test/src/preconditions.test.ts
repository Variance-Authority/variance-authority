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

describe('enterDescribes', () => {
  // A worker that cannot say a hook's describe throws once, at setup, and the
  // same for every test after; each case loads the module fresh for that.
  const fresh = async () => {
    vi.resetModules();
    return await import('./preconditions.js');
  };
  const worker = (fields: object): TestInfo =>
    ({
      _currentHookType: () => undefined,
      _timeoutManager: { _running: { runnable: { type: 'beforeEach' } } },
      ...fields,
    }) as unknown as TestInfo;

  it('throws at setup naming the internal it lacks and the installed Playwright, then every test the same', async () => {
    const { enterDescribes, playwrightVersion } = await fresh();
    const refusal = `Playwright ${playwrightVersion()} has no TestInfo._requireFile`;
    await expect(enterDescribes(worker({}))).rejects.toThrow(refusal);
    await expect(enterDescribes(worker({ _requireFile: '/repo/tests/checkout.spec.ts' }))).rejects.toThrow(refusal);
  });

  // That the installed Playwright has every internal read, and that they say
  // the right describe, is the real run in `preconditions.chromium.test.ts`.
  it('reaches the installed test loader, which holds no tree for a file its worker never loaded', async () => {
    const { enterDescribes, playwrightVersion } = await fresh();
    expect(playwrightVersion()).toMatch(/^\d+\.\d+\.\d+/);
    await expect(enterDescribes(worker({ _requireFile: '/repo/tests/never-loaded.spec.ts' }))).rejects.toThrow(
      `has no suite tree cached for /repo/tests/never-loaded.spec.ts in the testLoader its worker used`,
    );
  });
});
