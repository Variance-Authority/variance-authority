/**
 * The one directory every recorded name is relative to.
 *
 * A module id, a journal's test file, a journey's region and a diff's path all
 * name a file by its path, and they only join when they were spelled from the
 * same place. Git owns that place: it is the checkout the starting directory sits
 * in. A test runner's own root — Jest's `rootDir`, Vitest's `root` — answers
 * where the runner resolves its configuration, which is a different question,
 * and a package-level config would otherwise record a second name space that
 * matches nothing a diff says.
 *
 * `--show-cdup` rather than `--show-toplevel` because the toplevel comes back
 * with symlinks resolved. A run started under `/var` names its files under
 * `/var`, and a root under `/private/var` would strip no prefix from any of
 * them. Climbing from the caller's own spelling keeps both halves in one
 * spelling.
 */

// compass: variance-authority.reach

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const roots = new Map<string, string>();

/**
 * The checkout `from` sits in, or `from` itself where git names none.
 *
 * Outside a checkout there is no diff to join against, so the starting
 * directory is as good a space as any and nothing is refused. Held per
 * process: a config function is evaluated once per worker, and a checkout does
 * not move while one runs.
 */
export function repositoryRoot(from: string): string {
  const start = resolve(from);
  const held = roots.get(start);
  if (held !== undefined) return held;
  const found = climb(start);
  roots.set(start, found);

  return found;
}

function climb(start: string): string {
  // A directory holding `.git` is the top of its own checkout, in the spelling it
  // was asked by: every command asks from one, and a worktree's commands from the
  // primary checkout too. A `GIT_DIR` or `GIT_WORK_TREE` in the environment moves
  // the checkout away from the directories, so git is asked then.
  if (process.env['GIT_DIR'] === undefined && process.env['GIT_WORK_TREE'] === undefined && existsSync(resolve(start, '.git'))) return start;
  try {
    const up = execFileSync('git', ['rev-parse', '--show-cdup'], {
      cwd: start,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return resolve(start, up);
  } catch {
    return start;
  }
}
