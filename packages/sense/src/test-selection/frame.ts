import { digestString } from '../digest.js';
import type { TestCoverageView } from './format-view.js';
import type { ExecutionNarrowingOptions } from './importers.js';

/** The text a module's rows were recorded from, under the name that proved it. */
export interface Frame {
  readonly name: string;
  readonly text: string;
  /**
   * The text is one a landing kept because the commit does not hold it, so a
   * diff written against the commit is not written against this text.
   */
  readonly kept?: true;
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
 * - A name whose text agrees with every row of it: the frame.
 * - A name whose text disagrees with its rows, and whose rows name one digest
 *   `keptText` holds a text for: that text, marked `kept`. The run was recorded
 *   over an edit, and the landing kept what it ran over (`kept-texts.ts`).
 * - A name whose text disagrees, with no kept text: `stale`.
 * - Two names framed by different texts — one the commit's, one kept: `stale`,
 *   because one diff cannot be read in both.
 * - Texts, but none under a name with a row — a built twin whose source no test
 *   loaded: `unchecked`. There is no digest of that text to compare against, so
 *   its lines are read as they are, and nothing is parsed from it.
 * - No text under any name: the kept text of a name with rows, when there is
 *   one — a file recorded before it was ever committed — and otherwise `stale`.
 *   The recording saw a text nothing at that commit can be.
 * - No `sourceAt`: `unchecked`, because nothing was asked.
 */
export function frameOf(
  coverage: TestCoverageView,
  names: readonly string[],
  rowsOf: ReadonlyMap<string, readonly number[]>,
  sourceAt: ExecutionNarrowingOptions['sourceAt'],
  keptText?: ExecutionNarrowingOptions['keptText'],
): Frame | 'stale' | 'unchecked' {
  if (sourceAt === undefined) return 'unchecked';

  let frame: Frame | undefined;
  let kept: Frame | undefined;
  let answered = false;
  for (const name of names) {
    const text = sourceAt(name, coverage.commit);
    if (text === undefined) continue;
    answered = true;
    const rows = rowsOf.get(name);
    if (rows === undefined) continue;
    const digest = digestString(text);
    if (rows.every((module) => coverage.string(coverage.moduleSource.at(module)) === digest)) {
      frame ??= { name, text };
      continue;
    }
    const held = keptFor(coverage, name, rows, keptText);
    if (held === undefined) return 'stale';
    kept ??= held;
  }
  if (frame !== undefined && kept !== undefined) return 'stale';
  if (frame !== undefined || kept !== undefined) return (frame ?? kept)!;
  if (answered) return 'unchecked';

  for (const [name, rows] of rowsOf) {
    const held = keptFor(coverage, name, rows, keptText);
    if (held !== undefined) return held;
  }
  return 'stale';
}

/** The kept text every row of one name was cut from, when they name one and it was kept. */
function keptFor(
  coverage: TestCoverageView,
  name: string,
  rows: readonly number[],
  keptText: ExecutionNarrowingOptions['keptText'],
): Frame | undefined {
  if (keptText === undefined) return undefined;
  const digests = new Set(rows.map((module) => coverage.string(coverage.moduleSource.at(module))));
  if (digests.size !== 1) return undefined;
  const [digest] = digests;
  const text = keptText(digest!);
  // The store answers by name, and a name is a claim: the text is held to it.
  if (text === undefined || digestString(text) !== digest) return undefined;
  return { name, text, kept: true };
}
