import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
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

  // The installed loader, given the config a first load needs, caches the
  // fixture's suite tree as the worker's own load does before its first test.
  const flags = fileURLToPath(new URL('../test/fixtures/preconditions/tests/flags.spec.ts', import.meta.url));
  interface Loaded {
    title: string;
    _type: string;
    _hooks: { type: string; location: object }[];
    _entries: Loaded[];
  }
  const loaded = async (): Promise<Loaded> => {
    const playwright = createRequire(createRequire(import.meta.url).resolve('@playwright/test'));
    const { testLoader } = playwright('playwright/lib/common') as {
      testLoader: { loadTestFile: (file: string, config: object) => Promise<Loaded> };
    };
    return await testLoader.loadTestFile(flags, { config: { rootDir: dirname(flags), tags: [] } });
  };
  const beforeEachIn = (suite: Loaded, ...titles: string[]): object => {
    const found = titles.reduce((at, title) => at._entries.find((entry) => entry.title === title)!, suite);
    return found._hooks.find((hook) => hook.type === 'beforeEach')!.location;
  };

  it('places a running beforeEach at the describe that declared it, by the location object Playwright made for it', async () => {
    const root = await loaded();
    const { enterDescribes, playwrightStanding } = await fresh();
    await enterDescribes(worker({ _requireFile: flags }));
    // A second test of the same file finds it read.
    await enterDescribes(worker({ _requireFile: flags }));
    const standingAt = (location: object) => {
      vi.spyOn(test, 'info').mockReturnValue({
        ...infoWith(() => 'beforeEach'),
        _timeoutManager: { _running: { runnable: { type: 'beforeEach', location } } },
      } as unknown as TestInfo);
      return playwrightStanding(() => 'tests/checkout.spec.ts')();
    };
    const key = 'tests/checkout.spec.ts\u0000t1';
    expect(standingAt(beforeEachIn(root))).toEqual({ at: 'beforeEach', key, depth: 0 });
    expect(standingAt(beforeEachIn(root, 'flag on'))).toEqual({ at: 'beforeEach', key, depth: 1 });
    // One helper line declares both: equal locations, two objects, two depths.
    const outer = beforeEachIn(root, 'tier outer');
    const inner = beforeEachIn(root, 'tier outer', 'tier inner');
    expect(inner).toEqual(outer);
    expect(standingAt(outer)).toEqual({ at: 'beforeEach', key, depth: 1 });
    expect(standingAt(inner)).toEqual({ at: 'beforeEach', key, depth: 2 });
    expect(standingAt({ ...inner })).toMatchObject({ at: 'outside' });
  });

  it.each(['_type', '_hooks', '_entries'] as const)(
    'throws at setup for a suite tree whose suites carry no %s',
    async (field) => {
      const root = await loaded();
      const kept = root[field];
      delete (root as Partial<Loaded>)[field];
      try {
        const { enterDescribes, playwrightVersion } = await fresh();
        await expect(enterDescribes(worker({ _requireFile: flags }))).rejects.toThrow(
          `Playwright ${playwrightVersion()} has no Suite.${field}`,
        );
      } finally {
        Object.assign(root, { [field]: kept });
      }
    },
  );

  it.each([
    ['TestInfo._currentHookType()', { _currentHookType: undefined }],
    ['TestInfo._timeoutManager._running.runnable', { _timeoutManager: { _running: {} } }],
  ])('throws at setup for a worker with no %s', async (internal, fields) => {
    const { enterDescribes, playwrightVersion } = await fresh();
    await expect(enterDescribes(worker({ _requireFile: flags, ...fields }))).rejects.toThrow(
      `Playwright ${playwrightVersion()} has no ${internal}`,
    );
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
