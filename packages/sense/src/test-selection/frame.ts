import { digestString } from '../digest.js';
import type { TestCoverageView } from './format-view.js';
import type { ExecutionNarrowingOptions } from './importers.js';

/** The text a module's rows were recorded from, under the name that proved it. */
export interface Frame {
  readonly name: string;
  readonly text: string;
}

/**
 * Whether a file's line ranges are coordinates in the text the diff is written
 * against, and that text when they are.
 *
 * `modules.source` is a digest of the text the recorder cut the ranges from, so
 * the check is that digest against the text at the position the snapshot names.
 * It is asked once per file, under every name it may be held by. A name the
 * position does not hold says nothing: a built twin's rows carry the source's
 * line numbers and a digest of built output git never had, so they are in frame
 * exactly when the source is.
 *
 * - A name whose text disagrees with any of its rows: `stale`.
 * - A name whose text agrees with every row of it: the frame.
 * - Texts, but none under a name with a row — a built twin whose source no test
 *   loaded: `unchecked`. There is no digest of that text to compare against, so
 *   its lines are read as they are, and nothing is parsed from it.
 * - No text under any name: `stale`. The recording saw a text nothing at that
 *   commit can be.
 * - No `sourceAt`: `unchecked`, because nothing was asked.
 */
export function frameOf(
  coverage: TestCoverageView,
  names: readonly string[],
  rowsOf: ReadonlyMap<string, readonly number[]>,
  sourceAt: ExecutionNarrowingOptions['sourceAt'],
): Frame | 'stale' | 'unchecked' {
  if (sourceAt === undefined) return 'unchecked';

  let frame: Frame | undefined;
  let answered = false;
  for (const name of names) {
    const text = sourceAt(name, coverage.commit);
    if (text === undefined) continue;
    answered = true;
    const rows = rowsOf.get(name);
    if (rows === undefined) continue;
    const digest = digestString(text);
    if (rows.some((module) => coverage.string(coverage.moduleSource.at(module)) !== digest)) return 'stale';
    frame ??= { name, text };
  }

  return frame ?? (answered ? 'unchecked' : 'stale');
}
