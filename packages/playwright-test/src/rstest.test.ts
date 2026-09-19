import { describe, expect, it } from 'vitest';
import { runOf, type RstestContext } from './rstest.js';

/**
 * Every field here is read from a place Rstest chose, and each was probed
 * against `@rstest/playwright` 0.12 rather than inferred from its types: the
 * title path is on `expect.getState()`, the spec file and project root are on
 * `task`, the browser options are the `playwright` fixture's value, and the
 * update mode is `snapshotState.snapshotUpdateState`, which is `new` on an
 * ordinary run and `all` under `-u`.
 */

function context(overrides: Partial<RstestContext> = {}): RstestContext {
  return {
    task: { filepath: `${process.cwd()}/e2e/checkout.test.ts`, projectRoot: process.cwd() },
    expect: {
      getState: () => ({
        currentTestName: 'checkout > shows an empty cart',
        testPath: `${process.cwd()}/e2e/checkout.test.ts`,
        snapshotState: { snapshotUpdateState: 'new' },
      }),
    },
    playwright: {
      contextOptions: {
        colorScheme: 'dark',
        deviceScaleFactor: 2,
        baseURL: 'http://localhost:3000',
      },
    },
    ...overrides,
  };
}

describe('runOf', () => {
  it('reads the subject, the raster partition and the origin from one test context', () => {
    expect(runOf(context())).toEqual({
      id: 'checkout/shows an empty cart',
      colorScheme: 'dark',
      deviceScaleFactor: 2,
      baseURL: 'http://localhost:3000',
      owner: 'e2e/checkout.test.ts',
      accepting: false,
    });
  });

  it('accepts under `-u` and under nothing else', () => {
    const states = ['new', 'none', 'all'] as const;
    const accepting = states.map((snapshotUpdateState) =>
      runOf(
        context({
          expect: { getState: () => ({ snapshotState: { snapshotUpdateState } }) },
        }),
      ).accepting,
    );

    // `new` is Rstest's default and means "write what has no snapshot yet",
    // which is the absence Playwright spells `missing`. Reading it as approval
    // would promote a baseline from the run nobody has looked at.
    expect(accepting).toEqual([false, false, true]);
  });

  it('leaves the result of a test that has not finished unstated', () => {
    // The body is still running when it asks, so there is no status to read and
    // `failed: false` would be a claim rather than an observation.
    expect('failed' in runOf(context())).toBe(false);
  });

  it('defaults the partition a project that configured no context options runs in', () => {
    const run = runOf(context({ playwright: { contextOptions: undefined } }));

    expect(run).toMatchObject({ colorScheme: 'light', deviceScaleFactor: 1 });
    expect('baseURL' in run).toBe(false);
  });

  it('falls back to the path expect knows when a run reports no task', () => {
    expect(runOf(context({ task: undefined })).owner).toBe('e2e/checkout.test.ts');
  });

  it('keeps the whole suite chain in the id, as a path', () => {
    const run = runOf(
      context({
        expect: { getState: () => ({ currentTestName: 'cart > empty > at 2x' }) },
      }),
    );

    expect(run.id).toBe('cart/empty/at 2x');
  });
});
