/**
 * Which paths the working tree disagrees with `HEAD` about, as git says.
 *
 * Two readers need the answer: the scan, which re-hashes those paths and takes
 * the rest from the commit (`tree.ts`), and the landing of a run, which keeps
 * the text of each recorded module the commit does not hold
 * (`test-selection/kept-texts.ts`). Both ask here, so both ask in the shape git
 * answers cheaply.
 */

// compass: variance-authority.reach

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

/** Enough for a repository of two hundred thousand paths. */
export const MAX_OUTPUT = 256 * 1024 * 1024;

/** What the working tree disagrees with `HEAD` about. */
export interface WorkingTreeChanges {
  /** Paths whose bytes on disk may differ from the commit's: edited, added, untracked, or the new name of a rename. */
  readonly changed: readonly string[];
  /** Paths the commit names that the working tree no longer holds under that name. */
  readonly gone: readonly string[];
}

/**
 * The paths under `root` that differ from `HEAD` in the working tree or the
 * index, untracked ones git does not ignore included, spelled from `root`.
 * `top` says `root` is the top of its checkout. `undefined` when git cannot
 * answer.
 *
 * Nothing is passed for `core.fsmonitor` or `core.untrackedCache`. Both are
 * the repository's to configure and both are what make this call cheap on a
 * large checkout; an override here would quietly cost a user who turned them on
 * the whole saving, and turning them on from here would start a daemon nobody
 * asked for. The untracked cache answers only `--untracked-files=normal` with
 * no pathspec, and either one alone walks every directory again: 370 ms
 * against 40 ms on 288,197 paths. So at the top of the checkout the question
 * is asked in that shape, and the directories it collapses are listed apart.
 */
export async function workingTreeChanges(root: string, top: boolean): Promise<WorkingTreeChanges | undefined> {
  const args = top
    ? ['status', '--porcelain=v1', '-z', '--untracked-files=normal']
    : ['-c', 'status.relativePaths=true', 'status', '--porcelain=v1', '-z', '--untracked-files=all', '--', '.'];
  let status: string;
  try {
    ({ stdout: status } = await run('git', args, { cwd: root, maxBuffer: MAX_OUTPUT }));
  } catch {
    return undefined;
  }

  const changed: string[] = [];
  const gone: string[] = [];
  const collapsed: string[] = [];
  const fields = status.split('\0');

  for (let at = 0; at < fields.length; at += 1) {
    const entry = fields[at]!;
    if (entry.length < 4) continue;

    const codes = entry.slice(0, 2);
    const path = entry.slice(3);

    // A rename carries its old path as the next field, and that path is gone.
    if (codes.includes('R')) {
      const from = fields[at + 1];
      if (from !== undefined) gone.push(from);
      at += 1;
    }

    if (codes.includes('D')) gone.push(path);
    // A directory git did not descend: untracked, collapsed by
    // `--untracked-files=normal`, or a repository of its own. It has no blob,
    // and one in the batch fails `hash-object` for every file.
    else if (path.endsWith('/')) {
      if (codes === '??') collapsed.push(path);
    } else changed.push(path);
  }

  if (collapsed.length > 0) {
    // Only the directories git collapsed are walked, and the walk is git's, so
    // the ignore rules are the ones `status` applied. Unanswered, the files under
    // them are unknown, and git has not answered.
    let listed: string;
    try {
      ({ stdout: listed } = await run(
        'git',
        ['--literal-pathspecs', 'ls-files', '-z', '--others', '--exclude-standard', '--', ...collapsed],
        { cwd: root, maxBuffer: MAX_OUTPUT },
      ));
    } catch {
      return undefined;
    }
    for (const path of listed.split('\0')) if (path !== '' && !path.endsWith('/')) changed.push(path);
  }

  return { changed, gone };
}
