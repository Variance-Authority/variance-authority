/**
 * What `variance index` leaves running after it returns, and how every later
 * command waits for it.
 *
 * The source index is the one artifact `index` has to finish before the shell
 * gets its prompt back: every reader reads it, and it costs the diff. The code
 * map, the journeys, the dependency lexicon and the published questions are read
 * from it and are read only when somebody asks, which is seconds later at the
 * earliest. So a workstation's `index` writes the index, hands those four to a
 * detached process, and says which process and where its lines go. The process
 * holds a lock beside the index; every command waits on that lock before it
 * reads, so an answer is never made from a map older than the index it prints.
 *
 * A lock whose process is gone — killed, or the machine slept through it — is
 * not trusted and not waited on: the next command makes the follow-ups itself,
 * and says so.
 */

// compass: variance-authority.reach.source-index

import { readFileSync, rmSync, writeFileSync } from 'node:fs';

/** The lock, as written beside the index. */
export interface FollowUpsLock {
  readonly pid: number;
  /** Where the process writes the lines `index` would have printed. */
  readonly log: string;
}

/** Relaunch this program with `argv`, its output written to `log`; the process id. */
export type Detach = (argv: readonly string[], log: string) => number | undefined;

export const followUpsLockPath = (index: string): string => `${index}.follow-ups`;
export const followUpsLogPath = (index: string): string => `${index}.follow-ups.log`;

export function holdFollowUps(index: string, lock: FollowUpsLock): void {
  writeFileSync(followUpsLockPath(index), `${JSON.stringify(lock)}\n`);
}

/** Drop the lock when it is still the one `pid` holds. */
export function releaseFollowUps(index: string, pid: number): void {
  if (heldBy(index)?.pid === pid) rmSync(followUpsLockPath(index), { force: true });
}

export function heldBy(index: string): FollowUpsLock | undefined {
  try {
    const held = JSON.parse(readFileSync(followUpsLockPath(index), 'utf8')) as Partial<FollowUpsLock>;
    return typeof held.pid === 'number' && typeof held.log === 'string' ? { pid: held.pid, log: held.log } : undefined;
  } catch {
    return undefined;
  }
}

/** What waiting found: nothing held, a process that finished, or one that is gone. */
export type Waited =
  | { readonly held: false }
  | { readonly held: true; readonly lock: FollowUpsLock; readonly finished: boolean };

/**
 * Wait until no live process holds the follow-ups of the index at `index`.
 * `waiting` is told once, before the first pause.
 */
export async function awaitFollowUps(index: string, waiting: (lock: FollowUpsLock) => void): Promise<Waited> {
  let waited: FollowUpsLock | undefined;
  for (;;) {
    const lock = heldBy(index);
    if (lock === undefined) return waited === undefined ? { held: false } : { held: true, lock: waited, finished: true };
    if (!alive(lock.pid)) return { held: true, lock, finished: false };
    if (waited === undefined) waiting(lock);
    waited = lock;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // Somebody else's process under a reused id is still a process.
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}
