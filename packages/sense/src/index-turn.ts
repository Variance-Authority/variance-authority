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

import { mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { native, nativeRefusal } from './addon.js';

/** Who holds the turn: the process and the checkout it indexes. */
export interface IndexTurnHolder {
  readonly pid: number;
  readonly root: string;
}

/** The one file every index on this machine takes its turn at, in the user's temporary directory. */
export function indexTurnPath(): string {
  return join(tmpdir(), 'variance-authority', 'index-turn');
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
  mkdirSync(join(path, '..'), { recursive: true });
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
