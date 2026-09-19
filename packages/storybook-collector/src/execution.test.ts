/**
 * A story is the case that costs nothing to name: the driver shows one at a
 * time, so the per-case grain a unit runner needs a custom runner for is
 * already here. What the index costs is the file, which is why it is asked for.
 */

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import {
  testSelectionProbes,
  type EvaluatingPage,
  type ExecutionJournal,
} from '@variance-authority/sense/journal';
import { readTestCoverage } from '@variance-authority/sense/test-selection';
import { describe, expect, it } from 'vitest';
import { createStoryRecorder } from './execution.js';

const INSTRUMENTATION = 'sense:instrument/presence-v4';
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
        cases: true,
      });
      await recorder.note(pageReporting(journal(0)), 'story:price--premium', true);
      await recorder.note(pageReporting(journal(1)), 'story:price--plain', true);
      await recorder.close();

      const written = JSON.parse(await readFile(`${coverageFile}.cases.json`, 'utf8')) as {
        readonly tests: readonly { readonly name: string; readonly file: string }[];
      };
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

  it('writes the same record and no index for a run that did not ask', async () => {
    await inRoot(async ({ root, cacheRoot, coverageFile, index }) => {
      const recorder = await createStoryRecorder(index, { root, cacheRoot, coverageFile });
      await recorder.note(pageReporting(journal(0)), 'story:price--premium', true);
      await recorder.close();

      expect((await readTestCoverage(coverageFile)).tests.map((test) => test.file)).toEqual([
        'story:price--premium',
      ]);
      await expect(readFile(`${coverageFile}.cases.json`, 'utf8')).rejects.toThrow();
    });
  });
});
