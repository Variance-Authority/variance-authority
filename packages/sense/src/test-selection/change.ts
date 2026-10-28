// compass: variance-authority.reach
/**
 * A change as the value every selection step reads: the files it names, the
 * old-side lines it moved in each, and the hunks that move them.
 *
 * A diff is one way to arrive at it and never the only one. A caller that
 * already knows which files moved hands their paths over; a simulation invents
 * the ranges; neither has a diff to write or a checkout to write it in. Every
 * step past this one reads the value, so none of them parses text and none of
 * them asks git.
 */

import { codeUnitOrder } from '@variance-authority/core/segment';
import type { LineRange } from './diff-lines.js';
import { changedLines } from './diff-lines.js';
import { hunksOf, type Hunk } from './patch.js';
import { ignoredBy, withoutPaths } from './route.js';

export interface Change {
  /**
   * The old-side lines each changed file moved, in the coordinates the record
   * is indexed by. A file mapped to no ranges is changed whole: a binary, a
   * rename, a mode, or a file the caller names without lines.
   */
  readonly lines: ReadonlyMap<string, readonly LineRange[]>;
  /**
   * The hunks that move each file's old text to its new one, under the same
   * name. A file with none is read by its lines alone: nothing can apply it to
   * a text, so no parser reads what it did.
   */
  readonly hunks: ReadonlyMap<string, readonly Hunk[]>;
}

/** The change a unified diff writes (`changedLines`, `hunksOf`). */
export function changeOfDiff(diff: string): Change {
  return { lines: changedLines(diff), hunks: hunksOf(diff) };
}

/** `change` cut in two by a suite's `ignore` globs (`route.ts`): what it reads, and what it ignores, in code-unit order. */
export function ignoredChange(
  change: Change,
  ignore: readonly string[] | undefined,
): { readonly kept: Change; readonly ignored: readonly string[] } {
  const ignored = ignoredBy(ignore, change.lines.keys());
  return { kept: { lines: withoutPaths(change.lines, ignored), hunks: withoutPaths(change.hunks, ignored) }, ignored };
}

/** The part of `change` that moves `paths`: their lines and their hunks, and no other file's. */
export function changeOfPaths(change: Change, paths: Iterable<string>): Change {
  const kept = new Set(paths);
  const only = <Value>(byFile: ReadonlyMap<string, Value>) => new Map([...byFile].filter(([file]) => kept.has(file)));
  return { lines: only(change.lines), hunks: only(change.hunks) };
}

/**
 * The change that moves each of `paths` whole, with no lines and no hunks: the
 * change a caller hands over when it knows which files moved and nothing more.
 */
export function changeOfFiles(paths: Iterable<string>): Change {
  return { lines: new Map([...new Set(paths)].sort(codeUnitOrder).map((path) => [path, []])), hunks: new Map() };
}
