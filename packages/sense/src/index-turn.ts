/**
 * One source index's heavy work at a time on a machine
 * (`native/src/index_turn.rs`).
 *
 * An update and its follow-ups each use every core, so two checkouts indexing
 * at once starve each other. The second waits for the first, and is told
 * which process holds the turn and for which checkout, so a wait is never
 * silent.
 */

// compass: variance-authority.reach.source-index

import { lstatSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { native, nativeRefusal } from './addon.js';

/** Who holds the turn: the process and the checkout it indexes. */
export interface IndexTurnHolder {
  readonly pid: number;
  readonly root: string;
}

/**
 * The one file every index of this user's takes its turn at. Where the
 * temporary directory is shared between users, as `/tmp` is on Linux, the
 * directory is named for the user's id, so nobody else's directory is used.
 */
export function indexTurnPath(): string {
  const uid = process.getuid?.();
  return join(tmpdir(), uid === undefined ? 'variance-authority' : `variance-authority-${uid}`, 'index-turn');
}

/**
 * Make the turn's directory readable by this user alone, and refuse one this
 * user does not own or that is a link: the lock and the holder are opened by
 * name, so either would let another user decide what they open.
 */
function ownDirectory(directory: string): void {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const stat = lstatSync(directory);
  const uid = process.getuid?.();
  if (stat.isSymbolicLink() || !stat.isDirectory() || (uid !== undefined && stat.uid !== uid)) {
    throw new Error(
      `the index turn's directory ${directory} is not a directory this user owns, so no index will lock or write in it: remove it, or set TMPDIR to a directory of your own`,
    );
  }
}

/**
 * Run `work` for the checkout at `root` in the machine's index turn, waiting
 * for any other process that holds it. `waiting` is told once, with the
 * holder, before the first pause.
 */
export async function inIndexTurn<T>(root: string, work: () => Promise<T>, waiting: (holder: IndexTurnHolder) => void = () => {}): Promise<T> {
  const addon = native();
  if (addon === undefined) throw new Error(`the index turn is taken by the native addon, which did not load: ${nativeRefusal()}`);
  const path = indexTurnPath();
  ownDirectory(dirname(path));
  const holder = JSON.stringify({ pid: process.pid, root } satisfies IndexTurnHolder);
  let told = false;
  for (;;) {
    const turn = addon.takeIndexTurn(path, holder);
    if (turn !== null) {
      try {
        return await work();
      } finally {
        turn.release();
      }
    }
    if (!told) {
      const held = heldBy(path);
      if (held !== undefined && held.pid !== process.pid) {
        waiting(held);
        told = true;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

function heldBy(path: string): IndexTurnHolder | undefined {
  try {
    const held = JSON.parse(readFileSync(`${path}.holder`, 'utf8')) as Partial<IndexTurnHolder>;
    return typeof held.pid === 'number' && typeof held.root === 'string' ? { pid: held.pid, root: held.root } : undefined;
  } catch {
    return undefined;
  }
}
