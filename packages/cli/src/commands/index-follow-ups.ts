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
 * holds a lock beside the index; a command that reads any of the four waits on
 * that lock before it reads, so an answer is never made from a map older than
 * the index it prints.
 *
 * The process first brings the index up to date and readies it — folds its
 * working layer into its base. Each of those publishes and then removes the
 * segments it replaced, so a reader that opened the index before either can find
 * them gone. Once both are done it marks the lock `readied`; nothing after that
 * writes the index. A command that reads the index and none of the four — the list
 * beside `settleFollowUps` — waits for that mark and no longer.
 *
 * A lock whose process is gone — killed, or the machine slept through it — is
 * not trusted and not waited on: the next command that reads the follow-ups
 * makes them itself, and says so. A gone process folds nothing, so a reader of
 * the index alone reads it as it stands and leaves the lock to that command.
 */

// compass: variance-authority.reach.source-index

import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { sourceIndexPath } from '@variance-authority/sense';
import type { Parsed } from '../parse.js';

/** The lock, as written beside the index. */
export interface FollowUpsLock {
  readonly pid: number;
  /** Where the process writes the lines `index` would have printed. */
  readonly log: string;
  /** The index is readied, and only the code map, the journeys, the lexicon and the questions are left. */
  readonly readied?: true;
}

/** Relaunch this program with `argv`, its output written to `log`; the process id. */
export type Detach = (argv: readonly string[], log: string) => number | undefined;

export const followUpsLockPath = (index: string): string => `${index}.follow-ups`;
export const followUpsLogPath = (index: string): string => `${index}.follow-ups.log`;

/** Hand the lock to `lock.pid` in one rename, so no reader ever finds it absent or half written. */
export function holdFollowUps(index: string, lock: FollowUpsLock): void {
  const written = `${followUpsLockPath(index)}.${process.pid}.tmp`;
  writeFileSync(written, `${JSON.stringify(lock)}\n`);
  renameSync(written, followUpsLockPath(index));
}

/**
 * Take the lock for this process before the index is written, waiting out any
 * process that holds it: two `index` runs in one checkout would otherwise each
 * start a process, and the second would write over the first one's lock while
 * the first was still making what it names. False when the lock cannot be
 * written at all: the index beside it cannot be either, and writing it says why.
 */
export async function reserveFollowUps(index: string, log: string, waiting: (lock: FollowUpsLock) => void): Promise<boolean> {
  for (;;) {
    try {
      mkdirSync(dirname(index), { recursive: true });
      writeFileSync(followUpsLockPath(index), `${JSON.stringify({ pid: process.pid, log })}\n`, { flag: 'wx' });
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') return false;
    }
    const waited = await awaitFollowUps(index, waiting);
    // A holder that is gone left nothing this run is not about to make.
    if (waited.held && !waited.finished) releaseFollowUps(index, waited.lock.pid);
  }
}

/** Mark the lock `readied` when it is still the one `pid` holds; a lock not yet handed to `pid` stays unmarked, and its readers wait for its release. */
export function readiedFollowUps(index: string, pid: number): void {
  const held = heldBy(index);
  if (held?.pid === pid) holdFollowUps(index, { ...held, readied: true });
}

/** Drop the lock when it is still the one `pid` holds. */
export function releaseFollowUps(index: string, pid: number): void {
  if (heldBy(index)?.pid === pid) rmSync(followUpsLockPath(index), { force: true });
}

export function heldBy(index: string): FollowUpsLock | undefined {
  try {
    const held = JSON.parse(readFileSync(followUpsLockPath(index), 'utf8')) as Partial<FollowUpsLock>;
    if (typeof held.pid !== 'number' || typeof held.log !== 'string') return undefined;
    return { pid: held.pid, log: held.log, ...(held.readied === true ? { readied: true } : {}) };
  } catch {
    return undefined;
  }
}

/** What waiting found: nothing held, a process that finished what was waited for, or one that is gone. */
export type Waited =
  | { readonly held: false }
  | { readonly held: true; readonly lock: FollowUpsLock; readonly finished: boolean };

/** What a command waits for: the lock let go, or, for a reader of the index alone, the index readied. */
export type Until = 'released' | 'readied';

/**
 * Wait until no live process holds the follow-ups of the index at `index`, or,
 * `until` `readied`, until the live process holding them has readied the index.
 * `waiting` is told once, before the first pause.
 */
export async function awaitFollowUps(index: string, waiting: (lock: FollowUpsLock) => void, until: Until = 'released'): Promise<Waited> {
  let waited: FollowUpsLock | undefined;
  for (;;) {
    const lock = heldBy(index);
    if (lock === undefined) return waited === undefined ? { held: false } : { held: true, lock: waited, finished: true };
    if (!alive(lock.pid)) return { held: true, lock, finished: false };
    if (until === 'readied' && lock.readied === true) return { held: true, lock, finished: true };
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

/**
 * The commands that read the source index and the records, and none of the
 * code map, the journeys, the dependency lexicon or the questions. Each waits
 * only while the index may still be folded. Declared, not inferred: a command
 * joins once a run of it is shown to open none of the four.
 */
const READS_THE_INDEX_ALONE: ReadonlySet<Parsed['command']> = new Set(['select']);

/**
 * Wait for the follow-ups a detached `index` is making, before any command reads
 * them; the process making them is the one command that does not wait. A process
 * that is gone left them unmade, so they are made here, on stderr, before the
 * command runs — unless the command is `index`, which is about to make them anyway.
 * A command that reads the index alone waits for the fold and no further, and
 * leaves the follow-ups of a gone process to the next command that reads them.
 */
export async function settleFollowUps(parsed: Parsed, streams: { err(text: string): void }): Promise<void> {
  if (parsed.command === 'index' && parsed.followUps === true) return;
  const indexing = parsed.command === 'index';
  const cwd = process.cwd();
  const index = sourceIndexPath(cwd);
  if (READS_THE_INDEX_ALONE.has(parsed.command)) {
    await awaitFollowUps(index, (lock) => streams.err(foldingLine(lock)), 'readied');
    return;
  }
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

function foldingLine({ pid, log }: { pid: number; log: string }): string {
  return `waiting for process ${pid} to fold the source index \`variance index\` left to it; its lines are in ${log}\n`;
}
