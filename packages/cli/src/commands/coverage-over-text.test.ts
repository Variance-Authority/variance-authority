import { execFileSync } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { sourceIndexPath, updateSourceIndex } from '@variance-authority/sense';
import { INSTRUMENTATION_ID } from '@variance-authority/sense/instrument';
import { commitRunsFile, editOf, encodeExecutionIndex, landRun, NO_BLOB, openTestCoverage, repositoryLayers, testCoverageFile, writeTestCoverage, type TestCoverage } from '@variance-authority/sense/test-selection';
import { digestString } from '@variance-authority/core/format';
import { main } from '../bin.js';
import { textOver } from './coverage-over-text.js';
import { hashObject } from './review-fixture.js';

// `ci-info` decides CI once, when it loads, so the module is cut: a test that runs as CI sets `ci.isCI`.
const ci = vi.hoisted(() => ({ isCI: false }));
vi.mock('ci-info', () => ({ get isCI() { return ci.isCI; } }));
// Counted, not changed: which texts a split hashes and diffs, and whether a review asks for the split at all.
vi.mock('@variance-authority/core/format', async (importOriginal) => {
  const original = await importOriginal<typeof import('@variance-authority/core/format')>();
  return { ...original, digestString: vi.fn(original.digestString) };
});
vi.mock('@variance-authority/sense/test-selection', async (importOriginal) => {
  const original = await importOriginal<typeof import('@variance-authority/sense/test-selection')>();
  return { ...original, editOf: vi.fn(original.editOf) };
});
vi.mock('./coverage-over-text.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('./coverage-over-text.js')>();
  return { ...original, textOver: vi.fn(original.textOver) };
});

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
  /** Write the rows as a record made before rows named their text by its git blob. */
  readonly unkeyed?: true;
  /**
   * Check the checkout out under `core.autocrlf`, every text on disk with CRLF and every blob with LF, and land the
   * rows as a run does, so the landing names their text.
   */
  readonly crlf?: true;
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

  it('counts a region as older when the tree holds another text than the rows, by the name the source index gives the tree\'s text', async () => {
    // Every run ran the commit's text, which the rows were cut from; the tree's text is not that one.
    const { at } = await checkout(atRecord);
    await writeFile(join(at, PAY_FILE), REFUNDED);
    await updateSourceIndex(at);

    const said = await json('--root', at);

    expect(said.count).toMatchObject({ run: 3, over: { older: 1, notKnown: 0, why: [] } });
  });

  it('counts an unchanged file git cleans on the way in (core.autocrlf) as run over this text', async () => {
    const { at } = await checkout({ ...atRecord, crlf: true });

    expect((await json('--root', at)).count).toMatchObject({ run: 3, over: { older: 0, notKnown: 0, why: [] } });
  });

  it('changes no number when nothing changed since the runs, and counts nothing as older', async () => {
    const { at, recorded } = await checkout(atRecord);

    const answer = await ask('--root', at);
    const said = await json('--root', at);

    expect(said.count).toMatchObject({ run: 3, over: { older: 0, notKnown: 0, why: [] } });
    expect(answer.out.split('\n')[0]).toBe(`coverage at ${recorded.slice(0, 8)} — 5 regions in 2 files the suites loaded`);
    expect(answer.out).toMatch(/any suite\s+3\s+60\.0%/u);
  });

  it('names the tree\'s texts by the source index and hashes none of them, diffing one pair once per answer', async () => {
    const { at } = await checkout(atRecord);
    await writeFile(join(at, PAY_FILE), REFUNDED);
    await updateSourceIndex(at);
    vi.mocked(digestString).mockClear();
    vi.mocked(editOf).mockClear();

    const said = await json('--root', at);

    expect(said.count).toMatchObject({ run: 3, over: { older: 1, notKnown: 0, why: [] } });
    // The tree's texts are the index's `git:` names: neither `REFUNDED` nor `CART` is hashed to name it.
    expect(vi.mocked(digestString).mock.calls.filter(([text]) => text === REFUNDED || text === CART)).toEqual([]);
    // The record ran `PAY`, the tree holds `REFUNDED`: one edit read, and none for `cart.ts`, which no edit touched.
    expect(vi.mocked(editOf)).toHaveBeenCalledTimes(1);
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

  it('writes the older text and each reason a text is not known into the markdown breakdown', async () => {
    // `fee.test.ts` alone called `refund`, and the runs record leaves it out; `charge` was rewritten since its run.
    const { at } = await checkout({ ...atRecord, refund: [1], runs: (_, recorded) => ({ commit: recorded, ...landed([PAY_TEST, CART_TEST]) }) });
    await writeFile(join(at, PAY_FILE), PAY.replace('  return amount;', '  return amount + 1;'));

    const answer = await ask('--root', at, '--format', 'markdown');

    expect(answer.out).toContain('| Executed over an older text | 1 | 20.0% |\n');
    expect(answer.out).toContain('| Executed over a text not known | 1 | 20.0% |\n');
    expect(answer.out).toContain('\n- Not known: the runs record does not say where some test files ran\n');
  });

  it('counts every region of a file whose rows name no text as not known, and says so', async () => {
    const { at } = await checkout({ ...atRecord, unkeyed: true });

    const answer = await ask('--root', at);
    const said = await json('--root', at);

    expect(said.count).toMatchObject({ run: 3, over: { older: 0, notKnown: 3, why: ['the record names no text its rows were cut from, so which text ran is not known'] } });
    expect(answer.out.split('the record names no text its rows were cut from').length).toBe(2);
  });

  describe('in CI, where coverage takes the source index as published and builds none', () => {
    afterEach(() => {
      ci.isCI = false;
    });

    it('counts every region run as not known when no source index is published, says so once, and reads no text', async () => {
      const { at } = await checkout(atRecord);
      await rm(sourceIndexPath(at), { recursive: true, force: true });
      // An edit a read of the disk would see: with no index, nothing reads it.
      await writeFile(join(at, PAY_FILE), REFUNDED);
      ci.isCI = true;

      const answer = await ask('--root', at);
      const said = await json('--root', at);
      const markdown = await ask('--root', at, '--format', 'markdown');

      expect(said.count).toMatchObject({ run: 3, over: { older: 0, notKnown: 3, why: [expect.stringMatching(/^which text ran is not known: no source index is published at /u)] } });
      expect(answer.out.split('not known: which text ran is not known: no source index is published at').length).toBe(2);
      expect(markdown.out).toMatch(/\n- Not known: which text ran is not known: no source index is published at /u);
    });

    it('parts what ran by the index as published', async () => {
      const { at } = await checkout(atRecord);
      await writeFile(join(at, PAY_FILE), REFUNDED);
      await updateSourceIndex(at);
      ci.isCI = true;

      const said = await json('--root', at);

      expect(said.count).toMatchObject({ run: 3, over: { older: 1, notKnown: 0, why: [] } });
    });

    it('counts a file the published index does not hold as gone, run over an older text, though the disk holds the text every run ran', async () => {
      const { at } = await checkout(atRecord);
      await rm(join(at, PAY_FILE));
      await updateSourceIndex(at);
      await writeFile(join(at, PAY_FILE), PAY);
      ci.isCI = true;

      expect((await json('--root', at)).count).toMatchObject({ over: { older: 2, notKnown: 0, why: [] } });
    });
  });

  it('counts every region run as not known when the source index cannot be brought up to the checkout, and gives the reason', async () => {
    const { at } = await checkout(atRecord);
    await writeFile(join(at, PAY_FILE), REFUNDED);
    const index = dirname(sourceIndexPath(at));
    await chmod(index, 0o555);
    try {
      const said = await json('--root', at);

      expect(said.count).toMatchObject({
        run: 3,
        over: { older: 0, notKnown: 3, why: [expect.stringMatching(/^which text ran is not known: the source index at .+ could not be updated to the checkout: .*Permission denied/u)] },
      });
    } finally {
      await chmod(index, 0o755);
    }
  });

  it('keeps a function whose body gained only a comment as run over this text', async () => {
    const { at } = await checkout(atRecord);
    await writeFile(join(at, PAY_FILE), PAY.replace('  return -amount;', '  // refunds are negative\n  return -amount;'));

    const said = await json('--root', at);

    expect(said.count).toMatchObject({ run: 3, over: { older: 0, notKnown: 0, why: [] } });
  });

  it('counts every region of a file gone from the checkout as run over an older text, since the text it ran is no longer there', async () => {
    const { at } = await checkout(atRecord);
    await rm(join(at, PAY_FILE));

    expect((await json('--root', at)).count).toMatchObject({ over: { older: 2, notKnown: 0, why: [] } });
  });
});

describe('a review that counts coverage', () => {
  it('passes coverage no reader of the text each region ran over, and says none', async () => {
    const { at } = await checkout(atRecord);
    await writeFile(join(at, PAY_FILE), REFUNDED);
    vi.mocked(textOver).mockClear();
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
    expect(vi.mocked(textOver)).not.toHaveBeenCalled();
    expect(JSON.stringify(said.coverage)).not.toMatch(/"over"/u);
    expect(out).not.toMatch(/older text/u);
  });
});
