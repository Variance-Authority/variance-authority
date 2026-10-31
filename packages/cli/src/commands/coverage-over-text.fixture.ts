// compass: variance-authority.reach.crossings
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { updateSourceIndex } from '@variance-authority/sense';
import { INSTRUMENTATION_ID } from '@variance-authority/sense/instrument';
import { commitRunsFile, encodeExecutionIndex, landRun, NO_BLOB, openTestCoverage, testCoverageFile, writeTestCoverage, type TestCoverage } from '@variance-authority/sense/test-selection';
import { digestString } from '@variance-authority/core/format';
import { main } from '../bin.js';
import { hashObject } from './review-fixture.js';

/** `charge` on lines 1-3 and `refund` on 5-7. */
export const PAY = 'export function charge(amount: number): number {\n  return amount;\n}\n\nexport function refund(amount: number): number {\n  return -amount;\n}\n';
/** `refund`'s body rewritten; `charge` as it was. */
export const REFUNDED = PAY.replace('return -amount;', 'return -amount * 2;');
export const CART = 'export function cart(): number {\n  return 1;\n}\n';
export const PAY_FILE = 'libs/pay/src/pay.ts';
const CART_FILE = 'libs/shop/src/cart.ts';
export const TESTS = ['libs/pay/src/pay.test.ts', 'libs/pay/src/fee.test.ts', 'libs/shop/src/cart.test.ts'] as const;
export const [PAY_TEST, FEE_TEST, CART_TEST] = TESTS;

const files: Record<string, string> = {
  'package.json': JSON.stringify({ name: 'root', private: true, workspaces: ['libs/*'] }),
  'variance.config.json': JSON.stringify({ suites: { unit: { kind: 'unit' } } }),
  'libs/pay/package.json': JSON.stringify({ name: 'pay' }),
  [PAY_FILE]: PAY,
  [PAY_TEST]: "import { charge, refund } from './pay';\ncharge(1);\nrefund(1);\n",
  [FEE_TEST]: "import { refund } from './pay';\nrefund(2);\n",
  'libs/shop/package.json': JSON.stringify({ name: 'shop' }),
  [CART_FILE]: CART,
  [CART_TEST]: "import { cart } from './cart';\ncart();\n",
};

interface Region {
  readonly kind: 'module' | 'function';
  readonly name: string;
  readonly path: string;
  readonly startLine: number;
  readonly endLine: number;
  /** The test files, by their place in `TESTS`, that called into the region; a module's are loads. */
  readonly tests: readonly number[];
}

export interface Setup {
  /** Which test files entered `charge` and `refund`. */
  readonly charge: readonly number[];
  readonly refund: readonly number[];
  /** The text of `src/pay.ts` the record's rows hold. */
  readonly recorded: string;
  /** The runs beside the record, given the first commit and the record's. */
  readonly runs: (first: string, recorded: string) => unknown;
  /** Commit `REFUNDED` before recording. */
  readonly second?: true;
  /** Write the rows as a record made before rows named their text by its git blob. */
  readonly unkeyed?: true;
  /**
   * Check the checkout out under `core.autocrlf`, every text on disk with CRLF and every blob with LF, and land the
   * rows as a run does, so the landing names their text.
   */
  readonly crlf?: true;
  /** Where the checkout holds `src/pay.ts`'s text, and the record's rows name it, when not at `PAY_FILE`. */
  readonly payAt?: string;
}

/** The checkouts made, for the test file to remove. */
export const made: string[] = [];

export const landed = (files: readonly string[], texts: Record<string, string> = {}) => {
  const at = new Date().toISOString();
  return { latest: at, runs: 1, landings: [{ files, first: at, latest: at, runs: 1, texts }] };
};

/** A checkout whose `unit` record ran `src/pay.ts` and `src/cart.ts`, at its first commit or its second. */
export async function checkout(setup: Setup): Promise<{ readonly at: string; readonly git: (...args: string[]) => string; readonly recorded: string }> {
  const at = await mkdtemp(join(tmpdir(), 'variance-coverage-over-'));
  made.push(at);
  const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: at, encoding: 'utf8' }).trim();
  for (const [file, text] of Object.entries(files)) {
    await mkdir(dirname(join(at, file)), { recursive: true });
    await writeFile(join(at, file), text);
  }
  if (setup.payAt !== undefined) {
    await rm(join(at, PAY_FILE));
    await writeFile(join(at, setup.payAt), PAY);
  }
  git('init', '--quiet', '--initial-branch', 'main');
  if (setup.crlf === true) {
    git('config', 'core.autocrlf', 'true');
    for (const file of [PAY_FILE, CART_FILE]) await writeFile(join(at, file), files[file]!.replaceAll('\n', '\r\n'));
  }
  git('add', '.');
  git('commit', '--quiet', '-m', 'pay');
  const first = git('rev-parse', 'HEAD');
  if (setup.second === true) {
    await writeFile(join(at, PAY_FILE), REFUNDED);
    git('commit', '--quiet', '-am', 'refund twice');
  }
  const recorded = git('rev-parse', 'HEAD');
  await updateSourceIndex(at);
  /** The text a run read off the disk for `text`. */
  const disk = (text: string) => (setup.crlf === true ? text.replaceAll('\n', '\r\n') : text);

  const modules: readonly (readonly [string, string, readonly Region[]])[] = [
    [setup.payAt ?? PAY_FILE, setup.recorded, [
      { kind: 'module', name: setup.payAt ?? PAY_FILE, path: 'module', startLine: 1, endLine: 7, tests: [0, 1] },
      { kind: 'function', name: 'charge', path: 'entry', startLine: 1, endLine: 3, tests: setup.charge },
      { kind: 'function', name: 'refund', path: 'entry', startLine: 5, endLine: 7, tests: setup.refund },
    ]],
    [CART_FILE, CART, [
      { kind: 'module', name: CART_FILE, path: 'module', startLine: 1, endLine: 3, tests: [2] },
      { kind: 'function', name: 'cart', path: 'entry', startLine: 1, endLine: 3, tests: [2] },
    ]],
  ];
  const file = testCoverageFile(at, { suite: 'unit' });
  await mkdir(dirname(file), { recursive: true });
  const coverage = (named: (path: string, text: string) => string | undefined): TestCoverage => ({
    version: 3,
    instrumentation: INSTRUMENTATION_ID,
    commit: recorded,
    tests: TESTS.map((test) => ({ file: test, complete: true, preconditions: [] })),
    modules: modules.map(([path, text, regions]) => ({
      file: path,
      sourceDigest: digestString(disk(text)),
      ...(named(path, text) === undefined ? {} : { sourceBlob: named(path, text) }),
      instrumented: true,
      blocks: regions.map((region, ordinal) => ({
        ordinal, kind: region.kind, digest: digestString(`${region.kind} ${region.name}`), name: region.name, path: region.path,
        startLine: region.startLine, endLine: region.endLine, source: true, testFiles: region.tests.map((test) => TESTS[test]!),
      })),
    })),
  });
  // Landed as a run is, beside the record, the rows are named by the landing.
  let landed: ReadonlyMap<string, string | undefined> | undefined;
  if (setup.crlf === true) {
    const run = join(at, 'landed.bin');
    await landRun(run, coverage(() => undefined), at);
    const view = openTestCoverage(await readFile(run));
    landed = new Map(Array.from({ length: view.modulePath.length }, (_, module) => [
      view.string(view.modulePath.at(module)),
      view.moduleBlob === undefined || view.moduleBlob.at(module) === NO_BLOB ? undefined : view.string(view.moduleBlob.at(module)),
    ]));
    await rm(run);
  }
  await writeTestCoverage(file, coverage((path, text) => (
    setup.unkeyed === true ? undefined : landed === undefined ? hashObject(text) : landed.get(path)
  )), {
    index: encodeExecutionIndex({
      tests: TESTS.map((test, id) => ({ id: String(id), file: test, name: 'runs', stopped: false })),
      modules: modules.map(([path, , regions]) => ({
        file: path,
        blocks: regions.map(({ tests, ...region }) => ({
          ...region, source: true,
          crossings: tests.map((test) => ({ test, distance: 0, ...(region.kind === 'module' ? { loaded: true } : {}) })),
        })),
      })),
    }),
  });
  await writeFile(commitRunsFile(file), JSON.stringify(setup.runs(first, recorded)));
  return { at, git, recorded };
}

/** Every test file ran at the record's commit, over its texts. */
export const atRecord: Setup = { charge: [0], refund: [0], recorded: PAY, runs: (_, recorded) => ({ commit: recorded, ...landed(TESTS) }) };

export async function ask(...argv: string[]) {
  let out = '';
  let err = '';
  const code = await main(['coverage', ...argv], { out: (text) => (out += text), err: (text) => (err += text) });
  return { code, out, err };
}

export async function json(...argv: string[]): Promise<{ readonly count: { readonly run: number; readonly over?: unknown; readonly suites: readonly { readonly over?: unknown }[] }; readonly source?: { readonly over?: unknown }; readonly entries?: readonly { readonly from: string; readonly own: { readonly over?: unknown } }[] }> {
  const answer = await ask(...argv, '--format', 'json');
  if (answer.code !== 0) throw new Error(answer.err);
  return JSON.parse(answer.out) as never;
}
