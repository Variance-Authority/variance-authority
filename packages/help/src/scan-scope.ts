import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { relative } from 'node:path';
import type { Offering } from '@variance-authority/package/help';

// compass: variance-authority.report.agent-surface

/**
 * The directories a workspace's scan reads, and the root they are named from.
 *
 * A workspace whose members all sit inside its root is the whole of that root.
 * One whose member list reaches beside it — a product of a monorepo listing
 * packages in the checkout's other directories — is its root and each member
 * the list names, named from the top of the checkout: what the list names is
 * what the workspace can import and work with. A member inside another named
 * directory is already read with it, so it is not named twice.
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

  const named = new Set<string>();
  for (const path of [root, ...offerings.map((offering) => offering.dir)]) {
    const from = relative(repository, realpathSync(path));
    if (from === '' || from.startsWith('..')) continue;
    named.add(from);
  }
  // Code-unit order puts a directory right before everything inside it.
  const dirs: string[] = [];
  for (const dir of [...named].sort()) {
    const last = dirs.at(-1);
    if (last === undefined || !dir.startsWith(`${last}/`)) dirs.push(dir);
  }
  return { root: repository, dirs };
}

/**
 * The source index a workspace's reading keeps, beside the one at `index` that
 * its root keeps.
 *
 * A scope of the whole root is that root's own index. A scope that reaches
 * beside the root is named from another root and holds other files, so it is
 * an index of its own, written next to the root's: the root's records are
 * spelled from the root and must never be overwritten by the workspace's.
 */
export function scopeSourceIndexPath(index: string, dirs: readonly string[]): string {
  return coversWhole(dirs) ? index : `${index}.workspace.bin`;
}

/** Whether a scan of `dirs` is the whole of its root, and so kept in the root's own index. */
export function coversWhole(dirs: readonly string[]): boolean {
  return dirs.length === 1 && dirs[0] === '.';
}
