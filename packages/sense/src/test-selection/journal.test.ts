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

interface Realm {
  readonly price: (amount: number) => number;
  readonly collector: ExecutionCollector;
}

/**
 * Run the transformed module the way a page would: collector first, then the
 * module body, with the hoisted import spent by hand because a `new Function`
 * has no module loader to spend it.
 */
function evaluate(transformed: string): Realm {
  new Function(executionCollectorSource())();
  const body = transformed.replace(/^import "[^"]+";/, '');
  new Function(body)();
  const global = globalThis as unknown as Record<string, unknown>;
  return {
    price: global['__browser_test_price'] as (amount: number) => number,
    collector: global[EXECUTION_GLOBAL] as ExecutionCollector,
  };
}

afterEach(() => {
  const global = globalThis as unknown as Record<string, unknown>;
  delete global['__browser_test_price'];
  delete global[EXECUTION_GLOBAL];
  delete global['__VA__'];
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
      const modulesFile = resolve(root, 'modules.json');
      const coverageFile = resolve(root, 'coverage.bin');
      const module = resolve(root, 'price.js');
      await writeFile(module, SOURCE, 'utf8');

      const plugin = testSelectionProbes({ root, modulesFile });
      const transformed = plugin.transform(SOURCE, module)!;
      await plugin.buildEnd();

      const realm = evaluate(transformed.code);
      realm.price(20);
      const premium: ExecutionJournal = realm.collector.drain();
      realm.price(1);
      const plain: ExecutionJournal = realm.collector.drain();

      const recorded = await recordExecution({
        root,
        modulesFile,
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

  it('gives a module-scope edit every subject the page served', async () => {
    await inRoot(async (root) => {
      const modulesFile = resolve(root, 'modules.json');
      const coverageFile = resolve(root, 'coverage.bin');
      const module = resolve(root, 'price.js');
      await writeFile(module, SOURCE, 'utf8');

      const plugin = testSelectionProbes({ root, modulesFile });
      const transformed = plugin.transform(SOURCE, module)!;
      await plugin.buildEnd();

      // The module evaluates once, inside the first subject's window — which is
      // exactly the attribution that would be a lie if it were kept.
      const realm = evaluate(transformed.code);
      realm.price(20);
      const first = realm.collector.drain();
      realm.price(1);
      const second = realm.collector.drain();

      await recordExecution({
        root,
        modulesFile,
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

  it('stamps the commit the checkout was at, and nothing when there is none', async () => {
    // An index's whole position in time and space. A reader diffs from here to
    // the working tree to learn what has changed since; without it there is
    // nothing to diff against, which is the honest record of a recording made
    // outside a checkout and leaves a caller running everything.
    await inRoot(async (root) => {
      const modulesFile = resolve(root, 'modules.json');
      const coverageFile = resolve(root, 'coverage.bin');
      const module = resolve(root, 'price.js');
      await writeFile(module, SOURCE, 'utf8');

      const plugin = testSelectionProbes({ root, modulesFile });
      const transformed = plugin.transform(SOURCE, module)!;
      await plugin.buildEnd();
      const realm = evaluate(transformed.code);
      realm.price(20);
      const journal = realm.collector.drain();
      const subjects = [{ owner: 'story:price--premium', journal }];

      await recordExecution({ root, modulesFile, coverageFile, subjects });
      expect(await readTestCoverage(coverageFile)).not.toHaveProperty('commit');

      const head = await checkout(root);
      await recordExecution({ root, modulesFile, coverageFile, subjects });
      expect((await readTestCoverage(coverageFile)).commit).toBe(head);
    });
  });

  it('records over an index it can no longer read', async () => {
    // Refusing would take the index lock inside a runner's teardown and stop
    // every later run from recording anything until somebody deleted the file
    // by hand. What is lost is evidence this machine could not read anyway.
    await inRoot(async (root) => {
      const modulesFile = resolve(root, 'modules.json');
      const coverageFile = resolve(root, 'coverage.bin');
      const module = resolve(root, 'price.js');
      await writeFile(module, SOURCE, 'utf8');

      const plugin = testSelectionProbes({ root, modulesFile });
      const transformed = plugin.transform(SOURCE, module)!;
      await plugin.buildEnd();
      const realm = evaluate(transformed.code);
      realm.price(20);
      const journal = realm.collector.drain();
      await writeFile(coverageFile, 'half a copy of something else', 'utf8');

      const recorded = await recordExecution({
        root,
        modulesFile,
        coverageFile,
        subjects: [{ owner: 'story:price--premium', journal }],
      });

      expect(recorded).toMatchObject({ recorded: true, subjects: 1 });
      expect(await selectTestFiles(coverageFile, diffAt('price.js', PREMIUM_LINE))).toEqual([
        'story:price--premium',
      ]);
    });
  });

  it('records nothing, and says why, when no build wrote an inventory', async () => {
    await inRoot(async (root) => {
      const recorded = await recordExecution({
        root,
        modulesFile: resolve(root, 'absent.json'),
        coverageFile: resolve(root, 'coverage.bin'),
        subjects: [
          {
            owner: 'story:price--premium',
            journal: { instrumentation: 'sense:instrument/presence-v2', modules: [] },
          },
        ],
      });

      expect(recorded.recorded).toBe(false);
      expect(recorded.because).toContain('testSelectionProbes()');
    });
  });

  it('refuses a page whose probe recipe is not this driver’s', async () => {
    await inRoot(async (root) => {
      const modulesFile = resolve(root, 'modules.json');
      const module = resolve(root, 'price.js');
      await writeFile(module, SOURCE, 'utf8');
      const plugin = testSelectionProbes({ root, modulesFile });
      plugin.transform(SOURCE, module);
      await plugin.buildEnd();

      const recorded = await recordExecution({
        root,
        modulesFile,
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
      const modulesFile = resolve(root, 'modules.json');
      const coverageFile = resolve(root, 'coverage.bin');
      const module = resolve(root, 'price.js');
      await writeFile(module, SOURCE, 'utf8');

      const plugin = testSelectionProbes({ root, modulesFile });
      const transformed = plugin.transform(SOURCE, module)!;
      await plugin.buildEnd();

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
          modulesFile,
          coverageFile,
          subjects: [{ owner: 'tests/premium.spec.ts', journal: premium }],
        }),
        recordExecution({
          root,
          modulesFile,
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
      const modulesFile = resolve(root, 'modules.json');
      const coverageFile = resolve(root, 'coverage.bin');
      const module = resolve(root, 'price.js');
      await writeFile(module, SOURCE, 'utf8');
      await writeFile(resolve(root, 'price.stories.js'), 'export default {};\n', 'utf8');

      const plugin = testSelectionProbes({ root, modulesFile });
      const transformed = plugin.transform(SOURCE, module)!;
      await plugin.buildEnd();
      const realm = evaluate(transformed.code);
      realm.price(20);

      const precondition = await preconditionOf(root, 'price.stories.js');
      expect(precondition?.name).toBe('price.stories.js');

      await recordExecution({
        root,
        modulesFile,
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
