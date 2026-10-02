// compass: variance-authority.reach
/**
 * The install, as the commands hand it to the stages after it.
 *
 * [`beyondReach`](../../../core/src/relate/beyond.ts) reads a bump and a moved
 * manifest back into the repository files they change; this is that reading
 * for an `InstallDiff`, and the patch every reader of a change is then handed:
 * the diff, with each traced file changed whole. Nothing after it is told a
 * package name.
 */

import { beyondReach, type BeyondReach, type Relations } from '@variance-authority/core/relate';
import { wholeEntry, withoutFiles } from '@variance-authority/sense/test-selection';
import type { InstallDiff } from './installed.js';

const NOTHING: BeyondReach = { files: [], unplaced: [], traced: [], chains: new Map() };

/**
 * What the install moved, as files. Nothing for no install to compare; an
 * install that cannot be compared is the caller's full run, before this is asked.
 */
export function beyondOf(relations: Relations | undefined, install: InstallDiff | undefined): BeyondReach {
  if (relations === undefined || install === undefined || 'whole' in install) return NOTHING;
  return beyondReach(relations, install);
}

/**
 * The diff with each of `files` changed whole. A file the diff already changed
 * loses its hunks: whole is what the install made of it, and a selector that
 * read both would answer for the hunks alone.
 */
export function withWhole(diff: string, files: readonly string[]): string {
  if (files.length === 0) return diff;
  return [withoutFiles(diff, files), ...files.map(wholeEntry)].join('\n');
}
