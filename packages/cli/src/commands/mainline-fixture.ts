import { execFile } from 'node:child_process';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { expect, vi } from 'vitest';
import { digestString } from '@variance-authority/core/format';
import { publishLine } from '@variance-authority/core/share';
import type { RunReport } from '@variance-authority/report';
import { updateSourceIndex } from '@variance-authority/sense';
import {
  caseSectionsAt,
  commitRunsFile,
  encodeAsSetExecutionIndex,
  testCoverageFile,
  withCaseSections,
  writeTestCoverage,
  type CoverageBlock,
  type ExecutionBlock,
  type TestCoverage,
} from '@variance-authority/sense/test-selection';
import { readFlags } from '../args.js';
import type { Config } from '../config.js';
import { parseReviewArgs } from '../review-args.js';
import { frame, suiteEntry } from '../share-entries.js';
import { lineCellOf, type Env } from '../share-lines.js';
import { flagsFor, synopsisFor } from '../usage.js';
import { indexOutput } from './index-command.js';
import { selectOutput } from './select-command.js';
import { publishRun } from './share.js';
import { suiteBase } from './suite-base.js';
import { publishSuite } from './suite-share.js';

/**
 * A mainline that published a record of `unit`, and a clone that recorded none.
 *
 * Against a real repository with a bare `origin`, and a second clone of it at
 * another path with a cache of its own, because that is the case a base read
 * from the mainline exists for: a fresh CI checkout, or a laptop that never ran
 * the suite. Every helper takes the directory the test made, so two test files
 * can share it without sharing state.
 */

const run = promisify(execFile);
export const PUSH: Env = { GITHUB_ACTIONS: 'true', GITHUB_EVENT_NAME: 'push', GITHUB_REF_TYPE: 'branch', GITHUB_REF_NAME: 'main' };

export const BEFORE = 'export function applyDiscount(price: number): number {\n  return price * 0.9;\n}\n';
const TOTAL = "import { applyDiscount } from '../src/total';\nit('discounts', () => applyDiscount(1));\n";
const OTHER = "it('stands alone', () => {});\n";
export const DISCOUNTS = { id: 'test/total.test.ts > discounts', file: 'test/total.test.ts', name: 'discounts', stopped: false };
export const ROUNDS = { id: 'test/total.test.ts > rounds', file: 'test/total.test.ts', name: 'rounds', stopped: false };

/**
 * The one module a fixture run instrumented, entered by `files`. A run that
 * instruments no module records no coverage and no runs, so a run that stands
 * for one carries this.
 */
export function probedModule(files: readonly string[]): TestCoverage['modules'][number] {
  return {
    file: 'src/probed.ts',
    sourceDigest: 'probed',
    instrumented: true,
    blocks: [{ ordinal: 0, kind: 'module', digest: 'probed', name: '', path: '', startLine: 1, endLine: 1, source: true, testFiles: [...files].sort() }],
  };
}

/**
 * The case a cased seam keeps of a run at `commit` that finished
 * `test/total.test.ts`: `DISCOUNTS`, entering the module `probedModule` holds.
 * A run that finished a test file and kept no cases leaves no case index.
 */
export function keptDiscounts(commit: string) {
  return {
    fresh: encodeAsSetExecutionIndex({
      tests: [DISCOUNTS],
      modules: [{ file: 'src/probed.ts', blocks: [{ kind: 'module', name: '', path: '', startLine: 1, endLine: 1, source: true, crossings: [{ test: 0, distance: 0 }] }] }],
    }),
    run: { tests: [{ file: 'test/total.test.ts', complete: true }], commit },
  };
}

export interface Published {
  readonly dir: string;
  readonly origin: string;
  readonly first: string;
}

/** Select in `dir` the way a runner's command line does it: from inside the checkout, with its source index built. */
export async function selectedIn(dir: string): Promise<{ out: string; err: string }> {
  process.chdir(dir);
  await indexOutput({ cwd: dir });
  return selectOutput({ cwd: dir, format: 'plain' });
}

export function parseReview(argv: readonly string[]) {
  return parseReviewArgs(readFlags(argv, 'review', flagsFor('review'), synopsisFor('review')));
}

/**
 * A mainline whose one commit declares `unit` and gives it to a directory
 * share, with the record CI made there published to the share unless told not
 * to. `record` replaces what CI recorded before it is published, for a test
 * about bytes a reader cannot use.
 */
export async function published(
  home: string,
  options: { readonly publish?: boolean; readonly record?: (dir: string) => Promise<void> } = {},
): Promise<Published> {
  const origin = join(home, 'origin.git');
  const dir = join(home, 'ci');
  await git(home, 'init', '--quiet', '--bare', '--initial-branch', 'main', origin);
  await git(home, 'init', '--quiet', '--initial-branch', 'main', dir);
  await git(dir, 'config', 'user.email', 'fixture@example.test');
  await git(dir, 'config', 'user.name', 'Fixture');
  await mkdir(join(dir, 'src'));
  await mkdir(join(dir, 'test'));
  await writeFile(join(dir, 'src/total.ts'), BEFORE);
  await writeFile(join(dir, 'test/total.test.ts'), TOTAL);
  await writeFile(join(dir, 'test/other.test.ts'), OTHER);
  await writeFile(join(dir, 'variance.config.json'), JSON.stringify({
    suites: { unit: { kind: 'unit', carry: 'share' } },
    share: shareConfig(home).share,
  }));
  await git(dir, 'add', '-A');
  await git(dir, 'commit', '--quiet', '-m', 'first');
  const first = await git(dir, 'rev-parse', 'HEAD');
  await git(dir, 'remote', 'add', 'origin', origin);
  await git(dir, 'push', '--quiet', 'origin', 'main');
  await git(dir, 'fetch', '--quiet', 'origin');

  await recordIn(dir, first, ['test/total.test.ts'], [DISCOUNTS]);
  await options.record?.(dir);
  if (options.publish !== false) await publishTo(home, dir, first, PUSH, 'mainline main');
  return { dir, origin, first };
}

/** A share on the checkout's own `origin`, whose mainline is `main`, as GitHub carries it. */
export const GIT_SHARE = { kind: 'git', mainlines: ['main'] } as const;

/** A bare `origin` under `home`, and an empty `ci` checkout beside it that commits as the fixture. */
export async function originAndCi(home: string): Promise<{ origin: string; ci: string }> {
  const origin = join(home, 'origin.git');
  const ci = join(home, 'ci');
  await git(home, 'init', '--quiet', '--bare', '--initial-branch', 'main', origin);
  await git(home, 'init', '--quiet', '--initial-branch', 'main', ci);
  await git(ci, 'config', 'user.email', 'fixture@example.test');
  await git(ci, 'config', 'user.name', 'Fixture');
  return { origin, ci };
}

/**
 * The CI checkout for {@link GIT_SHARE}: `unit` given to it, one commit pushed
 * to a bare `origin`, and the record a run of the whole suite made there, in
 * which only `total.test.ts` runs `applyDiscount`. Published with a push's
 * environment unless told not to, from a cache at `ci-cache` under `home`,
 * under the probes `instrumentation`, `fixture` unless named. `suites` are
 * declared in place of `unit` alone.
 */
export async function gitPublished(
  home: string,
  options: { readonly publish?: boolean; readonly instrumentation?: string; readonly suites?: Readonly<Record<string, unknown>>; readonly readings?: Uint8Array } = {},
): Promise<{ ci: string; origin: string; first: string; record: Buffer }> {
  const { origin, ci } = await originAndCi(home);
  await mkdir(join(ci, 'src'));
  await mkdir(join(ci, 'test'));
  await writeFile(join(ci, 'src/total.ts'), BEFORE);
  await writeFile(join(ci, 'test/total.test.ts'), "it('discounts', () => {});\n");
  await writeFile(join(ci, 'test/other.test.ts'), "it('stands alone', () => {});\n");
  const suites = options.suites ?? { unit: { kind: 'unit', carry: 'share' } };
  await writeFile(join(ci, 'variance.config.json'), JSON.stringify({ suites, share: GIT_SHARE }));
  await git(ci, 'add', '-A');
  await git(ci, 'commit', '--quiet', '-m', 'first');
  const first = await git(ci, 'rev-parse', 'HEAD');
  await git(ci, 'remote', 'add', 'origin', origin);
  await git(ci, 'push', '--quiet', 'origin', 'main');
  await git(ci, 'fetch', '--quiet', 'origin');

  vi.stubEnv('VARIANCE_AUTHORITY_CACHE', join(home, 'ci-cache'));
  await recordIn(ci, first, ['test/total.test.ts'], [DISCOUNTS], options.instrumentation, options.readings);
  await ranWhole(testCoverageFile(ci, { suite: 'unit' }), first);
  const record = await readFile(testCoverageFile(ci, { suite: 'unit' }));
  if (options.publish !== false) {
    const done = await publishSuite(ci, 'unit', { env: PUSH }, { collected: await collectedBoth(home) });
    const written = 'published' in done && done.line.kind === 'mainline' ? done.published.written : [];
    if (!written.includes(suiteEntry('unit'))) throw new Error(`the record was to reach mainline main, and the share answered ${JSON.stringify(done)}`);
  }
  return { ci, origin, first, record };
}

/** The record CI made at `commit` published to the mainline: that commit's job finishing, whenever it does. */
export async function publishedAt(home: string, ci: string, commit: string): Promise<void> {
  const reader = process.env['VARIANCE_AUTHORITY_CACHE'];
  vi.stubEnv('VARIANCE_AUTHORITY_CACHE', join(home, 'ci-cache'));
  await git(ci, 'checkout', '--quiet', commit);
  await recordIn(ci, commit, ['test/total.test.ts'], [DISCOUNTS]);
  await ranWhole(testCoverageFile(ci, { suite: 'unit' }), commit);
  const done = await publishSuite(ci, 'unit', { env: PUSH }, { collected: await collectedBoth(home) });
  await git(ci, 'checkout', '--quiet', 'main');
  if (reader === undefined) vi.unstubAllEnvs();
  else vi.stubEnv('VARIANCE_AUTHORITY_CACHE', reader);
  // The latest keeps a newer commit's record when that job finished first.
  expect(done).toMatchObject({ published: { atCommit: { kept: [commit] } } });
}

/** Take back the git cell's held answers under `cache`, as a minute passing would. */
export async function forgetLineAnswers(cache: string): Promise<void> {
  const held = (await readdir(cache, { recursive: true })).filter((path) => basename(path) === 'variance-fetched');
  for (const dir of held) await rm(join(cache, dir), { recursive: true, force: true });
  expect(held).not.toEqual([]);
}

/** A clone of `origin` at another path, as a fresh CI checkout or a laptop has it, on `branch` when one is named. */
export async function cloneOf(home: string, origin: string, branch?: string): Promise<string> {
  const dir = join(home, 'clone');
  await git(home, 'clone', '--quiet', ...(branch === undefined ? [] : ['--branch', branch]), origin, dir);
  return dir;
}

/** A clone that fetched the mainline's first record, with main then moved past it by a commit the clone holds. */
export async function behindMainline(home: string, options: { readonly publish: boolean }) {
  const asCi = () => vi.stubEnv('VARIANCE_AUTHORITY_CACHE', join(home, 'ci-cache'));
  const asClone = () => vi.stubEnv('VARIANCE_AUTHORITY_CACHE', join(home, 'clone-cache'));
  asCi();
  const ci = await published(home);
  const clone = await cloneOf(home, ci.origin);
  asClone();
  await suiteBase(clone, { env: {} });

  asCi();
  await writeFile(join(ci.dir, 'src/moved.ts'), 'export const moved = 1;\n');
  await git(ci.dir, 'add', '-A');
  await git(ci.dir, 'commit', '--quiet', '-m', 'main moves on');
  const second = await git(ci.dir, 'rev-parse', 'HEAD');
  await git(ci.dir, 'push', '--quiet', 'origin', 'main');
  if (options.publish) {
    await recordIn(ci.dir, second, ['test/total.test.ts'], [DISCOUNTS]);
    await publishTo(home, ci.dir, second, PUSH, 'mainline main');
  }
  asClone();
  await git(clone, 'pull', '--quiet', 'origin', 'main');
  process.chdir(clone);
  return { ...ci, clone, second };
}

/** The config a CI run publishes with: `unit` given to the directory share, whose mainline is `main`. */
export function shareConfig(home: string): Config {
  return {
    project: 'web',
    report: join(home, 'report.json'),
    share: { kind: 'directory', root: join(home, 'share'), mainlines: ['main'] },
    suites: [{ name: 'unit', kind: 'unit', carry: 'share' }],
  } as unknown as Config;
}

/**
 * Publish what `dir` recorded at `commit`, as a run of the whole suite there
 * would, and fail unless the suite's record reached `line`. A mainline takes
 * the record only from `share --suite` given the runner's collected list, so
 * there the run's publish carries the index and the suite's carries the record,
 * as check.yml publishes them.
 */
export async function publishTo(home: string, dir: string, commit: string, env: Env, line: string): Promise<void> {
  await ranWhole(testCoverageFile(dir, { suite: 'unit' }), commit);
  const mainline = line.startsWith('mainline ');
  const done = await publishRun(shareConfig(home), await reportAt(home, commit), { env, cwd: dir });
  const reached = 'published' in done ? `${done.line.kind} ${done.line.name}: ${done.published.written.join(', ')}` : undefined;
  const wanted = `${line}: ${mainline ? 'suite-index-v2' : 'suite-index-v2, suite-v1/unit'}`;
  if (reached !== wanted) throw new Error(`the run was to publish ${wanted}, and the share answered ${JSON.stringify(done)}`);
  if (!mainline) return;
  const suite = await publishSuite(dir, 'unit', { env }, { collected: await collectedBoth(home) });
  const written = 'published' in suite ? `${suite.line.kind} ${suite.line.name}: ${suite.published.written.join(', ')}` : undefined;
  if (written !== `${line}: suite-v1/unit`) throw new Error(`the record was to reach ${line}, and the share answered ${JSON.stringify(suite)}`);
}

/** The runner's collected list for the fixture's suite: both of its test files. */
export async function collectedBoth(home: string): Promise<string> {
  const path = join(home, 'collected.txt');
  await writeFile(path, 'test/other.test.ts\ntest/total.test.ts\n');
  return path;
}

/**
 * What `dir` recorded, written to the mainline's line as it is, the way a
 * writer that does not check a record before publishing it would: an older CLI,
 * or another tool. `publishTo` goes through the CLI's own publish, which leaves
 * out a record that does not read or names another commit, so a test about a
 * reader meeting one of those puts it on the line this way. `withRuns` puts the
 * runs record beside it, `partial` marks the entry as the merge queue's publish
 * of part of the suite does, and `share: 'git'` publishes to the share
 * `gitPublished` configures.
 */
export async function publishRaw(
  home: string,
  dir: string,
  commit: string,
  options: { readonly withRuns?: boolean; readonly partial?: true; readonly share?: 'git' } = {},
): Promise<void> {
  const cell = options.share === 'git' ? await lineCellOf({ share: GIT_SHARE } as unknown as Config, { cwd: dir }) : await lineCellOf(shareConfig(home));
  if (cell === undefined || !('load' in cell)) throw new Error(`the share in ${home} is not a line cell: ${JSON.stringify(cell)}`);
  const record = testCoverageFile(dir, { suite: 'unit' });
  const runs: [string, Uint8Array][] = options.withRuns === true ? [['coverage.runs.json', await readFile(commitRunsFile(record))]] : [];
  const bytes = frame([['coverage.bin', await readFile(record)], ...runs]);
  const done = await publishLine(cell, { kind: 'mainline', name: 'main' }, [{ name: suiteEntry('unit'), commit, bytes, ...(options.partial ? { partial: true as const } : {}) }], {
    descends: async () => undefined,
    image: async (digest) => { throw new Error(`no image ${digest}`); },
  });
  if (!('written' in done) || !done.written.includes(suiteEntry('unit'))) {
    throw new Error(`the record was to reach mainline main, and the share answered ${JSON.stringify(done)}`);
  }
}

/**
 * A branch `feat/x` off `dir`'s `main`, pushed, and the record a pull request
 * run made there published to the branch's own line: one that says the other
 * test covers `applyDiscount`, which the mainline's record does not.
 */
export async function branchPublished(home: string, dir: string): Promise<string> {
  await git(dir, 'checkout', '--quiet', '-b', 'feat/x');
  await git(dir, 'commit', '--quiet', '--allow-empty', '-m', 'on the branch');
  const head = await git(dir, 'rev-parse', 'HEAD');
  await git(dir, 'push', '--quiet', 'origin', 'feat/x');
  await recordIn(dir, head, ['test/other.test.ts'], [DISCOUNTS]);
  const event = join(home, 'event.json');
  const repo = { full_name: 'acme/web' };
  await writeFile(event, JSON.stringify({ pull_request: { head: { sha: head, repo }, base: { repo } } }));
  const env: Env = { GITHUB_ACTIONS: 'true', GITHUB_EVENT_NAME: 'pull_request', GITHUB_HEAD_REF: 'feat/x', GITHUB_EVENT_PATH: event };
  await publishTo(home, dir, head, env, 'branch feat/x');
  return head;
}

/** The record CI makes in `dir` at `commit`: both test files whole, `covering` the ones that ran `applyDiscount`. */
export async function recordIn(
  dir: string,
  commit: string,
  covering: readonly string[],
  cases: readonly (typeof DISCOUNTS)[],
  instrumentation = 'fixture',
  readings?: Uint8Array,
): Promise<void> {
  const record = testCoverageFile(dir, { suite: 'unit' });
  await mkdir(dirname(record), { recursive: true });
  const blocks = [totalModule(covering), {
    ordinal: 1, owner: 0, kind: 'function' as const, digest: digestString('applyDiscount'), name: 'applyDiscount', path: 'applyDiscount',
    startLine: 1, endLine: 3, source: true, testFiles: [...covering],
  }];
  await writeTestCoverage(record, { ...totalCoverage(commit, ['test/total.test.ts', 'test/other.test.ts'], blocks), instrumentation });
  await keepCases(record, casesIndex(cases), readings);
}

/** What a run of `tests`, each whole, records at `commit` over `src/total.ts` as `BEFORE` holds it: `blocks`, the module first. */
export function totalCoverage(commit: string, tests: readonly string[], blocks: readonly CoverageBlock[]): TestCoverage {
  return {
    version: 3,
    instrumentation: 'fixture',
    commit,
    tests: tests.map((file) => ({ file, complete: true, preconditions: [] })),
    modules: [{ file: 'src/total.ts', sourceDigest: digestString(BEFORE), instrumented: true, blocks: [...blocks] }],
  };
}

/** The module block of `src/total.ts`, which the tests in `covering` entered. */
export function totalModule(covering: readonly string[]): CoverageBlock {
  return {
    ordinal: 0, kind: 'module', digest: digestString('module'), name: '', path: 'module',
    startLine: 1, endLine: 3, source: true, testFiles: [...covering],
  };
}

/**
 * The runs record a run of both test files at `commit` leaves beside `record`
 * when it lays itself over nothing: every test ran there, and none stands
 * anywhere older. It is what a mainline publishes a record on, so it is
 * written where a test publishes and never where a laptop records.
 */
export async function ranWhole(record: string, commit: string): Promise<void> {
  const at = '2026-01-01T00:00:00.000Z';
  const runs = { commit, latest: at, runs: 1, landings: [{ files: ['test/other.test.ts', 'test/total.test.ts'], first: at, latest: at, runs: 1 }], standing: [] };
  await writeFile(commitRunsFile(record), `${JSON.stringify(runs, null, 2)}\n`);
}

/**
 * Both test files whole, and `src/total.ts` as one module block `total.test.ts`
 * entered, over the coverage CI recorded. The cases that run kept stay in the
 * record, as they stayed when a later run rewrote its coverage alone.
 */
export async function wholeRecord(dir: string): Promise<void> {
  const record = testCoverageFile(dir, { suite: 'unit' });
  const commit = await git(dir, 'rev-parse', 'HEAD');
  const cases = caseSectionsAt(record);
  await writeTestCoverage(record, {
    version: 3,
    instrumentation: 'fixture',
    commit,
    tests: [
      { file: 'test/other.test.ts', complete: true, preconditions: [] },
      { file: 'test/total.test.ts', complete: true, preconditions: [] },
    ],
    modules: [{
      file: 'src/total.ts',
      sourceDigest: 'source:total',
      instrumented: true,
      blocks: [{
        ordinal: 0, kind: 'module', digest: 'block:0', name: 'total', path: 'module',
        startLine: 1, endLine: 3, source: true, testFiles: ['test/total.test.ts'],
      }],
    }],
  }, cases);
}

/**
 * A change in the working tree of `dir`, and the run over it: a record that
 * describes the change, a case index with the case it added, and the runs file
 * of a run that found no recording to lay itself over.
 */
export async function ranHere(dir: string, at: string): Promise<void> {
  const after = `${BEFORE.replace('0.9', '0.8')}`;
  await writeFile(join(dir, 'src/total.ts'), after);
  await writeFile(join(dir, 'test/total.test.ts'), `${TOTAL}it('rounds', () => {});\n`);
  process.chdir(dir);
  const record = testCoverageFile(dir, { suite: 'unit' });
  await mkdir(dirname(record), { recursive: true });
  await writeTestCoverage(record, {
    version: 3,
    instrumentation: 'fixture',
    commit: at,
    tests: [{ file: 'test/total.test.ts', complete: true, preconditions: [] }],
    modules: [{
      file: 'src/total.ts',
      sourceDigest: digestString(after),
      instrumented: true,
      blocks: [{
        ordinal: 0, kind: 'module', digest: digestString('module'), name: '', path: 'module',
        startLine: 1, endLine: 3, source: true, testFiles: ['test/total.test.ts'],
      }, {
        ordinal: 1, owner: 0, kind: 'function', digest: digestString('applyDiscount'), name: 'applyDiscount', path: 'applyDiscount',
        startLine: 1, endLine: 3, source: true, testFiles: ['test/total.test.ts'],
      }],
    }],
  });
  await keepCases(record, casesIndex([DISCOUNTS, ROUNDS]));
  const landed = '2026-09-26T00:00:00.000Z';
  await writeFile(commitRunsFile(record), JSON.stringify({
    commit: at, latest: landed, runs: 1, landings: [{ files: ['test/total.test.ts'], first: landed, latest: landed, runs: 1 }],
  }));
  // What the pipeline's `variance index` step publishes after the run; under CI, review refuses to build it itself.
  await updateSourceIndex(dir);
}

/** `index`, kept in the record at `record` the way a run keeps its cases, with `readings` beside it when given. */
async function keepCases(record: string, index: Uint8Array, readings?: Uint8Array): Promise<void> {
  await writeFile(record, withCaseSections(await readFile(record), { index, ...(readings === undefined ? {} : { readings }) }));
}

/** The case index a run that ran `tests` keeps, each entering `applyDiscount`. */
export function casesIndex(tests: readonly (typeof DISCOUNTS)[]): Uint8Array {
  const block: ExecutionBlock = {
    kind: 'function', name: 'applyDiscount', path: 'applyDiscount', startLine: 1, endLine: 3, source: true,
    crossings: [{ test: 0, distance: 0 }],
  };
  return encodeAsSetExecutionIndex({ tests, modules: [{ file: 'src/total.ts', blocks: [block] }] });
}

async function reportAt(home: string, commit: string): Promise<string> {
  const path = join(home, `run-${commit}.json`);
  const report = {
    runVersion: 1,
    identity: { renderer: 'playwright-chromium', engine: 'chromium@131', platform: 'linux/x64', deviceScaleFactor: 1, fonts: [] },
    observations: [],
    run: { id: 'run-1', commit },
    composition: { subjects: [], components: [] },
    lexicon: { version: 1, fields: ['components'], subjects: [] },
  } as unknown as RunReport;
  await writeFile(path, JSON.stringify(report));
  return path;
}

export async function git(at: string, ...args: string[]): Promise<string> {
  return (await run('git', args, { cwd: at })).stdout.trim();
}

/** The argv of every git process `work` started in the checkout at `at`, read from git's own trace. */
export async function gitStarted(at: string, work: () => Promise<unknown>): Promise<string[][]> {
  const trace = join(at, '.git', 'variance-trace.json');
  await rm(trace, { force: true });
  vi.stubEnv('GIT_TRACE2_EVENT', trace);
  try {
    await work();
  } finally {
    vi.stubEnv('GIT_TRACE2_EVENT', undefined);
  }
  const events = (await readFile(trace, 'utf8').catch(() => '')).trim().split('\n').filter((line) => line !== '');
  return events
    .map((line) => JSON.parse(line) as { event: string; argv?: string[] })
    .filter((event) => event.event === 'start')
    .map((event) => (event.argv ?? []).slice(1));
}
