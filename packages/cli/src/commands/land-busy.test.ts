import { mkdtemp, readdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { testCoverageFile, writeTestCoverage } from '@variance-authority/sense/test-selection';
import { EXIT_OPERATOR } from '../exit.js';
import { landJourneys } from './land.js';
import { published, wholeRecord } from './mainline-fixture.js';

/**
 * A landing that cannot take a lock changes nothing and stops with an operator
 * error naming the lock, whichever of the two locks is held: the snapshot's, or
 * the case index's, which the landing takes inside the snapshot's.
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
 * The polls `pastTheWait` fires before it calls a waiter one that never gives
 * up: four times the window's, `4 * LOCK_WAIT_MS / LOCK_POLL_MS` in the sense
 * package's `index-lock.ts`, whose own test bounds its copy of this helper the
 * same way. Written out, because the package does not export those constants
 * and a test is no reason to.
 */
const POLL_BOUND = 1600;
const POLL_MS = 25;

/**
 * Settle `work` across the lock's whole waiting window in milliseconds.
 *
 * The waiter polls with `setTimeout`, so only the timers are faked: `Date` stays
 * real and a lock written a moment ago never reads as stale. Every attempt is a
 * real `wx` create, so the clock jumps to the next poll only when one is
 * pending, and otherwise the pump yields a real turn for the attempt to return.
 * The bound counts polls fired, not turns taken, so a loaded machine spends
 * more real time and never more of the window.
 */
async function pastTheWait(work: () => Promise<unknown>): Promise<unknown> {
  const nextTurn = setTimeout;
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  let settled = false;
  const running = work().then(
    () => undefined,
    (error: unknown) => error,
  ).finally(() => {
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
  vi.useRealTimers();
  expect(
    settled,
    `the landing was still waiting on a lock after ${fired} polls (${fired * POLL_MS} ms of fake time); ` +
      'a lock gives up once its 10000 ms window has passed',
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
  it.each([
    ['the snapshot', (record: string) => record],
    ['the case index', (record: string) => `${record}.cases.bin`],
  ])('refuses on %s, names its lock, and changes nothing', async (_, locked) => {
    const { dir, record, shard } = await landing();
    const snapshot = await readFile(record);
    const cases = await readFile(`${record}.cases.bin`);
    const lock = `${locked(record)}.lock`;
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
    expect(await readFile(`${record}.cases.bin`)).toEqual(cases);
    expect((await readdir(dirname(record))).filter((name) => name.endsWith('.tmp'))).toEqual([]);
  });
});
