/**
 * One merge into the coverage index at a time.
 *
 * A recording ends by reading the coverage index, folding one run's subjects
 * into it and writing it back. Two runs doing that at once lose one of the two,
 * so the write is taken under a lock file beside the index. It lives apart from
 * the recorder because nothing about it is the browser's: it is the index's own
 * exclusion, and the next writer to need it should take this one rather than
 * grow a second.
 *
 * The exclusion is not advice. Everything that must run under it asks for an
 * {@link IndexLock}, which only {@link withIndexLock} can produce, so a caller
 * that forgot to take the lock does not compile. Three folds write this index
 * and a fourth will be written one day; none of them gets to decide this for
 * itself.
 */
import { mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import { isMissing } from './instrumented-modules.js';

const lockToken: unique symbol = Symbol('held index lock');

/**
 * Proof that its holder has the index to itself.
 *
 * Constructor-owned: the only way to hold one is to have taken the lock, and
 * the only way to take the lock is {@link withIndexLock}, which also gives it
 * back. A function that must not run unlocked asks for one of these, and the
 * question is then settled by the signature rather than by a comment above the
 * call.
 */
export class IndexLock {
  #held = true;

  /** The index this lock is taken over: the file the lock file sits beside. */
  readonly file: string;

  constructor(token: typeof lockToken, file: string) {
    if (token !== lockToken) {
      throw new Error('IndexLock is constructor-owned: take one with withIndexLock');
    }
    this.file = file;
  }

  /**
   * Whether the exclusion is still in force.
   *
   * A token outlives the call it was passed to — it can be stored on `this`, or
   * closed over by work that finishes later — and a token whose lock was
   * released is a token that proves nothing. Whoever must not run unlocked reads
   * this rather than trusting that having one was enough.
   */
  get held(): boolean {
    return this.#held;
  }

  /** Called by {@link withIndexLock}, which is the only thing that may. */
  release(token: typeof lockToken): void {
    if (token !== lockToken) throw new Error('an IndexLock is released by whoever took it');
    this.#held = false;
  }
}

/** A merge that ran, or the lock that was not free. */
export type Locked<T> = { readonly held: true; readonly value: T } | { readonly held: false };

/**
 * Hold the index for one merge, run it, and let go.
 *
 * `held: false` is the lock being busy, and it is a refusal rather than a
 * failure: the caller records nothing rather than merging over whatever the
 * holder is writing. What that costs is a lost contribution, which is a wider
 * next run — never a wrong one.
 *
 * The directory is made here because the lock is a file in it and the index may
 * not exist yet on a first run.
 */
export async function withIndexLock<T>(
  coverageFile: string,
  merge: (lock: IndexLock) => Promise<T>,
): Promise<Locked<T>> {
  await mkdir(dirname(coverageFile), { recursive: true });
  const lock = await takeIndexLock(coverageFile);
  if (lock === undefined) return { held: false };
  const held = new IndexLock(lockToken, coverageFile);
  try {
    return { held: true, value: await merge(held) };
  } finally {
    // Before the file goes, so nothing can be true of the token that is not true
    // of the exclusion it stands for.
    held.release(lockToken);
    await rm(lock, { force: true });
  }
}

/**
 * What a run that could not take the lock has to say for itself.
 *
 * One sentence, and it names the file, because the two things a reader wants are
 * whether anything was written and what to delete if the holder is a process
 * that no longer exists. A fold with a channel returns it; a reporter has none,
 * so {@link noteABusyIndex} puts it where the run can see it.
 */
export function busyIndex(coverageFile: string): string {
  return (
    `another process is holding ${coverageFile}.lock: nothing was recorded rather ` +
    'than merged over whatever it is writing'
  );
}

/** The same, for a reporter, which returns nothing anyone reads. */
export function noteABusyIndex(coverageFile: string): void {
  console.warn(`variance-authority recorded nothing from this run: ${busyIndex(coverageFile)}.`);
}

/**
 * Hold the index, or give up.
 *
 * `wx` is the exclusion — one creator wins on every filesystem this runs on —
 * and the waiting is bounded because a crashed holder must not make every later
 * run hang. A lock older than {@link LOCK_STALE_MS} is treated as abandoned and
 * broken: the cost of breaking one that was merely slow is a lost contribution,
 * which is a wider next run, and the cost of never breaking it is a suite that
 * stops recording until somebody deletes a file by hand.
 *
 * Private, because a taker that cannot be made to release is half an exclusion.
 */
async function takeIndexLock(coverageFile: string): Promise<string | undefined> {
  const lock = `${coverageFile}.lock`;
  const deadline = LOCK_WAIT_MS / LOCK_POLL_MS;
  for (let attempt = 0; attempt <= deadline; attempt += 1) {
    try {
      await writeFile(lock, `${process.pid}\n`, { flag: 'wx' });
      return lock;
    } catch (error) {
      if (!isTaken(error)) throw error;
      const age = await lockAge(lock);
      if (age !== undefined && age > LOCK_STALE_MS) {
        await rm(lock, { force: true });
        continue;
      }
      await new Promise((wake) => setTimeout(wake, LOCK_POLL_MS));
    }
  }
  return undefined;
}

/**
 * How long a waiter polls before it gives up, and how often. Exported because
 * the window is what the give-up test drives a clock across, and a test that
 * hard-codes ten seconds is a test that stops describing this file the day the
 * number changes.
 */
export const LOCK_WAIT_MS = 10_000;
export const LOCK_POLL_MS = 25;
const LOCK_STALE_MS = 60_000;

async function lockAge(lock: string): Promise<number | undefined> {
  try {
    return Date.now() - (await stat(lock)).mtimeMs;
  } catch (error) {
    if (isMissing(error)) return undefined;
    throw error;
  }
}

function isTaken(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'EEXIST';
}
