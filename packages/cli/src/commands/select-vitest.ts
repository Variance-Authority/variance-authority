/**
 * `variance select --format vitest`: a skip list spelled the way vitest matches it.
 */

import { isAbsolute, relative, resolve, sep } from 'node:path';

/**
 * The skipped files as the exclusions vitest matches them by, from a run in `run`.
 *
 * `skip` and `known` are named from `root`, the top of the checkout; `known` is
 * every path the reading named, and those not skipped are the ones that run.
 *
 * Vitest globs a project's test files from the project's directory, its `root`
 * or `test.dir`, and reads each `--exclude` as an ignore pattern against that
 * directory. Vitest 2 matches only a path relative to it; vitest 3 and later
 * also resolve an absolute one against it, and only the absolute one reaches
 * every project of a workspace. An exclusion that matches nothing is not an
 * error anywhere, so a file goes out in both forms, each matching where the
 * other does not.
 *
 * Every project is handed the relative form, so it also names any file whose
 * path ends in it under another project's directory. It is written only when
 * no file that runs ends in it; otherwise the absolute form alone goes out,
 * which vitest 2 matches nowhere and so runs the file, the safe direction. A
 * file outside `run` is globbed by no project rooted there, and is absolute
 * only as well.
 */
export function vitestExclusions(skip: readonly string[], known: readonly string[], root: string, run: string): string[] {
  const skipped = new Set(skip);
  // FIXME: a test file the record never named and the change did not touch is
  // not in `known`, so a relative form can still name it under another project.
  // Every tail of every path that runs, so each relative form is one lookup.
  const tails = new Set<string>();
  for (const path of known) {
    if (skipped.has(path)) continue;
    const parts = path.split('/');
    for (let at = 0; at < parts.length; at++) tails.add(parts.slice(at).join('/'));
  }
  return skip.flatMap((test) => {
    const file = resolve(root, test);
    const near = relative(run, file);
    const outside = near === '..' || near.startsWith(`..${sep}`) || isAbsolute(near);
    const spelled = near.split(sep).join('/');
    return [...(outside || tails.has(spelled) ? [] : [`--exclude=${spelled}`]), `--exclude=${file}`];
  });
}
