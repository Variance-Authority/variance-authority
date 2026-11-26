import { execFileSync } from 'node:child_process';
import { cp, mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Help } from '@variance-authority/package/help';
import { readWorkspace } from '../read.js';

/**
 * A checkout copied from `fixture`, with its source index published: what
 * `symbol` and `uses` read, which a fixture directory inside this repository
 * is not, since its files are this checkout's. The cache is the run's own,
 * keyed by the copy's path.
 */
export async function indexedCopy(fixture: string): Promise<{ readonly root: string; readonly help: Help; readonly remove: () => Promise<void> }> {
  // The cache is keyed by the path the checkout is at, which a temporary directory's name is not on macOS.
  const temporary = await realpath(await mkdtemp(join(tmpdir(), 'help-indexed-')));
  const root = join(temporary, 'workspace');
  await cp(fixture, root, { recursive: true });
  execFileSync('git', ['init', '--quiet'], { cwd: root });
  execFileSync('git', ['add', '.'], { cwd: root });
  const help = await readWorkspace(root);
  return {
    root,
    help,
    remove: () => rm(temporary, { recursive: true, force: true }),
  };
}
