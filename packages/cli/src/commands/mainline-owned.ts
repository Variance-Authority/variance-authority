// compass: variance-authority.reach
/**
 * What a selection over a record behind the merge base leaves to the mainline.
 * The mainline and its merge base come from the share the root config names,
 * the checkout's change from git and from the install compared at that base,
 * and `leftToMainline` decides which tests only the mainline's commits reach.
 */

import type { Relations } from '@variance-authority/core/relate';
import type { ExecutionNarrowing, TestDistance } from '@variance-authority/sense/test-selection';
import { ConfigError } from '../config-values.js';
import { distanceFrom, readerMainline } from '../share-lines.js';
import { installDiffs } from './installed.js';
import { rootShare } from './mainline-base.js';
import { beyondOf } from './select-beyond.js';
import { changedFrom, commitPoint } from './since.js';

/** What {@link mainlineOwned} left of a narrowing, and the note that says what it left to the mainline. */
export interface Owned<Distance extends TestDistance> {
  readonly narrowing: ExecutionNarrowing;
  readonly distances: readonly Distance[] | undefined;
  readonly note?: string;
}

/**
 * `narrowing`, read from the record at `commit` in the checkout at the top
 * level `root`, without the tests only the mainline's commits since `commit`
 * reach. Nothing is left out when the checkout names no mainline or is at its
 * merge base with it, git cannot list what changed from that base, the install
 * there cannot be compared, or `commit` is not before that base.
 */
export async function mainlineOwned<Distance extends TestDistance>(
  root: string,
  commit: string,
  narrowing: ExecutionNarrowing,
  distances: readonly Distance[] | undefined,
  relations: Relations,
): Promise<Owned<Distance>> {
  const unchanged = { narrowing, distances };
  const selection = await import('@variance-authority/sense/test-selection');
  let share: ReturnType<typeof rootShare>;
  try {
    share = rootShare(selection.rootConfig(root));
  } catch (error) {
    if (error instanceof ConfigError) return unchanged;
    throw error;
  }
  if (share === undefined) return unchanged;
  const mainline = await readerMainline({ share }, process.env, root);
  if ('missing' in mainline || mainline.base === undefined) return unchanged;
  const { name, base } = mainline;
  // At the mainline's own tip this run is the one that answers for the base.
  if ((await commitPoint('HEAD', [], root))?.base === base) return unchanged;
  if (((await distanceFrom({ share }, name, commit, root, base)) ?? 0) <= 0) return unchanged;

  const changed = await changedFrom(base, root);
  if (changed === undefined) return unchanged;
  // A bump the checkout made from the base moves the files that import what it bumped.
  const [installed] = await installDiffs([{ point: await commitPoint(base, [], root), changed }], root);
  if (installed !== undefined && 'whole' in installed) return unchanged;
  const left = selection.leftToMainline(narrowing, distances, new Set([...changed, ...beyondOf(relations, installed).files]), relations);
  if (left === undefined) return unchanged;
  return {
    narrowing: left.narrowing,
    distances: left.distances,
    note:
      `${left.left} test file(s) left to mainline ${name}: only its commits between the record's commit ` +
      `${commit.slice(0, 12)} and the merge base ${base.slice(0, 12)} reach them, and nothing this checkout changed from that base does`,
  };
}
