import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

/** The crate `@variance-authority/sense` builds its addon from, repository-relative. */
export const NATIVE = 'packages/sense/native';

/**
 * Every file the addon is built from, as preconditions of the whole unit suite.
 *
 * The recording cannot see the crate. A test reaches it through `scan.node`,
 * which Node loads with `dlopen` rather than through the module graph, so no
 * `.rs` file is ever a module a journal names, and a change confined to the
 * crate selected nothing. It is not a few tests that reach it, either: the
 * instrumenter calls the addon for every module it instruments
 * (`packages/sense/src/instrument/spliced.ts`), so every test that loads
 * product code ran on the crate's output. Declaring the crate for the whole
 * suite is that dependency stated, not a widening of it.
 *
 * Git owns what the directory contains, and `native/build.mjs` already treats
 * git's tree for it as the addon's identity — so the list is `git ls-files` of
 * the same directory: the manifest, the lockfile, the toolchain pin, the build
 * script and the vendored resolver as well as the sources. The index, not the
 * disk, because the checks read the index and so does selection; a file the
 * index lists and the tree has lost is left out rather than failing the read.
 * Sorted by code unit, so the list is the same under any `LANG`.
 *
 * @param {string} root the repository root
 * @returns {string[]} repository-relative paths
 */
export function nativeSources(root) {
  const listed = execFileSync('git', ['ls-files', '-z', '--', NATIVE], {
    cwd: root,
    encoding: 'utf8',
  });
  return listed
    .split('\0')
    .filter((path) => path !== '' && existsSync(join(root, path)))
    .sort();
}
