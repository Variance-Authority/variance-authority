import { join } from 'node:path';
import type { TestInfo } from '@playwright/test';
import type { TestState, Vantage, WatchedTestIdentity } from '@variance-authority/vantage';
import { describe, expect, it } from 'vitest';
import { varianceDesk, varianceVantageFixtures } from './vantage.js';

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
      noted: () => {},
      waits: async () => 'continued',
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

describe('the two calls a test author writes', () => {
  /** A vantage that keeps what it was told and answers waits on command. */
  function listening(): {
    notes: { test: string; at: string; note: string }[];
    waited: { test: string; at: string }[];
    vantage: Vantage;
  } {
    const notes: { test: string; at: string; note: string }[] = [];
    const waited: { test: string; at: string }[] = [];
    return {
      notes,
      waited,
      vantage: {
        opened: () => {},
        heard: () => {},
        remarked: () => {},
        noted: (test, at, note) => notes.push({ test, at, note }),
        waits: async (test, at) => {
          waited.push({ test, at });
          return 'continued';
        },
        closed: () => {},
      },
    };
  }

  it('costs nothing at all when nobody is watching', async () => {
    // The property the whole feature rests on: a call left in a committed spec
    // is inert in CI, unlike the `debugger;` it stands in for.
    const desk = varianceDesk(undefined, 't-1');

    expect(() => desk.snapshot('halfway')).not.toThrow();
    await expect(desk.observe()).resolves.toBe('unwatched');
  });

  it('says where in the spec the call was, without being told', async () => {
    const { notes, waited, vantage } = listening();
    const desk = varianceDesk(vantage, 't-1');

    desk.snapshot('cart filled');
    await desk.observe('look at this');

    expect(notes.map((one) => one.note)).toEqual(['cart filled', 'look at this']);
    // The caller's own file and line, not this module's.
    for (const one of [...notes, ...waited]) {
      expect(one.at).toMatch(/vantage\.test\.ts:\d+:\d+$/);
    }
    expect(waited).toEqual([{ test: 't-1', at: expect.any(String) }]);
  });

  it('blocks wherever the test is awaiting, not only in its body', async () => {
    // Established by experiment rather than reasoning: the rule is not "test
    // body only" but any frame the test is transitively awaiting.
    const { waited, vantage } = listening();
    const desk = varianceDesk(vantage, 't-1');

    const helper = async (): Promise<void> => {
      await desk.observe();
    };
    await helper();

    expect(waited).toHaveLength(1);
    expect(waited[0]?.at).toMatch(/vantage\.test\.ts:\d+:\d+$/);
  });

  it('sends a note with no words rather than refusing one', async () => {
    const { notes, vantage } = listening();

    varianceDesk(vantage, 't-1').snapshot();

    expect(notes[0]?.note).toBe('');
  });
});

describe('a test that stands still and the runner’s clock', () => {
  it('stops the clock while it waits and hands back only the time it stood still', async () => {
    // A test held open for somebody to look at is not a slow test. Without this
    // the one feature whose purpose is to hold a page still would arrive as a
    // timeout with no explanation in it.
    const set: number[] = [];
    let held = false;
    const vantage: Vantage = {
      opened: () => {},
      heard: () => {},
      remarked: () => {},
      noted: () => {},
      waits: async () => {
        held = set.at(-1) === 0;
        return 'continued';
      },
      closed: () => {},
    };

    await varianceDesk(vantage, 't-1', {
      reprieve: () => {
        set.push(0);
        return () => set.push(30_000);
      },
    }).observe();

    expect(held).toBe(true);
    expect(set).toEqual([0, 30_000]);
  });

  it('gives the clock back even when the wait throws', async () => {
    const set: string[] = [];
    const vantage: Vantage = {
      opened: () => {},
      heard: () => {},
      remarked: () => {},
      noted: () => {},
      waits: () => Promise.reject(new Error('the socket went')),
      closed: () => {},
    };

    await expect(
      varianceDesk(vantage, 't-1', {
        reprieve: () => {
          set.push('held');
          return () => set.push('given back');
        },
      }).observe(),
    ).rejects.toThrow('the socket went');

    expect(set).toEqual(['held', 'given back']);
  });
});
