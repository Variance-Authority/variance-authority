import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { nameModules } from '../module-names.js';
import { IndexLock, LOCK_POLL_MS, LOCK_WAIT_MS, withIndexLock } from './index-lock.js';

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
    // then refuses, and a clock the test drives says that in milliseconds. The
    // filesystem underneath is real, so every attempt is a real `wx` create
    // against a lock file that is really there.
    vi.useFakeTimers();
    try {
      let settled = false;
      const refusing = withIndexLock(file, async () => {
        ran = true;
      }).then((outcome) => {
        settled = true;
        return outcome;
      });

      // One poll at a time, because each attempt is a real filesystem create:
      // a step that covered the whole window at once would reach the end of the
      // fake clock while the first attempt was still in the kernel, and the
      // waiter would be left mid-loop with no timer to wake it. Twice the polls
      // the window holds is slack for the ones that pass before the waiter
      // reaches its loop at all; a waiter still waiting after that never gives
      // up, which is the failure this test is here to catch.
      for (let step = 0; step < (2 * LOCK_WAIT_MS) / LOCK_POLL_MS && !settled; step += 1) {
        await vi.advanceTimersByTimeAsync(LOCK_POLL_MS);
      }
      expect(settled).toBe(true);
      const refused = await refusing;

      expect(refused.held).toBe(false);
      expect(ran).toBe(false);
    } finally {
      vi.useRealTimers();
    }

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
    // index. Numbering with a released one is the one way past the signature,
    // and it is refused rather than silently unlocked.
    expect(kept?.held).toBe(false);
    await expect(
      nameModules(resolve(file, '..', 'names.bin'), ['src/cart.js'], kept as IndexLock),
    ).rejects.toThrow(/was released before/);
  });
});
