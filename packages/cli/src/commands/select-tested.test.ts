import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { digestString } from '@variance-authority/core/format';
import { testCoverageFile, writeTestCoverage } from '@variance-authority/sense/test-selection';
import { parseArgs } from '../parse.js';
import { indexOutput } from './index-command.js';
import { PUSH, cloneOf, git, publishTo, shareConfig } from './mainline-fixture.js';
import { selectOutput } from './select-command.js';
import { npmLock } from './select-install-fixture.js';

/**
 * `variance select --tested <tree>` in a merge queue: a pull request tested at
 * its own tree meets the mainline that moved past it. Each side's own run
 * passed what only that side reaches, so a group of one pull request runs what
 * both sides reach, and what a global input on either side reaches.
 *
 * Two folders, one test each: `total` and `other`. The fork `R` is the
 * mainline when the pull request branched; `P` is the mainline the queue
 * merges onto; `T` is the pull request's tested tree.
 */

let home: string;
const cwd = process.cwd();

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'variance-select-tested-'));
  vi.stubEnv('VARIANCE_AUTHORITY_CACHE', join(home, 'ci-cache'));
});

afterEach(async () => {
  process.chdir(cwd);
  vi.unstubAllEnvs();
  await rm(home, { recursive: true, force: true });
});

const TOTAL = 'export function total(price: number): number {\n  return price * 0.9;\n}\n';
const OTHER = 'export function other(price: number): number {\n  return price + 1;\n}\n';
const TOTAL_TEST = "import { total } from '../src/total';\nit('totals', () => total(1));\n";
const OTHER_TEST = "import { other } from '../src/other';\nit('others', () => other(1));\n";
const PADDED = "import pad from 'left-pad';\nexport function total(price: number): number {\n  return pad(price) * 0.9;\n}\n";
const DEV = ['-c', 'user.name=Dev', '-c', 'user.email=dev@example.test'];

type Files = Readonly<Record<string, string>>;

interface Queue {
  /** Files at the fork, beside the two folders and their tests. */
  readonly start?: Files;
  /** Which test entered each file the record holds beyond each folder's own module. */
  readonly entered?: Readonly<Record<string, string>>;
  /** What the mainline lands past the fork, which the queue merges onto. */
  readonly base: Files;
  /** What each pull request changes from the fork; the last is the one tested. */
  readonly prs: readonly Files[];
  /** Where the mainline published its record: at the fork, or at the base. */
  readonly recordAt: 'fork' | 'base';
}

/**
 * A merge-queue checkout: the mainline's record published, the pull requests
 * branched from the fork, and `HEAD` the queue's commit — the base with each
 * pull request merged onto it in turn. `tested` is the last pull request's tree.
 */
async function queued(queue: Queue): Promise<{ dir: string; base: string; tested: string; fork: string }> {
  const origin = join(home, 'origin.git');
  const ci = join(home, 'ci');
  await git(home, 'init', '--quiet', '--bare', '--initial-branch', 'main', origin);
  await git(home, 'init', '--quiet', '--initial-branch', 'main', ci);
  await git(ci, 'config', 'user.email', 'fixture@example.test');
  await git(ci, 'config', 'user.name', 'Fixture');
  await written(ci, {
    'src/total.ts': TOTAL, 'src/other.ts': OTHER, 'test/total.test.ts': TOTAL_TEST, 'test/other.test.ts': OTHER_TEST,
    'variance.config.json': JSON.stringify({ suites: { unit: { kind: 'unit', carry: 'share' } }, share: shareConfig(home).share }),
    ...queue.start,
  });
  await git(ci, 'add', '-A');
  await git(ci, 'commit', '--quiet', '-m', 'fork');
  const fork = await git(ci, 'rev-parse', 'HEAD');
  await git(ci, 'remote', 'add', 'origin', origin);
  await git(ci, 'push', '--quiet', 'origin', 'main');

  const tips: string[] = [];
  for (const [index, pr] of queue.prs.entries()) {
    await git(ci, 'checkout', '--quiet', '-b', `pr-${index}`, fork);
    await written(ci, pr);
    await git(ci, 'add', '-A');
    await git(ci, ...DEV, 'commit', '--quiet', '-m', `pr ${index}`);
    tips.push(await git(ci, 'rev-parse', 'HEAD'));
    await git(ci, 'push', '--quiet', 'origin', `pr-${index}`);
  }
  await git(ci, 'checkout', '--quiet', 'main');

  if (queue.recordAt === 'fork') await recorded(ci, queue.entered ?? {});
  await written(ci, queue.base);
  await git(ci, 'add', '-A');
  await git(ci, 'commit', '--quiet', '-m', 'base');
  const base = await git(ci, 'rev-parse', 'HEAD');
  await git(ci, 'push', '--quiet', 'origin', 'main');
  if (queue.recordAt === 'base') await recorded(ci, queue.entered ?? {});

  const dir = await cloneOf(home, origin);
  vi.stubEnv('VARIANCE_AUTHORITY_CACHE', join(home, 'queue-cache'));
  await git(dir, 'fetch', '--quiet', 'origin', ...queue.prs.map((_, index) => `pr-${index}`));
  await git(dir, 'checkout', '--quiet', '-b', 'gh-readonly-queue/main/pr-1', base);
  for (const tip of tips) await git(dir, ...DEV, 'merge', '--quiet', '--no-ff', '--no-edit', tip);
  return { dir, base, tested: tips.at(-1)!, fork };
}

async function written(dir: string, files: Files): Promise<void> {
  for (const [file, source] of Object.entries(files)) {
    await mkdir(dirname(join(dir, file)), { recursive: true });
    await writeFile(join(dir, file), source);
  }
}

/**
 * The record a whole run at `HEAD` of `ci` made, published to the mainline:
 * each test entered its own folder's module, and each file of `entered` as it
 * names, with the text each file holds there.
 */
async function recorded(ci: string, entered: Readonly<Record<string, string>>): Promise<void> {
  const commit = await git(ci, 'rev-parse', 'HEAD');
  const held = { 'src/other.ts': 'test/other.test.ts', 'src/total.ts': 'test/total.test.ts', ...entered };
  const modules = [];
  for (const [file, test] of Object.entries(held).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    modules.push(moduleOf(file, await readFile(join(ci, file), 'utf8'), test));
  }
  await writeTestCoverage(testCoverageFile(ci, { suite: 'unit' }), {
    version: 3,
    instrumentation: 'fixture',
    commit,
    tests: [
      { file: 'test/other.test.ts', complete: true, preconditions: [] },
      { file: 'test/total.test.ts', complete: true, preconditions: [] },
    ],
    modules,
  });
  await publishTo(home, ci, commit, PUSH, 'mainline main');
}

/** `file` holding `source`: its module, and one function over every line, both entered by `test` alone. */
function moduleOf(file: string, source: string, test: string) {
  const lines = source.split('\n').length - 1;
  return {
    file,
    sourceDigest: digestString(source),
    instrumented: true,
    blocks: [{
      ordinal: 0, kind: 'module' as const, digest: digestString(file), name: '', path: 'module',
      startLine: 1, endLine: lines, source: true, testFiles: [test],
    }, {
      ordinal: 1, owner: 0, kind: 'function' as const, digest: digestString(`${file}#body`), name: 'body', path: 'body',
      startLine: 1, endLine: lines, source: true, testFiles: [test],
    }],
  };
}

/** Select in the queue's checkout, as its workflow does: from the base it merges onto, with `tested` when given. */
async function selected(dir: string, since: string, tested?: string): Promise<{ out: string; err: string }> {
  process.chdir(dir);
  await indexOutput({ cwd: dir });
  return selectOutput({ cwd: dir, format: 'plain', since, ...(tested === undefined ? {} : { tested }) });
}

describe('`variance select --tested` in a merge queue', () => {
  it('reads the tested tree off the command line', () => {
    expect(parseArgs(['select', '--since', 'main', '--tested', 'abc123'])).toMatchObject({ since: 'main', tested: 'abc123' });
  });

  it.each([
    [['--tested', 'abc123'], '`--tested` names the pull request a merge queue merged onto `--since`, and no `--since` was passed'],
    [['--since', 'main', '--tested', 'abc123', '--execution', 'coverage.va'], '`--tested` reads both sides of a merge from git, and `--execution` names a record git does not hold; pass one'],
  ])('refuses `--tested` with %j', (flags, message) => {
    expect(() => parseArgs(['select', ...flags])).toThrow(message);
  });

  it.each(['fork', 'base'] as const)(
    'selects none of a group of one whose two sides reach disjoint tests, with the record at the %s, and names both sides',
    async (recordAt) => {
      const queue = await queued({
        base: { 'src/total.ts': TOTAL.replace('0.9', '0.8') },
        prs: [{ 'src/other.ts': OTHER.replace('+ 1', '+ 2') }],
        recordAt,
      });

      const here = await selected(queue.dir, queue.base, queue.tested);

      // Plain output is what to skip: both test files.
      expect(here.out).toBe('test/other.test.ts\ntest/total.test.ts\n');
      expect(here.err).toContain('the pull request and the mainline it meets reach no test in common');
      expect(here.err).toContain(`test/other.test.ts: only the pull request reaches it, and it passed at the tested tree ${queue.tested.slice(0, 12)}`);
      if (recordAt === 'fork') {
        expect(here.err).toContain(`test/total.test.ts: only the mainline reaches it, and it passed at ${queue.base.slice(0, 12)}`);
      }
    },
  );

  it('runs a test both sides reach, where the mainline renames a function the pull request adds a call to', async () => {
    const CART = "import { total } from './total';\nexport function cart(price: number): number {\n  return total(price);\n}\n\n\nexport const name = 'cart';\n";
    const queue = await queued({
      start: { 'src/cart.ts': CART, 'test/total.test.ts': "import { cart } from '../src/cart';\nit('totals', () => cart(1));\n" },
      entered: { 'src/cart.ts': 'test/total.test.ts' },
      base: {
        'src/total.ts': TOTAL.replace('function total', 'function sum'),
        'src/cart.ts': CART.replaceAll('total', 'sum'),
      },
      // The old name, called past the mainline's rename: the merge fails here, and on neither side.
      prs: [{ 'src/cart.ts': CART.replace('\n\n\n', '\n\nexport const fee = (price: number) => total(price) + 1;\n') }],
      recordAt: 'fork',
    });

    const here = await selected(queue.dir, queue.base, queue.tested);

    // `total` reaches `cart` from both sides and runs; nothing reaches `other`.
    expect(here.out).toBe('test/other.test.ts\n');
  });

  it.each([
    ['the pull request', 'base', { 'src/other.ts': OTHER.replace('+ 1', '+ 2') }, { 'package-lock.json': npmLock('1.4.0') }],
    ['the mainline', 'fork', { 'package-lock.json': npmLock('1.4.0') }, { 'src/other.ts': OTHER.replace('+ 1', '+ 2') }],
  ] as const)('runs the tests a package %s bumped reaches, though the other side reaches none of them', async (_, recordAt, base, pr) => {
    const queue = await queued({
      start: { 'src/total.ts': PADDED, 'package-lock.json': npmLock('1.3.0') },
      base,
      prs: [pr],
      recordAt,
    });

    const here = await selected(queue.dir, queue.base, queue.tested);

    expect(here.out).toBe('test/other.test.ts\n');
  });

  it('selects as without `--tested` when the tested tree is not merged into the checkout', async () => {
    const queue = await queued({
      base: { 'src/total.ts': TOTAL.replace('0.9', '0.8') },
      prs: [{ 'src/other.ts': OTHER.replace('+ 1', '+ 2') }],
      recordAt: 'fork',
    });

    const whole = await selected(queue.dir, queue.base);
    const here = await selected(queue.dir, queue.base, queue.fork);

    expect(here.out).toBe(whole.out);
    expect(here.err).toContain(`\`--tested ${queue.fork}\` selects as without it: HEAD is not ${queue.base.slice(0, 12)} with one pull request merged onto it`);
  });

  it('selects as without `--tested` for a group of two pull requests', async () => {
    const queue = await queued({
      base: { 'src/total.ts': TOTAL.replace('0.9', '0.8') },
      prs: [{ 'src/other.ts': OTHER.replace('+ 1', '+ 2') }, { 'src/extra.ts': 'export const extra = 1;\n' }],
      recordAt: 'fork',
    });

    const whole = await selected(queue.dir, queue.base);
    const here = await selected(queue.dir, queue.base, queue.tested);

    expect(here.out).toBe(whole.out);
    expect(here.err).toContain('selects as without it: HEAD is not');
  });

  it('selects as without `--tested` when the working tree changes a file HEAD holds', async () => {
    const queue = await queued({
      base: { 'src/total.ts': TOTAL.replace('0.9', '0.8') },
      prs: [{ 'src/other.ts': OTHER.replace('+ 1', '+ 2') }],
      recordAt: 'fork',
    });
    await writeFile(join(queue.dir, 'src/total.ts'), TOTAL.replace('0.9', '0.7'));

    const whole = await selected(queue.dir, queue.base);
    const here = await selected(queue.dir, queue.base, queue.tested);

    // The edit on top of the merge reaches `total`, which neither side's run saw.
    expect(here.out).toBe(whole.out);
    expect(here.err).toContain(`\`--tested ${queue.tested}\` selects as without it: the working tree changes files HEAD holds`);
  });

  it('selects as without `--tested` when one side changes what the suite rests on before reach', async () => {
    const config = { suites: { unit: { kind: 'unit', carry: 'share', before: ['vitest.config.ts'] } }, share: shareConfig(home).share };
    const queue = await queued({
      start: { 'variance.config.json': JSON.stringify(config), 'vitest.config.ts': 'export default {};\n' },
      base: { 'vitest.config.ts': 'export default { test: {} };\n' },
      prs: [{ 'src/other.ts': OTHER.replace('+ 1', '+ 2') }],
      recordAt: 'base',
    });

    const whole = await selected(queue.dir, queue.base);
    const here = await selected(queue.dir, queue.base, queue.tested);

    // `other` ran at the tested tree on the config the mainline has since changed, so it runs.
    expect(here.out).toBe(whole.out);
    expect(whole.out).toBe('test/total.test.ts\n');
    expect(here.err).toContain(`\`--tested ${queue.tested}\` selects as without it: read alone, the mainline's change selects every test file`);
  });
});
