import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { digestString } from '@variance-authority/core/format';
import { publishLine } from '@variance-authority/core/share';
import type { RunReport } from '@variance-authority/report';
import { updateSourceIndex } from '@variance-authority/sense';
import {
  commitRunsFile,
  encodeExecutionIndex,
  testCoverageFile,
  writeTestCoverage,
  type ExecutionBlock,
  type ExecutionIndex,
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

/**
 * The CI checkout for {@link GIT_SHARE}: `unit` given to it, one commit pushed
 * to a bare `origin`, and the record a run of the whole suite made there, in
 * which only `total.test.ts` runs `applyDiscount`. Published with a push's
 * environment unless told not to, from a cache at `ci-cache` under `home`.
 */
export async function gitPublished(
  home: string,
  options: { readonly publish?: boolean } = {},
): Promise<{ ci: string; origin: string; first: string; record: Buffer }> {
  const origin = join(home, 'origin.git');
  const ci = join(home, 'ci');
  await git(home, 'init', '--quiet', '--bare', '--initial-branch', 'main', origin);
  await git(home, 'init', '--quiet', '--initial-branch', 'main', ci);
  await git(ci, 'config', 'user.email', 'fixture@example.test');
  await git(ci, 'config', 'user.name', 'Fixture');
  await mkdir(join(ci, 'src'));
  await mkdir(join(ci, 'test'));
  await writeFile(join(ci, 'src/total.ts'), BEFORE);
  await writeFile(join(ci, 'test/total.test.ts'), "it('discounts', () => {});\n");
  await writeFile(join(ci, 'test/other.test.ts'), "it('stands alone', () => {});\n");
  await writeFile(join(ci, 'variance.config.json'), JSON.stringify({ suites: { unit: { kind: 'unit', carry: 'share' } }, share: GIT_SHARE }));
  await git(ci, 'add', '-A');
  await git(ci, 'commit', '--quiet', '-m', 'first');
  const first = await git(ci, 'rev-parse', 'HEAD');
  await git(ci, 'remote', 'add', 'origin', origin);
  await git(ci, 'push', '--quiet', 'origin', 'main');
  await git(ci, 'fetch', '--quiet', 'origin');

  process.env['VARIANCE_AUTHORITY_CACHE'] = join(home, 'ci-cache');
  await recordIn(ci, first, ['test/total.test.ts'], [DISCOUNTS]);
  await ranWhole(testCoverageFile(ci, { suite: 'unit' }), first);
  const record = await readFile(testCoverageFile(ci, { suite: 'unit' }));
  if (options.publish !== false) {
    const done = await publishSuite(ci, 'unit', { env: PUSH });
    const written = 'published' in done && done.line.kind === 'mainline' ? done.published.written : [];
    if (!written.includes(suiteEntry('unit'))) throw new Error(`the record was to reach mainline main, and the share answered ${JSON.stringify(done)}`);
  }
  return { ci, origin, first, record };
}

/** A clone of `origin` at another path, as a fresh CI checkout or a laptop has it, on `branch` when one is named. */
export async function cloneOf(home: string, origin: string, branch?: string): Promise<string> {
  const dir = join(home, 'clone');
  await git(home, 'clone', '--quiet', ...(branch === undefined ? [] : ['--branch', branch]), origin, dir);
  return dir;
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
 * would, and fail unless the suite's record reached `line`.
 */
export async function publishTo(home: string, dir: string, commit: string, env: Env, line: string): Promise<void> {
  await ranWhole(testCoverageFile(dir, { suite: 'unit' }), commit);
  const done = await publishRun(shareConfig(home), await reportAt(home, commit), { env, cwd: dir });
  const reached = 'published' in done ? `${done.line.kind} ${done.line.name}: ${done.published.written.join(', ')}` : undefined;
  const wanted = `${line}: suite-index-v1, suite-v1/unit`;
  if (reached !== wanted) throw new Error(`the run was to publish ${wanted}, and the share answered ${JSON.stringify(done)}`);
}

/**
 * What `dir` recorded, written to the mainline's line as it is, the way a
 * writer that does not check a record before publishing it would: an older CLI,
 * or another tool. `publishTo` goes through the CLI's own publish, which leaves
 * out a record that does not read or names another commit, so a test about a
 * reader meeting one of those puts it on the line this way.
 */
export async function publishRaw(home: string, dir: string, commit: string): Promise<void> {
  const cell = await lineCellOf(shareConfig(home));
  if (cell === undefined || !('load' in cell)) throw new Error(`the share in ${home} is not a line cell: ${JSON.stringify(cell)}`);
  const record = testCoverageFile(dir, { suite: 'unit' });
  const cases = await readFile(`${record}.cases.bin`).catch(() => undefined);
  const bytes = frame([['coverage.bin', await readFile(record)], ...(cases === undefined ? [] : [['coverage.bin.cases.bin', cases] as const])]);
  const done = await publishLine(cell, { kind: 'mainline', name: 'main' }, [{ name: suiteEntry('unit'), commit, bytes }], {
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
): Promise<void> {
  const record = testCoverageFile(dir, { suite: 'unit' });
  await mkdir(dirname(record), { recursive: true });
  await writeTestCoverage(record, {
    version: 3,
    instrumentation: 'fixture',
    commit,
    tests: [
      { file: 'test/total.test.ts', complete: true, preconditions: [] },
      { file: 'test/other.test.ts', complete: true, preconditions: [] },
    ],
    modules: [{
      file: 'src/total.ts',
      sourceDigest: digestString(BEFORE),
      instrumented: true,
      blocks: [{
        ordinal: 0, kind: 'function', digest: digestString('applyDiscount'), name: 'applyDiscount', path: 'applyDiscount',
        startLine: 1, endLine: 3, source: true, testFiles: [...covering],
      }],
    }],
  });
  await writeFile(`${record}.cases.bin`, encodeExecutionIndex(casesOf(cases)));
}

/**
 * The runs record a run of both test files at `commit` leaves beside `record`
 * when it lays itself over nothing: every test ran there, and none stands
 * anywhere older. It is what a mainline publishes a record on, so it is
 * written where a test publishes and never where a laptop records.
 */
export async function ranWhole(record: string, commit: string): Promise<void> {
  const at = '2026-01-01T00:00:00.000Z';
  const runs = { commit, first: at, latest: at, runs: 1, files: ['test/other.test.ts', 'test/total.test.ts'], standing: [] };
  await writeFile(commitRunsFile(record), `${JSON.stringify(runs, null, 2)}\n`);
}

/** Both test files whole, and `src/total.ts` as one module block `total.test.ts` entered. */
export async function wholeRecord(dir: string): Promise<void> {
  const record = testCoverageFile(dir, { suite: 'unit' });
  const commit = await git(dir, 'rev-parse', 'HEAD');
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
  });
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
        ordinal: 0, kind: 'function', digest: digestString('applyDiscount'), name: 'applyDiscount', path: 'applyDiscount',
        startLine: 1, endLine: 3, source: true, testFiles: ['test/total.test.ts'],
      }],
    }],
  });
  await writeFile(`${record}.cases.bin`, encodeExecutionIndex(casesOf([DISCOUNTS, ROUNDS])));
  await writeFile(commitRunsFile(record), JSON.stringify({
    commit: at, first: '2026-09-26T00:00:00.000Z', latest: '2026-09-26T00:00:00.000Z', runs: 1, files: ['test/total.test.ts'],
  }));
  // What the pipeline's `variance index` step publishes after the run; under CI, review refuses to build it itself.
  await updateSourceIndex(dir);
}

function casesOf(tests: readonly (typeof DISCOUNTS)[]): ExecutionIndex {
  const block: ExecutionBlock = {
    kind: 'function', name: 'applyDiscount', path: 'applyDiscount', startLine: 1, endLine: 3, source: true,
    crossings: [{ test: 0, distance: 0 }],
  };
  return { tests, modules: [{ file: 'src/total.ts', blocks: [block] }] };
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
