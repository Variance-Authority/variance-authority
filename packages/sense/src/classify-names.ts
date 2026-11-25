/** Exact filenames and declaration locations read from a published source snapshot. */

// compass: variance-authority.report.agent-surface

import { entry } from './help-reading.js';
import { sourceIndexPath } from './source-index.js';

/** The matching names only; the source inventory stays in the addon. */
export interface ClassifiedNames {
  /** Bounded matching files per word, with every match counted. */
  readonly named: readonly { readonly name: string; readonly files: readonly string[]; readonly count: number }[];
  /** Exact declaration spellings, excluding bindings to definitions elsewhere. */
  readonly declared: readonly { readonly name: string; readonly at: string; readonly line: number }[];
  /** Why the published source snapshot could not be read; absent is not no matches. */
  readonly refused?: string | null;
}

/**
 * The files each word spells, with exact spelling, and the locations that
 * declare it. A word with a slash spells the file at that path, one with a dot
 * and no slash the files of that name, and any other the files whose name
 * before the first dot it is; only the last kind is looked up as declared. File rows are capped per word, declarations
 * are complete; paths are relative to the workspace at `within`. Reads only
 * the supplied index, or the checkout's published index, and never refreshes it.
 */
export function classifyNames(root: string, words: readonly string[], cap: number, source?: { readonly index: string; readonly within: string }): ClassifiedNames {
  return entry('classifyNames')([...words], cap, source?.index ?? sourceIndexPath(root), source?.within ?? '');
}
