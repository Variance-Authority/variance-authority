import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import {
  EXECUTION_GLOBAL,
  testSelectionProbes,
  executionCollectorSource,
  preconditionOf,
  recordExecution,
  type ExecutionCollector,
  type ExecutionJournal,
} from './journal.js';
import { readTestCoverage, selectTestFiles } from './index.js';

/** A module with one decision in it, and no export, so a test can evaluate it. */
const SOURCE = [
  'function price(amount) {',
  '  if (amount > 10) {',
  '    return amount * 2;',
  '  }',
  '  return amount;',
  '}',
  'globalThis.__browser_test_price = price;',
].join('\n');

const PREMIUM_LINE = 3;
const PLAIN_LINE = 5;

/**
 * The same decision, and a helper the top level calls once while the module
 * evaluates: a region no subject enters on its own, and every subject depends
 * on.
 */
const INITIALIZING = [
  'function label(amount) {',
  '  if (amount > 10) {',
  '    return "premium";',
  '  }',
  '  return "plain";',
  '}',
  'const DEFAULT = label(1);',
  ...SOURCE.split('\n'),
].join('\n');

const LABEL_PREMIUM_LINE = 3;
const LABEL_PLAIN_LINE = 5;
const LATER_PLAIN_LINE = 7 + PLAIN_LINE;

interface Realm {
  readonly price: (amount: number) => number;
  readonly collector: ExecutionCollector;
}

/**
 * Run the transformed module the way a page would: collector first, then the
 * module body, with the hoisted import spent by hand because a `new Function`
 * has no module loader to spend it.
 *
 * A page arrives with no collector, and the one the build hoists keeps whatever
 * identity it finds ({@link executionCollectorSource}) so that a second script
 * cannot displace the first. This file borrows the runner's `globalThis` to play
 * that page, and under an instrumented suite the runner has already installed a
 * collector of its own — so the fixture would defer to it and hand `price.js`
 * to whichever run is watching this test file. The page therefore holds the
 * global only while page code is running: the module body, and each call into
 * it. Everything between belongs to the runner, and reports to the runner.
 */
function evaluate(transformed: string): Realm {
  const global = globalThis as unknown as Record<string, unknown>;
  const runner = Object.getOwnPropertyDescriptor(globalThis, '__VA__');
  const asRunner = (): void => {
    if (runner === undefined) delete global['__VA__'];
    else Object.defineProperty(globalThis, '__VA__', runner);
  };

  delete global['__VA__'];
  let page: PropertyDescriptor;
  try {
    new Function(executionCollectorSource())();
    page = Object.getOwnPropertyDescriptor(globalThis, '__VA__')!;
    new Function(transformed.replace(/^import "[^"]+";/, ''))();
  } finally {
    asRunner();
  }

  const price = global['__browser_test_price'] as (amount: number) => number;
  return {
    price: (amount) => {
      Object.defineProperty(globalThis, '__VA__', page);
      try {
        return price(amount);
      } finally {
        asRunner();
      }
    },
    collector: global[EXECUTION_GLOBAL] as ExecutionCollector,
  };
}

afterEach(() => {
  const global = globalThis as unknown as Record<string, unknown>;
  delete global['__browser_test_price'];
  delete global[EXECUTION_GLOBAL];
});

async function inRoot(run: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(resolve(tmpdir(), 'variance-browser-selection-'));
  try {
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function diffAt(file: string, line: number): string {
  return `--- a/${file}\n+++ b/${file}\n@@ -${line},1 +${line},1 @@\n`;
}

/** Turn a scratch directory into a checkout with one commit, and name it. */
async function checkout(root: string): Promise<string> {
  const git = async (...args: string[]): Promise<string> =>
    (await promisify(execFile)('git', args, { cwd: root })).stdout.trim();
  await git('init', '--quiet');
  await git('config', 'user.email', 'fixture@example.invalid');
  await git('config', 'user.name', 'Fixture');
  await git('add', '--all');
  await git('commit', '--quiet', '--message', 'the state this index stands at');
  return git('rev-parse', 'HEAD');
}

describe('a browser run records what it executed', () => {
  it('selects the subject that took the branch and leaves the other one out', async () => {
    await inRoot(async (root) => {
      const cacheRoot = resolve(root, 'cache');
      const coverageFile = resolve(root, 'coverage.bin');
      const module = resolve(root, 'price.js');
      await writeFile(module, SOURCE, 'utf8');

      const plugin = testSelectionProbes({ root, cacheRoot });
      const transformed = plugin.transform(SOURCE, module)!;

      const realm = evaluate(transformed.code);
      realm.price(20);
      const premium: ExecutionJournal = realm.collector.drain();
      realm.price(1);
      const plain: ExecutionJournal = realm.collector.drain();

      const recorded = await recordExecution({
        root,
        cacheRoot,
        coverageFile,
        subjects: [
          { owner: 'story:price--premium', journal: premium },
          { owner: 'story:price--plain', journal: plain },
        ],
      });
      expect(recorded).toMatchObject({ recorded: true, subjects: 2 });

      expect(await selectTestFiles(coverageFile, diffAt('price.js', PREMIUM_LINE))).toEqual([
        'story:price--premium',
      ]);
      expect(await selectTestFiles(coverageFile, diffAt('price.js', PLAIN_LINE))).toEqual([
        'story:price--plain',
      ]);
    });
  });

  it('records one row for a subject the run read twice', async () => {
    // A subject that is not trusted on the first read is read again, so an
    // unstable or changed one reaches the recorder twice under one owner. The
    // format interns rows by file, and two rows for one owner is the duplicate
    // it refuses — a refusal that used to reach the caller as a crash on every
    // run after the first, which is the only kind that has baselines to differ
    // from. The two reads are one observation, and their crossings union.
    await inRoot(async (root) => {
      const cacheRoot = resolve(root, 'cache');
      const coverageFile = resolve(root, 'coverage.bin');
      const module = resolve(root, 'price.js');
      await writeFile(module, SOURCE, 'utf8');

      const plugin = testSelectionProbes({ root, cacheRoot });
      const transformed = plugin.transform(SOURCE, module)!;

      const realm = evaluate(transformed.code);
      realm.price(20);
      const first = realm.collector.drain();
      realm.price(1);
      const again = realm.collector.drain();

      const recorded = await recordExecution({
        root,
        cacheRoot,
        coverageFile,
        subjects: [
          { owner: 'story:price--only', journal: first },
          { owner: 'story:price--only', journal: again },
        ],
      });
      expect(recorded).toMatchObject({ recorded: true, subjects: 1 });

      const coverage = await readTestCoverage(coverageFile);
      expect(coverage.tests.map((test) => test.file)).toEqual(['story:price--only']);

      // Both reads' lines belong to it: the fold unions crossings rather than
      // letting the later read stand in for the pair.
      expect(await selectTestFiles(coverageFile, diffAt('price.js', PREMIUM_LINE))).toEqual([
        'story:price--only',
      ]);
      expect(await selectTestFiles(coverageFile, diffAt('price.js', PLAIN_LINE))).toEqual([
        'story:price--only',
      ]);
    });
  });

  it('gives a module-scope edit every subject the page served', async () => {
    await inRoot(async (root) => {
      const cacheRoot = resolve(root, 'cache');
      const coverageFile = resolve(root, 'coverage.bin');
      const module = resolve(root, 'price.js');
      await writeFile(module, SOURCE, 'utf8');

      const plugin = testSelectionProbes({ root, cacheRoot });
      const transformed = plugin.transform(SOURCE, module)!;

      // The module evaluates once, inside the first subject's window — which is
      // exactly the attribution that would be a lie if it were kept.
      const realm = evaluate(transformed.code);
      realm.price(20);
      const first = realm.collector.drain();
      realm.price(1);
      const second = realm.collector.drain();

      await recordExecution({
        root,
        cacheRoot,
        coverageFile,
        subjects: [
          { owner: 'story:price--premium', journal: first },
          { owner: 'story:price--plain', journal: second },
        ],
      });

      const coverage = await readTestCoverage(coverageFile);
      const root_ = coverage.modules[0]!.blocks.find((block) => block.kind === 'module')!;
      expect(root_.testFiles).toEqual(['story:price--plain', 'story:price--premium']);
    });
  });

  it('gives every region entered during module initialization every subject the page served', async () => {
    await inRoot(async (root) => {
      const cacheRoot = resolve(root, 'cache');
      const coverageFile = resolve(root, 'coverage.bin');
      const module = resolve(root, 'price.js');
      await writeFile(module, INITIALIZING, 'utf8');

      const plugin = testSelectionProbes({ root, cacheRoot });
      const transformed = plugin.transform(INITIALIZING, module)!;

      // `label(1)` runs once, while the module evaluates, inside the first
      // subject's window. The second subject never calls it and depends on it.
      const realm = evaluate(transformed.code);
      realm.price(20);
      const first = realm.collector.drain();
      realm.price(1);
      const second = realm.collector.drain();

      await recordExecution({
        root,
        cacheRoot,
        coverageFile,
        subjects: [
          { owner: 'story:price--premium', journal: first },
          { owner: 'story:price--plain', journal: second },
        ],
      });

      expect(await selectTestFiles(coverageFile, diffAt('price.js', LABEL_PLAIN_LINE))).toEqual([
        'story:price--plain',
        'story:price--premium',
      ]);
      // The window closed with the last statement: what the second subject
      // did on its own is its own, and what nobody entered selects nobody.
      expect(await selectTestFiles(coverageFile, diffAt('price.js', LATER_PLAIN_LINE))).toEqual([
        'story:price--plain',
      ]);
      expect(await selectTestFiles(coverageFile, diffAt('price.js', LABEL_PREMIUM_LINE))).toEqual([]);
    });
  });

  it('stamps the commit the checkout was at, and nothing when there is none', async () => {
    // An index's whole position in time and space. A reader diffs from here to
    // the working tree to learn what has changed since; without it there is
    // nothing to diff against, which is the honest record of a recording made
    // outside a checkout and leaves a caller running everything.
    await inRoot(async (root) => {
      const cacheRoot = resolve(root, 'cache');
      const coverageFile = resolve(root, 'coverage.bin');
      const module = resolve(root, 'price.js');
      await writeFile(module, SOURCE, 'utf8');

      const plugin = testSelectionProbes({ root, cacheRoot });
      const transformed = plugin.transform(SOURCE, module)!;
      const realm = evaluate(transformed.code);
      realm.price(20);
      const journal = realm.collector.drain();
      const subjects = [{ owner: 'story:price--premium', journal }];

      await recordExecution({ root, cacheRoot, coverageFile, subjects });
      expect(await readTestCoverage(coverageFile)).not.toHaveProperty('commit');

      const head = await checkout(root);
      await recordExecution({ root, cacheRoot, coverageFile, subjects });
      expect((await readTestCoverage(coverageFile)).commit).toBe(head);
    });
  });

  it('records over an index it can no longer read', async () => {
    // Refusing would take the index lock inside a runner's teardown and stop
    // every later run from recording anything until somebody deleted the file
    // by hand. What is lost is evidence this machine could not read anyway.
    await inRoot(async (root) => {
      const cacheRoot = resolve(root, 'cache');
      const coverageFile = resolve(root, 'coverage.bin');
      const module = resolve(root, 'price.js');
      await writeFile(module, SOURCE, 'utf8');

      const plugin = testSelectionProbes({ root, cacheRoot });
      const transformed = plugin.transform(SOURCE, module)!;
      const realm = evaluate(transformed.code);
      realm.price(20);
      const journal = realm.collector.drain();
      await writeFile(coverageFile, 'half a copy of something else', 'utf8');

      const recorded = await recordExecution({
        root,
        cacheRoot,
        coverageFile,
        subjects: [{ owner: 'story:price--premium', journal }],
      });

      expect(recorded).toMatchObject({ recorded: true, subjects: 1 });
      expect(await selectTestFiles(coverageFile, diffAt('price.js', PREMIUM_LINE))).toEqual([
        'story:price--premium',
      ]);
    });
  });

  it('records nothing, and says why, when the page names a module no store holds', async () => {
    // The page is instrumented and reports ordinals; what is missing is the
    // record that says which regions those ordinals are. Joining anyway would
    // put crossings in regions nobody cut.
    await inRoot(async (root) => {
      const module = resolve(root, 'price.js');
      await writeFile(module, SOURCE, 'utf8');

      const plugin = testSelectionProbes({ root, cacheRoot: resolve(root, 'cache') });
      const transformed = plugin.transform(SOURCE, module)!;

      const realm = evaluate(transformed.code);
      realm.price(20);
      const recorded = await recordExecution({
        root,
        cacheRoot: resolve(root, 'another-cache'),
        coverageFile: resolve(root, 'coverage.bin'),
        subjects: [{ owner: 'story:price--premium', journal: realm.collector.drain() }],
      });

      expect(recorded.recorded).toBe(false);
      expect(recorded.because).toContain('no source identity');
      expect(recorded.because).toContain(resolve(root, 'another-cache'));
    });
  });

  it('refuses a page whose probe recipe is not this driver’s', async () => {
    await inRoot(async (root) => {
      const cacheRoot = resolve(root, 'cache');
      const module = resolve(root, 'price.js');
      await writeFile(module, SOURCE, 'utf8');
      const plugin = testSelectionProbes({ root, cacheRoot });
      plugin.transform(SOURCE, module);

      const recorded = await recordExecution({
        root,
        cacheRoot,
        coverageFile: resolve(root, 'coverage.bin'),
        subjects: [
          {
            owner: 'story:price--premium',
            journal: { instrumentation: 'sense:instrument/presence-v1', modules: [] },
          },
        ],
      });

      expect(recorded.recorded).toBe(false);
      expect(recorded.because).toContain('different versions');
    });
  });

  it('keeps both contributions when two processes merge at once', async () => {
    await inRoot(async (root) => {
      const cacheRoot = resolve(root, 'cache');
      const coverageFile = resolve(root, 'coverage.bin');
      const module = resolve(root, 'price.js');
      await writeFile(module, SOURCE, 'utf8');

      const plugin = testSelectionProbes({ root, cacheRoot });
      const transformed = plugin.transform(SOURCE, module)!;

      const realm = evaluate(transformed.code);
      realm.price(20);
      const premium = realm.collector.drain();
      realm.price(1);
      const plain = realm.collector.drain();

      // Two Playwright workers are two processes over one index. Unlocked, the
      // later rename would carry only what its own reader saw.
      const [first, second] = await Promise.all([
        recordExecution({
          root,
          cacheRoot,
          coverageFile,
          subjects: [{ owner: 'tests/premium.spec.ts', journal: premium }],
        }),
        recordExecution({
          root,
          cacheRoot,
          coverageFile,
          subjects: [{ owner: 'tests/plain.spec.ts', journal: plain }],
        }),
      ]);
      expect([first.recorded, second.recorded]).toEqual([true, true]);

      const coverage = await readTestCoverage(coverageFile);
      expect(coverage.tests.map((test) => test.file).sort()).toEqual([
        'tests/plain.spec.ts',
        'tests/premium.spec.ts',
      ]);
      expect(await selectTestFiles(coverageFile, diffAt('price.js', PREMIUM_LINE))).toEqual([
        'tests/premium.spec.ts',
      ]);
    });
  });

  it('lets a story file select the story, through a precondition nothing enters', async () => {
    await inRoot(async (root) => {
      const cacheRoot = resolve(root, 'cache');
      const coverageFile = resolve(root, 'coverage.bin');
      const module = resolve(root, 'price.js');
      await writeFile(module, SOURCE, 'utf8');
      await writeFile(resolve(root, 'price.stories.js'), 'export default {};\n', 'utf8');

      const plugin = testSelectionProbes({ root, cacheRoot });
      const transformed = plugin.transform(SOURCE, module)!;
      const realm = evaluate(transformed.code);
      realm.price(20);

      const precondition = await preconditionOf(root, 'price.stories.js');
      expect(precondition?.name).toBe('price.stories.js');

      await recordExecution({
        root,
        cacheRoot,
        coverageFile,
        subjects: [
          {
            owner: 'story:price--premium',
            journal: realm.collector.drain(),
            preconditions: [precondition!],
          },
        ],
      });

      expect(await selectTestFiles(coverageFile, diffAt('price.stories.js', 1))).toEqual([
        'story:price--premium',
      ]);
    });
  });
});
