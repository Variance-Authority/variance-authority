// compass: variance-authority.reach.source-index

import { native } from './native.js';

/**
 * Fold the working layer of the index at `index` into its base, once it has
 * grown past a share of it (`native/src/ready_index.rs`): what `variance index`
 * leaves to its follow-ups, so an update rewrites only what changed since.
 * `false` when nothing was folded, and when no addon loaded to fold it.
 */
export async function readySourceIndex(index: string): Promise<boolean> {
  const ready = (native() as { readySourceIndex?(index: string): Promise<boolean> } | undefined)?.readySourceIndex;
  return ready === undefined ? false : ready(index);
}
