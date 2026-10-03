import { mkdtemp, readdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { variancePrecondition } from '@variance-authority/sense/precondition';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { commitRunsFile, testCoverageFile, writeCommitRuns, writeTestCoverage } from '@variance-authority/sense/test-selection';
import { EXIT_OPERATOR } from '../exit.js';
import { landJourneys } from './land.js';
import { published, wholeRecord } from './mainline-fixture.js';

/**
 * A landing that cannot take the snapshot's lock changes nothing and stops
 * with an operator error naming the lock. The cases travel in the snapshot, so
 * that lock is the only one a landing takes.
 */

let home: string;

beforeEach(async () => {
  home = await realpath(await mkdtemp(join(tmpdir(), 'variance-land-busy-')));
  process.env['VARIANCE_AUTHORITY_CACHE'] = join(home, 'cache');
});

afterEach(async () => {
  vi.useRealTimers();
  delete process.env['VARIANCE_AUTHORITY_CACHE'];
  await rm(home, { recursive: true, force: true });
});

/**
 * The lock's window and poll, `LOCK_WAIT_MS` and `LOCK_POLL_MS` in the sense
 * package's `index-lock.ts`, written out because the package does not export
 * them and a test is no reason to. `pastTheWait` fires four windows' worth of
 * polls before it calls a waiter one that never gives up, the bound the sense
 * package's own copy of this helper computes from those constants.
 */
const WINDOW_MS = 10_000;
const POLL_MS = 25;
const POLL_BOUND = (4 * WINDOW_MS) / POLL_MS;

/**
 * The real time `pastTheWait` gives `work` that neither settles nor schedules
 * a poll, and the timeout of the tests that call it: generous for a loaded
 * machine, and below the test's own timeout, so a hang fails with the helper's
 * sentence rather than vitest's.
 */
const REAL_CAP_MS = 30_000;
const PUMP_TEST_TIMEOUT_MS = 3 * REAL_CAP_MS;

/**
 * Settle `work` across the lock's whole waiting window in milliseconds.
 *
 * The waiter polls with `setTimeout`, so only the timers are faked: `Date` stays
 * real and a lock written a moment ago never reads as stale. Every attempt is a
 * real `wx` create, so the clock jumps to the next poll only when one is
 * pending, and otherwise the pump yields a real turn for the attempt to return.
 * The bound counts polls fired, not turns taken, so a loaded machine spends
 * more real time and never more of the window. A `work` that stops scheduling
 * polls without settling is stopped by {@link REAL_CAP_MS}.
 */
async function pastTheWait(work: () => Promise<unknown>): Promise<unknown> {
  const nextTurn = setTimeout;
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  variancePrecondition('clock', 'faked');
  let settled = false;
  const running = work().then(
    () => undefined,
    (error: unknown) => error,
  ).finally(() => {
    settled = true;
  });
  const began = Date.now();
  let fired = 0;
  while (!settled && fired < POLL_BOUND && Date.now() - began < REAL_CAP_MS) {
    if (vi.getTimerCount() > 0) {
      fired += 1;
      await vi.advanceTimersToNextTimerAsync();
    }
    await new Promise<void>((wake) => nextTurn(wake, 0));
  }
  vi.useRealTimers();
  expect(
    settled,
    fired < POLL_BOUND
      ? `the landing did not settle in ${REAL_CAP_MS} ms of real time, after ${fired} of the ${POLL_BOUND} polls it may fire`
      : `the landing was still waiting on a lock after ${fired} polls (${fired * POLL_MS} ms of fake time); ` +
          `a lock gives up once its ${WINDOW_MS} ms window has passed`,
  ).toBe(true);
  return await running;
}

async function landing(): Promise<{ dir: string; record: string; shard: string }> {
  const { dir, first } = await published(home, { publish: false, record: wholeRecord });
  const record = testCoverageFile(dir, { suite: 'unit' });
  // A shard that finished the file the index has cases for, and left none:
  // landed, it would remove the index.
  const shard = join(home, 'shard-1.bin');
  await writeTestCoverage(shard, {
    version: 3,
    instrumentation: 'fixture',
    commit: first,
    tests: [{ file: 'test/total.test.ts', complete: true, preconditions: [] }],
    modules: [],
  });
  return { dir, record, shard };
}

describe('landJourneys when another process holds a lock', () => {
  it('refuses on the snapshot, names its lock, and changes nothing, its cases included', async () => {
    variancePrecondition('lock', 'held');
    const { dir, record, shard } = await landing();
    const snapshot = await readFile(record);
    // The fixture leaves no runs record beside the snapshot. One is written here, so a landing that changed it would show.
    await writeCommitRuns(commitRunsFile(record), { first: '', latest: '', runs: 1, files: ['test/total.test.ts'] });
    const runs = await readFile(commitRunsFile(record));
    const lock = `${record}.lock`;
    // Written a moment ago by somebody else, which is what a live holder in
    // another process looks like from here.
    await writeFile(lock, '1\n');

    const refused = await pastTheWait(() => landJourneys(dir, [shard], record));

    expect(refused).toBeInstanceOf(Error);
    expect((refused as Error).message).toBe(
      `nothing landed at ${record}: another process is holding ${lock}. Land again once that run ends.`,
    );
    expect(refused).toMatchObject({ exitCode: EXIT_OPERATOR });
    expect(await readFile(record)).toEqual(snapshot);
    expect(await readFile(commitRunsFile(record))).toEqual(runs);
    expect((await readdir(dirname(record))).filter((name) => name.endsWith('.tmp'))).toEqual([]);
  }, PUMP_TEST_TIMEOUT_MS);
});
