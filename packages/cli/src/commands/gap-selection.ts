// compass: variance-authority.reach

/**
 * Which test files a gap runs: selection's answer for the asked file.
 *
 * `variance select` owns "which tests run this change": a new file by reach
 * over the file graph, new code by the test files that loaded it, under each
 * declared suite's `relations`, `ignore`, `before` and preconditions. A gap that
 * worked the answer out again would drop those, and two answers to one question
 * part company the first time either changes. So a gap asks selection about the
 * asked file alone, as a change to every line of it (`wholeEntry`), and only
 * words and counts what selection named.
 */

import type { Relations } from '@variance-authority/core/relate';
import { wholeEntry } from '@variance-authority/sense/test-selection';
import { OperatorError } from '../exit.js';
import { fileGraph } from './covering-at.js';

/**
 * The checkout's file graph, read on first ask and shared by every later one:
 * the answer's readers and selection's alike, so a `covering` asked of several
 * suites reads it once, not once per suite.
 */
export type Graph = () => Promise<Relations>;

/** A {@link Graph} of `root` that reads it at most once. */
export function graphOnce(root: string): Graph {
  let read: Promise<Relations> | undefined;
  return () => (read ??= fileGraph(root));
}

/**
 * What selection runs for one file: these recorded test files, the whole suite
 * for the reason it gives, none, or `unread` when selection refused, in its own
 * words: the refusal names its own remedy, which the gap does not guess.
 */
export type Selected =
  | { readonly files: readonly string[] }
  | { readonly whole: string }
  | { readonly none: true }
  | { readonly unread: string };

/**
 * Where the record a gap is of was read: the root, the suite whose
 * configuration selects, and the file `--execution` named or, without it, the
 * record the answer was read from. Selection is asked of that record and looks
 * for no other: a suite given to the share would otherwise be read from the
 * mainline's, another record than the one the answer came from.
 */
export interface GapSource {
  readonly root: string;
  readonly suite?: string | undefined;
  readonly execution?: string | undefined;
  readonly record?: string | undefined;
  readonly graph: Graph;
}

/**
 * Selection's answer for a change to every line of `file`, in code-unit order.
 * It names recorded test files only: the ones the record holds whole that a
 * changed line reached, and every one it holds only in part, which runs
 * whatever changed. A test file the record never ran is not in it: reach owns
 * those, and the gap names `variance reach --since` from the record's commit
 * rather than walking again.
 */
export async function selectedFor(source: GapSource, file: string): Promise<Selected> {
  try {
    const { selectSuite } = await import('./select-command.js');
    const reading = await selectSuite({
      root: source.root,
      ...(source.suite === undefined ? {} : { suite: source.suite }),
      ...(source.execution !== undefined ? { execution: source.execution } : source.record === undefined ? {} : { record: source.record }),
      change: wholeEntry(file),
      relations: await source.graph(),
    });
    if (reading.declined !== undefined) return { whole: reading.declined };
    // A test file the record holds no whole observation of runs whatever changed, as selection runs it.
    const files = [...new Set([...[...reading.whole].filter((one) => !reading.skip.has(one)), ...(reading.reading.incomplete ?? [])])].sort();
    return files.length === 0 ? { none: true } : { files };
  } catch (error) {
    if (error instanceof OperatorError) return { unread: error.message };
    throw error;
  }
}
