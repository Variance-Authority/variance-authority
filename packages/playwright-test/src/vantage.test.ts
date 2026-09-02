import { join } from 'node:path';
import type { TestInfo } from '@playwright/test';
import type { TestState, Vantage, WatchedTestIdentity } from '@variance-authority/vantage';
import { describe, expect, it } from 'vitest';
import { varianceVantageFixtures } from './vantage.js';

/**
 * The lifecycle half, without a browser.
 *
 * What is worth testing here is what a listing ends up saying about a test, and
 * that is decided entirely by what this reads off `TestInfo`. A run under a real
 * browser would exercise the same three lines through ten seconds of setup.
 */

interface Said {
  readonly opened: { test: string; identity: WatchedTestIdentity }[];
  readonly closed: { test: string; state: TestState; error?: string }[];
}

function watcher(): { said: Said; vantage: Vantage } {
  const said: Said = { opened: [], closed: [] };
  return {
    said,
    vantage: {
      opened: (test, identity) => said.opened.push({ test, identity }),
      heard: () => {},
      remarked: () => {},
      closed: (test, state, error) =>
        said.closed.push({ test, state, ...(error === undefined ? {} : { error }) }),
    },
  };
}

function info(over: Partial<TestInfo> = {}): TestInfo {
  return {
    testId: 't-1',
    title: 'adds an item',
    titlePath: ['chromium', join(process.cwd(), 'specs/cart.spec.ts'), 'the cart', 'adds an item'],
    file: join(process.cwd(), 'specs/cart.spec.ts'),
    workerIndex: 3,
    project: { name: 'chromium' },
    status: 'passed',
    errors: [],
    ...over,
  } as unknown as TestInfo;
}

/** Run the automatic fixture end to end, the way the runner would. */
async function watched(vantage: Vantage | undefined, testInfo: TestInfo): Promise<void> {
  const [setup] = varianceVantageFixtures.varianceWatched as [
    (
      args: { varianceVantage: Vantage | undefined },
      use: () => Promise<void>,
      testInfo: TestInfo,
    ) => Promise<void>,
    unknown,
  ];
  await setup({ varianceVantage: vantage }, async () => {}, testInfo);
}

describe('varianceVantageFixtures', () => {
  it('opens and closes every test, whatever else it destructured', async () => {
    const { said, vantage } = watcher();

    await watched(vantage, info());

    expect(said.opened).toEqual([
      {
        test: 't-1',
        identity: {
          title: 'the cart › adds an item',
          file: 'specs/cart.spec.ts',
          project: 'chromium',
          worker: 3,
        },
      },
    ]);
    expect(said.closed).toEqual([{ test: 't-1', state: 'passed' }]);
  });

  it('leaves the project out when the suite never named one', async () => {
    const { said, vantage } = watcher();

    // An unnamed project is an empty leading entry in the path, not a missing
    // one, and both halves of that fact are read here.
    await watched(
      vantage,
      info({
        project: { name: '' } as TestInfo['project'],
        titlePath: ['', 'specs/cart.spec.ts', 'the cart', 'adds an item'],
      }),
    );

    expect(said.opened[0]?.identity.project).toBeUndefined();
    expect(said.opened[0]?.identity.title).toBe('the cart › adds an item');
  });

  it('keeps a title that is only the test', async () => {
    const { said, vantage } = watcher();

    await watched(vantage, info({ titlePath: ['chromium', 'adds an item'] }));

    expect(said.opened[0]?.identity.title).toBe('adds an item');
  });

  it('carries the first lines of the failure it ended on', async () => {
    const { said, vantage } = watcher();

    await watched(
      vantage,
      info({
        status: 'failed',
        errors: [{ message: ['one', 'two', 'three', 'four', 'five'].join('\n') }],
      }),
    );

    expect(said.closed).toEqual([
      { test: 't-1', state: 'failed', error: 'one\ntwo\nthree\nfour' },
    ]);
  });

  it('calls a test the runner never gave a status interrupted', async () => {
    const { said, vantage } = watcher();

    await watched(vantage, info({ status: undefined }));

    expect(said.closed[0]?.state).toBe('interrupted');
  });

  it('says nothing at all when nobody is watching', async () => {
    // The bargain the whole package rests on: unwatched, this is a no-op that
    // every test in every suite runs, so it has to cost nothing and throw never.
    await expect(watched(undefined, info())).resolves.toBeUndefined();
  });
});
