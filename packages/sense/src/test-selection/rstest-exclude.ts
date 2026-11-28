// compass: variance-authority.reach

/**
 * The files an Rstest selection skips, written as the `exclude` patterns its
 * planning reads.
 */

import { posix } from 'node:path';
import { commonDirectory } from '../checkout-path.js';

/** The longest pattern this plugin adds: picomatch refuses one past 65 536 characters. */
const PATTERN_LIMIT = 60_000;

/**
 * Absolute paths as `exclude` patterns that match them alone, relative to the
 * project's `root`, as the glob reads an ignore pattern: an absolute one is
 * made relative to a root it escapes differently, and stops matching under a
 * root whose name holds `@`, `+` or `,`. The files under the root share their
 * common directory and the rest of each sits in brace alternations, so
 * thousands of skipped files compile to a handful of patterns rather than one
 * per file, which a matcher would test every path against in turn. A file
 * above the root, which an `include` may reach, is a pattern of its own.
 */
export function excluded(root: string, paths: readonly string[]): string[] {
  const from = root.replaceAll('\\', '/');
  const relatives = paths.map((path) => posix.relative(from, path.replaceAll('\\', '/')));
  const above = relatives.filter((path) => path.startsWith('../'));
  const under = relatives.filter((path) => !path.startsWith('../'));
  return [...grouped(under), ...above.map(escaped)];
}

function grouped(paths: readonly string[]): string[] {
  if (paths.length < 2) return paths.map(escaped);
  const common = commonDirectory(paths);
  const patterns: string[] = [];
  let group: string[] = [];
  let length = 0;
  const close = (): void => {
    if (group.length > 0) patterns.push(`${escaped(common)}${group.length === 1 ? group[0]! : `{${group.join(',')}}`}`);
    group = [];
    length = 0;
  };
  for (const rest of paths.map((path) => escaped(path.slice(common.length)))) {
    if (length + rest.length + 1 > PATTERN_LIMIT - common.length) close();
    group.push(rest);
    length += rest.length + 1;
  }
  close();
  return patterns;
}

/**
 * A path as a glob that matches it alone: its glob characters escaped, unlike a
 * regular expression's, and its commas too, which tinyglobby's `escapePath`
 * leaves alone and a brace alternation would split on, and its pipes, which
 * split an alternation as commas do.
 */
function escaped(path: string): string {
  return path.replace(/[*?[\]{}()!+@,|\\]/g, '\\$&');
}
