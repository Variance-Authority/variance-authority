import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { relative } from 'node:path';
import type { Offering } from '@variance-authority/package/help';

/**
 * The directories a workspace's scan reads, and the root they are named from.
 *
 * Every path is compared in one spelling, resolved. Git names its top level
 * resolved and the offerings are resolved, so a root spelled through a link —
 * a checkout under macOS's `/var`, which is `/private/var` — would otherwise
 * read as crossing itself and scan no directory at all. The root comes back
 * resolved for the same reason: every path the reading derives is taken
 * relative to it, from offerings that are named resolved.
 */
export function scanScope(root: string, offerings: readonly Offering[]): { readonly root: string; readonly dirs: readonly string[] } {
  const real = realpathSync(root);
  const crossesRoot = offerings.some((offering) => relative(real, realpathSync(offering.dir)).startsWith('..'));
  if (!crossesRoot) return { root: real, dirs: ['.'] };
  let repository = real;
  try {
    repository = realpathSync(execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: root, encoding: 'utf8' }).trim());
  } catch { /* A non-Git workspace is its own scan boundary. */ }
  if (repository === real) return { root: real, dirs: ['.'] };

  const dirs = new Set<string>();
  for (const path of [root, ...offerings.map((offering) => offering.dir)]) {
    const from = relative(repository, realpathSync(path));
    if (from === '' || from.startsWith('..')) continue;
    dirs.add(from.split('/')[0]!);
  }
  return { root: repository, dirs: [...dirs].sort() };
}

/**
 * Whether a scan of `dirs` covers the whole of the root its source index
 * belongs to. Only such a scan may save over the index: a save keeps only the
 * records its own scan touched.
 */
export function coversWhole(dirs: readonly string[]): boolean {
  return dirs.length === 1 && dirs[0] === '.';
}
