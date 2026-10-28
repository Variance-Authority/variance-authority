// compass: variance-authority.reach
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll } from 'vitest';
import { encodeExecutionIndex, testCoverageFile, writeTestCoverage, commitRunsFile } from '@variance-authority/sense/test-selection';
import { updateSourceIndex } from '@variance-authority/sense';
import { INSTRUMENTATION_ID } from '@variance-authority/sense/instrument';
import { digestString } from '@variance-authority/core/format';
import { main } from '../bin.js';

/**
 * A checkout whose `unit` record ran `src/pay.ts`, for the tests of how fresh
 * and how actual a `covering` answer says it is: the text the record's lines
 * are numbered in, and where, when and over which text each test file last ran.
 */

export const PAY = 'export function pay(amount: number): number {\n  if (amount < 0) {\n    return 0;\n  }\n  return amount;\n}\n';
export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;
export const iso = (ms: number): string => new Date(ms).toISOString();
export const sha = (commit: string | undefined): string => commit!.slice(0, 12);
/** What a record with no runs beside it says, in its JSON, of where its tests ran. */
export const unplaced = (commit: string | undefined): string =>
  `no runs record lies beside the snapshot, so every test is read as though it last ran at ${sha(commit)}`;
/** A runs record's fields for one run that landed `at` and finished `files` over `texts`, the commit's own unless named. */
export const oneRun = (at: string, files: readonly string[], texts: Record<string, string> = {}) =>
  ({ first: at, latest: at, runs: 1, files, landings: [{ files, first: at, latest: at, runs: 1, texts }] });
/** What a covering answer says of a test file the record could not place. */
export const ASSUMED = 'The record does not say where the test file named here last ran, so where it ran is assumed, not observed.\n';

/**
 * The index the record holds: `src/pay.test.ts` entered `pay`, and with `fee`,
 * `src/fee.test.ts` did too; no case ran its branch. With `refunds`,
 * `src/pay.test.ts` holds a second case, `r`, which enters `pay` or not.
 */
export function indexOf(fee = false, refunds?: 'enters' | 'idle'): { readonly tests: readonly object[]; readonly modules: readonly object[] } {
  const tests = [
    { id: 'p', file: 'src/pay.test.ts', name: 'charges once' },
    ...(fee ? [{ id: 'f', file: 'src/fee.test.ts', name: 'charges a fee' }] : []),
    ...(refunds === undefined ? [] : [{ id: 'r', file: 'src/pay.test.ts', name: 'refunds' }]),
  ];
  const crossings = tests.flatMap((test, at) => (test.id !== 'r' || refunds === 'enters' ? [{ test: at, distance: 0 }] : []));
  return {
    tests,
    modules: [{
      file: 'src/pay.ts',
      blocks: [
        { kind: 'function', name: 'pay', path: 'entry', startLine: 1, endLine: 6, source: true, crossings },
        { kind: 'branch', name: 'pay', path: 'if#0/then', startLine: 2, endLine: 4, source: true, crossings: [] },
      ],
    }],
  };
}

export interface Fixture {
  /** When the record's commit was committed, in ms; three days and an hour ago unless given. */
  readonly committed?: number;
  /** The commit the record names instead of the one it was made at; `null` for none. */
  readonly recordedAt?: string | null;
  /** The text whose digest the record holds for `src/pay.ts`, when not the committed one. */
  readonly ranOver?: string;
  /** How the record holds `src/pay.ts`: an instrumented row unless given, `loaded` for a row the build did not instrument, `false` for none. */
  readonly row?: 'loaded' | false;
  /** The text of `src/setup.ts`, committed and loaded by `src/pay.test.ts` without instrumenting it, when given. */
  readonly setup?: string;
  /** The text of `src/setup.ts` the record holds `src/pay.test.ts` ran over, when not `setup`. */
  readonly setupRanOver?: string;
  /** `src/fee.test.ts` entered `pay` too. */
  readonly fee?: true;
  /** `src/pay.test.ts` holds a second case, `refunds`, that enters `pay` or not. */
  readonly refunds?: 'enters' | 'idle';
  /**
   * A second commit, at `committed` ms, that the record names: it writes `pay`
   * to `src/pay.ts` when given, and `src/other.ts` otherwise.
   */
  readonly second?: { readonly committed: number; readonly pay?: string };
  /** The runs record written beside the snapshot, given the first commit and the record's. */
  readonly runs?: (first: string, recorded: string | undefined) => unknown;
}

export interface RecordFixture {
  /** A checkout whose `unit` record ran `src/pay.ts` at its first commit, or at the second when there is one. */
  readonly checkout: (options?: Fixture) => Promise<{ readonly at: string; readonly commit: string | undefined; readonly first: string }>;
  /** `covering` asked in `root`, in text and as the JSON of its one suite. */
  readonly ask: (root: string, ...argv: string[]) => Promise<{ readonly text: string; readonly json: Record<string, unknown> }>;
}

/** {@link RecordFixture}, under a cache of its own that the file's tests share and that is removed after them. */
export function recordFixture(): RecordFixture {
  let cache: string;
  let previous: string | undefined;
  const made: string[] = [];

  beforeAll(async () => {
    cache = await mkdtemp(join(tmpdir(), 'variance-covering-record-cache-'));
    previous = process.env['VARIANCE_AUTHORITY_CACHE'];
    process.env['VARIANCE_AUTHORITY_CACHE'] = cache;
  });

  afterAll(async () => {
    if (previous === undefined) delete process.env['VARIANCE_AUTHORITY_CACHE'];
    else process.env['VARIANCE_AUTHORITY_CACHE'] = previous;
    await Promise.all([cache, ...made].map((dir) => rm(dir, { recursive: true, force: true })));
  });

  const checkout: RecordFixture['checkout'] = async (options = {}) => {
    const at = await mkdtemp(join(tmpdir(), 'variance-covering-record-'));
    made.push(at);
    const date = (ms: number) => `@${String(Math.floor(ms / 1000))} +0000`;
    const git = (args: readonly string[], when?: number) =>
      execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], {
        cwd: at,
        encoding: 'utf8',
        ...(when === undefined ? {} : { env: { ...process.env, GIT_COMMITTER_DATE: date(when), GIT_AUTHOR_DATE: date(when) } }),
      }).trim();
    const write = async (file: string, text: string) => {
      await mkdir(dirname(join(at, file)), { recursive: true });
      await writeFile(join(at, file), text);
    };
    git(['init', '--quiet', '--initial-branch', 'main']);
    await write('package.json', '{"name":"covering-record-fixture","private":true}\n');
    await write('variance.config.json', JSON.stringify({ suites: { unit: { kind: 'unit' } } }));
    await write('src/pay.ts', PAY);
    await write('src/pay.test.ts', "import { pay } from './pay';\nexport const paid = pay(1);\n");
    if (options.fee === true) await write('src/fee.test.ts', "import { pay } from './pay';\nexport const fee = pay(2);\n");
    if (options.setup !== undefined) await write('src/setup.ts', options.setup);
    git(['add', '.']);
    git(['commit', '--quiet', '-m', 'pay'], options.committed ?? Date.now() - (3 * DAY + HOUR));
    const first = git(['rev-parse', 'HEAD']);
    if (options.second !== undefined) {
      await (options.second.pay === undefined ? write('src/other.ts', 'export const other = 1;\n') : write('src/pay.ts', options.second.pay));
      git(['add', '.']);
      git(['commit', '--quiet', '-m', 'second'], options.second.committed);
    }
    const commit = options.recordedAt === null ? undefined : options.recordedAt ?? git(['rev-parse', 'HEAD']);

    // Under CI nothing builds the source index implicitly; the fixture publishes it, as the pipeline's `variance index` step does.
    await updateSourceIndex(at);

    const file = testCoverageFile(at, { suite: 'unit' });
    await mkdir(dirname(file), { recursive: true });
    const testFiles = ['src/pay.test.ts', ...(options.fee === true ? ['src/fee.test.ts'] : [])];
    const pay = {
      file: 'src/pay.ts',
      sourceDigest: digestString(options.ranOver ?? options.second?.pay ?? PAY),
      instrumented: options.row === undefined,
      // A module has regions exactly when the build instrumented it.
      blocks: options.row !== undefined ? [] : [{
        ordinal: 0, kind: 'module' as const, digest: digestString('module src/pay.ts'), name: 'src/pay.ts', path: 'module',
        startLine: 1, endLine: 6, source: true, testFiles,
      }],
    };
    await writeTestCoverage(file, {
      version: 3,
      instrumentation: INSTRUMENTATION_ID,
      ...(commit === undefined ? {} : { commit }),
      tests: testFiles.map((test) => ({
        file: test,
        complete: true,
        // A module the run loaded without instrumenting it is a precondition of the test file that loaded it.
        preconditions: options.setup === undefined || test !== 'src/pay.test.ts' ? [] : [{ name: 'src/setup.ts', digest: digestString(options.setupRanOver ?? options.setup) }],
      })),
      modules: [
        ...(options.row === false ? [] : [pay]),
        ...(options.setup === undefined ? [] : [{ file: 'src/setup.ts', sourceDigest: digestString(options.setupRanOver ?? options.setup), instrumented: false, blocks: [] }]),
      ],
    }, {
      index: encodeExecutionIndex(indexOf(options.fee === true, options.refunds) as Parameters<typeof encodeExecutionIndex>[0]),
    });
    const runs = options.runs?.(first, commit);
    if (runs !== undefined) await writeFile(commitRunsFile(file), typeof runs === 'string' ? runs : JSON.stringify(runs));
    return { at, commit, first };
  };

  const ask: RecordFixture['ask'] = async (root, ...argv) => {
    const run = async (format: string[]) => {
      let out = '';
      let err = '';
      await main(['covering', '--root', root, ...argv, ...format], { out: (text) => (out += text), err: (text) => (err += text) });
      return out + err;
    };
    const raw = await run(['--format', 'json']);
    if (!raw.startsWith('{')) throw new Error(raw);
    const said = JSON.parse(raw) as { readonly suites?: readonly Record<string, unknown>[] } & Record<string, unknown>;
    return { text: await run([]), json: said.suites?.[0] ?? said };
  };

  return { checkout, ask };
}
