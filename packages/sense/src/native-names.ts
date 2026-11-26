/**
 * `symbol` and `uses` answered by the addon, with the same reading the
 * standalone executable answers them with, over the help store a tool holds.
 */

// compass: variance-authority.report.agent-surface

import { entry, onIndex } from './help-reading.js';
import { asOneQuestion, type OpenedIndex } from './help-question.js';
import { sourceIndexPath } from './source-index.js';

/** One name as `symbol` or `uses` is asked about it. */
export interface NameAsked {
  readonly name: string;
  /** The package to answer from, by name or by specifier. */
  readonly package?: string;
  /** The paths the question stands at: `symbol` orders its declarations nearest to them and answers installed names as they resolve there, `uses` orders its sites nearest to the first. */
  readonly from?: readonly string[];
  /** The file whose declaration `uses` answers for alone. */
  readonly file?: string;
  /** The rows of each list to show; `symbol` cuts at its own when unsaid, `uses` needs it said. */
  readonly limit?: number;
  /** The words a question starts with in a shell; a wire host has none. */
  readonly shell?: string;
}

/** An answer, and whether it is that nothing declares the name. */
export interface NameAnswer {
  readonly text: string;
  readonly found: boolean;
}

/**
 * `symbol`'s answer about `asked.name` in the checkout at `root`, read from the
 * help store `store`; absent when there is no index, an index that does not
 * read, or an answer that needs a reading only the tool carries, which then
 * answers it itself.
 */
export function answerSymbol(root: string, store: Uint8Array, asked: NameAsked): NameAnswer | undefined {
  return answered(root, (opened) => entry('answerSymbol')(root, opened, store, asked));
}

/** `uses`'s answer about `asked.name`, as {@link answerSymbol} reads it, cut at `asked.limit`. */
export function answerUses(root: string, store: Uint8Array, asked: NameAsked): NameAnswer | undefined {
  return answered(root, (opened) => entry('answerUses')(root, opened, store, asked));
}

/** `answer` over the index of `root`, opened once for the question; an index that does not read is left to the tool, whose answer says why. */
function answered(root: string, answer: (opened: OpenedIndex) => NameAnswer | null): NameAnswer | undefined {
  const index = sourceIndexPath(root);
  return asOneQuestion(() => {
    try {
      onIndex(index, () => undefined);
    } catch {
      return undefined;
    }
    return onIndex(index, answer) ?? undefined;
  });
}
