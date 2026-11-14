import { ripgrepNative } from '@variance-authority/sense';

/**
 * ripgrep, over a list of files the caller already chose.
 *
 * The questions that search text — `grep` over a closure, `discover` over
 * the files its other sets kept — own the choice of files and nothing else; the
 * pattern language, encodings and binary detection are ripgrep's, whose crates
 * the native addon links, so nothing needs `rg` on PATH.
 */

export interface Hit {
  readonly file: string;
  readonly line: number;
  readonly text: string;
}

/** What ripgrep found, and what it could not read. */
export interface Searched {
  readonly hits: readonly Hit[];
  readonly errors: readonly string[];
}

/**
 * Every matching line in these files, in the order they were asked, and what it could not read.
 *
 * Hits are appended one at a time: `push(...hits)` passes each as an argument,
 * and a query that matches most lines of a wide closure runs out of stack.
 */
export function ripgrep(root: string, pattern: string, files: readonly string[]): Searched {
  const found = ripgrepNative(root, pattern, files);
  const hits: Hit[] = [];
  for (let at = 0; at < found.file.length; at++) {
    hits.push({ file: files[found.file[at]!]!, line: found.line[at]!, text: found.text[at]! });
  }
  return { hits, errors: found.errors };
}
