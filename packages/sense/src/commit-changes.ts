/**
 * What each commit on the first-parent line of `HEAD` touched, as git says it.
 *
 * Git owns the history, so nothing here is stored: a question about what
 * changed together reads the log it asks about. A merge is one change, compared
 * with its first parent, and the commits it brought in are not read again: the
 * line is what landed, in the order it landed. Renames are not followed, so a
 * moved file is two paths, each in the place a reader would look. Paths are
 * spelled from `root`, which may stand below the top of the repository, and
 * what a commit touched outside it is not read.
 */

// compass: variance-authority.reach

import { execFileSync } from 'node:child_process';

/** One commit on the line, and the paths it touched, from the root of the checkout. */
export interface CommitChange {
  readonly commit: string;
  readonly author: string;
  /** Whether it has a parent. A root, or a shallow clone's oldest, diffs as the whole tree. */
  readonly compared: boolean;
  readonly files: readonly string[];
}

/** The line since a date, and whether the clone holds less of it than the remote does. */
export interface CommitChanges {
  readonly commits: readonly CommitChange[];
  readonly shallow: boolean;
}

/** Around a commit's fields: a name holds no control character git would print. */
const FIELD = '\u0001';

/** A commit's token, whole: a path may hold the character, and only a NUL ends one. */
const HEADER = new RegExp(`^${FIELD}([0-9a-f]{40,64})${FIELD}([^${FIELD}]*)${FIELD}([0-9a-f ]*)${FIELD}$`, 'u');

function git(root: string, args: readonly string[]): string {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: Infinity, stdio: ['ignore', 'pipe', 'pipe'] });
}

/** `-z` ends the format and each path with a NUL, and puts a newline before a commit's first path. */
function commitsIn(log: string): readonly CommitChange[] {
  const commits: (CommitChange & { readonly files: string[] })[] = [];
  for (const token of log.split('\0')) {
    const header = HEADER.exec(token);
    if (header !== null) {
      commits.push({ commit: header[1]!, author: header[2]!, compared: header[3] !== '', files: [] });
    } else if (token !== '') {
      const { files } = commits.at(-1)!;
      files.push(files.length === 0 ? token.replace(/^\n/u, '') : token);
    }
  }
  return commits;
}

/**
 * The commits on `HEAD`'s first-parent line committed on or after `after`, a
 * `YYYY-MM-DD` read as midnight UTC, newest first. Git left to read the bare
 * date takes the time of day it is now.
 */
export function firstParentChanges(root: string, after: string): CommitChanges {
  const log = git(root, [
    'log', '-z', '--no-show-signature', '--first-parent', '--diff-merges=first-parent', '--no-renames', '--name-only', '--relative',
    `--format=${FIELD}%H${FIELD}%an${FIELD}%P${FIELD}`, `--since=${after}T00:00:00Z`, 'HEAD', '--',
  ]);
  return { commits: commitsIn(log), shallow: git(root, ['rev-parse', '--is-shallow-repository']).trim() === 'true' };
}

/** The files `HEAD` holds under `root`, spelled from it: the tree the log ends at, not what is staged. */
export function trackedFiles(root: string): readonly string[] {
  return git(root, ['ls-tree', '-r', '-z', '--name-only', 'HEAD']).split('\0').filter((path) => path !== '');
}
