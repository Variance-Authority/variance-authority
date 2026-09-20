import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import type { FullConfig } from '@playwright/test/reporter';
import {
  stageExecution,
  stagingDirectory,
  testSelectionProbes,
  type ExecutionJournal,
} from '@variance-authority/sense/journal';
import { readTestCoverage } from '@variance-authority/sense/test-selection';
import { describe, expect, it } from 'vitest';
import ExecutionReporter from './reporter.js';
import { decodeExecutionIndex } from '@variance-authority/sense/test-selection';

const INSTRUMENTATION = 'sense:instrument/presence-v4';
const SOURCE = ['export function price(amount) {', '  return amount * 2;', '}'].join('\n');

async function inRoot(run: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(resolve(tmpdir(), 'variance-playwright-reporter-'));
  try {
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

/** One real instrumented module, so the records the fold reads exist. */
async function instrumented(root: string): Promise<string> {
  const cacheRoot = resolve(root, 'cache');
  const module = resolve(root, 'price.js');
  await writeFile(module, SOURCE, 'utf8');
  testSelectionProbes({ root, cacheRoot }).transform(SOURCE, module);
  return cacheRoot;
}

const journal = (...hits: number[]): ExecutionJournal => ({
  instrumentation: INSTRUMENTATION,
  modules: [{ id: 'price.js', hits, shared: [] }],
});

describe('the reporter that folds what the workers recorded', () => {
  it('joins two workers that each ran part of one spec file', async () => {
    await inRoot(async (root) => {
      const coverageFile = resolve(root, 'coverage.bin');
      const cacheRoot = await instrumented(root);
      const reporter = new ExecutionReporter({ root, cacheRoot, coverageFile, cases: true });

      reporter.onBegin({} as FullConfig);
      const directory = stagingDirectory()!;
      expect(directory).toBeDefined();

      // Two workers, one spec file, one region each. Merged separately, the
      // later row would retire the earlier one's crossings and the file would
      // be recorded whole with half of what it walked.
      for (const [hit, id] of [[0, 'one'], [1, 'two']] as const) {
        await stageExecution(directory, {
          subjects: [{ owner: 'tests/checkout.spec.ts', journal: journal(hit), complete: true }],
          cases: [
            { file: 'tests/checkout.spec.ts', name: `case ${id}`, id, journal: journal(hit) },
          ],
        });
      }
      await reporter.onEnd();

      const coverage = await readTestCoverage(coverageFile);
      expect(coverage.tests.map((test) => test.file)).toEqual(['tests/checkout.spec.ts']);
      expect(coverage.modules[0]!.blocks.filter((block) => block.testFiles.length > 0)).toHaveLength(
        2,
      );
      const index = decodeExecutionIndex(await readFile(`${coverageFile}.cases.bin`));
      expect(index.tests.map((test) => test.name).sort()).toEqual(['case one', 'case two']);

      // The directory goes with the run that named it: what a killed run left
      // behind is evidence of executions that did not happen.
      expect(stagingDirectory()).toBeUndefined();
      await expect(readFile(resolve(directory, 'anything'), 'utf8')).rejects.toThrow();
    });
  });

  it('writes nothing for a run where no worker recorded anything', async () => {
    await inRoot(async (root) => {
      const coverageFile = resolve(root, 'coverage.bin');
      const cacheRoot = await instrumented(root);
      const reporter = new ExecutionReporter({ root, cacheRoot, coverageFile });

      reporter.onBegin({} as FullConfig);
      await reporter.onEnd();

      await expect(readTestCoverage(coverageFile)).rejects.toThrow();
    });
  });

  it('leaves the index alone for a run that did not ask for one', async () => {
    await inRoot(async (root) => {
      const coverageFile = resolve(root, 'coverage.bin');
      const cacheRoot = await instrumented(root);
      const reporter = new ExecutionReporter({ root, cacheRoot, coverageFile });

      reporter.onBegin({} as FullConfig);
      await stageExecution(stagingDirectory()!, {
        subjects: [{ owner: 'tests/checkout.spec.ts', journal: journal(0), complete: true }],
        cases: [{ file: 'tests/checkout.spec.ts', name: 'case one', id: 'one', journal: journal(0) }],
      });
      await reporter.onEnd();

      // A worker offered the cases and the run never asked for them. Being
      // able to write the index is not being obliged to.
      expect((await readTestCoverage(coverageFile)).tests).toHaveLength(1);
      await expect(readFile(`${coverageFile}.cases.bin`)).rejects.toThrow();
    });
  });
});
