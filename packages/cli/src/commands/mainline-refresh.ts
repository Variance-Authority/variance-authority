// compass: variance-authority.reach
/**
 * The fetch of the mainline's record that a workstation reader past the reuse
 * window hands to a process of its own.
 *
 * The process is `variance share --suite <name>`, which always asks the
 * mainline. It holds a lock in the suite's read root while it runs, so a second
 * reader in the meantime starts none, and `mainlineBase` gives the lock back
 * once its fetch is done. A lock whose process is gone is taken over. The
 * process and the lock are `detached.ts`'s, the same `variance index` hands its
 * follow-ups to.
 */

import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { alive, handLock, lockAt, releaseLock, takeLock, type Detach, type ProcessLock } from './detached.js';

/** The lock a process fetching the mainline's record holds in `readRoot`, and the file its output goes to. */
export function mainlineRefreshLock(readRoot: string): { readonly path: string; readonly log: string } {
  return { path: join(readRoot, 'refresh'), log: join(readRoot, 'refresh.log') };
}

/**
 * The process fetching the mainline's record of `suite` into `readRoot`: one
 * already running, or one started now. `undefined` when none could be started
 * or the lock could not be read or taken; the reader then fetches before it
 * answers, and releases the lock only if it names this process.
 */
export function refreshMainline(readRoot: string, suite: string, detach: Detach): ProcessLock | undefined {
  const { path, log } = mainlineRefreshLock(readRoot);
  try {
    mkdirSync(readRoot, { recursive: true });
    if (!takeLock(path, { pid: process.pid, log })) {
      const held = lockAt(path);
      if (held === undefined) return undefined;
      if (alive(held.pid)) return held;
      // Its process is gone, and fetched nothing this one will not.
      releaseLock(path, held.pid);
      if (!takeLock(path, { pid: process.pid, log })) return undefined;
    }
    const pid = detach(['share', '--suite', suite], log);
    if (pid === undefined) return undefined;
    const lock = { pid, log };
    handLock(path, lock);
    return lock;
  } catch {
    return undefined;
  }
}

/** The part of a reader's note that names the process fetching the mainline's record, and where its output goes. */
export function refreshing(lock: ProcessLock): string {
  return `process ${String(lock.pid)} is fetching the mainline's record now, and a command run after it ends reads that record; ` +
    `its output is written to ${lock.log}`;
}
