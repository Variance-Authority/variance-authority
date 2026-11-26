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
  /** The rows of each list to show; unsaid, each list is cut at its own default. */
  readonly limit?: number;
  /** The words a question starts with in a shell; a wire host has none. */
  readonly shell?: string;
  /** `<file>:<line>`, the line `symbol` orders the declarations by. */
  readonly line?: string;
}

/** One file an answer read, at the lines it read there. */
export interface FileLines {
  readonly file: string;
  readonly lines: readonly number[];
}

/** Every name a declaration is written by at `at`, `file:line`, and the last line of its head when the index cut one. */
export interface Spelled {
  readonly at: string;
  readonly names: readonly string[];
  readonly through?: number | null;
}

/**
 * An answer, whether it is that nothing declares the name, and the files it
 * rests on: `files` are the declarations `symbol` says and the lines `uses`
 * lists, absent with `absent` saying why when no file of the checkout declares
 * the name; `restsOn` are the files a caught-up look compares with the checkout.
 */
export interface NameAnswer {
  readonly text: string;
  readonly found: boolean;
  readonly files?: readonly FileLines[] | null;
  readonly spelled?: readonly Spelled[] | null;
  readonly unread: readonly string[];
  readonly absent?: string | null;
  readonly restsOn?: readonly string[] | null;
}

/**
 * `symbol`'s answer about `asked.name` in the checkout at `root`, read from the
 * help store `store`; absent when no source index is published. An index that
 * does not read, or an answer that does not, throws, saying why.
 */
export function answerSymbol(root: string, store: Uint8Array, asked: NameAsked): NameAnswer | undefined {
  return answered(root, (opened) => entry('answerSymbol')(root, opened, store, asked));
}

/** `uses`'s answer about `asked.name`, as {@link answerSymbol} reads it, cut at `asked.limit`. */
export function answerUses(root: string, store: Uint8Array, asked: NameAsked): NameAnswer | undefined {
  return answered(root, (opened) => entry('answerUses')(root, opened, store, asked));
}

/** `answer` over the index of `root`, opened once for the question. */
function answered(root: string, answer: (opened: OpenedIndex) => NameAnswer | null): NameAnswer | undefined {
  return asOneQuestion(() => onIndex(sourceIndexPath(root), answer) ?? undefined);
}
