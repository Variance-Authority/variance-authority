import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { IndexLock, LOCK_POLL_MS, LOCK_WAIT_MS, withIndexLock } from './index-lock.js';
import SelectionReporter from './jest-reporter.js';
import { RUN_DIRECTORY_VARIABLE } from './jest.js';
import journalFormat from './journal-format.cjs';
import { recordExecution } from './journal.js';
import { foldRun } from './selection-fold.js';
import { newRun } from './selection-run.js';
import { instrumentationId } from '../instrument/index.js';

const { encodeJournal } = journalFormat;

/**
 * The polls `pastTheWait` fires before it calls a waiter one that never gives
 * up: four times the window's. `land-busy.test.ts` in the cli package bounds
 * its own copy by the same number, which it writes out because these constants
 * are not exported from the package.
 */
const POLL_BOUND = (4 * LOCK_WAIT_MS) / LOCK_POLL_MS;

/**
 * Run `work` across the whole waiting window of a lock it cannot take, in
 * milliseconds rather than ten seconds.
 *
 * The waiter polls with `setTimeout`, so only the timers are faked: `Date` stays
 * real, and a lock written a moment ago never reads as stale. The filesystem is
 * real too, so every attempt is a real `wx` create against a lock file that is
 * really there, and one handle to the real event loop is kept to yield to it.
 *
 * The clock jumps to the next poll only when one is pending, and otherwise the
 * pump yields a real turn for the attempt in the kernel to return. So the bound
 * counts polls fired, not turns taken: a loaded machine that needs more turns
 * per `wx` spends more real time, never more of the window. `work` may do its
 * own I/O before it reaches the lock and after it gives up, which is why the
 * bound is {@link POLL_BOUND} rather than the window's own count.
 */
async function pastTheWait<T>(work: () => Promise<T>): Promise<T> {
  const nextTurn = setTimeout;
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  try {
    let settled = false;
    const running = work().finally(() => {
      settled = true;
    });
    let fired = 0;
    while (!settled && fired < POLL_BOUND) {
      if (vi.getTimerCount() > 0) {
        fired += 1;
        await vi.advanceTimersToNextTimerAsync();
      }
      await new Promise<void>((wake) => nextTurn(wake, 0));
    }
    expect(
      settled,
      `the lock waiter was still waiting after ${fired} polls (${fired * LOCK_POLL_MS} ms of fake time); ` +
        `it gives up once its ${LOCK_WAIT_MS} ms window has passed`,
    ).toBe(true);
    return await running;
  } finally {
    vi.useRealTimers();
  }
}

describe('who may grow the index', () => {
  const made: string[] = [];

  afterAll(async () => {
    for (const directory of made) await rm(directory, { recursive: true, force: true });
  });

  async function index(): Promise<string> {
    const directory = await mkdtemp(resolve(tmpdir(), 'variance-index-lock-'));
    made.push(directory);
    return resolve(directory, 'coverage.bin');
  }

  it('cannot be held by anyone who did not take it', () => {
    // The whole point of the type: an object of the right shape is not an
    // exclusion, so a fold cannot satisfy the signature by inventing one.
    expect(() => new (IndexLock as unknown as new (token: symbol, file: string) => IndexLock)(
      Symbol('index lock'),
      '/tmp/coverage.bin',
    )).toThrow(/constructor-owned/);
  });

  it('lets the next merge in only once the one holding it is finished', async () => {
    const file = await index();
    const order: string[] = [];
    let entered!: () => void;
    let finish!: () => void;
    const holding = new Promise<void>((done) => (entered = done));
    const held = withIndexLock(file, async () => {
      order.push('first in');
      entered();
      await new Promise<void>((done) => (finish = done));
      order.push('first out');
    });

    await holding;
    const next = withIndexLock(file, async () => {
      order.push('second in');
    });
    // Long enough for a merge that was not excluded to have run. The two are
    // separate calls over one file, which is the shape two runners finishing at
    // once make — and the second is not inside the first.
    await new Promise((wake) => setTimeout(wake, 100));
    expect(order).toEqual(['first in']);

    finish();
    await Promise.all([held, next]);
    expect(order).toEqual(['first in', 'first out', 'second in']);
  });

  it('gives up rather than merging over a holder that never lets go', async () => {
    const file = await index();
    let ran = false;
    // Held until this test says otherwise, which is what a hung or very slow
    // merge looks like from outside. The waiter gives up and records nothing
    // rather than writing over it; the cost is one lost contribution, which is
    // a wider next run rather than a wrong one.
    let entered!: () => void;
    let finish!: () => void;
    const holding = new Promise<void>((done) => (entered = done));
    const held = withIndexLock(file, async () => {
      entered();
      await new Promise<void>((done) => (finish = done));
    });
    await holding;

    // The waiting window is the point of the test and ten seconds of it is not:
    // what has to be true is that the waiter polls to the end of the window and
    // then refuses, and a clock the test drives says that in milliseconds.
    const refused = await pastTheWait(() => withIndexLock(file, async () => {
      ran = true;
    }));

    expect(refused.held).toBe(false);
    expect(ran).toBe(false);

    finish();
    await held;
  });

  it('stops proving anything once the merge it was taken for has ended', async () => {
    const file = await index();
    let kept: IndexLock | undefined;

    await withIndexLock(file, async (lock) => {
      kept = lock;
      expect(lock.held).toBe(true);
    });

    // A token outlives its call, so holding one is not the same as holding the
    // index.
    expect(kept?.held).toBe(false);
  });
});

/**
 * What each seam does when another process holds the snapshot's lock past the
 * waiting window: it writes neither the snapshot nor the case index beside it,
 * and it says so in one sentence naming the lock. Each busy run is paired with
 * the same run on a free lock, which does write the case index and does warn
 * that no module was placed, so "nothing written" and "no empty-record warning"
 * are both claims the free run could have broken.
 */
describe('a run the snapshot lock refuses', () => {
  const made: string[] = [];
  let warned: string[] = [];
  const warn = console.warn;
  const cache = process.env['VARIANCE_AUTHORITY_CACHE'];

  afterEach(async () => {
    console.warn = warn;
    delete process.env[RUN_DIRECTORY_VARIABLE];
    if (cache === undefined) delete process.env['VARIANCE_AUTHORITY_CACHE'];
    else process.env['VARIANCE_AUTHORITY_CACHE'] = cache;
    for (const directory of made.splice(0)) await rm(directory, { recursive: true, force: true });
  });

  /** A project with one test file, and a lock on its snapshot when `busy`. */
  async function project(busy: boolean): Promise<{ root: string; coverageFile: string; testFile: string }> {
    const root = await mkdtemp(resolve(tmpdir(), 'variance-busy-index-'));
    made.push(root);
    await mkdir(resolve(root, 'test'), { recursive: true });
    const testFile = resolve(root, 'test/a.case.js');
    await writeFile(testFile, '// a\n');
    const coverageFile = resolve(root, 'coverage.bin');
    // Written a moment ago by somebody else, which is what a live holder in
    // another process looks like from here.
    if (busy) await writeFile(`${coverageFile}.lock`, '1\n');
    // A cache of its own: a run marks its checkout and prunes the cache when a
    // prune is due, and a prune that frees another test's layers warns too.
    process.env['VARIANCE_AUTHORITY_CACHE'] = resolve(root, 'variance-cache');
    warned = [];
    console.warn = (message: string): void => void warned.push(message);
    return { root, coverageFile, testFile };
  }

  const busyWarning = (coverageFile: string): string =>
    `variance-authority recorded nothing from this run: another process is holding ${coverageFile}.lock: ` +
    'nothing was recorded rather than merged over whatever it is writing.';
  const emptyWarning = /^variance-authority instrumented 0 modules across 1 test file\(s\)/u;

  async function fold(busy: boolean): Promise<{ coverageFile: string }> {
    const { root, coverageFile, testFile } = await project(busy);
    const run = newRun(coverageFile, root, 'presence');
    await mkdir(run.runDirectory, { recursive: true });
    await writeFile(resolve(run.runDirectory, 'a.va'), encodeJournal(testFile, new Map()));
    const settle = foldRun(run, { coverageFile, executionFile: `${coverageFile}.cases.bin`, shims: [] });
    await pastTheWait(() => settle([{ filepath: testFile, complete: true }]));
    return { coverageFile };
  }

  it('the Vitest and Rstest fold writes nothing, and says only that the lock was busy', async () => {
    const free = await fold(false);
    expect(existsSync(free.coverageFile)).toBe(true);
    expect(existsSync(`${free.coverageFile}.cases.bin`)).toBe(true);
    expect(warned).toEqual([expect.stringMatching(emptyWarning)]);

    const { coverageFile } = await fold(true);
    expect(existsSync(coverageFile)).toBe(false);
    expect(existsSync(`${coverageFile}.cases.bin`)).toBe(false);
    expect(warned).toEqual([busyWarning(coverageFile)]);
  });

  async function report(busy: boolean): Promise<{ coverageFile: string }> {
    const { root, coverageFile, testFile } = await project(busy);
    const reporter = new SelectionReporter(undefined, { root, coverageFile, preconditions: [] });
    reporter.onRunStart();
    const runDirectory = process.env[RUN_DIRECTORY_VARIABLE]!;
    await mkdir(runDirectory, { recursive: true });
    await writeFile(resolve(runDirectory, 'a.va'), encodeJournal(testFile, new Map()));
    await pastTheWait(() => reporter.onRunComplete(
      new Set([{ config: { cacheDirectory: resolve(root, 'cache'), id: 'project' } }]),
      { testResults: [{ testFilePath: testFile, skipped: false, testResults: [{ status: 'passed' }] }] },
    ));
    return { coverageFile };
  }

  it('the Jest reporter writes nothing, and says only that the lock was busy', async () => {
    const free = await report(false);
    expect(existsSync(free.coverageFile)).toBe(true);
    expect(existsSync(`${free.coverageFile}.cases.bin`)).toBe(true);
    expect(warned).toEqual([expect.stringMatching(emptyWarning)]);

    const { coverageFile } = await report(true);
    expect(existsSync(coverageFile)).toBe(false);
    expect(existsSync(`${coverageFile}.cases.bin`)).toBe(false);
    expect(warned).toEqual([busyWarning(coverageFile)]);
  });

  async function record(busy: boolean): Promise<{ coverageFile: string; recorded: unknown }> {
    const { root, coverageFile } = await project(busy);
    const recorded = await pastTheWait(() => recordExecution({
      root,
      cacheRoot: resolve(root, 'cache'),
      coverageFile,
      subjects: [{ owner: 'story:price--premium', journal: { instrumentation: instrumentationId(), modules: [] } }],
    }));
    return { coverageFile, recorded };
  }

  it('a browser recording writes nothing, and returns the reason rather than printing it', async () => {
    const free = await record(false);
    expect(free.recorded).toMatchObject({ recorded: true });
    expect(existsSync(free.coverageFile)).toBe(true);
    expect(warned).toEqual([expect.stringMatching(emptyWarning)]);

    const { coverageFile, recorded } = await record(true);
    expect(recorded).toEqual({
      recorded: false,
      coverageFile,
      subjects: 0,
      because: `another process is holding ${coverageFile}.lock: ` +
        'nothing was recorded rather than merged over whatever it is writing',
    });
    expect(existsSync(coverageFile)).toBe(false);
    expect(warned).toEqual([]);
  });
});
