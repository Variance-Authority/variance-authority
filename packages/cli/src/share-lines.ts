/**
 * Which lines a share keeps, which one this run writes, and which one a reader
 * reads (spec 0074).
 *
 * Every answer here has an owner that is not this file. The configuration
 * names the mainlines when it wants to; otherwise git does, through
 * `refs/remotes/<remote>/HEAD`, and on a CI checkout that has no such ref the
 * event does. The CI host names the event and the branch. Git answers descent.
 * This file asks them in order and says which one answered, and never
 * substitutes `main` for an answer nobody gave.
 *
 * The git asked here is read-only in your clone: `symbolic-ref`, `remote
 * get-url`, `merge-base`, `rev-list`. Anything that fetches runs in the share's
 * own repository under the cache.
 */

import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  httpLineCell,
  type Descends,
  type LineCell,
  type ShareLine,
  type ShareMiss,
} from '@variance-authority/core/share';
import { createDirectoryLineCell, createGitLineCell, gitDescends } from '@variance-authority/store/share';
import type { Config } from './config.js';
import { shareRoot } from './commands/resources.js';

/** The environment a CI host describes the run in. `process.env` unless a caller says otherwise. */
export type Env = Readonly<Record<string, string | undefined>>;

/** The mainlines, in priority order, or which of the three answers were missing. */
export type Mainlines =
  | { readonly names: readonly string[] }
  | { readonly missing: readonly ('config' | 'remote-head' | 'event')[] };

/**
 * The mainlines: `share.mainlines`, then the branch `<remote>/HEAD` names, then
 * the CI event's default branch. A command that read no config asks the other
 * two.
 *
 * `actions/checkout` usually leaves no `<remote>/HEAD`, which is why the event
 * is asked at all. With none of the three, nothing is published or saved, and
 * the caller says which answers were missing.
 */
export async function mainlinesOf(
  config: Pick<Config, 'share'> | undefined,
  env: Env = process.env,
  cwd: string = process.cwd(),
): Promise<Mainlines> {
  const configured = config?.share?.mainlines;
  if (configured !== undefined) return { names: configured };

  const prefix = `refs/remotes/${remoteOf(config)}/`;
  const head = (await git(['symbolic-ref', '--quiet', `${prefix}HEAD`], cwd))?.trim();
  if (head?.startsWith(prefix) === true) return { names: [head.slice(prefix.length)] };

  const branch = (await eventOf(env))?.repository?.default_branch;
  if (typeof branch === 'string' && branch !== '') return { names: [branch] };

  return { missing: ['config', 'remote-head', 'event'] };
}

/** The line a publish from this run writes, and the head a pull request pointed at; or why it writes none. */
export type RunLine =
  | { readonly line: ShareLine; readonly head?: string }
  | { readonly none: string };

/**
 * Where this run's record belongs.
 *
 * A push to a mainline writes that mainline. A pull request writes its head
 * branch, and records the head commit beside the merge commit CI ran on. A
 * merge-queue run writes nothing, because its branch is deleted when the queue
 * moves; a pull request from a fork writes nothing, because its token cannot.
 * Any other run on a mainline writes nothing either: only a push to it
 * describes it. Off CI, the checked-out branch is the line, and a checkout of
 * a mainline writes nothing for the same reason.
 */
export async function lineOfRun(
  config: Pick<Config, 'share'>,
  env: Env = process.env,
  cwd: string = process.cwd(),
): Promise<RunLine> {
  const mainlines = await mainlinesOf(config, env, cwd);
  const isMainline = (name: string): boolean => 'names' in mainlines && mainlines.names.includes(name);
  const queued = (name: string): boolean => name.startsWith('gh-readonly-queue/');

  if (env['GITHUB_ACTIONS'] === 'true') {
    const event = env['GITHUB_EVENT_NAME'];
    if (event === 'merge_group') return { none: 'a merge-queue run publishes nothing; its branch is temporary' };
    if (event === 'pull_request' || event === 'pull_request_target') {
      const pull = (await eventOf(env))?.pull_request;
      if (pull?.head?.repo?.full_name !== undefined && pull.head.repo.full_name !== pull.base?.repo?.full_name) {
        return { none: 'a pull request from a fork publishes nothing; its token is read-only' };
      }
      const name = env['GITHUB_HEAD_REF'];
      if (name === undefined || name === '') return { none: 'the pull request names no head branch' };
      const head = pull?.head?.sha;
      return { line: { kind: 'branch', name }, ...(typeof head === 'string' ? { head } : {}) };
    }
    const name = env['GITHUB_REF_TYPE'] === 'branch' ? env['GITHUB_REF_NAME'] : undefined;
    if (name === undefined || name === '') return { none: 'this run is not on a branch' };
    if (queued(name)) return { none: 'a merge-queue run publishes nothing; its branch is temporary' };
    if (isMainline(name)) {
      return event === 'push'
        ? { line: { kind: 'mainline', name } }
        : { none: `only a push to ${name} publishes its record, and this run is a ${event ?? 'run'}` };
    }
    return { line: { kind: 'branch', name } };
  }

  const name = (await git(['symbolic-ref', '--quiet', '--short', 'HEAD'], cwd))?.trim();
  if (name === undefined || name === '') return { none: 'this checkout is not on a branch' };
  if (isMainline(name)) return { none: `only a push to ${name} publishes its record, and this run is not on CI` };
  return { line: { kind: 'branch', name } };
}

/**
 * The branch line a reader reads, or why it reads none.
 *
 * Not {@link lineOfRun}: every refusal there is about who may write, and a
 * reader of a fork's pull request or of a merge-queue branch reads whatever
 * its branch holds. The name is the one the host gives a pull request's head,
 * or the one it gives a pushed branch, or the branch this checkout is on. A
 * mainline is read as a mainline, so it is never asked for as a branch.
 */
export async function lineOfReader(
  config: Pick<Config, 'share'>,
  env: Env = process.env,
  cwd: string = process.cwd(),
): Promise<{ readonly line: ShareLine } | { readonly none: string }> {
  const pushed = env['GITHUB_ACTIONS'] === 'true' && env['GITHUB_REF_TYPE'] === 'branch' ? env['GITHUB_REF_NAME'] : undefined;
  const name = [env['GITHUB_HEAD_REF'], pushed].find((one) => one !== undefined && one !== '')
    ?? (await git(['symbolic-ref', '--quiet', '--short', 'HEAD'], cwd))?.trim();
  if (name === undefined || name === '') return { none: 'this checkout is not on a branch' };
  const mainlines = await mainlinesOf(config, env, cwd);
  if ('names' in mainlines && mainlines.names.includes(name)) return { none: `${name} is a mainline` };
  return { line: { kind: 'branch', name } };
}

/**
 * How many commits `HEAD` is past `commit`: `false` when `HEAD` does not
 * contain it, absent when this clone cannot say — a commit it does not hold,
 * or a history too shallow to walk.
 *
 * Git's exit code is the answer, so this asks it directly rather than through
 * a runner that folds every failure into one.
 */
export async function headPast(commit: string, cwd: string = process.cwd()): Promise<number | false | undefined> {
  const contains = await new Promise<boolean | undefined>((resolve) => {
    execFile('git', ['merge-base', '--is-ancestor', commit, 'HEAD'], { cwd, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } }, (error) =>
      resolve(error === null ? true : error.code === 1 ? false : undefined),
    );
  });
  if (contains !== true) return contains;
  return count(`${commit}..HEAD`, cwd);
}

/** How long a reader reuses a fetched line: one editor session asking ten questions fetches once. */
export const READ_REUSE_MS = 60_000;

/**
 * The cell the configured share kind keeps its lines in.
 *
 * `git` needs the remote's URL, which is your clone's to answer; a clone with
 * no such remote is a share that cannot be reached, not a share that is empty.
 */
export async function lineCellOf(
  config: Pick<Config, 'share' | 'cacheRoot'>,
  options: { readonly cwd?: string; readonly reuseMs?: number } = {},
): Promise<LineCell | ShareMiss | undefined> {
  const share = config.share;
  if (share === undefined) return undefined;
  if (share.kind === 'directory') return createDirectoryLineCell(share.root);
  if (share.kind === 'http') {
    return httpLineCell({
      endpoint: share.endpoint,
      ...(share.method !== undefined ? { method: share.method } : {}),
      ...(share.token !== undefined ? { headers: { authorization: `Bearer ${share.token}` } } : {}),
    });
  }
  const remote = await remoteOfClone(config, options.cwd ?? process.cwd());
  if ('kind' in remote) return remote;
  return createGitLineCell({
    ...remote,
    ...(share.namespace !== undefined ? { namespace: share.namespace } : {}),
    ...(options.reuseMs !== undefined ? { reuseMs: options.reuseMs } : {}),
  });
}

/**
 * Whether one commit of `mainline` descends from another, for every share
 * kind: the history is fetched from the remote into the share's own
 * repository whether or not the lines live there too.
 */
export async function descendsOf(
  config: Pick<Config, 'share' | 'cacheRoot'>,
  mainline: string,
  cwd: string = process.cwd(),
): Promise<Descends> {
  const remote = await remoteOfClone(config, cwd);
  if ('kind' in remote) return async () => undefined;
  return gitDescends(remote, mainline);
}

/** The mainline a reader reads, and how many commits `HEAD` is past its merge base with it. */
export type ReaderMainline = { readonly name: string; readonly since?: number } | Extract<Mainlines, { missing: unknown }>;

/**
 * The mainline this checkout is measured against.
 *
 * The one a pull request names as its base, when the host says. Otherwise the
 * one with the nearest merge base, and a tie, or a clone that cannot count,
 * goes to the first listed.
 */
export async function readerMainline(
  config: Pick<Config, 'share'>,
  env: Env = process.env,
  cwd: string = process.cwd(),
): Promise<ReaderMainline> {
  const mainlines = await mainlinesOf(config, env, cwd);
  if (!('names' in mainlines)) return mainlines;
  const base = env['GITHUB_BASE_REF'];
  const names = base !== undefined && mainlines.names.includes(base) ? [base] : mainlines.names;

  let best: { name: string; since?: number } = { name: names[0]! };
  let nearest = Number.POSITIVE_INFINITY;
  for (const name of names) {
    const since = await sinceMergeBase(config, name, cwd);
    if (since !== undefined && since < nearest) {
      nearest = since;
      best = { name, since };
    }
  }
  return best;
}

/**
 * Commits between a held record's `commit` and `HEAD`'s merge base with
 * `mainline`: positive when the record is older than that base, negative when
 * it is newer. Absent when this clone cannot count, or when neither descends
 * from the other.
 */
export async function distanceFrom(
  config: Pick<Config, 'share'>,
  mainline: string,
  commit: string,
  cwd: string = process.cwd(),
): Promise<number | undefined> {
  const base = (await git(['merge-base', 'HEAD', `refs/remotes/${remoteOf(config)}/${mainline}`], cwd))?.trim();
  if (base === undefined || base === '') return undefined;
  const behind = await count(`${commit}..${base}`, cwd);
  const ahead = await count(`${base}..${commit}`, cwd);
  if (behind === undefined || ahead === undefined) return undefined;
  if (ahead === 0) return behind;
  if (behind === 0) return -ahead;
  return undefined;
}

async function sinceMergeBase(config: Pick<Config, 'share'>, mainline: string, cwd: string): Promise<number | undefined> {
  const base = (await git(['merge-base', 'HEAD', `refs/remotes/${remoteOf(config)}/${mainline}`], cwd))?.trim();
  if (base === undefined || base === '') return undefined;
  return count(`${base}..HEAD`, cwd);
}

async function count(range: string, cwd: string): Promise<number | undefined> {
  const listed = (await git(['rev-list', '--count', range], cwd))?.trim();
  return listed === undefined || listed === '' ? undefined : Number(listed);
}

function remoteOf(config: Pick<Config, 'share'> | undefined): string {
  return config?.share?.remote ?? 'origin';
}

/**
 * The remote's URL, the share's own repository for it, and the header your
 * clone authenticates to it with, when the clone has one. A CI checkout keeps
 * its token in the clone's configuration, so the share's repository is given
 * it rather than asking for one of its own.
 */
async function remoteOfClone(
  config: Pick<Config, 'share' | 'cacheRoot'>,
  cwd: string,
): Promise<{ url: string; gitDir: string; extraHeader?: string } | ShareMiss> {
  const remote = remoteOf(config);
  const url = (await git(['remote', 'get-url', remote], cwd))?.trim();
  if (url === undefined || url === '') return { kind: 'unreachable', detail: `this clone has no remote named ${remote}` };
  const header = (await git(['config', '--get-urlmatch', 'http.extraheader', url], cwd))?.trim();
  return { url, gitDir: gitDirOf(config, url), ...(header !== undefined && header !== '' ? { extraHeader: header } : {}) };
}

/** One bare repository per remote URL, so two checkouts of one repository share their fetches. */
function gitDirOf(config: Pick<Config, 'cacheRoot'>, url: string): string {
  return join(shareRoot(config), `${createHash('sha256').update(url).digest('hex').slice(0, 16)}.git`);
}

interface GitHubEvent {
  readonly repository?: { readonly default_branch?: unknown };
  readonly pull_request?: {
    readonly head?: { readonly sha?: unknown; readonly repo?: { readonly full_name?: string } };
    readonly base?: { readonly repo?: { readonly full_name?: string } };
  };
}

async function eventOf(env: Env): Promise<GitHubEvent | undefined> {
  const path = env['GITHUB_EVENT_PATH'];
  if (path === undefined || path === '') return undefined;
  try {
    return JSON.parse(await readFile(path, 'utf8')) as GitHubEvent;
  } catch {
    // An event file that is not there or not JSON answers nothing, and the
    // caller says which answer was missing.
    return undefined;
  }
}

function git(args: readonly string[], cwd: string): Promise<string | undefined> {
  return new Promise((resolve) => {
    execFile('git', [...args], { cwd, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } }, (error, stdout) =>
      resolve(error === null ? stdout : undefined),
    );
  });
}
