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
 * `undefined` when git cannot answer.
 *
 * `prefix` is where `root` sits below the top of its checkout, as
 * `rev-parse --show-prefix` spells it. Porcelain status names every path from
 * that top wherever it runs, so each one is cut to `root`, and one beside
 * `root` is dropped: a rename across `root` is a deletion or an addition on
 * `root`'s side.
 *
 * Nothing is passed for `core.fsmonitor` or `core.untrackedCache`. Both are
 * the repository's to configure and both are what make this call cheap on a
 * large checkout; an override here would quietly cost a user who turned them on
 * the whole saving, and turning them on from here would start a daemon nobody
 * asked for. What is chosen here is the shape of the question, in
 * [`untrackedQuestion`](#untrackedquestion).
 */
export async function workingTreeChanges(root: string, prefix: string): Promise<WorkingTreeChanges | undefined> {
  const args = ['status', '--porcelain=v1', '-z', ...untrackedQuestion(prefix, await untrackedSettings(root))];
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

    // A rename carries its old path as the next field, and that path is gone.
    if (codes.includes('R')) {
      const from = fields[at + 1];
      if (from?.startsWith(prefix) === true) gone.push(from.slice(prefix.length));
      at += 1;
    }

    // Collapsed by `normal`, the root itself, or a directory above it, is one
    // untracked line, and every file under the root is untracked.
    if (codes === '??' && entry.endsWith('/') && prefix.startsWith(entry.slice(3))) {
      collapsed.push('.');
      continue;
    }

    // Asked of the whole checkout, status names paths beside the root too. A
    // rename across the root is the deletion or the addition on the root's side.
    if (!entry.startsWith(prefix, 3)) continue;
    const path = entry.slice(3 + prefix.length);

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

/** What the repository configures about its untracked files, as `git config` reads it. */
export interface UntrackedSettings {
  /** Whether git keeps an untracked cache: `core.untrackedCache`, or `feature.manyFiles` when that is unset. */
  readonly cached: boolean;
  /** `status.showUntrackedFiles`: the one mode the cache is kept for. */
  readonly mode: 'all' | 'no' | 'normal';
}

const SETTINGS = '^(core\\.untrackedcache|feature\\.manyfiles|status\\.showuntrackedfiles)$';

/** The three settings, read in one call; none set is git's default, and so is a git that cannot answer. */
export async function untrackedSettings(root: string): Promise<UntrackedSettings> {
  let listed = '';
  try {
    ({ stdout: listed } = await run('git', ['config', '-z', '--get-regexp', SETTINGS], { cwd: root }));
  } catch {
    // Exit 1 is nothing set, which is every default.
  }
  return settingsOf(listed);
}

/**
 * `git config -z --get-regexp` output as the settings it names.
 *
 * Each entry is `key\nvalue`, or the key alone for a setting written with no
 * value, which git reads as true. Read in order, so a later file wins over an
 * earlier one, as git reads it.
 */
export function settingsOf(listed: string): UntrackedSettings {
  let cache: boolean | undefined;
  let manyFiles = false;
  let mode: UntrackedSettings['mode'] = 'normal';
  for (const entry of listed.split('\0')) {
    if (entry === '') continue;
    const newline = entry.indexOf('\n');
    const key = newline === -1 ? entry : entry.slice(0, newline);
    const value = newline === -1 ? 'true' : entry.slice(newline + 1).toLowerCase();
    if (key === 'core.untrackedcache') cache = TRUE.has(value);
    else if (key === 'feature.manyfiles') manyFiles = TRUE.has(value);
    else if (key === 'status.showuntrackedfiles') mode = value === 'all' ? 'all' : FALSE.has(value) ? 'no' : 'normal';
  }
  return { cached: cache ?? manyFiles, mode };
}

const TRUE = new Set(['true', 'yes', 'on', '1']);
const FALSE = new Set(['false', 'no', 'off', '0', '']);

/**
 * How `status` is asked for the untracked files below `prefix`.
 *
 * Git answers from its untracked cache only in the mode the repository
 * configures, and only with no pathspec; asked any other way it walks every
 * directory again. On a checkout of 812,428 paths configured for `all`,
 * `--untracked-files=normal` walked all 185,251 directories in 12.7–16.9 s
 * where the configured mode took 1.05 s, and `-- .` below the top took
 * 4.2–5.2 s where the whole checkout took 1.2–2.0 s. So where git keeps the
 * cache, the whole checkout is asked in its configured mode and the caller
 * drops what lies beside the root. Where it does not, or the mode is `no`,
 * nothing is cached, and the pathspec is what keeps the walk to the root.
 */
export function untrackedQuestion(prefix: string, settings: UntrackedSettings): readonly string[] {
  if (settings.cached && settings.mode !== 'no') return [`--untracked-files=${settings.mode}`];
  return prefix === '' ? ['--untracked-files=normal'] : ['--untracked-files=all', '--', '.'];
}
