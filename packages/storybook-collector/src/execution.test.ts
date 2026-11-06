/**
 * A story is the case that costs nothing to name: the driver shows one at a
 * time, so the per-case grain a unit runner needs a custom runner for is
 * already here. What the index costs is the file, which is why it is asked for.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import {
  moduleId,
  type EvaluatingPage,
  type ExecutionJournal,
} from '@variance-authority/sense/journal';
import { readTestCoverage } from '@variance-authority/sense/test-selection';
import { storyDirectory } from '@variance-authority/sense/story';
import { describe, expect, it, vi } from 'vitest';
import { createStoryRecorder } from './execution.js';
import { decodeExecutionIndex } from '@variance-authority/sense/test-selection';

const INSTRUMENTATION = 'sense:instrument/presence-v6';
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
  modules: [{ id: moduleId('price.js', SOURCE), hits, shared: [] }],
});

async function inRoot(
  run: (about: { root: string; cacheRoot: string; coverageFile: string; index: string }) => Promise<void>,
): Promise<void> {
  const root = await mkdtemp(resolve(tmpdir(), 'variance-storybook-execution-'));
  try {
    const cacheRoot = resolve(root, 'cache');
    await writeFile(resolve(root, 'price.js'), SOURCE, 'utf8');
    const index = resolve(root, 'index.json');
    await writeFile(index, JSON.stringify(INDEX), 'utf8');
    await run({ root, cacheRoot, coverageFile: resolve(root, 'coverage.bin'), index });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

describe('a Storybook run records what each story executed', () => {
  it('writes each story\'s story beside the record, once however many times it was read, where the run asked for stories', async () => {
    const story = { tape: [0], taped: 1, visits: 1, notes: [], lines: [], unnoted: 0, held: [], rows: { ids: [moduleId('price.js', SOURCE)], counts: [1], bases: [0] } };
    const taped = (...hits: number[]): ExecutionJournal => ({ ...journal(...hits), story });
    for (const asked of [true, false]) {
      await inRoot(async ({ root, cacheRoot, coverageFile, index }) => {
        if (asked) vi.stubEnv('VARIANCE_AUTHORITY_STORY', '1');
        try {
          const recorder = await createStoryRecorder(index, { root, cacheRoot, coverageFile });
          expect(recorder.storyPage !== undefined).toBe(asked);
          await recorder.note(pageReporting(taped(0)), 'story:price--premium', true);
          await recorder.note(pageReporting(taped(0)), 'story:price--premium', true);
          await recorder.note(pageReporting(taped(1)), 'story:price--plain', false);
          await recorder.close();

          const directory = storyDirectory(coverageFile);
          expect(existsSync(directory) ? readdirSync(directory).length : 0).toBe(asked ? 2 : 0);
        } finally {
          vi.unstubAllEnvs();
        }
      });
    }
  });

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

      const written = decodeExecutionIndex(await readFile(coverageFile));
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

  it('records the time the run spent on each story, once, however many times it was read', async () => {
    await inRoot(async ({ root, cacheRoot, coverageFile, index }) => {
      const recorder = await createStoryRecorder(index, { root, cacheRoot, coverageFile });
      // Read twice — the second time alone — and timed once, first collection to decision.
      await recorder.note(pageReporting(journal(0)), 'story:price--premium', true);
      await recorder.note(pageReporting(journal(0)), 'story:price--premium', true);
      await recorder.note(pageReporting(journal(1)), 'story:price--plain', true);
      await recorder.close(new Map([['story:price--premium', 340]]));

      const cases = decodeExecutionIndex(await readFile(coverageFile)).tests;
      expect(Object.fromEntries(cases.map((test) => [test.name, test.duration]))).toEqual({
        'Price/Premium': 340,
        'Price/Plain': undefined,
      });
      const files = (await readTestCoverage(coverageFile)).tests;
      expect(Object.fromEntries(files.map((test) => [test.file, test.duration]))).toEqual({
        'story:price--premium': 340,
        'story:price--plain': undefined,
      });
    });
  });

  it('records where the browser spent a story: the preview load once, the story file, the render', async () => {
    await inRoot(async ({ root, cacheRoot, coverageFile, index }) => {
      const recorder = await createStoryRecorder(index, { root, cacheRoot, coverageFile });
      // The first story on a document carries the preview's load; a story the
      // preview switched to paid nothing for it.
      await recorder.note(pageReporting(journal(0)), 'story:price--premium', true, { ready: 900, collect: 40, cases: 12 });
      await recorder.note(pageReporting(journal(1)), 'story:price--plain', true, { ready: 0, collect: 5, cases: 3 });
      await recorder.close();

      const files = (await readTestCoverage(coverageFile)).tests;
      expect(Object.fromEntries(files.map((test) => [test.file, test.phases]))).toEqual({
        'story:price--premium': { prepare: 900, collect: 40, cases: 12 },
        'story:price--plain': { prepare: 0, collect: 5, cases: 3 },
      });
    });
  });

  it('records each width a story is read at as its own row, with its own figures', async () => {
    await inRoot(async ({ root, cacheRoot, coverageFile, index }) => {
      const recorder = await createStoryRecorder(index, { root, cacheRoot, coverageFile });
      await recorder.note(pageReporting(journal(0)), 'story:price--premium@375', true, { ready: 900, collect: 40, cases: 12 });
      await recorder.note(pageReporting(journal(0)), 'story:price--premium@1280', true, { ready: 0, collect: 30, cases: 10 });
      await recorder.close();

      const files = (await readTestCoverage(coverageFile)).tests;
      expect(Object.fromEntries(files.map((test) => [test.file, test.phases]))).toEqual({
        'story:price--premium@375': { prepare: 900, collect: 40, cases: 12 },
        'story:price--premium@1280': { prepare: 0, collect: 30, cases: 10 },
      });
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
      await writeFile(resolve(root, 'price.js'), SOURCE, 'utf8');
      await writeFile(resolve(root, 'src/Price.stories.tsx'), 'export default {};\n', 'utf8');
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
      });
      await recorder.note(
        pageReporting({ instrumentation: INSTRUMENTATION, modules: [{ id: moduleId('packages/ui/price.js', SOURCE), hits: [0], shared: [] }] }),
        'story:price--premium',
        true,
      );
      await recorder.close();

      const [test] = (await readTestCoverage(coverageFile)).tests;
      expect(test?.preconditions.map((precondition) => precondition.name)).toContain(
        'packages/ui/src/Price.stories.tsx',
      );
      const written = decodeExecutionIndex(await readFile(coverageFile));
      expect(written.tests.map((each) => each.file)).toEqual(['packages/ui/src/Price.stories.tsx']);
    } finally {
      await rm(checkout, { recursive: true, force: true });
    }
  });
});
