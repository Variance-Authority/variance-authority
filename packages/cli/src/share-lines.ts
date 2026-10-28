/**
 * Which lines a share keeps, which one this run writes, and which one a reader
 * reads (ADR-0077).
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
import { countPast } from './clone-cut.js';
import type { Config } from './config.js';
import { ConfigError } from './config-values.js';
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
 * is asked at all. With none of the three there is no mainline: a reader has
 * none to read, and {@link lineOfRun} writes every run to its branch's line — a
 * push to the branch you meant as the mainline included. Each caller says which
 * answers were missing.
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

/**
 * The line a publish from this run writes and the head a pull request pointed
 * at, or why it writes none. `noMainline` is present when no mainline is known
 * and the line turned on it, and names the answers that were missing. A pull
 * request's line is its head branch whatever the mainline is, so it never
 * carries one.
 */
export type RunLine =
  | { readonly line: ShareLine; readonly head?: string; readonly noMainline?: MainlinesMissing }
  | { readonly none: string };

/** The mainline answers nobody gave. */
export type MainlinesMissing = Extract<Mainlines, { missing: unknown }>['missing'];

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
 *
 * When no mainline is known, no branch is one, so a push to the branch you
 * meant as the mainline writes `branch/<name>`. A branch line decided that way
 * says which answers were missing, so the publish can say why.
 */
export async function lineOfRun(
  config: Pick<Config, 'share'>,
  env: Env = process.env,
  cwd: string = process.cwd(),
): Promise<RunLine> {
  return runLineOf(await mainlinesOf(config, env, cwd), env, cwd);
}

async function runLineOf(mainlines: Mainlines, env: Env, cwd: string): Promise<RunLine> {
  const isMainline = (name: string): boolean => 'names' in mainlines && mainlines.names.includes(name);
  const queued = (name: string): boolean => name.startsWith('gh-readonly-queue/');
  // A branch that is not a mainline, which is what every branch is when no mainline is known.
  const branch = (name: string): RunLine => ({
    line: { kind: 'branch', name },
    ...('missing' in mainlines ? { noMainline: mainlines.missing } : {}),
  });

  // TODO: only GitHub Actions describes a CI run here. GitLab CI (CI_COMMIT_BRANCH,
  // CI_MERGE_REQUEST_SOURCE_BRANCH_NAME, CI_MERGE_REQUEST_TARGET_BRANCH_NAME,
  // CI_DEFAULT_BRANCH) and Bitbucket Pipelines (BITBUCKET_BRANCH, BITBUCKET_PR_ID,
  // BITBUCKET_PR_DESTINATION_BRANCH) are not read: a detached checkout on either
  // publishes nothing, and one on a branch is taken for a run off CI, so a
  // mainline job there is refused as "not on CI" and no mainline line is ever
  // written. `mainlinesOf`'s event and `readerMainline`'s base are GitHub's alone too.
  if (env['GITHUB_ACTIONS'] === 'true') {
    const event = env['GITHUB_EVENT_NAME'];
    if (event === 'merge_group') return { none: 'a merge-queue run publishes nothing; its branch is temporary' };
    if (event === 'pull_request' || event === 'pull_request_target') {
      const pull = (await eventOf(env))?.pull_request;
      // FIXME: under `pull_request_target` a fork's token can write, so this
      // message's reason is false there. And that event's `GITHUB_SHA` is the
      // base branch's tip, so a same-repository pull request's line is written
      // at the base's commit, with the head commit only beside it.
      if (fromFork(pull)) return { none: 'a pull request from a fork publishes nothing; its token is read-only' };
      const name = env['GITHUB_HEAD_REF'];
      if (name === undefined || name === '') return { none: 'the pull request names no head branch' };
      const head = pullHeadIn(pull);
      return { line: { kind: 'branch', name }, ...(head === undefined ? {} : { head }) };
    }
    const name = env['GITHUB_REF_TYPE'] === 'branch' ? env['GITHUB_REF_NAME'] : undefined;
    if (name === undefined || name === '') return { none: 'this run is not on a branch' };
    if (queued(name)) return { none: 'a merge-queue run publishes nothing; its branch is temporary' };
    if (isMainline(name)) {
      return event === 'push'
        ? { line: { kind: 'mainline', name } }
        : { none: `only a push to ${name} publishes its record, and this run is a ${event ?? 'run'}` };
    }
    return branch(name);
  }

  const name = (await git(['symbolic-ref', '--quiet', '--short', 'HEAD'], cwd))?.trim();
  if (name === undefined || name === '') return { none: 'this checkout is not on a branch' };
  if (isMainline(name)) return { none: `only a push to ${name} publishes its record, and this run is not on CI` };
  return branch(name);
}

/**
 * The branch line a reader reads, or why it reads none.
 *
 * Not {@link lineOfRun}, whose refusals are about who may write: a
 * merge-queue branch is asked for, and holds nothing. A pull request from a
 * fork is the one refusal both share, for a different reason here. Its head
 * branch is named in the fork, and the line of that name in this share is a
 * branch of the base repository, so a fork's reader goes to the mainline
 * rather than read another branch's record as its own. The fork is told the
 * way `lineOfRun` tells it, by the event's head and base repositories.
 *
 * The name is the one the host gives a pull request's head, or the one it
 * gives a pushed branch, or the branch this checkout is on. A mainline is read
 * as a mainline, so it is never asked for as a branch.
 */
export async function lineOfReader(
  config: Pick<Config, 'share'>,
  env: Env = process.env,
  cwd: string = process.cwd(),
): Promise<{ readonly line: ShareLine } | { readonly none: string }> {
  const event = env['GITHUB_EVENT_NAME'];
  if (env['GITHUB_ACTIONS'] === 'true' && (event === 'pull_request' || event === 'pull_request_target')) {
    if (fromFork((await eventOf(env))?.pull_request)) {
      return { none: 'this pull request is from a fork, and a branch line of its name here is a branch of the base repository' };
    }
  }
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
  return countPast(cwd, commit, 'HEAD');
}

/** How long a reader reuses a fetched line: one editor session asking ten questions fetches once. */
export const READ_REUSE_MS = 60_000;

/**
 * A share this environment was not given what it needs: the config names a
 * credential and the environment does not hold it.
 */
export interface Unconfigured {
  readonly kind: 'unconfigured';
  readonly detail: string;
}

/**
 * The cell the configured share kind keeps its lines in.
 *
 * `git` needs the remote's URL, which is your clone's to answer; a clone with
 * no such remote is a share that cannot be reached, not a share that is empty.
 * `http` needs its token only here, so a job without the variable the config
 * names — a pull request from a fork — gets a miss that names it, and every
 * other command in that job runs.
 */
export async function lineCellOf(
  config: Pick<Config, 'share' | 'cacheRoot'>,
  options: { readonly cwd?: string; readonly reuseMs?: number } = {},
): Promise<LineCell | ShareMiss | Unconfigured | undefined> {
  const share = config.share;
  if (share === undefined) return undefined;
  if (share.kind === 'directory') return createDirectoryLineCell(share.root);
  if (share.kind === 'http') {
    let token: string | undefined;
    try {
      token = share.token?.();
    } catch (error) {
      if (!(error instanceof ConfigError)) throw error;
      return { kind: 'unconfigured', detail: error.message };
    }
    return httpLineCell({
      endpoint: share.endpoint,
      ...(share.method !== undefined ? { method: share.method } : {}),
      ...(token !== undefined ? { headers: { authorization: `Bearer ${token}` } } : {}),
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

/**
 * The mainline a reader reads, how many commits `HEAD` is past its merge base
 * with it, and that merge base, so a distance measured from it next is not
 * asked for it again.
 */
export type ReaderMainline =
  | { readonly name: string; readonly since?: number; readonly base?: string }
  | Extract<Mainlines, { missing: unknown }>;

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

  const measured = await Promise.all(names.map(async (name) => ({ name, ...(await sinceMergeBase(config, name, cwd)) })));
  let best = measured[0]!;
  for (const one of measured) {
    if (one.since !== undefined && (best.since === undefined || one.since < best.since)) best = one;
  }
  return best;
}

/**
 * Commits between a held record's `commit` and `HEAD`'s merge base with
 * `mainline`: positive when the record is older than that base, negative when
 * it is newer. Absent when this clone cannot count, or when neither descends
 * from the other. `base` is that merge base, when the caller already asked.
 */
export async function distanceFrom(
  config: Pick<Config, 'share'>,
  mainline: string,
  commit: string,
  cwd: string = process.cwd(),
  base: string | undefined = undefined,
): Promise<number | undefined> {
  base ??= await mergeBase(config, mainline, cwd);
  if (base === undefined) return undefined;
  // Git named the base, so the clone holds it: a record at it is no distance.
  if (commit === base) return 0;
  const [behind, ahead] = await Promise.all([countPast(cwd, commit, base), countPast(cwd, base, commit)]);
  if (behind === undefined || ahead === undefined) return undefined;
  if (ahead === 0) return behind;
  if (behind === 0) return -ahead;
  return undefined;
}

async function sinceMergeBase(
  config: Pick<Config, 'share'>,
  mainline: string,
  cwd: string,
): Promise<{ base?: string; since?: number }> {
  const base = await mergeBase(config, mainline, cwd);
  if (base === undefined) return {};
  const since = await countPast(cwd, base, 'HEAD');
  return since === undefined ? { base } : { base, since };
}

async function mergeBase(config: Pick<Config, 'share'>, mainline: string, cwd: string): Promise<string | undefined> {
  const base = (await git(['merge-base', 'HEAD', `refs/remotes/${remoteOf(config)}/${mainline}`], cwd))?.trim();
  return base === undefined || base === '' ? undefined : base;
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

/** Whether a pull request's head is in another repository than its base. An event that names no head repository is not a fork. */
function fromFork(pull: GitHubEvent['pull_request']): boolean {
  return pull?.head?.repo?.full_name !== undefined && pull.head.repo.full_name !== pull.base?.repo?.full_name;
}

/**
 * The head commit of the pull request this CI run is for, as the event names
 * it, or absent on any other run. CI checks out a merge of it that nobody
 * pushed, so the head is read from the event, never guessed from the merge.
 */
export async function pullRequestHead(env: Env = process.env): Promise<string | undefined> {
  if (env['GITHUB_ACTIONS'] !== 'true') return undefined;
  const event = env['GITHUB_EVENT_NAME'];
  if (event !== 'pull_request' && event !== 'pull_request_target') return undefined;
  return pullHeadIn((await eventOf(env))?.pull_request);
}

function pullHeadIn(pull: GitHubEvent['pull_request']): string | undefined {
  const head = pull?.head?.sha;
  return typeof head === 'string' ? head : undefined;
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
