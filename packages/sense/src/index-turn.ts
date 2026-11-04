/**
 * One source index's heavy work at a time in a repository
 * (`native/src/index_turn.rs`).
 *
 * An update and its follow-ups each use every core, so two checkouts of a
 * repository indexing at once starve each other. The second waits for the
 * first, and is told which process holds the turn and for which checkout, so a
 * wait is never silent. The turn buys speed and nothing else: two repositories
 * may index at once, and an index whose turn is refused runs without one.
 */

// compass: variance-authority.reach.source-index

import { closeSync, mkdirSync, openSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { native, nativeRefusal } from './addon.js';
import { repositoryLayers } from './test-selection/cache-layers.js';

/** Who holds the turn: the process and the checkout it indexes. */
export interface IndexTurnHolder {
  readonly pid: number;
  readonly root: string;
}

/**
 * The one file every checkout of the repository at `root` takes its turn at. It
 * sits in the repository's cache, as exposed as the index it paces, and beside
 * the worktrees' layers, where no carry takes it and no prune reads it.
 */
export function indexTurnPath(root: string): string {
  return join(repositoryLayers(root).base, '.work', 'index-turn');
}

/** Why the file system refuses the turn's file at `path`, or undefined when it is there to lock. */
function refusal(path: string): string | undefined {
  try {
    mkdirSync(dirname(path), { recursive: true });
    closeSync(openSync(path, 'a'));
    return undefined;
  } catch (error) {
    return String((error as NodeJS.ErrnoException).code);
  }
}

/**
 * Run `work` for the checkout at `root` in its repository's index turn, waiting
 * for any other process that holds it. `waiting` is told once, with the
 * holder, before the first pause. `alone` is told when the file system refuses
 * the turn, as a sandbox holding a worktree away from its primary's cache does,
 * and `work` runs without it.
 */
export async function inIndexTurn<T>(
  root: string,
  work: () => Promise<T>,
  waiting: (holder: IndexTurnHolder) => void = () => {},
  alone: (path: string, reason: string) => void = () => {},
): Promise<T> {
  const addon = native();
  if (addon === undefined) throw new Error(`the index turn is taken by the native addon, which did not load: ${nativeRefusal()}`);
  const path = indexTurnPath(root);
  const refused = refusal(path);
  if (refused !== undefined) {
    alone(path, refused);
    return work();
  }
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
