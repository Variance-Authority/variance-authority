import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseArgs } from '../parse.js';
import { indexOutput } from './index-command.js';
import { git, shareConfig } from './mainline-fixture.js';
import { selectSuite } from './select-command.js';
import { npmLock } from './select-install-fixture.js';
import { DEV, OTHER, PADDED, TOTAL, queued, scratch, selected } from './select-tested.fixture.js';
import { testedSuite } from './select-tested.js';

/**
 * `variance select --tested <tree>` in a merge queue, on the checkout
 * [`select-tested.fixture.ts`](./select-tested.fixture.ts) builds. Each side's
 * own run passed what only that side reaches, so a group of one pull request
 * runs what both sides reach, and what a global input on either side reaches.
 */

const home = scratch();

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
      const queue = await queued(home(), {
        base: { 'src/total.ts': TOTAL.replace('0.9', '0.8') },
        prs: [{ 'src/other.ts': OTHER.replace('+ 1', '+ 2') }],
        recordAt,
      });

      const here = await selected(queue.dir, queue.base, queue.tested);

      // Plain output is what to skip: both test files.
      expect(here.out).toBe('test/other.test.ts\ntest/total.test.ts\n');
      expect(here.err).toContain('the pull request and the mainline it meets reach no test in common');
      expect(here.err).toContain(`test/other.test.ts: only the pull request reaches it; \`--tested\` names its tree ${queue.tested.slice(0, 12)} as tested`);
      if (recordAt === 'fork') {
        expect(here.err).toContain(`test/total.test.ts: only the mainline reaches it; \`--since\` names its tree ${queue.base.slice(0, 12)} as tested`);
      }
    },
  );

  it('selects none of a group of one a queue squashed onto the mainline, whose two sides reach disjoint tests', async () => {
    const queue = await queued(home(), {
      base: { 'src/total.ts': TOTAL.replace('0.9', '0.8') },
      prs: [{ 'src/other.ts': OTHER.replace('+ 1', '+ 2') }],
      recordAt: 'fork',
      squash: true,
    });

    const here = await selected(queue.dir, queue.base, queue.tested);

    // HEAD has one parent, the base, and holds the tree the clean merge would.
    expect(here.out).toBe('test/other.test.ts\ntest/total.test.ts\n');
    expect(here.err).toContain('the pull request and the mainline it meets reach no test in common');
  });

  it('narrows for every caller of `selectSuite`, as for the command', async () => {
    const queue = await queued(home(), {
      base: { 'src/total.ts': TOTAL.replace('0.9', '0.8') },
      prs: [{ 'src/other.ts': OTHER.replace('+ 1', '+ 2') }],
      recordAt: 'fork',
    });

    // The seam and `shards` ask `selectSuite`, never the command's printer.
    const asked = await selectSuite({ root: queue.dir, since: queue.base, tested: queue.tested });

    expect([...asked.skip].sort()).toEqual(['test/other.test.ts', 'test/total.test.ts']);
  });

  it('runs a test both sides reach, where the mainline renames a function the pull request adds a call to', async () => {
    const CART = "import { total } from './total';\nexport function cart(price: number): number {\n  return total(price);\n}\n\n\nexport const name = 'cart';\n";
    const queue = await queued(home(), {
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
    const queue = await queued(home(), {
      start: { 'src/total.ts': PADDED, 'package-lock.json': npmLock('1.3.0') },
      base,
      prs: [pr],
      recordAt,
    });

    const here = await selected(queue.dir, queue.base, queue.tested);

    expect(here.out).toBe('test/other.test.ts\n');
  });

  it('runs a test the pull request reaches through an import it adds to a module the mainline changed', async () => {
    const queue = await queued(home(), {
      base: { 'src/total.ts': TOTAL.replace('0.9', '0.8') },
      // At the fork `other` does not import `total`, so the record's lines alone miss the new edge.
      prs: [{ 'src/other.ts': "import { total } from './total';\nexport function other(price: number): number {\n  return total(price) + 1;\n}\n" }],
      recordAt: 'fork',
    });

    const here = await selected(queue.dir, queue.base, queue.tested);

    // `other` now calls the `total` the mainline changed: both sides reach it, so it runs.
    expect(here.out).toBe('test/total.test.ts\n');
  });

  it('selects as without `--tested` when a side changes a file the record cannot place', async () => {
    const READS = "import { readFileSync } from 'node:fs';\nexport function other(price: number): number {\n  return price + Number(readFileSync('src/rate.txt', 'utf8'));\n}\n";
    const queue = await queued(home(), {
      start: { 'src/other.ts': READS, 'src/rate.txt': '1\n' },
      base: { 'src/rate.txt': '5\n' },
      prs: [{ 'src/other.ts': READS.replace('price +', 'price * 2 +') }],
      recordAt: 'fork',
    });

    const whole = await selected(queue.dir, queue.base);
    const here = await selected(queue.dir, queue.base, queue.tested);

    // Nothing says which test reads `rate.txt`, so `other` may meet the mainline's rate there.
    expect(here.out).not.toContain('test/other.test.ts');
    expect(here.out).toBe(whole.out);
    expect(here.err).toContain(`\`--tested ${queue.tested}\` selects as without it: read alone, the mainline's change`);
  });

  it('selects as without `--tested` when reading a side fails', async () => {
    const queue = await queued(home(), {
      base: { 'src/total.ts': TOTAL.replace('0.9', '0.8') },
      prs: [{ 'src/other.ts': OTHER.replace('+ 1', '+ 2') }],
      recordAt: 'fork',
    });
    process.chdir(queue.dir);
    await indexOutput({ cwd: queue.dir });
    const full = await selectSuite({ root: queue.dir, since: queue.base });
    const fails = () => Promise.reject(new Error('the record went away'));

    const here = await testedSuite({ root: queue.dir, since: queue.base, tested: queue.tested }, full, fails);

    expect(here.skip).toEqual(full.skip);
    expect(here.notes.at(-1)).toBe(`\`--tested ${queue.tested}\` selects as without it: the record could not read a side of the merge (the record went away)`);
  });

  it('selects as without `--tested` when the pull request pushed past the tested commit', async () => {
    const queue = await queued(home(), {
      base: { 'src/total.ts': TOTAL.replace('0.9', '0.8') },
      prs: [{ 'src/other.ts': OTHER.replace('+ 1', '+ 2') }],
      past: { 'src/other.ts': OTHER.replace('+ 1', '+ 3') },
      recordAt: 'fork',
    });

    const whole = await selected(queue.dir, queue.base);
    const here = await selected(queue.dir, queue.base, queue.tested);

    // The commit merged is not the one tested, so its last change to `other` never ran.
    expect(here.out).toBe(whole.out);
    expect(here.err).toContain(`\`--tested ${queue.tested}\` selects as without it: HEAD is not ${queue.base.slice(0, 12)} with one pull request merged onto it`);
  });

  it('selects as without `--tested` when the tested tree is not merged into the checkout', async () => {
    const queue = await queued(home(), {
      base: { 'src/total.ts': TOTAL.replace('0.9', '0.8') },
      prs: [{ 'src/other.ts': OTHER.replace('+ 1', '+ 2') }],
      recordAt: 'fork',
    });

    await git(queue.dir, 'checkout', '--quiet', '-b', 'elsewhere', queue.fork);
    await writeFile(join(queue.dir, 'src/other.ts'), OTHER.replace('+ 1', '+ 3'));
    await git(queue.dir, ...DEV, 'commit', '--quiet', '-am', 'elsewhere');
    const elsewhere = await git(queue.dir, 'rev-parse', 'HEAD');
    await git(queue.dir, 'checkout', '--quiet', 'gh-readonly-queue/main/pr-1');

    const whole = await selected(queue.dir, queue.base);
    const here = await selected(queue.dir, queue.base, elsewhere);

    expect(here.out).toBe(whole.out);
    expect(here.err).toContain(`\`--tested ${elsewhere}\` selects as without it: HEAD is not ${queue.base.slice(0, 12)} with one pull request merged onto it`);
  });

  it('skips every test file when HEAD holds the tree the tested commit ran on', async () => {
    const queue = await queued(home(), {
      base: { 'src/total.ts': TOTAL.replace('0.9', '0.8') },
      prs: [{ 'src/other.ts': OTHER.replace('+ 1', '+ 2') }],
      recordAt: 'fork',
    });
    const head = await git(queue.dir, 'rev-parse', 'HEAD');

    const here = await selected(queue.dir, queue.base, head);

    // A pull request up to date with the mainline: the queue's merge is its tree, whose selection already ran.
    expect(here.out).toBe('test/other.test.ts\ntest/total.test.ts\n');
    expect(here.err).toContain(`\`--tested ${head}\` skips every test file: HEAD's tree is the tree ${head.slice(0, 12)} ran its selection on`);
  });

  it('selects as without `--tested` for a group of two pull requests', async () => {
    const queue = await queued(home(), {
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
    const queue = await queued(home(), {
      base: { 'src/total.ts': TOTAL.replace('0.9', '0.8') },
      prs: [{ 'src/other.ts': OTHER.replace('+ 1', '+ 2') }],
      recordAt: 'fork',
    });
    await writeFile(join(queue.dir, 'src/total.ts'), TOTAL.replace('0.9', '0.7'));

    const whole = await selected(queue.dir, queue.base);
    const here = await selected(queue.dir, queue.base, queue.tested);

    // The edit on top of the merge reaches `total`, which neither side's run saw.
    expect(here.out).toBe(whole.out);
    expect(here.err).toContain(`\`--tested ${queue.tested}\` selects as without it: the working tree differs from HEAD`);
  });

  it.each([['by default', 'all'], ['when git is set to hide untracked files', 'no']])('selects as without `--tested` when the working tree holds a file HEAD does not, %s', async (_, shown) => {
    const queue = await queued(home(), {
      base: { 'src/total.ts': TOTAL.replace('0.9', '0.8') },
      prs: [{ 'src/other.ts': OTHER.replace('+ 1', '+ 2') }],
      recordAt: 'fork',
    });
    await git(queue.dir, 'config', 'status.showUntrackedFiles', shown);
    await writeFile(join(queue.dir, 'src/rate.ts'), 'export const rate = 1;\n');

    const whole = await selected(queue.dir, queue.base);
    const here = await selected(queue.dir, queue.base, queue.tested);

    // A file neither side wrote may be loaded by a test either side's run never saw it beside.
    expect(here.out).toBe(whole.out);
    expect(here.err).toContain(`\`--tested ${queue.tested}\` selects as without it: the working tree differs from HEAD`);
  });

  it('selects as without `--tested` when the two sides have more than one merge base', async () => {
    const queue = await queued(home(), {
      base: { 'src/total.ts': TOTAL.replace('0.9', '0.8') },
      prs: [{ 'src/other.ts': OTHER.replace('+ 1', '+ 2') }],
      recordAt: 'fork',
    });
    // Each side merges the other's first commit, then changes a file of its own: a criss-cross, whose fork is neither commit alone, merged to a tree neither side ran.
    await git(queue.dir, 'checkout', '--quiet', '-b', 'pull', queue.tested);
    await git(queue.dir, ...DEV, 'merge', '--quiet', '--no-ff', '--no-edit', queue.base);
    await writeFile(join(queue.dir, 'src/other.ts'), OTHER.replace('+ 1', '+ 3'));
    await git(queue.dir, ...DEV, 'commit', '--quiet', '-am', 'pull moves on');
    const tested = await git(queue.dir, 'rev-parse', 'HEAD');
    await git(queue.dir, 'checkout', '--quiet', '-b', 'mainline', queue.base);
    await git(queue.dir, ...DEV, 'merge', '--quiet', '--no-ff', '--no-edit', queue.tested);
    await writeFile(join(queue.dir, 'src/total.ts'), TOTAL.replace('0.9', '0.7'));
    await git(queue.dir, ...DEV, 'commit', '--quiet', '-am', 'mainline moves on');
    const mainline = await git(queue.dir, 'rev-parse', 'HEAD');
    await git(queue.dir, ...DEV, 'merge', '--quiet', '--no-ff', '--no-edit', tested);

    const whole = await selected(queue.dir, mainline);
    const here = await selected(queue.dir, mainline, tested);

    expect(here.out).toBe(whole.out);
    expect(here.err).toContain(`\`--tested ${tested}\` selects as without it: ${mainline.slice(0, 12)} and ${tested.slice(0, 12)} have more than one merge base`);
  });

  it('selects as without `--tested` when one side changes what the suite rests on before reach', async () => {
    const config = { suites: { unit: { kind: 'unit', carry: 'share', before: ['vitest.config.ts'] } }, share: shareConfig(home()).share };
    const queue = await queued(home(), {
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
