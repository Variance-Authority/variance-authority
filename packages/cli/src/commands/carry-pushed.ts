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
 * The records name earlier pushes' merge commits, which no branch holds;
 * `take` fetches the ones the clone lacks by name. A suite whose commits cannot
 * all be had is left, and reads the mainline's record, as a first push does.
 */

// compass: variance-authority.retention

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { cp, mkdir, readdir, rm } from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { namedCommits, testCoverageFile } from '@variance-authority/sense/test-selection';
import type { ParsedCarry } from '../carry-args.js';
import { EXIT_CLEAN, type ExitCode } from '../exit.js';

/** Where `carry` keeps and takes the pushed records, under the checkout. */
export const PUSHED = '.variance/pushed';

/** Why a suite was not taken. */
export type PushedLeft =
  | { readonly suite: string; readonly missing: readonly string[] }
  | { readonly suite: string; readonly unlisted: true };

export interface PushedTaken {
  readonly taken: readonly string[];
  readonly left: readonly PushedLeft[];
  /**
   * Each replaced record, set aside by suite: the mainline's cases, for
   * `variance review --against`, which would otherwise compare the change's
   * cases with the last push's. Absent when no taken suite had a record.
   */
  readonly against?: Readonly<Record<string, string>>;
}

/** Where `take` sets aside the record it replaces, under the pushed directory. */
export const ASIDE = '.mainline';

export interface PushedKept {
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
 * Copy every suite's own record into `dir`, replacing what an earlier push
 * kept there. A run's half-written `.run-*` directories are left out: they are
 * no record.
 */
export async function keepPushed(root: string, dir: string): Promise<PushedKept> {
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
  return { kept: kept.sort() };
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
    ...(Object.keys(against).length === 0 ? {} : { against }),
  };
}

/** What `take` did, one line each, for a person reading the log. */
export function takenLines(result: PushedTaken): readonly string[] {
  const lines: string[] = [];
  for (const suite of result.taken) {
    const aside = result.against?.[suite];
    lines.push(
      `${suite} reads from what the last push ran. ${
        aside === undefined
          ? "No mainline record was here to set aside, so a review compares its cases with the last push's unless it reads the mainline's from the share."
          : `The mainline's record it replaced is at ${aside}, for \`review --against\`.`
      }`,
    );
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

/** What `keep` did, in one line. */
export function keptLines(result: PushedKept, dir: string): readonly string[] {
  return [result.kept.length === 0 ? 'this push recorded no suite, so nothing is kept.' : `kept ${result.kept.join(', ')} in ${dir}.`];
}

/**
 * `carry take|keep`: lay what the last push ran over the restored records, or
 * keep what this one ran for the next. Under `--format github` the suites go to
 * `$GITHUB_OUTPUT` as `taken` and `left`, or `kept`, separated by spaces, and
 * the lines to the error stream.
 */
export async function movePushed(
  parsed: ParsedCarry,
  root: string,
  streams: { readonly out: (text: string) => void; readonly err: (text: string) => void },
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
    const kept = await keepPushed(root, dir);
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
