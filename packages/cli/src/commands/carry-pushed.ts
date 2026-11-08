/**
 * What a pull request's last push ran, kept for its next push and taken there.
 *
 * A selection diffs each test from the commit it last ran at, so a push that
 * reads the last push's record runs what changed since then, failures included.
 * `keep` copies each suite's own record, and the commits it names that no
 * remote holds, into a directory the host saves under the pull request's key;
 * `take` lays it back over the mainline's and names each suite's mainline
 * cases for `review --against`. A suite whose commits or probes do not fit is
 * left to the mainline's record, and `take` hands on only what it took.
 */

// compass: variance-authority.retention

import { existsSync } from 'node:fs';
import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { instrumentationId } from '@variance-authority/sense/instrument';
import { declaredSuites, foreignProbes, keepsCases, namedCommits, testCoverageFile } from '@variance-authority/sense/test-selection';
import type { ParsedCarry } from '../carry-args.js';
import { EXIT_CLEAN, OperatorError, type ExitCode } from '../exit.js';
import type { Env } from '../share-lines.js';
import { BUNDLE, git, holds, keepCommits, succeeds, takeCommits, type KeptCommits } from './carry-bundle.js';
import { suiteBase } from './suite-base.js';

/** Where `carry` keeps and takes the pushed records, under the checkout. */
export const PUSHED = '.variance/pushed';

/** Why a suite was not taken. */
export type PushedLeft =
  | { readonly suite: string; readonly missing: readonly string[] }
  | { readonly suite: string; readonly unlisted: true }
  | { readonly suite: string; readonly instrumentation: string; readonly run: string }
  | { readonly suite: string; readonly undeclared: true };

export interface PushedTaken {
  readonly taken: readonly string[];
  readonly left: readonly PushedLeft[];
  /** Why the commits kept beside the records did not read, when they did not. */
  readonly unbundled?: string;
  /**
   * The mainline's cases by suite, for `variance review --against`, which would
   * otherwise compare the change's cases with the last push's: the restored
   * record, set aside, or the share's when the restore laid none. Absent when
   * no declared suite had either.
   */
  readonly against?: Readonly<Record<string, string>>;
}

/**
 * Where `take` sets aside the mainline's record, under the checkout: outside
 * the pushed directory, which `keep` replaces whole, so a review that reads it
 * after `keep` still finds it.
 */
export const AGAINST = '.variance/against';

export interface PushedKept extends KeptCommits {
  readonly kept: readonly string[];
}

/** The file in which `take` names the suites it took, for a later take over the same directory. */
const TAKEN = 'taken.json';


/** The suites the repository declares by name; none when it declares none. */
const declaredNames = (root: string): ReadonlySet<string> => new Set((declaredSuites(root) ?? []).map((one) => one.name));

/**
 * Copy every declared suite's own record into `dir`, replacing what an earlier
 * push kept there, with the commits they name that `mainline` does not hold. A
 * run's half-written `.run-*` directories are left out: they are no record.
 */
export async function keepPushed(root: string, dir: string, mainline: string | undefined): Promise<PushedKept> {
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  const kept: string[] = [];
  for (const suite of declaredNames(root)) {
    const record = testCoverageFile(root, { suite });
    if (!existsSync(record)) continue;
    await cp(dirname(record), join(dir, suite), {
      recursive: true,
      filter: (path) => !basename(path).startsWith('.run-'),
    });
    kept.push(suite);
  }
  return { kept: kept.sort(), ...(await keepCommits(root, dir, mainline)) };
}

/** Where the restored record of `suite` stays readable once this push writes over it: absent when none was laid, or the one laid kept no cases, since a review could not read it. */
async function setAside(root: string, suite: string): Promise<string | undefined> {
  const record = testCoverageFile(root, { suite });
  if (!existsSync(record) || !keepsCases(record)) return undefined;
  const aside = resolve(root, AGAINST, suite, 'coverage.bin');
  await mkdir(dirname(aside), { recursive: true });
  // Ignored by itself: a project's `.gitignore` may not name it, and a review would read the file as part of the change.
  await writeFile(resolve(root, AGAINST, '.gitignore'), '*\n');
  await cp(record, aside);
  return aside;
}

/**
 * Lay each suite under `dir` into the checkout at `root` as its own record,
 * replacing one a restore laid from the mainline: the last push was laid on a
 * mainline record, so it is that record plus what the pull request ran since.
 * `left` names the rest: the commits not had, `unlisted`, `undeclared`, or
 * the probes it was written under when they are not `instrumentation`, the
 * run's next (`foreignProbes`); `undefined` takes any probes. The left are
 * removed from `dir` and the taken named there; a take over a directory an
 * earlier take named stops when it leaves one of those.
 */
export async function takePushed(
  root: string,
  dir: string,
  options: { readonly env?: Env; readonly instrumentation?: string } = {},
): Promise<PushedTaken> {
  let entries: Dirent[];
  try {
    entries = (await readdir(dir, { withFileTypes: true })).filter((entry) => entry.isDirectory());
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    entries = [];
  }
  const earlier = await earlierTaken(dir);
  const taken: string[] = [];
  const left: PushedLeft[] = [];
  const against: Record<string, string> = {};
  let unbundled: string | undefined;
  let bundleRead = false;
  // A shallow clone fetches each commit alone: a diff reads two trees, not history.
  const depth = git(root, 'rev-parse', '--is-shallow-repository') === 'true' ? ['--depth=1'] : [];
  const declared = declaredNames(root);
  // Every declared suite: what `take` leaves in place, the run writes over.
  for (const suite of [...declared].sort()) {
    const aside = await setAside(root, suite);
    if (aside !== undefined) against[suite] = aside;
  }
  for (const suite of entries.map((entry) => entry.name).sort()) {
    const from = join(dir, suite);
    if (!existsSync(join(from, 'coverage.bin'))) continue;
    if (!declared.has(suite)) {
      left.push({ suite, undeclared: true });
      continue;
    }
    const run = options.instrumentation;
    const written = run === undefined ? undefined : foreignProbes(await readFile(join(from, 'coverage.bin')), run);
    if (written !== undefined && run !== undefined) {
      left.push({ suite, instrumentation: written, run });
      continue;
    }
    const named = await namedCommits(join(from, 'coverage.bin'));
    if (named === undefined) {
      left.push({ suite, unlisted: true });
      continue;
    }
    if (!bundleRead && named.some((commit) => !holds(root, commit))) {
      // Once: what the bundle holds is in the clone after the first read.
      bundleRead = true;
      unbundled = takeCommits(root, dir);
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
    if (!existsSync(record)) {
      // Nothing laid here, and the last push's record is about to read as the suite's own: only the share still has the mainline's.
      const base = await suiteBase(root, { suite, ...(options.env === undefined ? {} : { env: options.env }) });
      if (base.from === 'mainline' && base.mainline.cases !== undefined) against[suite] = base.mainline.cases;
    }
    const own = dirname(record);
    await rm(own, { recursive: true, force: true });
    await cp(from, own, { recursive: true });
    taken.push(suite);
  }
  const result: PushedTaken = {
    taken,
    left,
    ...(unbundled === undefined ? {} : { unbundled }),
    ...(Object.keys(against).length === 0 ? {} : { against }),
  };
  const lost = left.filter((one) => earlier?.includes(one.suite) === true);
  if (lost.length > 0) {
    throw new OperatorError(
      `an earlier take of this run took ${lost.map((one) => one.suite).join(', ')} from ${dir}, and this one cannot, so this job stops rather than read another record than the other jobs read:\n${[
        ...(unbundled === undefined ? [] : [unbundled]),
        ...lost.map(leftLine),
      ].join('\n')}`,
    );
  }
  if (existsSync(dir)) {
    for (const one of left) await rm(join(dir, one.suite), { recursive: true, force: true });
    await writeFile(join(dir, TAKEN), `${JSON.stringify({ taken })}\n`);
  }
  return result;
}

/** The suites an earlier take over `dir` took, or absent when none took from it. */
async function earlierTaken(dir: string): Promise<readonly string[] | undefined> {
  let text: string;
  try {
    text = await readFile(join(dir, TAKEN), 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
  const read = (JSON.parse(text) as { taken?: unknown }).taken;
  if (!Array.isArray(read) || !read.every((one) => typeof one === 'string')) {
    throw new OperatorError(`${join(dir, TAKEN)} does not name the suites an earlier take took.`);
  }
  return read;
}

/** Why `one` reads the mainline's record, for a person. */
function leftLine(one: PushedLeft): string {
  return 'missing' in one
    ? `${one.suite} reads the mainline's record: neither the commits kept beside the records nor the remote hold ${one.missing.map((commit) => commit.slice(0, 12)).join(', ')}, which the last push's record stands on.`
    : 'unlisted' in one
      ? `${one.suite} reads the mainline's record: the last push's record has no runs record naming the commit it was recorded at.`
      : 'run' in one
        ? `${one.suite} reads the mainline's record: the last push recorded under the probes \`${one.instrumentation}\`, and this run records under \`${one.run}\`, so no run here can be laid over it.`
        : `${one.suite} is not taken: the last push kept it, and the repository no longer declares it.`;
}

/** What `take` did, one line each, for a person reading the log. */
export function takenLines(result: PushedTaken): readonly string[] {
  const lines = result.unbundled === undefined ? [] : [result.unbundled];
  for (const suite of result.taken) {
    const aside = result.against?.[suite];
    lines.push(
      `${suite} reads from what the last push ran. ${
        aside === undefined
          ? "Neither the restore nor the share gave a mainline record, so a review compares its cases with the last push's."
          : `The mainline's cases are at ${aside}, for \`review --against\`.`
      }`,
    );
  }
  lines.push(...result.left.map(leftLine));
  for (const [suite, aside] of Object.entries(result.against ?? {})) {
    if (!result.taken.includes(suite)) lines.push(`${suite}: the mainline's cases are at ${aside}, for \`review --against\`.`);
  }
  if (lines.length === 0) lines.push("no earlier push kept a record, so every suite reads the mainline's.");
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
  if (result.unbundled !== undefined) lines.push(`no commit is kept beside the records: ${result.unbundled}.`);
  if (result.bundled.length > 0) {
    const count = result.bundled.length;
    lines.push(`${String(count)} ${count === 1 ? 'commit' : 'commits'} no remote holds ${count === 1 ? 'is' : 'are'} kept in ${join(dir, BUNDLE)}.`);
  }
  return lines;
}

/**
 * `carry take|keep`: lay what the last push ran over the restored records, or
 * keep what this one ran for the next. Under `--format github` the suites go to
 * `$GITHUB_OUTPUT` as `taken` and `left`, or `kept`, separated by spaces, and
 * the lines to the error stream. `line` is the mainline branch, whose commits
 * on `origin` every clone holds and `keep` leaves out of what it keeps.
 */
export async function movePushed(
  parsed: ParsedCarry,
  root: string,
  streams: { readonly out: (text: string) => void; readonly err: (text: string) => void },
  line?: string,
): Promise<ExitCode> {
  const dir = parsed.dir ?? resolve(root, PUSHED);
  let outputs: string[];
  let lines: readonly string[];
  if (parsed.direction === 'take') {
    const taken = await takePushed(root, dir, { instrumentation: instrumentationId() });
    outputs = [
      `taken=${taken.taken.join(' ')}`,
      `left=${taken.left.map((one) => one.suite).join(' ')}`,
      // The suite's name is the output's: a step reads `against-<suite>`.
      ...Object.entries(taken.against ?? {}).map(([suite, path]) => `against-${suite}=${path}`),
    ];
    lines = takenLines(taken);
  } else {
    const kept = await keepPushed(root, dir, line === undefined ? undefined : `refs/remotes/origin/${line}`);
    outputs = [`kept=${kept.kept.join(' ')}`];
    lines = keptLines(kept, dir);
  }
  return printMoved(parsed.format, outputs, lines, streams);
}

/** Under `--format github` the outputs go to `$GITHUB_OUTPUT` and the lines to the error stream; otherwise only the lines print. */
export function printMoved(
  format: ParsedCarry['format'],
  outputs: readonly string[],
  lines: readonly string[],
  streams: { readonly out: (text: string) => void; readonly err: (text: string) => void },
): ExitCode {
  if (format === 'github') {
    streams.out(`${outputs.join('\n')}\n`);
    streams.err(`${lines.join('\n')}\n`);
  } else {
    streams.out(`${lines.join('\n')}\n`);
  }
  return EXIT_CLEAN;
}
