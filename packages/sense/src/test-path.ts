/**
 * What a path says of a file: whether it is named as a test, and whether it
 * sits with the tests. A name holds in any language; a directory holds its
 * fixtures and snapshots too, because a test is edited with them.
 *
 * The patterns are written once, in the addon's `path.rs`, and compiled here
 * from its source, so a path asked here and a path the addon reads are one
 * test. The addon's `TEST_BY_PATH` is another question, for `orient`: a path
 * regex in Rust, which also takes a harness's config name.
 */

// compass: variance-authority.reach

import { nativePaths } from './package-owner.js';

let patterns: readonly [RegExp, RegExp] | undefined;

/**
 * Whether `file` is a test or sits with them. Read a path inside a package from
 * that package, so a package named `test` is not its own test.
 */
export function isTestPath(file: string): boolean {
  if (patterns === undefined) {
    const { named, withTheTests } = nativePaths().testPathPatterns();
    patterns = [new RegExp(named, 'u'), new RegExp(withTheTests, 'iu')];
  }
  return patterns[0].test(file) || patterns[1].test(file);
}
