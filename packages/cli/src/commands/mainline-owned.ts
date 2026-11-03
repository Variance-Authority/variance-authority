// compass: variance-authority.reach
/**
 * What a selection over a record behind the merge base leaves to the mainline.
 * The mainline and its merge base come from the share the root config names,
 * and the checkout's own change from git, from that base. A test the record
 * charges runs only when `file` precision over that change selects it too, so
 * the answer never runs more than that precision would.
 */

import type { ExecutionNarrowing, TestDistance } from '@variance-authority/sense/test-selection';
import { ConfigError } from '../config-values.js';
import { distanceFrom, readerMainline } from '../share-lines.js';
import { rootShare } from './mainline-base.js';
import { changedFrom, commitPoint } from './since.js';

/** A record behind the checkout's merge base with its mainline `name`: that `base`, and what the checkout `changed` from it. */
export interface Behind {
  readonly name: string;
  readonly base: string;
  readonly changed: readonly string[];
}

/**
 * Whether the record at `commit` is behind the merge base of the checkout at
 * the top level `root`, and what the checkout changed from that base.
 * `undefined` when the checkout names no mainline, git cannot list what
 * changed from the base, `commit` is not before it, or the checkout is the
 * mainline's own tip with nothing changed: that run answers for the base.
 */
export async function behindOf(root: string, commit: string): Promise<Behind | undefined> {
  const selection = await import('@variance-authority/sense/test-selection');
  let share: ReturnType<typeof rootShare>;
  try {
    share = rootShare(selection.rootConfig(root));
  } catch (error) {
    if (error instanceof ConfigError) return undefined;
    throw error;
  }
  if (share === undefined) return undefined;
  const mainline = await readerMainline({ share }, process.env, root);
  if ('missing' in mainline || mainline.base === undefined) return undefined;
  const { name, base } = mainline;
  const changed = await changedFrom(base, root);
  if (changed === undefined) return undefined;
  if (changed.length === 0 && (await commitPoint('HEAD', [], root))?.base === base) return undefined;
  if (((await distanceFrom({ share }, name, commit, root, base)) ?? 0) <= 0) return undefined;
  return { name, base, changed };
}

/** What {@link leftToMainline} kept of a narrowing, and the note that says what it left. */
export interface Owned {
  readonly narrowing: ExecutionNarrowing;
  readonly distances: readonly TestDistance[] | undefined;
  readonly note: string;
}

/**
 * `charged`, read from the record at `commit`, without the tests `file`
 * precision over the checkout's change from the merge base does not select:
 * those only the mainline's commits since `commit` reach. `undefined` when it
 * leaves none.
 */
export function leftToMainline(
  charged: { readonly narrowing: ExecutionNarrowing; readonly distances?: readonly TestDistance[] | undefined },
  selected: readonly string[],
  behind: Behind,
  commit: string,
): Owned | undefined {
  const mine = new Set(selected);
  const left = new Set(charged.narrowing.entered.filter((test) => !mine.has(test)));
  if (left.size === 0) return undefined;
  const { narrowing } = charged;
  return {
    narrowing: {
      ...narrowing,
      entered: narrowing.entered.filter((test) => !left.has(test)),
      because: (narrowing.because ?? []).filter((cause) => !left.has(cause.test)),
    },
    distances: charged.distances?.filter((distance) => !left.has(distance.test)),
    note:
      `${left.size} test file(s) left to mainline ${behind.name}: only its commits between the record's commit ` +
      `${commit.slice(0, 12)} and the merge base ${behind.base.slice(0, 12)} reach them, and nothing this checkout changed from that base does`,
  };
}
