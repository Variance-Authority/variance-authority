import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import {
  moduleId,
  stageExecution,
  stagingDirectory,
  type ExecutionJournal,
} from '@variance-authority/sense/journal';
import { readTestCoverage } from '@variance-authority/sense/test-selection';
import type { FullConfig, Suite } from '@playwright/test/reporter';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SkippedFiles, fileSelection, selectFiles } from './file-selection.js';
import ExecutionReporter from './reporter.js';
import { decodeExecutionIndex } from '@variance-authority/sense/test-selection';

const INSTRUMENTATION = 'sense:instrument/presence-v6';
const SOURCE = ['export function price(amount) {', '  return amount * 2;', '}'].join('\n');

async function inRoot(run: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(resolve(tmpdir(), 'variance-playwright-reporter-'));
  try {
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

/** One real module on disk, so the fold can cut what its id names. */
async function instrumented(root: string): Promise<string> {
  await writeFile(resolve(root, 'price.js'), SOURCE, 'utf8');
  return resolve(root, 'cache');
}

const journal = (...hits: number[]): ExecutionJournal => ({
  instrumentation: INSTRUMENTATION,
  modules: [{ id: moduleId('price.js', SOURCE), hits, shared: [] }],
});

describe('the reporter that folds what the workers recorded', () => {
  it('joins two workers that each ran part of one spec file', async () => {
    await inRoot(async (root) => {
      const coverageFile = resolve(root, 'coverage.bin');
      const cacheRoot = await instrumented(root);
      const reporter = new ExecutionReporter({ root, cacheRoot, coverageFile });

      reporter.onBegin();
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
      const index = decodeExecutionIndex(await readFile(coverageFile));
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

      reporter.onBegin();
      await reporter.onEnd();

      await expect(readTestCoverage(coverageFile)).rejects.toThrow();
    });
  });

  it('writes a relative record and the cases in it beside the root it was given, where the fixture writes it', async () => {
    // Every seam resolves these against its own root. Resolved against the
    // checkout instead, a suite under `packages/ui` staged its workers beside
    // one snapshot and folded into another, and the fixture recording without
    // the reporter wrote to a third.
    const checkout = await mkdtemp(resolve(tmpdir(), 'variance-playwright-checkout-'));
    try {
      execFileSync('git', ['init', '-q'], { cwd: checkout });
      const root = resolve(checkout, 'packages/ui');
      await mkdir(root, { recursive: true });
      const cacheRoot = await instrumented(root);
      const reporter = new ExecutionReporter({
        root,
        cacheRoot,
        coverageFile: 'coverage.bin',
      });

      reporter.onBegin();
      const directory = stagingDirectory()!;
      expect(directory.startsWith(`${root}/`)).toBe(true);
      const walked: ExecutionJournal = {
        instrumentation: INSTRUMENTATION,
        modules: [{ id: moduleId('packages/ui/price.js', SOURCE), hits: [0], shared: [] }],
      };
      await stageExecution(directory, {
        subjects: [{ owner: 'packages/ui/tests/checkout.spec.ts', journal: walked, complete: true }],
        cases: [
          { file: 'packages/ui/tests/checkout.spec.ts', name: 'case one', id: 'one', journal: walked },
        ],
      });
      await reporter.onEnd();

      expect((await readTestCoverage(resolve(root, 'coverage.bin'))).tests).toHaveLength(1);
      const index = decodeExecutionIndex(await readFile(resolve(root, 'coverage.bin')));
      expect(index.tests.map((test) => test.name)).toEqual(['case one']);
      await expect(readFile(resolve(checkout, 'coverage.bin'))).rejects.toThrow();
    } finally {
      await rm(checkout, { recursive: true, force: true });
    }
  });
});

describe('the verdict on a run that found no tests', () => {
  const config = { projects: [{ testMatch: '**/*.spec.ts' }] } as unknown as FullConfig;
  const nothing = { allTests: () => [] } as unknown as Suite;
  const noTests = { message: 'Error: No tests found.' };

  afterEach(() => {
    (globalThis as Record<symbol, unknown>)[Symbol.for('variance-authority:playwright-selection')] = undefined;
    vi.restoreAllMocks();
  });

  /** A selection read over `tests/`, with `skip` dropped and every other file let through. */
  async function selecting(root: string, skip: readonly string[], found: readonly string[]): Promise<void> {
    const read = async () => ({ whole: new Set(found), skip: new Set(skip), notes: [] });
    selectFiles(root, read);
    fileSelection()!.selection = await read();
    const drop = new SkippedFiles();
    for (const file of found) drop.test(resolve(root, file));
  }

  async function verdict(root: string): Promise<unknown> {
    const reporter = new ExecutionReporter({ root, cacheRoot: await instrumented(root), coverageFile: resolve(root, 'coverage.bin') });
    reporter.onBegin(config, nothing);
    reporter.onError(noTests);
    return reporter.onEnd({ status: 'failed', startTime: new Date(), duration: 0 });
  }

  it('passes it, and says what was selected, when the selection dropped every spec file', async () => {
    await inRoot(async (root) => {
      const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
      await selecting(root, ['tests/a.spec.ts', 'tests/b.spec.ts'], ['tests/a.spec.ts', 'tests/b.spec.ts', 'tests/helpers.ts']);

      expect(await verdict(root)).toEqual({ status: 'passed' });
      expect(stderr.mock.calls.map(([line]) => String(line)).join('')).toContain('selected');
    });
  });

  it('leaves it failed when the selection kept a spec file the run then filtered out', async () => {
    await inRoot(async (root) => {
      await selecting(root, ['tests/b.spec.ts'], ['tests/a.spec.ts', 'tests/b.spec.ts']);
      expect(await verdict(root)).toBeUndefined();
    });
  });

  it('leaves it failed when the selection dropped nothing', async () => {
    await inRoot(async (root) => {
      await selecting(root, [], ['tests/a.spec.ts']);
      expect(await verdict(root)).toBeUndefined();
    });
  });
});
