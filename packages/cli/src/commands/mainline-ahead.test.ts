import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { digestString } from '@variance-authority/core/format';
import { testCoverageFile, writeTestCoverage } from '@variance-authority/sense/test-selection';
import { indexOutput } from './index-command.js';
import { PUSH, cloneOf, git, publishTo, selectedIn, shareConfig } from './mainline-fixture.js';
import { selectOutput } from './select-command.js';
import { npmLock } from './select-install-fixture.js';

/** Set to have the source index refuse to come up to the checkout, as a read-only cache or a failed scan does. */
let refused: string | undefined;

vi.mock('./source-graph.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('./source-graph.js')>();
  return { ...original, indexUpToCheckout: async (...args: Parameters<typeof original.indexUpToCheckout>) => refused ?? original.indexUpToCheckout(...args) };
});

/**
 * A checkout whose mainline moved past the record it published: a pull
 * brought commits CI has not recorded yet. A test is the checkout's to run when
 * its outcome here can differ from its outcome at the merge base, so a change
 * only the mainline made is the mainline's to run, and the checkout's own
 * change selects by what its tests reach.
 *
 * Two folders, one test each: `total` (package A) and `other` (package B).
 */

let home: string;
const cwd = process.cwd();

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'variance-mainline-ahead-'));
  vi.stubEnv('VARIANCE_AUTHORITY_CACHE', join(home, 'ci-cache'));
});

afterEach(async () => {
  refused = undefined;
  process.chdir(cwd);
  vi.unstubAllEnvs();
  await rm(home, { recursive: true, force: true });
});

const TOTAL = 'export function total(price: number): number {\n  return price * 0.9;\n}\n';
const OTHER = 'export function other(price: number): number {\n  return price + 1;\n}\n';
const TOTAL_TEST = "import { total } from '../src/total';\nit('totals', () => total(1));\n";
const OTHER_TEST = "import { other } from '../src/other';\nit('others', () => other(1));\n";
const PADDED = "import pad from 'left-pad';\nexport function total(price: number): number {\n  return pad(price) * 0.9;\n}\n";

/**
 * The mainline at its published record: both folders committed, pushed, and
 * the record a whole run there made published, in which each test entered its
 * own folder's module and nothing else. `total` replaces its module, and
 * `files` are written beside; so are `entered`, which `total`'s test entered.
 */
async function mainline(
  { total = TOTAL, files = {}, entered = {}, before }: {
    total?: string; files?: Readonly<Record<string, string>>; entered?: Readonly<Record<string, string>>; before?: readonly string[];
  } = {},
): Promise<{ dir: string; origin: string; recorded: string }> {
  const origin = join(home, 'origin.git');
  const dir = join(home, 'ci');
  await git(home, 'init', '--quiet', '--bare', '--initial-branch', 'main', origin);
  await git(home, 'init', '--quiet', '--initial-branch', 'main', dir);
  await git(dir, 'config', 'user.email', 'fixture@example.test');
  await git(dir, 'config', 'user.name', 'Fixture');
  await mkdir(join(dir, 'src'));
  await mkdir(join(dir, 'test'));
  await writeFile(join(dir, 'src/total.ts'), total);
  for (const [file, source] of Object.entries({ ...files, ...entered })) await writeFile(join(dir, file), source);
  await writeFile(join(dir, 'src/other.ts'), OTHER);
  await writeFile(join(dir, 'test/total.test.ts'), TOTAL_TEST);
  await writeFile(join(dir, 'test/other.test.ts'), OTHER_TEST);
  await writeFile(join(dir, 'variance.config.json'), JSON.stringify({
    suites: { unit: { kind: 'unit', carry: 'share', ...(before === undefined ? {} : { before }) } },
    share: shareConfig(home).share,
  }));
  await git(dir, 'add', '-A');
  await git(dir, 'commit', '--quiet', '-m', 'recorded');
  const recorded = await git(dir, 'rev-parse', 'HEAD');
  await git(dir, 'remote', 'add', 'origin', origin);
  await git(dir, 'push', '--quiet', 'origin', 'main');
  await git(dir, 'fetch', '--quiet', 'origin');

  await writeTestCoverage(testCoverageFile(dir, { suite: 'unit' }), {
    version: 3,
    instrumentation: 'fixture',
    commit: recorded,
    tests: [
      { file: 'test/other.test.ts', complete: true, preconditions: [] },
      { file: 'test/total.test.ts', complete: true, preconditions: [] },
    ],
    modules: [
      moduleOf('src/other.ts', 'other', OTHER, 'test/other.test.ts'),
      moduleOf('src/total.ts', 'total', total, 'test/total.test.ts'),
      ...Object.entries(entered).map(([file, source]) => moduleOf(file, file, source, 'test/total.test.ts')),
    ],
  });
  await publishTo(home, dir, recorded, PUSH, 'mainline main');
  return { dir, origin, recorded };
}

/** `file` holding `source`: its module and the function `name` in it, both entered by `test` alone. */
function moduleOf(file: string, name: string, source: string, test: string) {
  return {
    file,
    sourceDigest: digestString(source),
    instrumented: true,
    blocks: [{
      ordinal: 0, kind: 'module' as const, digest: digestString('module'), name: '', path: 'module',
      startLine: 1, endLine: 3, source: true, testFiles: [test],
    }, {
      ordinal: 1, owner: 0, kind: 'function' as const, digest: digestString(name), name, path: name,
      startLine: 1, endLine: 3, source: true, testFiles: [test],
    }],
  };
}

/** A commit on the mainline past its record, pushed and not recorded: each file written with its source. */
async function landed(dir: string, files: Readonly<Record<string, string>>): Promise<void> {
  for (const [file, source] of Object.entries(files)) {
    await mkdir(dirname(join(dir, file)), { recursive: true });
    await writeFile(join(dir, file), source);
  }
  await git(dir, 'add', '-A');
  await git(dir, 'commit', '--quiet', '-m', `lands ${Object.keys(files).join(', ')}`);
  await git(dir, 'push', '--quiet', 'origin', 'main');
}

/** A clone of the mainline as it is now, on a branch of its own with one commit: `file` rewritten to `source`, or deleted. */
async function branched(origin: string, file: string, source: string | undefined): Promise<string> {
  const clone = await cloneOf(home, origin);
  await git(clone, 'checkout', '--quiet', '-b', 'mine');
  if (source === undefined) await git(clone, 'rm', '--quiet', file);
  else await writeFile(join(clone, file), source);
  await git(clone, '-c', 'user.name=Dev', '-c', 'user.email=dev@example.test', 'commit', '--quiet', '-am', `mine ${file}`);
  vi.stubEnv('VARIANCE_AUTHORITY_CACHE', join(home, 'laptop-cache'));
  return clone;
}

describe('`variance select` a commit past the record its mainline published', () => {
  it('runs none of the tests only the mainline\'s change reaches', async () => {
    const ci = await mainline();
    await landed(ci.dir, { 'src/total.ts': TOTAL.replace('0.9', '0.8') });
    const clone = await branched(ci.origin, 'src/other.ts', OTHER.replace('+ 1', '+ 2'));

    const here = await selectedIn(clone);

    // Plain output is what to skip.
    expect(here.out).toBe('test/total.test.ts\n');
    expect(here.err).toContain(`1 test file(s) left to mainline main: only its commits between the record's commit ${ci.recorded.slice(0, 12)} and the merge base `);
  });

  it('runs a test the mainline changed when it reaches the checkout\'s change, though its record never entered it', async () => {
    const ci = await mainline();
    // The mainline's change sends `total` into `other`; the record, made before it, says `total` never entered `other`.
    await landed(ci.dir, { 'src/total.ts': "import { other } from './other';\nexport function total(price: number): number {\n  return other(price) * 0.9;\n}\n" });
    const clone = await branched(ci.origin, 'src/other.ts', OTHER.replace('+ 1', '+ 2'));

    const here = await selectedIn(clone);

    expect(here.out).toBe('');
  });

  it('runs a test whose module a mainline flag turns onto a file the checkout changes, though the record never saw that load', async () => {
    // At the record the flag is off: `total` read it and never loaded `x`.
    const ci = await mainline({
      total: "import { enabled } from './flags';\nexport async function total(price: number): Promise<number> {\n  return enabled ? (await import('./x')).x(price) : price * 0.9;\n}\n",
      files: { 'src/flags.ts': 'export const enabled = false;\n', 'src/x.ts': 'export function x(price: number): number {\n  return price * 0.9;\n}\n' },
    });
    // The mainline changes only the flag; `total`, its literal import and `x` stay as they were.
    await landed(ci.dir, { 'src/flags.ts': 'export const enabled = true;\n' });
    const clone = await branched(ci.origin, 'src/x.ts', 'export function x(price: number): number {\n  return price * 0.8;\n}\n');

    const here = await selectedIn(clone);

    expect(here.out).toBe('test/other.test.ts\n');
  });

  it.each([
    ['rates.json', "import rates from './rates.json';", 'rates.rate', '{ "rate": 0.9 }\n', '{ "rate": 0.8 }\n'],
    ['total.css', "import './total.css';", '0.9', '.total { color: red; }\n', '.total { color: blue; }\n'],
    ['rates.graphql', "import rates from './rates.graphql';", '0.9', 'query Rates { rate }\n', 'query Rates { rate tax }\n'],
  ])('runs a test whose module imports the %s the checkout changes, though the record never saw that file', async (file, load, factor, before, after) => {
    const ci = await mainline({
      total: `${load}\nexport function total(price: number): number {\n  return price * ${factor};\n}\n`,
      files: { [`src/${file}`]: before },
    });
    await landed(ci.dir, { 'src/other.ts': OTHER.replace('+ 1', '+ 3') });
    const clone = await branched(ci.origin, `src/${file}`, after);

    const here = await selectedIn(clone);

    // `other` only the mainline's change reaches; `total` imports the file the checkout changed.
    expect(here.out).toBe('test/other.test.ts\n');
  });

  it('runs a test the mainline made import a file the checkout deletes, which fails at the checkout', async () => {
    const ci = await mainline();
    await landed(ci.dir, { 'src/total.ts': "import { other } from './other';\nexport function total(price: number): number {\n  return other(price) * 0.9;\n}\n" });
    // A deleted file is in no graph at the checkout, and the record never saw `total` enter it.
    const clone = await branched(ci.origin, 'src/other.ts', undefined);

    const here = await selectedIn(clone);

    // `other` entered the deleted file; `total` still imports it, which the graph holds as an import it could not resolve.
    expect(here.out).toBe('');
  });

  it('runs a test the mainline changed when the checkout renames the module it imports', async () => {
    const ci = await mainline();
    await landed(ci.dir, { 'src/total.ts': TOTAL.replace('0.9', '0.8') });
    const clone = await cloneOf(home, ci.origin);
    await git(clone, 'checkout', '--quiet', '-b', 'mine');
    // The test still imports the old path, so it fails here and passes at the merge base.
    await git(clone, 'mv', 'src/total.ts', 'src/sum.ts');
    await git(clone, '-c', 'user.name=Dev', '-c', 'user.email=dev@example.test', 'commit', '--quiet', '-m', 'mine renames total');
    vi.stubEnv('VARIANCE_AUTHORITY_CACHE', join(home, 'laptop-cache'));

    const here = await selectedIn(clone);

    expect(here.out).toBe('test/other.test.ts\n');
  });

  it('runs a test that entered a file both the mainline and the checkout changed', async () => {
    const ci = await mainline();
    await landed(ci.dir, { 'src/total.ts': TOTAL.replace('0.9', '0.8') });
    const clone = await branched(ci.origin, 'src/total.ts', TOTAL.replace('0.9', '0.7'));

    const here = await selectedIn(clone);

    expect(here.out).toBe('test/other.test.ts\n');
  });

  it('runs a test that entered a file the checkout restored to the record\'s text after the mainline changed it', async () => {
    const ci = await mainline();
    await landed(ci.dir, { 'src/total.ts': TOTAL.replace('0.9', '0.8') });
    // The checkout undoes the mainline's change: `total` reads as the record ran it, and differs from the merge base.
    const clone = await branched(ci.origin, 'src/total.ts', TOTAL);

    const here = await selectedIn(clone);

    expect(here.out).toBe('test/other.test.ts\n');
  });

  it('places a test by the hops from the checkout\'s change, not from the mainline\'s nearer one', async () => {
    // `total` imports `a`, `a` imports `b`, `b` imports `c`: the test is one hop from `total` and four from `c`.
    const ci = await mainline({
      total: "import { a } from './a';\nexport function total(price: number): number {\n  return a(price) * 0.9;\n}\n",
      entered: {
        'src/a.ts': "import { b } from './b';\nexport const a = (n: number) => b(n);\n",
        'src/b.ts': "import { c } from './c';\nexport const b = (n: number) => c(n);\n",
        'src/c.ts': 'export const c = (n: number) => n;\n',
      },
    });
    await landed(ci.dir, { 'src/total.ts': "import { a } from './a';\nexport function total(price: number): number {\n  return a(price) * 0.8;\n}\n" });
    const clone = await branched(ci.origin, 'src/c.ts', 'export const c = (n: number) => n + 1;\n');
    process.chdir(clone);
    await indexOutput({ cwd: clone });

    const leg = async (from: number, to: number) =>
      JSON.parse((await selectOutput({ cwd: clone, format: 'json', atDistance: { from, to } })).out);
    const near = await leg(0, 2);
    const far = await leg(3, Number.MAX_SAFE_INTEGER);

    expect(near.skip).toContain('test/total.test.ts');
    expect(far.skip).not.toContain('test/total.test.ts');
    expect(far.distances).toContainEqual(expect.objectContaining({ test: 'test/total.test.ts', hops: 4, from: 'src/c.ts' }));
  });

  it('runs a test the mainline moved off a file the checkout changes, as `file` precision over that change does', async () => {
    const ci = await mainline();
    // The mainline's test no longer imports `total`; the record, made before, says it entered `total`.
    await landed(ci.dir, { 'test/total.test.ts': "import { other } from '../src/other';\nit('totals', () => other(1));\n" });
    const clone = await branched(ci.origin, 'src/total.ts', TOTAL.replace('0.9', '0.7'));

    const here = await selectedIn(clone);

    // The record says it entered the changed file, and `file` precision reads that too: the run costs one test, never more.
    expect(here.out).toBe('test/other.test.ts\n');
  });

  it('runs none of the tests only a package the mainline bumped reaches', async () => {
    const ci = await mainline({ total: PADDED, files: { 'package-lock.json': npmLock('1.3.0') } });
    await landed(ci.dir, { 'package-lock.json': npmLock('1.4.0') });
    const clone = await branched(ci.origin, 'src/other.ts', OTHER.replace('+ 1', '+ 2'));

    const here = await selectedIn(clone);

    expect(here.out).toBe('test/total.test.ts\n');
  });

  it('runs a test the mainline added, which no record holds, and none the mainline alone reaches', async () => {
    const ci = await mainline();
    await landed(ci.dir, { 'src/total.ts': TOTAL.replace('0.9', '0.8'), 'test/added.test.ts': "import { total } from '../src/total';\nit('adds', () => total(2));\n" });
    const clone = await branched(ci.origin, 'src/other.ts', OTHER.replace('+ 1', '+ 2'));

    const here = await selectedIn(clone);

    // Plain output is what to skip, and a test no record holds is never on it.
    expect(here.out).toBe('test/total.test.ts\n');
  });

  it('leaves nothing to the mainline on the mainline itself, whose run is the one that answers for it', async () => {
    const ci = await mainline();
    await landed(ci.dir, { 'src/total.ts': TOTAL.replace('0.9', '0.8') });
    const clone = await cloneOf(home, ci.origin);
    vi.stubEnv('VARIANCE_AUTHORITY_CACHE', join(home, 'laptop-cache'));

    const here = await selectedIn(clone);

    expect(here.out).toBe('test/other.test.ts\n');
    expect(here.err).not.toContain('left to mainline');
  });

  it('runs none of the tests only the mainline reaches when the checkout is at the merge base with an edit not yet committed', async () => {
    const ci = await mainline();
    await landed(ci.dir, { 'src/total.ts': TOTAL.replace('0.9', '0.8') });
    const clone = await cloneOf(home, ci.origin);
    vi.stubEnv('VARIANCE_AUTHORITY_CACHE', join(home, 'laptop-cache'));
    await writeFile(join(clone, 'src/other.ts'), OTHER.replace('+ 1', '+ 2'));

    const here = await selectedIn(clone);

    expect(here.out).toBe('test/total.test.ts\n');
  });

  it('runs none of the tests only the mainline reaches when the mainline changed a file the suite rests on before reach', async () => {
    const ci = await mainline({ before: ['test/setup.ts'], files: { 'test/setup.ts': 'export const seed = 1;\n' } });
    await landed(ci.dir, { 'test/setup.ts': 'export const seed = 2;\n' });
    const clone = await branched(ci.origin, 'src/other.ts', OTHER.replace('+ 1', '+ 2'));

    const here = await selectedIn(clone);

    expect(here.out).toBe('test/total.test.ts\n');
  });

  it('runs the whole suite when the checkout changes a file the suite rests on before reach', async () => {
    const ci = await mainline({ before: ['test/setup.ts'], files: { 'test/setup.ts': 'export const seed = 1;\n' } });
    await landed(ci.dir, { 'src/total.ts': TOTAL.replace('0.9', '0.8') });
    const clone = await branched(ci.origin, 'test/setup.ts', 'export const seed = 2;\n');

    const here = await selectedIn(clone);

    expect(here.out).toBe('');
  });

  it('runs a test whose module imports a package the checkout bumped', async () => {
    const ci = await mainline({ total: PADDED, files: { 'package-lock.json': npmLock('1.3.0') } });
    await landed(ci.dir, { 'src/other.ts': OTHER.replace('+ 1', '+ 3') });
    const clone = await branched(ci.origin, 'package-lock.json', npmLock('1.4.0'));

    const here = await selectedIn(clone);

    // `other` only the mainline's change reaches; `total` imports what the checkout's bump moved.
    expect(here.out).toBe('test/other.test.ts\n');
  });

  it('leaves nothing to the mainline when the source index could not come up to the checkout', async () => {
    const ci = await mainline();
    await landed(ci.dir, { 'src/total.ts': TOTAL.replace('0.9', '0.8') });
    const clone = await branched(ci.origin, 'src/other.ts', OTHER.replace('+ 1', '+ 2'));
    refused = 'the source index could not be updated to the checkout: read-only';

    const here = await selectedIn(clone);

    expect(here.out).toBe('');
    expect(here.err).not.toContain('left to mainline');
  });

  it('selects as it does without a mainline when the record is at the merge base', async () => {
    const ci = await mainline();
    const clone = await branched(ci.origin, 'src/other.ts', OTHER.replace('+ 1', '+ 2'));

    const here = await selectedIn(clone);

    expect(here.out).toBe('test/total.test.ts\n');
    expect(here.err).not.toContain('left to mainline');
  });
});
