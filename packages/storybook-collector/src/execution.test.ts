/**
 * A story is the case that costs nothing to name: the driver shows one at a
 * time, so the per-case grain a unit runner needs a custom runner for is
 * already here. What the index costs is the file, which is why it is asked for.
 */

import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import {
  testSelectionProbes,
  type EvaluatingPage,
  type ExecutionJournal,
} from '@variance-authority/sense/journal';
import { readTestCoverage } from '@variance-authority/sense/test-selection';
import { describe, expect, it } from 'vitest';
import { createStoryRecorder } from './execution.js';
import { decodeExecutionIndex } from '@variance-authority/sense/test-selection';

const INSTRUMENTATION = 'sense:instrument/presence-v5';
const SOURCE = ['export function price(amount) {', '  return amount * 2;', '}'].join('\n');

const INDEX = {
  v: 5,
  entries: {
    'price--premium': {
      id: 'price--premium',
      type: 'story',
      name: 'Premium',
      title: 'Price',
      importPath: 'src/Price.stories.tsx',
    },
    'price--plain': {
      id: 'price--plain',
      type: 'story',
      name: 'Plain',
      title: 'Price',
      importPath: 'src/Price.stories.tsx',
    },
  },
};

/** A preview that hands over whatever the test says the story entered. */
function pageReporting(journal: ExecutionJournal): EvaluatingPage {
  return { evaluate: async () => journal } as unknown as EvaluatingPage;
}

const journal = (...hits: number[]): ExecutionJournal => ({
  instrumentation: INSTRUMENTATION,
  modules: [{ id: 'price.js', hits, shared: [] }],
});

async function inRoot(
  run: (about: { root: string; cacheRoot: string; coverageFile: string; index: string }) => Promise<void>,
): Promise<void> {
  const root = await mkdtemp(resolve(tmpdir(), 'variance-storybook-execution-'));
  try {
    const cacheRoot = resolve(root, 'cache');
    const module = resolve(root, 'price.js');
    await writeFile(module, SOURCE, 'utf8');
    testSelectionProbes({ root, cacheRoot }).transform(SOURCE, module);
    const index = resolve(root, 'index.json');
    await writeFile(index, JSON.stringify(INDEX), 'utf8');
    await run({ root, cacheRoot, coverageFile: resolve(root, 'coverage.bin'), index });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

describe('a Storybook run records what each story executed', () => {
  it('names the story that entered the region, for a run that asked', async () => {
    await inRoot(async ({ root, cacheRoot, coverageFile, index }) => {
      const recorder = await createStoryRecorder(index, {
        root,
        cacheRoot,
        coverageFile,
      });
      await recorder.note(pageReporting(journal(0)), 'story:price--premium', true);
      await recorder.note(pageReporting(journal(1)), 'story:price--plain', true);
      await recorder.close();

      const written = decodeExecutionIndex(await readFile(`${coverageFile}.cases.bin`));
      // By its declaration, which is what a person reads in the sidebar and
      // what a diff touches — not by the id Storybook slugged from it.
      expect(written.tests.map((test) => test.name).sort()).toEqual([
        'Price/Plain',
        'Price/Premium',
      ]);
      expect([...new Set(written.tests.map((test) => test.file))]).toEqual([
        'src/Price.stories.tsx',
      ]);
    });
  });

  it('names a story file from the checkout, not from where Storybook ran', async () => {
    // Storybook writes `importPath` relative to its own directory, with a `./`
    // in front. In a workspace that directory is a package, and a story file
    // named from there is a path the diff never spells: its precondition read
    // nothing and its case named a file no commit touches.
    const checkout = await mkdtemp(resolve(tmpdir(), 'variance-storybook-checkout-'));
    try {
      execFileSync('git', ['init', '-q'], { cwd: checkout });
      const root = resolve(checkout, 'packages/ui');
      await mkdir(resolve(root, 'src'), { recursive: true });
      const cacheRoot = resolve(checkout, 'cache');
      const module = resolve(root, 'price.js');
      await writeFile(module, SOURCE, 'utf8');
      await writeFile(resolve(root, 'src/Price.stories.tsx'), 'export default {};\n', 'utf8');
      testSelectionProbes({ root, cacheRoot }).transform(SOURCE, module);
      const index = resolve(root, 'storybook-static/index.json');
      await mkdir(dirname(index), { recursive: true });
      const entry = INDEX.entries['price--premium'];
      await writeFile(
        index,
        JSON.stringify({ ...INDEX, entries: { [entry.id]: { ...entry, importPath: './src/Price.stories.tsx' } } }),
        'utf8',
      );
      // Relative, so it is read from `root` as every seam reads it, and the
      // record is found in the package rather than at the checkout's root.
      const coverageFile = resolve(root, 'coverage.bin');

      const recorder = await createStoryRecorder(index, {
        root,
        cacheRoot,
        coverageFile: 'coverage.bin',
        executionFile: 'cases.bin',
      });
      await recorder.note(
        pageReporting({ instrumentation: INSTRUMENTATION, modules: [{ id: 'packages/ui/price.js', hits: [0], shared: [] }] }),
        'story:price--premium',
        true,
      );
      await recorder.close();

      const [test] = (await readTestCoverage(coverageFile)).tests;
      expect(test?.preconditions.map((precondition) => precondition.name)).toContain(
        'packages/ui/src/Price.stories.tsx',
      );
      const written = decodeExecutionIndex(await readFile(resolve(root, 'cases.bin')));
      expect(written.tests.map((each) => each.file)).toEqual(['packages/ui/src/Price.stories.tsx']);
    } finally {
      await rm(checkout, { recursive: true, force: true });
    }
  });
});
