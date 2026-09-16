import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  testSelectionProbes,
  preconditionOf,
  recordExecution,
  type ExecutionJournal,
} from './journal.js';
import { readTestCoverage, selectTestFiles } from './index.js';
import {
  INITIALIZING,
  LABEL_PLAIN_LINE,
  LABEL_PREMIUM_LINE,
  LATER_PLAIN_LINE,
  PLAIN_LINE,
  PREMIUM_LINE,
  SOURCE,
  checkout,
  diffAt,
  evaluate,
  forgetThePage,
  inRoot,
} from './__fixtures__/browser-page.js';

afterEach(forgetThePage);

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
