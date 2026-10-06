/**
 * Work a workstation command hands to a process of its own, and the lock that
 * says which process has it.
 *
 * Only the program can start that process, because only it knows what to run:
 * `bin.ts` passes a {@link Detach} outside CI, and a command called without one
 * does the work before it returns. The lock is one file, written whole: taken
 * with an exclusive create, handed to the process it names in one rename, and
 * given back only by the process it names. A lock whose process is gone is not
 * trusted, so the next command takes it over.
 *
 * `variance index` hands the follow-ups of the source index over this way
 * (`index-follow-ups.ts`), and a reader past the mainline's reuse window hands
 * over the fetch of the mainline's record (`mainline-base.ts`).
 */

// compass: variance-authority.reach

import { readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';

/** Relaunch this program with `argv`, its output written to `log`; the process id. */
export type Detach = (argv: readonly string[], log: string) => number | undefined;

/** A lock, as written at its path. */
export interface ProcessLock {
  readonly pid: number;
  /** Where the process writes its output. */
  readonly log: string;
}

/** Write `lock` at `path` when no lock is there; false when one is. Anything else that stops the write is thrown. */
export function takeLock(path: string, lock: ProcessLock): boolean {
  try {
    writeFileSync(path, `${JSON.stringify(lock)}\n`, { flag: 'wx' });
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false;
    throw error;
  }
}

/** Hand the lock at `path` to `lock.pid` in one rename, so no reader ever finds it absent or half written. */
export function handLock(path: string, lock: ProcessLock): void {
  const written = `${path}.${process.pid}.tmp`;
  writeFileSync(written, `${JSON.stringify(lock)}\n`);
  renameSync(written, path);
}

/** Drop the lock at `path` when it is still the one `pid` holds. */
export function releaseLock(path: string, pid: number): void {
  if (lockAt(path)?.pid === pid) rmSync(path, { force: true });
}

/** The lock at `path`, or `undefined` when there is none that reads. */
export function lockAt(path: string): ProcessLock | undefined {
  try {
    const held = JSON.parse(readFileSync(path, 'utf8')) as Partial<ProcessLock>;
    return typeof held.pid === 'number' && typeof held.log === 'string' ? { pid: held.pid, log: held.log } : undefined;
  } catch {
    return undefined;
  }
}

/** Whether a process with this id is running. */
export function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // Somebody else's process under a reused id is still a process.
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}
