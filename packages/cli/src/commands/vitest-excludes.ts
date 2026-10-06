/**
 * How a vitest exclusion is written so that the vitest installed here matches it.
 *
 * `variance select --format vitest` hands vitest one `--exclude=` per skipped
 * test file. Which form of path vitest matches is decided by the installed
 * vitest, and nothing on its command line reports it: an exclusion that matches
 * nothing is no error, and the narrowed run is the whole suite.
 */

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve, sep } from 'node:path';

/**
 * The two forms, and which vitest matches each.
 *
 * Vitest 3 and later match an absolute exclusion, and a workspace needs one: a
 * project matches against its own directory rather than against the root the
 * journal counts from, so a root-relative path matches in no project. Vitest 2
 * hands each exclusion to fast-glob as an ignore relative to the project, and
 * fast-glob matches no absolute ignore, so there only the root-relative path
 * narrows the run.
 */
export type VitestExcludes = 'absolute' | 'relative';

/**
 * The form the vitest that resolves from `root` matches, or nothing when no
 * vitest resolves there or its manifest names no version.
 */
export function vitestExcludes(root: string): VitestExcludes | undefined {
  try {
    const manifest = createRequire(join(root, 'package.json')).resolve('vitest/package.json');
    const major = Number.parseInt((JSON.parse(readFileSync(manifest, 'utf8')) as { version?: string }).version ?? '', 10);
    if (Number.isNaN(major)) return undefined;
    return major < 3 ? 'relative' : 'absolute';
  } catch {
    return undefined;
  }
}

/**
 * One `--exclude=` per skipped file, in `excludes`' form.
 *
 * Every vitest reads an exclusion as a glob, and the journal's paths are
 * literal, so each glob character is escaped: unescaped, `cart[1].test.ts`
 * also excludes `cart1.test.ts` on vitest 2, 3 and 4, and on vitest 2
 * `app/(shop)/page.test.ts` excludes nothing.
 */
export function vitestExclusions(skip: readonly string[], root: string, excludes: VitestExcludes): string[] {
  return skip.map((test) => `--exclude=${literal(excludes === 'relative' ? test : resolve(root, test))}`);
}

/**
 * `path` as a glob that matches only itself. A backslash is a character of the
 * name where `/` separates, and is escaped there too; on Windows it separates.
 */
function literal(path: string): string {
  return path.replace(sep === '/' ? /[!()*+?@[\\\]{|}]/g : /[!()*+?@[\]{|}]/g, '\\$&');
}

/**
 * What stderr says when the form was not read but assumed. Absolute is the form
 * vitest 3 and later match; on vitest 2 it narrows nothing, and that has to be
 * said, because the run it produces looks exactly like a narrowed one.
 */
export function unreadVitestNote(root: string): string {
  return (
    `no vitest resolves from ${root}, so each exclusion is an absolute path: vitest 3 and later ` +
    'match it, vitest 2 matches none and runs the whole suite. Run this where vitest is installed'
  );
}
