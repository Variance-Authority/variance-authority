/**
 * One source index's heavy work at a time in a repository
 * (`native/src/index_turn.rs`).
 *
 * An update and its follow-ups each use every core, so two checkouts of a
 * repository indexing at once starve each other. The second waits for the
 * first, and is told which process holds the turn and for which checkout, so a
 * wait is never silent. The turn buys speed and nothing else: two repositories
 * may index at once, and an index whose turn is refused runs without one. It
 * paces what shares a cache, so a worktree of a bare or `--separate-git-dir`
 * repository, which shares none, waits for nothing.
 */

// compass: variance-authority.reach.source-index

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { native, nativeRefusal, refusalAt } from './addon.js';
import type { NativeScanner } from './native.js';
import { operatorError } from './operator.js';
import { repositoryLayers, workDirectory } from './test-selection/cache-layers.js';

/** Who holds the turn: the process and the checkout it indexes. */
export interface IndexTurnHolder {
  readonly pid: number;
  readonly root: string;
}

/**
 * The one file the checkouts sharing the cache of the repository at `root` take
 * their turn at. It is in the primary checkout's cache, as exposed as the index
 * it paces, and in `.work`, where no carry takes it and no prune reads it.
 */
export function indexTurnPath(root: string): string {
  return join(workDirectory(repositoryLayers(root).base), 'index-turn');
}

/** The turn, `null` while another process holds it, or why the file system refuses it. A panic is thrown on. */
function taken(addon: NativeScanner, path: string, holder: string): { release(): void } | null | string {
  try {
    return addon.takeIndexTurn(path, holder);
  } catch (error) {
    const refused = refusalAt(path, (error as Error).message);
    if (refused === undefined) throw error;
    return refused;
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
  if (addon === undefined) {
    throw operatorError(`the index turn is taken by the native addon, which did not load: ${nativeRefusal()}. Install again without \`--omit=optional\`, or, on a platform no package is published for, build the addon from the checkout with \`cargo\`.`);
  }
  const path = indexTurnPath(root);
  const holder = JSON.stringify({ pid: process.pid, root } satisfies IndexTurnHolder);
  let told = false;
  for (;;) {
    const turn = taken(addon, path, holder);
    if (typeof turn === 'string') {
      alone(path, turn);
      return work();
    }
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
