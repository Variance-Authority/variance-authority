// compass: variance-authority.reach

/**
 * Which test files a gap runs: selection's answer for the asked file, and, for
 * a file added since the record, the files added with it that reach it.
 *
 * `variance select` owns "which tests run this change". It runs a new file by
 * reach, over the file graph, and new code in a recorded file by the test
 * files that loaded it, and it honours each declared suite's `relations`,
 * `ignore`, `before` and preconditions. A gap that worked the answer out again
 * would drop those, and two answers to one question part company the first time
 * either changes. So a gap asks selection about the asked file alone, as a
 * change to every line of it (`wholeEntry`), and only words and counts what
 * selection named.
 *
 * Selection names recorded test files only: a test file the record never ran
 * is not in it. Reach owns those (`variance reach --since`): {@link addedReaching}
 * asks its walk which files reach the asked one over the same graph, and keeps
 * the ones git says were added since the record's commit, under the same
 * suite's `relations` and `ignore`.
 *
 * The file graph is read once per invocation and handed to every reader that
 * needs it, the answer's own and selection's alike: a `covering` asked of
 * several suites reads it once, not once per suite.
 */

import { realpathSync } from 'node:fs';
import { relative, resolve, sep } from 'node:path';
import type { Relations } from '@variance-authority/core/relate';
import { existedAt } from '@variance-authority/sense';
import { ignoredBy, unmeasuredOf, wholeEntry, type DeclaredSuite } from '@variance-authority/sense/test-selection';
import { OperatorError } from '../exit.js';
import { fileGraph } from './covering-at.js';
import { affectedFiles, refused } from './reach.js';
import { changedSince } from './since.js';

/** The checkout's file graph, read on first ask and shared by every later one. */
export type Graph = () => Promise<Relations>;

/** A {@link Graph} of `root` that reads it at most once. */
export function graphOnce(root: string): Graph {
  let read: Promise<Relations> | undefined;
  return () => (read ??= fileGraph(root));
}

/**
 * What selection runs for one file: these recorded test files, the whole suite
 * for the reason it gives, none, or `unread` when the answer could not be had
 * (an unpublished source index, a record selection cannot read).
 */
export type Selected =
  | { readonly files: readonly string[] }
  | { readonly whole: string }
  | { readonly none: true }
  | { readonly unread: true };

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

/** Selection's answer for a change to every line of `file`, in code-unit order. */
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
    const files = [...reading.whole].filter((one) => !reading.skip.has(one)).sort();
    return files.length === 0 ? { none: true } : { files };
  } catch (error) {
    if (error instanceof OperatorError) return { unread: true };
    throw error;
  }
}

/**
 * The files added since `commit` that reach `file`, `file` aside, in code-unit
 * order: reach's walk over the graph, kept to what git lists as changed since
 * the commit and did not exist at it. None for a suite that declines
 * relations, a file the suite ignores, or a walk or a git listing that could
 * not answer; `variance reach --since` from the same commit still runs then.
 */
export async function addedReaching(
  source: Pick<GapSource, 'root' | 'graph'>,
  file: string,
  commit: string,
  declared: DeclaredSuite | undefined,
): Promise<readonly string[]> {
  if (unmeasuredOf(declared) === 'nothing' || ignoredBy(declared?.ignore, [file]).length > 0) return [];
  try {
    const reach = affectedFiles(await source.graph(), [file], ['.']);
    if (refused(reach)) return [];
    const ignored = new Set(ignoredBy(declared?.ignore, reach.files));
    // `changedSince` speaks from the working directory, the graph from the
    // root; both are read through the real path, which a symlinked root hides.
    const at = realpathSync(source.root);
    const changed = await changedSince(commit, [relative(realpathSync(process.cwd()), at)]);
    const since = new Set(changed.map((one) => relative(at, resolve(realpathSync(process.cwd()), one)).split(sep).join('/')));
    return reach.files.filter((one) => one !== file && since.has(one) && !ignored.has(one) && existedAt(source.root, commit, one) === false);
  } catch (error) {
    if (error instanceof OperatorError) return [];
    throw error;
  }
}
