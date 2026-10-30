import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { updateSourceIndex } from '@variance-authority/sense';
import { INSTRUMENTATION_ID } from '@variance-authority/sense/instrument';
import { commitRunsFile, encodeExecutionIndex, repositoryLayers, testCoverageFile, writeTestCoverage } from '@variance-authority/sense/test-selection';
import { digestString } from '@variance-authority/core/format';
import { main } from '../bin.js';

/** `charge` on lines 1-3 and `refund` on 5-7. */
const PAY = 'export function charge(amount: number): number {\n  return amount;\n}\n\nexport function refund(amount: number): number {\n  return -amount;\n}\n';
/** `refund`'s body rewritten; `charge` as it was. */
const REFUNDED = PAY.replace('return -amount;', 'return -amount * 2;');
const CART = 'export function cart(): number {\n  return 1;\n}\n';
const PAY_FILE = 'libs/pay/src/pay.ts';
const CART_FILE = 'libs/shop/src/cart.ts';
const TESTS = ['libs/pay/src/pay.test.ts', 'libs/pay/src/fee.test.ts', 'libs/shop/src/cart.test.ts'] as const;
const [PAY_TEST, FEE_TEST, CART_TEST] = TESTS;

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

interface Setup {
  /** Which test files entered `charge` and `refund`. */
  readonly charge: readonly number[];
  readonly refund: readonly number[];
  /** The text of `src/pay.ts` the record's rows hold. */
  readonly recorded: string;
  /** The runs beside the record, given the first commit and the record's. */
  readonly runs: (first: string, recorded: string) => unknown;
  /** Commit `REFUNDED` before recording. */
  readonly second?: true;
}

let cache: string;
let previous: string | undefined;
const made: string[] = [];

beforeAll(async () => {
  cache = await mkdtemp(join(tmpdir(), 'variance-coverage-over-cache-'));
  previous = process.env['VARIANCE_AUTHORITY_CACHE'];
  process.env['VARIANCE_AUTHORITY_CACHE'] = cache;
});

afterAll(async () => {
  if (previous === undefined) delete process.env['VARIANCE_AUTHORITY_CACHE'];
  else process.env['VARIANCE_AUTHORITY_CACHE'] = previous;
  await Promise.all([cache, ...made].map((dir) => rm(dir, { recursive: true, force: true })));
});

const landed = (files: readonly string[], texts: Record<string, string> = {}) => {
  const at = new Date().toISOString();
  return { latest: at, runs: 1, landings: [{ files, first: at, latest: at, runs: 1, texts }] };
};

/** A checkout whose `unit` record ran `src/pay.ts` and `src/cart.ts`, at its first commit or its second. */
async function checkout(setup: Setup): Promise<{ readonly at: string; readonly git: (...args: string[]) => string; readonly recorded: string }> {
  const at = await mkdtemp(join(tmpdir(), 'variance-coverage-over-'));
  made.push(at);
  const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: at, encoding: 'utf8' }).trim();
  for (const [file, text] of Object.entries(files)) {
    await mkdir(dirname(join(at, file)), { recursive: true });
    await writeFile(join(at, file), text);
  }
  git('init', '--quiet', '--initial-branch', 'main');
  git('add', '.');
  git('commit', '--quiet', '-m', 'pay');
  const first = git('rev-parse', 'HEAD');
  if (setup.second === true) {
    await writeFile(join(at, PAY_FILE), REFUNDED);
    git('commit', '--quiet', '-am', 'refund twice');
  }
  const recorded = git('rev-parse', 'HEAD');
  await updateSourceIndex(at);

  const modules: readonly (readonly [string, string, readonly Region[]])[] = [
    [PAY_FILE, setup.recorded, [
      { kind: 'module', name: PAY_FILE, path: 'module', startLine: 1, endLine: 7, tests: [0, 1] },
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
  await writeTestCoverage(file, {
    version: 3,
    instrumentation: INSTRUMENTATION_ID,
    commit: recorded,
    tests: TESTS.map((test) => ({ file: test, complete: true, preconditions: [] })),
    modules: modules.map(([path, text, regions]) => ({
      file: path,
      sourceDigest: digestString(text),
      instrumented: true,
      blocks: regions.map((region, ordinal) => ({
        ordinal, kind: region.kind, digest: digestString(`${region.kind} ${region.name}`), name: region.name, path: region.path,
        startLine: region.startLine, endLine: region.endLine, source: true, testFiles: region.tests.map((test) => TESTS[test]!),
      })),
    })),
  }, {
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
const atRecord: Setup = { charge: [0], refund: [0], recorded: PAY, runs: (_, recorded) => ({ commit: recorded, ...landed(TESTS) }) };

async function ask(...argv: string[]) {
  let out = '';
  let err = '';
  const code = await main(['coverage', ...argv], { out: (text) => (out += text), err: (text) => (err += text) });
  return { code, out, err };
}

async function json(...argv: string[]): Promise<{ readonly count: { readonly run: number; readonly over?: unknown; readonly suites: readonly { readonly over?: unknown }[] }; readonly source?: { readonly over?: unknown }; readonly entries?: readonly { readonly from: string; readonly own: { readonly over?: unknown } }[] }> {
  const answer = await ask(...argv, '--format', 'json');
  if (answer.code !== 0) throw new Error(answer.err);
  return JSON.parse(answer.out) as never;
}

describe('coverage parts what ran by the text it ran over', () => {
  it('counts an edited function as run over an older text, and the file\'s other regions as run over this one', async () => {
    const { at } = await checkout(atRecord);
    await writeFile(join(at, PAY_FILE), REFUNDED);

    const answer = await ask('--root', at);
    const said = await json('--root', at);

    expect(said.count).toMatchObject({ run: 3, over: { older: 1, notKnown: 0, why: [] } });
    expect(said.count.suites[0]!.over).toEqual({ older: 1, notKnown: 0 });
    expect(answer.out).toMatch(/unit\s+unit\s+3\s+.*1 over an older text/u);
  });

  it('parts an edit committed after the runs the same way, and names the commit the record was made at', async () => {
    const { at, git, recorded } = await checkout(atRecord);
    await writeFile(join(at, PAY_FILE), REFUNDED);
    git('commit', '--quiet', '-am', 'refund twice');

    const answer = await ask('--root', at);
    const said = await json('--root', at);

    expect(said.count).toMatchObject({ run: 3, over: { older: 1, notKnown: 0 } });
    expect(answer.out.split('\n')[0]).toContain(`coverage at ${git('rev-parse', 'HEAD').slice(0, 8)}, recorded at ${recorded.slice(0, 8)}`);
  });

  it('counts a region a test file entered at an older commit as older, though a test run at the record entered its module elsewhere', async () => {
    const { at } = await checkout({
      charge: [0],
      refund: [1],
      recorded: REFUNDED,
      second: true,
      runs: (first, recorded) => ({
        commit: recorded, ...landed([PAY_TEST, CART_TEST]),
        standing: [{ commit: first, files: [FEE_TEST], first: new Date().toISOString(), latest: new Date().toISOString(), runs: 1, texts: {} }],
      }),
    });

    const said = await json('--root', at);

    expect(said.count).toMatchObject({ run: 3, over: { older: 1, notKnown: 0 } });
  });

  it('parts each package row, and the scope of --from', async () => {
    const { at } = await checkout(atRecord);
    await writeFile(join(at, PAY_FILE), REFUNDED);

    const packages = await ask('--root', at, '--packages');
    const owned = await json('--root', at, '--packages');
    const from = await json('--root', at, '--from', 'libs/pay');

    expect(owned.entries?.map((entry) => [entry.from, entry.own.over])).toEqual([
      ['libs/pay', { older: 1, notKnown: 0 }],
      ['libs/shop', { older: 0, notKnown: 0 }],
    ]);
    expect(packages.out).toMatch(/ {2}libs\/pay\s+.*1 over an older text/u);
    expect(from.source?.over).toEqual({ older: 1, notKnown: 0 });
  });

  it('counts a region whose test ran a text that cannot be found as not known, and says why, never as run over this text', async () => {
    const lost = digestString('a text no landing kept');
    const { at } = await checkout({ ...atRecord, runs: (_, recorded) => ({ commit: recorded, ...landed(TESTS, { [PAY_FILE]: lost }) }) });
    await writeFile(join(at, PAY_FILE), REFUNDED);

    const answer = await ask('--root', at);
    const said = await json('--root', at);

    expect(said.count).toMatchObject({ run: 3, over: { older: 0, notKnown: 2 } });
    expect(answer.out).toContain(`not known: the text of ${PAY_FILE} that run ran over is neither kept nor committed`);
  });

  it('counts a region as older when the rows were cut from an uncommitted text no listed run ran, though every run ran the commit\'s text and the tree holds it', async () => {
    // A run since moved on cut the rows from `REFUNDED` at the record's commit, which holds `PAY`, as the tree does,
    // and kept the text it ran over, as a landing keeps every text its commit does not hold.
    const { at } = await checkout({ ...atRecord, recorded: REFUNDED });
    const kept = join(repositoryLayers(at).top, '.texts');
    await mkdir(kept, { recursive: true });
    await writeFile(join(kept, digestString(REFUNDED).replace(/^[^:]+:/u, '')), REFUNDED);

    const said = await json('--root', at);

    expect(said.count).toMatchObject({ run: 3, over: { older: 1, notKnown: 0, why: [] } });
  });

  it('changes no number when nothing changed since the runs, and counts nothing as older', async () => {
    const { at, recorded } = await checkout(atRecord);

    const answer = await ask('--root', at);
    const said = await json('--root', at);

    expect(said.count).toMatchObject({ run: 3, over: { older: 0, notKnown: 0, why: [] } });
    expect(answer.out.split('\n')[0]).toBe(`coverage at ${recorded.slice(0, 8)} — 5 regions in 2 files the suites loaded`);
    expect(answer.out).toMatch(/any suite\s+3\s+60\.0%/u);
  });
});

describe('coverage names why a text is not known', () => {
  /** The record's runs record, written as `runs` gives it. */
  const runsBeside = (at: string, runs: string) => writeFile(commitRunsFile(testCoverageFile(at, { suite: 'unit' })), runs);

  it('counts every region run as not known when no runs record lies beside the record, and says so once', async () => {
    const { at } = await checkout(atRecord);
    await rm(commitRunsFile(testCoverageFile(at, { suite: 'unit' })));

    const answer = await ask('--root', at);
    const said = await json('--root', at);

    expect(said.count).toMatchObject({ run: 3, over: { older: 0, notKnown: 3, why: ['no runs record lies beside the record, so where its tests ran is not known'] } });
    expect(answer.out.split('no runs record lies beside the record').length).toBe(2);
  });

  it('names a runs record of another commit, one that does not read, and one that leaves a test file out', async () => {
    const other = await checkout({ ...atRecord, recorded: REFUNDED, second: true, runs: (first) => ({ commit: first, ...landed(TESTS) }) });
    const unread = await checkout(atRecord);
    await runsBeside(unread.at, 'not a runs record');
    const partial = await checkout({ ...atRecord, refund: [1], runs: (_, recorded) => ({ commit: recorded, ...landed([PAY_TEST, CART_TEST]) }) });

    expect((await json('--root', other.at)).count).toMatchObject({
      over: { notKnown: 3, why: ['the runs record beside the record lists the runs of another commit, so where its tests ran is not known'] },
    });
    expect((await json('--root', unread.at)).count).toMatchObject({ over: { notKnown: 3, why: [expect.stringMatching(/^the runs record beside the record does not read: /u)] } });
    expect((await json('--root', partial.at)).count).toMatchObject({ over: { older: 0, notKnown: 1, why: ['the runs record does not say where some test files ran'] } });
  });

  it('keeps a function whose body gained only a comment as run over this text', async () => {
    const { at } = await checkout(atRecord);
    await writeFile(join(at, PAY_FILE), PAY.replace('  return -amount;', '  // refunds are negative\n  return -amount;'));

    const said = await json('--root', at);

    expect(said.count).toMatchObject({ run: 3, over: { older: 0, notKnown: 0, why: [] } });
  });

  it('counts a file gone from the checkout as older, and one that does not read for another reason as not known, with the reason', async () => {
    const gone = await checkout(atRecord);
    await rm(join(gone.at, PAY_FILE));
    const unreadable = await checkout(atRecord);
    await rm(join(unreadable.at, PAY_FILE));
    await mkdir(join(unreadable.at, PAY_FILE));

    expect((await json('--root', gone.at)).count).toMatchObject({ over: { older: 2, notKnown: 0 } });
    const said = await json('--root', unreadable.at);
    expect(said.count).toMatchObject({ over: { older: 0, notKnown: 2, why: [expect.stringContaining(`${PAY_FILE} does not read: EISDIR`)] } });
  });
});

describe('a review that counts coverage', () => {
  it('neither asks which text each region ran over nor says it', async () => {
    const { at } = await checkout(atRecord);
    await writeFile(join(at, PAY_FILE), REFUNDED);
    let out = '';
    let err = '';
    const review = (format: string) => main(['review', '--root', at, '--since', 'HEAD', '--coverage', '--format', format], {
      out: (text) => (out += text), err: (text) => (err += text),
    });

    expect(await review('json'), err).toBe(0);
    const said = JSON.parse(out) as { readonly coverage: readonly unknown[] };
    out = '';
    expect(await review('text'), err).toBe(0);

    expect(said.coverage.length).toBeGreaterThan(0);
    expect(JSON.stringify(said.coverage)).not.toMatch(/"over"/u);
    expect(out).not.toMatch(/older text/u);
  });
});
