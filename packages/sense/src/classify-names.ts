/** Exact filenames and declaration locations read from a published source snapshot. */

// compass: variance-authority.report.agent-surface

import { entry } from './help-reading.js';
import { sourceIndexPath } from './source-index.js';

/** The matching names only; the source inventory stays in the addon. */
export interface ClassifiedNames {
  /** Bounded matching files per exact basename, with every match counted. */
  readonly named: readonly { readonly name: string; readonly files: readonly string[]; readonly count: number }[];
  /** Exact declaration spellings, excluding bindings to definitions elsewhere. */
  readonly declared: readonly { readonly name: string; readonly at: string; readonly line: number }[];
  /** Why the published source snapshot could not be read; absent is not no matches. */
  readonly refused?: string | null;
}

/**
 * The files named by each word before their first dot, and the locations that
 * declare it, with exact spelling. File rows are capped per word, declarations
 * are complete; paths are relative to the workspace at `within`. Reads only
 * the supplied index, or the checkout's published index, and never refreshes it.
 */
export function classifyNames(root: string, words: readonly string[], cap: number, source?: { readonly index: string; readonly within: string }): ClassifiedNames {
  return entry('classifyNames')(root, [...words], cap, source?.index ?? sourceIndexPath(root), source?.within ?? '');
}
