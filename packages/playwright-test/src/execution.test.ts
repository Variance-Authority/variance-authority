import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import type { Page, TestInfo } from '@playwright/test';
import {
  closeStage,
  foldStage,
  openStage,
  testSelectionProbes,
  type ExecutionJournal,
} from '@variance-authority/sense/journal';
import { readTestCoverage } from '@variance-authority/sense/test-selection';
import { describe, expect, it } from 'vitest';
import {
  createExecutionRecorder,
  testOf,
  varianceCompletedFixtures,
  type ExecutionRecorder,
} from './execution.js';

const INSTRUMENTATION = 'sense:instrument/presence-v4';

/** A page that hands over whatever the test says it entered, once per drain. */
function pageReporting(...journals: readonly (ExecutionJournal | undefined)[]): Page {
  const queue = [...journals];
  return {
    evaluate: async () => queue.shift(),
  } as unknown as Page;
}

const SOURCE = ['export function price(amount) {', '  return amount * 2;', '}'].join('\n');

async function inRoot(run: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(resolve(tmpdir(), 'variance-playwright-execution-'));
  try {
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

/** One real instrumented module's record, so ordinals mean something. */
async function instrumented(
  root: string,
): Promise<{ cacheRoot: string; id: string; ordinals: number[] }> {
  const cacheRoot = resolve(root, 'cache');
  const module = resolve(root, 'price.js');
  await writeFile(module, SOURCE, 'utf8');
  const plugin = testSelectionProbes({ root, cacheRoot });
  plugin.transform(SOURCE, module);
  return { cacheRoot, id: 'price.js', ordinals: [0, 1] };
}

/**
 * End one test the way the runner ends it, through the fixture that is supposed
 * to be there for every spec.
 *
 * The bundle is asked for the fixture rather than the module, because what is
 * under test is the wiring: a suite gets whatever `varianceFixtures` carries,
 * and a marking function no fixture reaches marks nothing.
 */
async function ended(
  recorder: ExecutionRecorder,
  owner: string,
  status: TestInfo['status'],
): Promise<void> {
  const declared = varianceCompletedFixtures.varianceCompleted as unknown as readonly [
    (
      args: { varianceRecorder: ExecutionRecorder | undefined },
      use: () => Promise<void>,
      testInfo: TestInfo,
    ) => Promise<void>,
    { auto?: boolean },
  ];
  await declared[0]({ varianceRecorder: recorder }, async () => {}, {
    file: resolve(process.cwd(), owner),
    status,
  } as TestInfo);
}

describe('a Playwright worker records what its specs executed', () => {
  it('joins every observation in one spec file to that file', async () => {
    await inRoot(async (root) => {
      const coverageFile = resolve(root, 'coverage.bin');
      const { cacheRoot, id, ordinals } = await instrumented(root);

      const recorder = createExecutionRecorder({ root, cacheRoot, coverageFile });
      const page = pageReporting(
        { instrumentation: INSTRUMENTATION, modules: [{ id, hits: [ordinals[0]!], shared: [0] }] },
        { instrumentation: INSTRUMENTATION, modules: [{ id, hits: [ordinals[1]!], shared: [] }] },
      );
      await recorder.note(page, 'tests/checkout.spec.ts');
      await recorder.note(page, 'tests/checkout.spec.ts');
      recorder.mark('tests/checkout.spec.ts', true);
      await recorder.close();

      const coverage = await readTestCoverage(coverageFile);
      expect(coverage.tests.map((test) => test.file)).toEqual(['tests/checkout.spec.ts']);
      expect(coverage.tests[0]!.complete).toBe(true);
      const crossed = coverage.modules[0]!.blocks.filter((block) => block.testFiles.length > 0);
      expect(crossed.length).toBe(2);
    });
  });

  it('retires a spec whose test failed, so it can never justify a skip', async () => {
    await inRoot(async (root) => {
      const coverageFile = resolve(root, 'coverage.bin');
      const { cacheRoot, id } = await instrumented(root);

      const recorder = createExecutionRecorder({ root, cacheRoot, coverageFile });
      await recorder.note(
        pageReporting({
          instrumentation: INSTRUMENTATION,
          modules: [{ id, hits: [0], shared: [0] }],
        }),
        'tests/checkout.spec.ts',
      );
      recorder.mark('tests/checkout.spec.ts', false);
      await recorder.close();

      expect((await readTestCoverage(coverageFile)).tests[0]!.complete).toBe(false);
    });
  });

  it('asks the runner about every test, not only the ones that destructured a fixture', () => {
    // The whole of the bug this covers: the verdict used to be read in the
    // teardown of `variance`, which a spec on the journey path never asks for.
    // A fixture that is not `auto` is a fixture some specs simply do not have.
    expect(varianceCompletedFixtures.varianceCompleted[1]).toEqual({ auto: true });
  });

  it('retires a failed spec that never destructured `variance`', async () => {
    await inRoot(async (root) => {
      const coverageFile = resolve(root, 'coverage.bin');
      const { cacheRoot, id } = await instrumented(root);
      const owner = 'tests/checkout.spec.ts';

      const recorder = createExecutionRecorder({ root, cacheRoot, coverageFile });
      await recorder.note(
        pageReporting({ instrumentation: INSTRUMENTATION, modules: [{ id, hits: [0], shared: [0] }] }),
        owner,
      );
      await ended(recorder, owner, 'failed');
      await recorder.close();

      expect((await readTestCoverage(coverageFile)).tests[0]!.complete).toBe(false);
    });
  });

  it('leaves a spec whose tests all passed whole', async () => {
    await inRoot(async (root) => {
      const coverageFile = resolve(root, 'coverage.bin');
      const { cacheRoot, id } = await instrumented(root);
      const owner = 'tests/checkout.spec.ts';

      const recorder = createExecutionRecorder({ root, cacheRoot, coverageFile });
      await recorder.note(
        pageReporting({ instrumentation: INSTRUMENTATION, modules: [{ id, hits: [0], shared: [0] }] }),
        owner,
      );
      await ended(recorder, owner, 'passed');
      await recorder.close();

      expect((await readTestCoverage(coverageFile)).tests[0]!.complete).toBe(true);
    });
  });

  it('writes nothing when the application has no collector in it', async () => {
    await inRoot(async (root) => {
      const coverageFile = resolve(root, 'coverage.bin');
      const { cacheRoot } = await instrumented(root);
      const recorder = createExecutionRecorder({ root, cacheRoot, coverageFile });

      await recorder.note(pageReporting(undefined), 'tests/checkout.spec.ts');
      await recorder.close();

      await expect(readTestCoverage(coverageFile)).rejects.toThrow();
    });
  });
});

describe('a worker that is one of several', () => {
  it('stages its contribution instead of merging the index itself', async () => {
    await inRoot(async (root) => {
      const coverageFile = resolve(root, 'coverage.bin');
      const { cacheRoot, id } = await instrumented(root);
      const directory = resolve(root, '.stage');
      openStage(directory);
      try {
        const recorder = createExecutionRecorder({ root, cacheRoot, coverageFile });
        await recorder.note(
          pageReporting({
            instrumentation: INSTRUMENTATION,
            modules: [{ id, hits: [0], shared: [] }],
          }),
          'tests/checkout.spec.ts',
        );
        await recorder.close();

        // Nothing merged: the run's own record is written once, by whoever saw
        // all of it, because the merge retires a file's previous crossings and
        // a worker only ever has part of the file.
        await expect(readTestCoverage(coverageFile)).rejects.toThrow();
        const staged = await foldStage(directory);
        expect(staged.subjects.map((subject) => subject.owner)).toEqual([
          'tests/checkout.spec.ts',
        ]);
      } finally {
        await closeStage(directory);
      }
    });
  });

  it('records which test entered the region, for a run that asked', async () => {
    await inRoot(async (root) => {
      const coverageFile = resolve(root, 'coverage.bin');
      const { cacheRoot, id } = await instrumented(root);
      const owner = 'tests/checkout.spec.ts';

      const recorder = createExecutionRecorder({ root, cacheRoot, coverageFile, cases: true });
      await recorder.note(
        pageReporting({ instrumentation: INSTRUMENTATION, modules: [{ id, hits: [0], shared: [] }] }),
        owner,
        { name: 'pays with a saved card', id: 'one' },
      );
      await recorder.note(
        pageReporting({ instrumentation: INSTRUMENTATION, modules: [{ id, hits: [1], shared: [] }] }),
        owner,
        { name: 'pays with a new card', id: 'two' },
      );
      await recorder.close();

      const index = JSON.parse(
        await readFile(`${coverageFile}.cases.json`, 'utf8'),
      ) as { readonly tests: readonly { readonly name: string; readonly file: string }[] };
      expect(index.tests.map((test) => test.name).sort()).toEqual([
        'pays with a new card',
        'pays with a saved card',
      ]);
      expect([...new Set(index.tests.map((test) => test.file))]).toEqual([owner]);
    });
  });

  it('writes no index at all for a run that did not ask', async () => {
    await inRoot(async (root) => {
      const coverageFile = resolve(root, 'coverage.bin');
      const { cacheRoot, id } = await instrumented(root);

      const recorder = createExecutionRecorder({ root, cacheRoot, coverageFile });
      await recorder.note(
        pageReporting({ instrumentation: INSTRUMENTATION, modules: [{ id, hits: [0], shared: [] }] }),
        'tests/checkout.spec.ts',
        { name: 'pays with a saved card', id: 'one' },
      );
      await recorder.close();

      // The coordinate was there for the taking and the run did not ask for it.
      // Being able to name a case is not being obliged to write a row for one.
      await expect(readFile(`${coverageFile}.cases.json`, 'utf8')).rejects.toThrow();
    });
  });

  it('names a test by where it is declared, not by the runner position for it', () => {
    expect(
      testOf({
        titlePath: ['chromium', 'tests/checkout.spec.ts', 'checkout', 'pays with a saved card'],
        project: { name: 'chromium' },
        file: resolve(process.cwd(), 'tests/checkout.spec.ts'),
        testId: 'abc123',
      } as unknown as TestInfo),
    ).toEqual({ name: 'checkout > pays with a saved card', id: 'abc123' });
  });
});
