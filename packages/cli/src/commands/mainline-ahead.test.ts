import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { digestString } from '@variance-authority/core/format';
import { testCoverageFile, writeTestCoverage } from '@variance-authority/sense/test-selection';
import { PUSH, cloneOf, git, publishTo, selectedIn, shareConfig } from './mainline-fixture.js';
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
const CONFIG = 'export default { test: {} };\n';
const PADDED = "import pad from 'left-pad';\nexport function total(price: number): number {\n  return pad(price) * 0.9;\n}\n";

/**
 * The mainline at its published record: both folders committed, pushed, and
 * the record a whole run there made published, in which each test entered its
 * own folder's module and nothing else. `config` is a runner config every test
 * declares; `total` replaces its module, and `files` are written beside.
 */
async function mainline(
  { config, total = TOTAL, files = {} }: { config?: string; total?: string; files?: Readonly<Record<string, string>> } = {},
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
  for (const [file, source] of Object.entries(files)) await writeFile(join(dir, file), source);
  await writeFile(join(dir, 'src/other.ts'), OTHER);
  await writeFile(join(dir, 'test/total.test.ts'), TOTAL_TEST);
  await writeFile(join(dir, 'test/other.test.ts'), OTHER_TEST);
  if (config !== undefined) await writeFile(join(dir, 'vitest.config.ts'), config);
  await writeFile(join(dir, 'variance.config.json'), JSON.stringify({
    suites: { unit: { kind: 'unit', carry: 'share' } },
    share: shareConfig(home).share,
  }));
  await git(dir, 'add', '-A');
  await git(dir, 'commit', '--quiet', '-m', 'recorded');
  const recorded = await git(dir, 'rev-parse', 'HEAD');
  await git(dir, 'remote', 'add', 'origin', origin);
  await git(dir, 'push', '--quiet', 'origin', 'main');
  await git(dir, 'fetch', '--quiet', 'origin');

  // The runner records the config it loaded as every test's precondition.
  const preconditions = config === undefined ? [] : [{ name: 'vitest.config.ts', digest: digestString(config) }];
  await writeTestCoverage(testCoverageFile(dir, { suite: 'unit' }), {
    version: 3,
    instrumentation: 'fixture',
    commit: recorded,
    tests: [
      { file: 'test/other.test.ts', complete: true, preconditions },
      { file: 'test/total.test.ts', complete: true, preconditions },
    ],
    modules: [moduleOf('src/other.ts', 'other', OTHER, 'test/other.test.ts'), moduleOf('src/total.ts', 'total', total, 'test/total.test.ts')],
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
  for (const [file, source] of Object.entries(files)) await writeFile(join(dir, file), source);
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

  it('runs every test declaring the config when the mainline names a setup file in it and the checkout changes that file', async () => {
    const ci = await mainline({ config: CONFIG });
    // The config names the setup file by a string, so no import reaches it, and the record was made before it.
    await landed(ci.dir, {
      'vitest.config.ts': "export default { test: { setupFiles: ['./test/setup.ts'] } };\n",
      'test/setup.ts': 'globalThis.rate = 0.9;\n',
    });
    const clone = await branched(ci.origin, 'test/setup.ts', 'globalThis.rate = 0.8;\n');

    const here = await selectedIn(clone);

    expect(here.out).toBe('');
  });

  it('runs every test declaring the config when the mainline has it import a file the checkout changes', async () => {
    const ci = await mainline({ config: CONFIG });
    await landed(ci.dir, {
      'vitest.config.ts': "import { rate } from './test/rate';\nexport default { test: { env: { RATE: String(rate) } } };\n",
      'test/rate.ts': 'export const rate = 0.9;\n',
    });
    const clone = await branched(ci.origin, 'test/rate.ts', 'export const rate = 0.8;\n');

    const here = await selectedIn(clone);

    expect(here.out).toBe('');
  });

  it('runs a test the mainline sent through a load it computes, when the checkout changes what that load can reach', async () => {
    const ci = await mainline();
    // A specifier that is not a literal: the scan reads no edge out of `total`, and the record never saw the load.
    await landed(ci.dir, {
      'src/total.ts': "const where = './other';\nexport async function total(price: number): Promise<number> {\n  return (await import(where)).other(price) * 0.9;\n}\n",
    });
    const clone = await branched(ci.origin, 'src/other.ts', OTHER.replace('+ 1', '+ 2'));

    const here = await selectedIn(clone);

    expect(here.out).toBe('');
  });

  it('runs a test the mainline changed when the checkout deletes a file the mainline made it import', async () => {
    const ci = await mainline();
    await landed(ci.dir, { 'src/total.ts': "import { other } from './other';\nexport function total(price: number): number {\n  return other(price) * 0.9;\n}\n" });
    // A deleted file is in no graph at the checkout, so no import reaches `total` from it.
    const clone = await branched(ci.origin, 'src/other.ts', undefined);

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
