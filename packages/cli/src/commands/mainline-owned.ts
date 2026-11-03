// compass: variance-authority.reach
/**
 * What a selection over a record behind the merge base leaves to the mainline.
 * The mainline and its merge base come from the fetch that read its record,
 * and the checkout's own change from git, from that base. A test the record
 * charges runs only when `file` precision over that change selects it too, and
 * its hops are counted from that change: a nearer edit only the mainline made
 * places no test. The answer runs no more than that precision would, save when
 * the change deletes a path: then every file whose imports the scan could not
 * all resolve counts as changed too ({@link reachedFrom}).
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { NODE_KINDS, type Relations } from '@variance-authority/core/relate';
import type { ExecutionNarrowing, TestDistance } from '@variance-authority/sense/test-selection';
import type { SelectSource } from './select.js';
import { changedFrom } from './since.js';
import { headOf } from './suite-share.js';

/** A record behind the checkout's merge base with its mainline `name`: that `base`, and what the checkout `changed` from it. */
export interface Behind {
  readonly name: string;
  readonly base: string;
  readonly changed: readonly string[];
}

/**
 * Whether the record read, as `source` says, is the mainline's and behind the
 * merge base of the checkout at the top level `root`, and what the checkout
 * changed from that base. `undefined` for any other record, when git cannot
 * list what changed from the base, or when the checkout is at the base with
 * nothing changed: that run answers for the base.
 */
export async function behindOf(root: string, source: SelectSource | undefined): Promise<Behind | undefined> {
  if (source?.from !== 'mainline' || source.mainline === undefined || source.base === undefined) return undefined;
  if ((source.distance ?? 0) <= 0) return undefined;
  const { mainline: name, base } = source;
  const changed = await changedFrom(base, root);
  if (changed === undefined) return undefined;
  if (changed.length === 0 && (await headOf(root)) === base) return undefined;
  return { name, base, changed };
}

const FILE = NODE_KINDS.indexOf('file');

/**
 * What the checkout's change from the merge base reaches, as `file` precision
 * reads it: the files it `changed`, and when one of them is gone from the
 * checkout at `root`, every file in `relations` whose imports the scan could
 * not all read. A deleted path is in no graph at the checkout, and a file that
 * still imports it holds an import that resolves to nothing, though the record
 * may never have seen that import: the mainline can add it after the record.
 */
export function reachedFrom(root: string, changed: readonly string[], relations: Relations): readonly string[] {
  if (changed.every((file) => existsSync(join(root, file)))) return changed;
  const holes = relations.names.filter((_, id) => relations.unknown[id] === 1 && relations.kinds[id] === FILE);
  return [...new Set([...changed, ...holes])];
}

/** What {@link leftToMainline} kept of a narrowing, and the note that says what it left, when it left any. */
export interface Owned {
  readonly narrowing: ExecutionNarrowing;
  readonly distances: readonly TestDistance[] | undefined;
  readonly note: string | undefined;
}

/** A narrowing and the distances measured with it. */
interface Read {
  readonly narrowing: ExecutionNarrowing;
  readonly distances?: readonly TestDistance[] | undefined;
}

/**
 * `charged`, read from the record at `commit`, without the tests `file`
 * precision over the checkout's change from the merge base, read as `mine`,
 * does not select: those only the mainline's commits since `commit` reach.
 * Each test kept stands at its distance in `mine`, from that change alone.
 */
export function leftToMainline(charged: Read, mine: Read, behind: Behind, commit: string): Owned {
  const selected = new Set(mine.narrowing.entered);
  const left = new Set(charged.narrowing.entered.filter((test) => !selected.has(test)));
  const { narrowing } = charged;
  const entered = narrowing.entered.filter((test) => !left.has(test));
  const kept = new Set(entered);
  return {
    narrowing: { ...narrowing, entered, because: (narrowing.because ?? []).filter((cause) => !left.has(cause.test)) },
    distances: mine.distances?.filter((distance) => kept.has(distance.test)),
    note: left.size === 0
      ? undefined
      : `${left.size} test file(s) left to mainline ${behind.name}: only its commits between the record's commit ` +
        `${commit.slice(0, 12)} and the merge base ${behind.base.slice(0, 12)} reach them, and nothing this checkout changed from that base does`,
  };
}
