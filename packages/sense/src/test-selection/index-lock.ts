/**
 * One merge into the coverage index at a time.
 *
 * A recording ends by reading the coverage index, folding one run's subjects
 * into it and writing it back. Two runs doing that at once lose one of the two,
 * so the write is taken under a lock file beside the index. It lives apart from
 * the recorder because nothing about it is the browser's: it is the index's own
 * exclusion, and the next writer to need it should take this one rather than
 * grow a second.
 */
import { rm, stat, writeFile } from 'node:fs/promises';

import { isMissing } from './instrumented-modules.js';

/**
 * Hold the index for one merge, or give up.
 *
 * `wx` is the exclusion — one creator wins on every filesystem this runs on —
 * and the waiting is bounded because a crashed holder must not make every later
 * run hang. A lock older than {@link LOCK_STALE_MS} is treated as abandoned and
 * broken: the cost of breaking one that was merely slow is a lost contribution,
 * which is a wider next run, and the cost of never breaking it is a suite that
 * stops recording until somebody deletes a file by hand.
 */
export async function takeIndexLock(coverageFile: string): Promise<string | undefined> {
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

const LOCK_WAIT_MS = 10_000;
const LOCK_POLL_MS = 25;
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
