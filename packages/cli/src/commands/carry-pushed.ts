/**
 * What a pull request's last push ran, kept for its next push and taken there.
 *
 * A selection diffs each test from the commit it last ran at, so a push that
 * reads the last push's record runs what changed since then, and every file
 * that push left incomplete, a failed one included. `keep` copies each suite's
 * own record into a directory the host cache saves under the pull request's
 * key, red or green; `take` lays it back over the mainline's. Only selection
 * reads it: `review` still compares with the mainline.
 *
 * The records name earlier pushes' merge commits, which no ref holds. `keep`
 * bundles the ones the mainline lacks beside the records, and `take` reads the
 * bundle, then fetches the rest by name. A suite whose commits cannot all be
 * had is left, and reads the mainline's record, as a first push does.
 */

// compass: variance-authority.retention

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { cp, mkdir, readdir, rm } from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { readCommitRuns, testCoverageFile } from '@variance-authority/sense/test-selection';
import type { ParsedCarry } from '../carry-args.js';
import { EXIT_CLEAN, type ExitCode } from '../exit.js';

/** Where `carry` keeps and takes the pushed records, under the checkout. */
export const PUSHED = '.variance/pushed';

/** The commits no remote holds, beside the records. */
export const BUNDLE = 'commits.bundle';

/** Why a suite was not taken. */
export type PushedLeft =
  | { readonly suite: string; readonly missing: readonly string[] }
  | { readonly suite: string; readonly unlisted: true };

export interface PushedTaken {
  readonly taken: readonly string[];
  readonly left: readonly PushedLeft[];
  /** Why the bundle beside the records did not read, when it did not. */
  readonly unbundled?: string;
  /**
   * Each replaced record, set aside by suite: the mainline's cases, for
   * `variance review --against`, which would otherwise compare the change's
   * cases with the last push's. Absent when no taken suite had a record.
   */
  readonly against?: Readonly<Record<string, string>>;
}

/** Where `take` sets aside the record it replaces, under the pushed directory. */
export const ASIDE = '.mainline';

export interface PushedBundled {
  /** The commits written to the bundle. */
  readonly bundled: readonly string[];
  /** The commits the records name that this clone does not hold. */
  readonly absent: readonly string[];
  /**
   * Set when nothing was bundled because the clone is shallow: a bundle cut at
   * a shallow boundary does not read in a clone without the boundary's parent,
   * so the next push fetches each commit by name instead.
   */
  readonly shallow?: true;
}

export interface PushedKept extends PushedBundled {
  readonly kept: readonly string[];
}

const run = (root: string, ...args: string[]): string =>
  execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

const succeeds = (root: string, ...args: string[]): boolean => {
  try {
    execFileSync('git', args, { cwd: root, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
};

const holds = (root: string, commit: string): boolean => succeeds(root, 'cat-file', '-e', `${commit}^{commit}`);

/** The directory each suite's own record sits in, one per suite. */
function suitesDir(root: string): string {
  return dirname(dirname(testCoverageFile(root, { suite: 'unit' })));
}

/**
 * The commits a selection reads from the record at `coverage`: where it was
 * recorded, where its runs started, and where each test stands. Undefined when
 * no runs record beside it names where it was recorded.
 */
export async function namedCommits(coverage: string): Promise<readonly string[] | undefined> {
  const runs = await readCommitRuns(coverage);
  if (runs?.commit === undefined) return undefined;
  const all = [runs.commit, runs.over, ...(runs.standing ?? []).map((entry) => entry.commit)];
  return [...new Set(all.filter((commit): commit is string => commit !== undefined))];
}

/**
 * Copy every suite's own record into `dir`, replacing what an earlier push
 * kept there, and bundle beside them the commits `mainline` does not hold. A
 * run's half-written `.run-*` directories are left out: they are no record.
 */
export async function keepPushed(root: string, dir: string, mainline: string | undefined): Promise<PushedKept> {
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  const from = suitesDir(root);
  const kept: string[] = [];
  for (const suite of (await readdir(from, { withFileTypes: true }).catch(() => [])).filter((entry) => entry.isDirectory())) {
    if (!existsSync(join(from, suite.name, 'coverage.bin'))) continue;
    await cp(join(from, suite.name), join(dir, suite.name), {
      recursive: true,
      filter: (path) => !basename(path).startsWith('.run-'),
    });
    kept.push(suite.name);
  }
  return { kept: kept.sort(), ...(await bundlePushed(root, dir, mainline)) };
}

/**
 * Write `<dir>/commits.bundle` holding every commit the records under `dir`
 * name that `mainline` does not hold, with what they need beyond it. A bundle
 * needs refs, so each commit is named `refs/carried/<n>` while it is written,
 * and the refs are gone after. With no `mainline` every held commit is bundled.
 */
export async function bundlePushed(root: string, dir: string, mainline: string | undefined): Promise<PushedBundled> {
  const named = new Set<string>();
  for (const suite of (await readdir(dir, { withFileTypes: true })).filter((entry) => entry.isDirectory())) {
    for (const commit of (await namedCommits(join(dir, suite.name, 'coverage.bin'))) ?? []) named.add(commit);
  }
  const held = [...named].filter((commit) => holds(root, commit));
  const absent = [...named].filter((commit) => !held.includes(commit)).sort();
  const onMainline = (commit: string): boolean =>
    mainline !== undefined && succeeds(root, 'merge-base', '--is-ancestor', commit, mainline);
  await rm(join(dir, BUNDLE), { force: true });
  if (run(root, 'rev-parse', '--is-shallow-repository') === 'true') return { bundled: [], absent, shallow: true };
  const bundled = held.filter((commit) => !onMainline(commit)).sort();
  if (bundled.length === 0) return { bundled, absent };
  const refs = bundled.map((commit, index) => [`refs/carried/${String(index)}`, commit] as const);
  try {
    for (const [ref, commit] of refs) run(root, 'update-ref', ref, commit);
    const not = mainline !== undefined && succeeds(root, 'rev-parse', '--verify', '--quiet', mainline) ? ['--not', mainline] : [];
    run(root, 'bundle', 'create', '--quiet', join(dir, BUNDLE), ...refs.map(([ref]) => ref), ...not);
  } finally {
    for (const [ref] of refs) run(root, 'update-ref', '-d', ref);
  }
  return { bundled, absent };
}

/**
 * Lay each suite under `dir` into the checkout at `root` as its own record,
 * replacing one a restore laid from the mainline: the last push was laid on a
 * mainline record, so it is that record plus what the pull request ran since.
 * `left` names the rest, each with the commits the remote did not give, or
 * `unlisted` when its record names no commit its tests ran at.
 */
export async function takePushed(root: string, dir: string): Promise<PushedTaken> {
  let entries: Dirent[];
  try {
    entries = (await readdir(dir, { withFileTypes: true })).filter((entry) => entry.isDirectory());
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    entries = [];
  }
  const taken: string[] = [];
  const left: PushedLeft[] = [];
  const against: Record<string, string> = {};
  const bundle = join(dir, BUNDLE);
  let unbundled: string | undefined;
  let bundleRead = false;
  // A shallow clone fetches each commit alone: a diff reads two trees, not history.
  const depth = run(root, 'rev-parse', '--is-shallow-repository') === 'true' ? ['--depth=1'] : [];
  for (const suite of entries.map((entry) => entry.name).sort()) {
    const from = join(dir, suite);
    if (!existsSync(join(from, 'coverage.bin'))) continue;
    const named = await namedCommits(join(from, 'coverage.bin'));
    if (named === undefined) {
      left.push({ suite, unlisted: true });
      continue;
    }
    if (!bundleRead && named.some((commit) => !holds(root, commit)) && existsSync(bundle)) {
      // Once: what the bundle holds is in the clone after the first read.
      bundleRead = true;
      // Each head by name, into FETCH_HEAD alone: the commits are wanted, not
      // the refs that named them.
      try {
        const heads = run(root, 'bundle', 'list-heads', bundle)
          .split('\n')
          .map((line) => line.split(' ')[1])
          .filter((ref): ref is string => ref !== undefined);
        run(root, 'fetch', '--quiet', '--no-tags', bundle, ...heads);
      } catch (error) {
        const said = (error as { stderr?: unknown }).stderr;
        unbundled = `${bundle} did not read: ${String(said ?? error).trim()}`;
      }
    }
    const absent = named.filter((commit) => !holds(root, commit));
    // One commit the remote no longer has fails the whole fetch; each is asked after.
    if (absent.length > 0 && !succeeds(root, 'fetch', '--quiet', '--no-tags', ...depth, 'origin', ...absent)) {
      for (const commit of absent) succeeds(root, 'fetch', '--quiet', '--no-tags', ...depth, 'origin', commit);
    }
    const missing = absent.filter((commit) => !holds(root, commit));
    if (missing.length > 0) {
      left.push({ suite, missing });
      continue;
    }
    const record = testCoverageFile(root, { suite });
    const own = dirname(record);
    if (existsSync(record)) {
      const aside = join(dir, ASIDE, suite, 'coverage.bin');
      await mkdir(dirname(aside), { recursive: true });
      await cp(record, aside);
      against[suite] = aside;
    }
    await rm(own, { recursive: true, force: true });
    await cp(from, own, { recursive: true });
    taken.push(suite);
  }
  return {
    taken,
    left,
    ...(unbundled === undefined ? {} : { unbundled }),
    ...(Object.keys(against).length === 0 ? {} : { against }),
  };
}

/** What `take` did, one line each, for a person reading the log. */
export function takenLines(result: PushedTaken): readonly string[] {
  const lines = result.unbundled === undefined ? [] : [result.unbundled];
  for (const suite of result.taken) {
    const aside = result.against?.[suite];
    lines.push(`${suite} reads from what the last push ran.${aside === undefined ? '' : ` The mainline's record it replaced is at ${aside}, for \`review --against\`.`}`);
  }
  for (const one of result.left) {
    lines.push(
      'missing' in one
        ? `${one.suite} reads the mainline's record: the remote no longer has ${one.missing.map((commit) => commit.slice(0, 12)).join(', ')}, which the last push's record stands on.`
        : `${one.suite} reads the mainline's record: the last push's record has no runs record naming the commit it was recorded at.`,
    );
  }
  if (result.taken.length === 0 && result.left.length === 0) lines.push("no earlier push kept a record, so every suite reads the mainline's.");
  return lines;
}

/** What `keep` did, one line each. */
export function keptLines(result: PushedKept, dir: string): readonly string[] {
  const lines = [result.kept.length === 0 ? 'this push recorded no suite, so nothing is kept.' : `kept ${result.kept.join(', ')} in ${dir}.`];
  if (result.absent.length > 0) {
    lines.push(
      `this clone does not hold ${result.absent.map((commit) => commit.slice(0, 12)).join(', ')}, which the records name, so the next push reads their suites from the mainline unless the remote has them.`,
    );
  }
  if (result.shallow === true) lines.push('this clone is shallow, so nothing is bundled: the next push fetches each commit the records name from the remote.');
  if (result.bundled.length > 0) lines.push(`${String(result.bundled.length)} commit(s) the mainline does not hold are bundled in ${join(dir, BUNDLE)}.`);
  return lines;
}

/**
 * `carry take|keep`: lay what the last push ran over the restored records, or
 * keep what this one ran for the next. Under `--format github` the suites go to
 * `$GITHUB_OUTPUT` as `taken` and `left`, or `kept`, separated by spaces, and
 * the lines to the error stream. `mainline` is the ref whose commits `keep`
 * leaves out of the bundle.
 */
export async function movePushed(
  parsed: ParsedCarry,
  root: string,
  streams: { readonly out: (text: string) => void; readonly err: (text: string) => void },
  mainline: string | undefined,
): Promise<ExitCode> {
  const dir = parsed.dir ?? resolve(root, PUSHED);
  let outputs: string[];
  let lines: readonly string[];
  if (parsed.direction === 'take') {
    const taken = await takePushed(root, dir);
    outputs = [
      `taken=${taken.taken.join(' ')}`,
      `left=${taken.left.map((one) => one.suite).join(' ')}`,
      // The suite's name is the output's: a step reads `against-<suite>`.
      ...Object.entries(taken.against ?? {}).map(([suite, path]) => `against-${suite}=${path}`),
    ];
    lines = takenLines(taken);
  } else {
    const kept = await keepPushed(root, dir, mainline);
    outputs = [`kept=${kept.kept.join(' ')}`];
    lines = keptLines(kept, dir);
  }
  if (parsed.format === 'github') {
    streams.out(`${outputs.join('\n')}\n`);
    streams.err(`${lines.join('\n')}\n`);
  } else {
    streams.out(`${lines.join('\n')}\n`);
  }

  return EXIT_CLEAN;
}
