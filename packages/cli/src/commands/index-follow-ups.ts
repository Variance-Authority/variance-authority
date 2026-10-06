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
 * and says so. The process and its lock are `detached.ts`'s.
 */

// compass: variance-authority.reach.source-index

import { mkdirSync, rmSync } from 'node:fs';
import { dirname } from 'node:path';
import { sourceIndexPath } from '@variance-authority/sense';
import type { Parsed } from '../parse.js';
import { alive, handLock, lockAt, releaseLock, takeLock, type ProcessLock } from './detached.js';

export const followUpsLockPath = (index: string): string => `${index}.follow-ups`;
export const followUpsLogPath = (index: string): string => `${index}.follow-ups.log`;

/** Hand the lock to `lock.pid` in one rename, so no reader ever finds it absent or half written. */
export function holdFollowUps(index: string, lock: ProcessLock): void {
  handLock(followUpsLockPath(index), lock);
}

/**
 * Take the lock for this process before the index is written, waiting out any
 * process that holds it: two `index` runs in one checkout would otherwise each
 * start a process, and the second would write over the first one's lock while
 * the first was still making what it names. False when the lock cannot be
 * written at all: the index beside it cannot be either, and writing it says why.
 */
export async function reserveFollowUps(index: string, log: string, waiting: (lock: ProcessLock) => void): Promise<boolean> {
  for (;;) {
    try {
      mkdirSync(dirname(index), { recursive: true });
      if (takeLock(followUpsLockPath(index), { pid: process.pid, log })) return true;
    } catch {
      return false;
    }
    const waited = await awaitFollowUps(index, waiting);
    // A holder that is gone left nothing this run is not about to make.
    if (waited.held && !waited.finished) releaseFollowUps(index, waited.lock.pid);
  }
}

/** Drop the lock when it is still the one `pid` holds. */
export function releaseFollowUps(index: string, pid: number): void {
  releaseLock(followUpsLockPath(index), pid);
}

export function heldBy(index: string): ProcessLock | undefined {
  return lockAt(followUpsLockPath(index));
}

/** What waiting found: nothing held, a process that finished, or one that is gone. */
export type Waited =
  | { readonly held: false }
  | { readonly held: true; readonly lock: ProcessLock; readonly finished: boolean };

/**
 * Wait until no live process holds the follow-ups of the index at `index`.
 * `waiting` is told once, before the first pause.
 */
export async function awaitFollowUps(index: string, waiting: (lock: ProcessLock) => void): Promise<Waited> {
  let waited: ProcessLock | undefined;
  for (;;) {
    const lock = heldBy(index);
    if (lock === undefined) return waited === undefined ? { held: false } : { held: true, lock: waited, finished: true };
    if (!alive(lock.pid)) return { held: true, lock, finished: false };
    if (waited === undefined) waiting(lock);
    waited = lock;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

/**
 * Wait for the follow-ups a detached `index` is making, before any command reads
 * them; the process making them is the one command that does not wait. A process
 * that is gone left them unmade, so they are made here, on stderr, before the
 * command runs — unless the command is `index`, which is about to make them anyway.
 */
export async function settleFollowUps(parsed: Parsed, streams: { err(text: string): void }): Promise<void> {
  if (parsed.command === 'index' && parsed.followUps === true) return;
  const indexing = parsed.command === 'index';
  const cwd = process.cwd();
  const index = sourceIndexPath(cwd);
  const waited = await awaitFollowUps(index, (lock) => streams.err(waitingLine(lock)));
  if (!waited.held || waited.finished) return;
  rmSync(followUpsLockPath(index), { force: true });
  if (indexing) return;
  const { pid, log } = waited.lock;
  streams.err(`process ${pid} ended before it finished what \`variance index\` left to it, so it is made now; what it wrote is in ${log}\n`);
  const { indexOutput } = await import('./index-command.js');
  streams.err(await indexOutput({ cwd, waiting: (text) => streams.err(text) }));
}

/** What a command says while it waits on the process making the follow-ups. */
export function waitingLine({ pid, log }: { pid: number; log: string }): string {
  return `waiting for process ${pid} to finish the code map, the journeys, the dependency lexicon and the questions \`variance index\` left to it; its lines are in ${log}\n`;
}
