/**
 * Writers that contend for one index lock, let in one at a time.
 *
 * Real contention leaves the handover to scheduling: a waiter whose attempt
 * failed sometimes looks at the lock's age just after the holder let go, and
 * finds it gone. A case that enters that branch on some runs and not on others
 * reads as motion on every review. Here every writer finds the lock held and
 * waits for its next poll before any of them is let in, and the polls fall due
 * at distinct moments and are fired one at a time, each only once the writer
 * before it has finished. So every writer takes the same path on every run:
 * refused once, the lock's age read, one poll, then in.
 */
import { expect, vi } from 'vitest';
import { withIndexLock } from '../index-lock.js';
import { variancePrecondition } from '../precondition.js';

/**
 * The real time a pump waits for work that neither settles nor schedules a
 * poll: generous, because a loaded machine is slow and nothing here should fail
 * for that, and below {@link TURNS_TEST_TIMEOUT_MS}, so a hang fails with the
 * pump's sentence rather than vitest's.
 */
export const REAL_CAP_MS = 30_000;

/** The timeout of a case that waits on {@link REAL_CAP_MS}: room for every wait it caps. */
export const TURNS_TEST_TIMEOUT_MS = 3 * REAL_CAP_MS;

/**
 * Yield real turns until `count` polls are pending on the faked clock, which is
 * where a waiter is once it has found the lock taken and read its age.
 * `nextTurn` is the real `setTimeout`, taken before the timers were faked.
 */
export async function untilPolling(count: number, nextTurn: typeof setTimeout): Promise<void> {
  const began = Date.now();
  while (vi.getTimerCount() < count && Date.now() - began < REAL_CAP_MS) {
    await new Promise<void>((wake) => nextTurn(wake, 0));
  }
  expect(
    vi.getTimerCount(),
    `${String(count)} writers should be waiting on the lock within ${String(REAL_CAP_MS)} ms of real time`,
  ).toBe(count);
}

/** Run `writers` against the index lock over `file`, one after another, each having waited once. */
export async function inTurn<T>(file: string, writers: readonly (() => Promise<T>)[]): Promise<T[]> {
  let entered!: () => void;
  let release!: () => void;
  const holding = new Promise<void>((done) => (entered = done));
  const held = withIndexLock(file, async () => {
    entered();
    await new Promise<void>((done) => (release = done));
  });
  await holding;

  const nextTurn = setTimeout;
  const stopTurn = clearTimeout;
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  variancePrecondition('fixture', { clock: 'faked' });
  try {
    const pending = new Map<number, Promise<T>>();
    const results: Promise<T>[] = [];
    for (const [index, write] of writers.entries()) {
      const running = write();
      pending.set(index, running.finally(() => pending.delete(index)));
      results.push(running);
      // Vitest fires every timer due at the moment it advances to, so each
      // writer's poll falls due a millisecond after the one before it, and
      // advancing to the next timer lets in one writer alone.
      await untilPolling(index + 1, nextTurn);
      vi.advanceTimersByTime(1);
    }
    release();
    await held;
    const began = Date.now();
    while (pending.size > 0 && Date.now() - began < REAL_CAP_MS) {
      await vi.advanceTimersToNextTimerAsync();
      let cap: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([...pending.values(), new Promise<void>((wake) => (cap = nextTurn(wake, REAL_CAP_MS)))]).finally(
        () => stopTurn(cap),
      );
    }
    expect(
      [...pending.keys()],
      `every writer should be through the lock within ${String(REAL_CAP_MS)} ms of real time`,
    ).toEqual([]);
    return await Promise.all(results);
  } finally {
    vi.useRealTimers();
  }
}
