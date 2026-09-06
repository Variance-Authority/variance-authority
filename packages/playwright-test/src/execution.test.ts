import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import type { Page } from '@playwright/test';
import { testSelectionProbes, type ExecutionJournal } from '@variance-authority/sense/journal';
import { readTestCoverage } from '@variance-authority/sense/test-selection';
import { describe, expect, it } from 'vitest';
import { createExecutionRecorder } from './execution.js';

const INSTRUMENTATION = 'sense:instrument/presence-v3';

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

/** An inventory over one real instrumented module, so ordinals mean something. */
async function inventory(root: string): Promise<{ modulesFile: string; ordinals: number[] }> {
  const modulesFile = resolve(root, 'modules.json');
  const module = resolve(root, 'price.js');
  await writeFile(module, SOURCE, 'utf8');
  const plugin = testSelectionProbes({ root, modulesFile });
  plugin.transform(SOURCE, module);
  await plugin.buildEnd();
  return { modulesFile, ordinals: [0, 1] };
}

describe('a Playwright worker records what its specs executed', () => {
  it('joins every observation in one spec file to that file', async () => {
    await inRoot(async (root) => {
      const coverageFile = resolve(root, 'coverage.bin');
      const { modulesFile, ordinals } = await inventory(root);

      const recorder = createExecutionRecorder({ root, modulesFile, coverageFile });
      const page = pageReporting(
        { instrumentation: INSTRUMENTATION, modules: [{ file: 'price.js', hits: [ordinals[0]!], shared: [0] }] },
        { instrumentation: INSTRUMENTATION, modules: [{ file: 'price.js', hits: [ordinals[1]!], shared: [] }] },
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
      const { modulesFile } = await inventory(root);

      const recorder = createExecutionRecorder({ root, modulesFile, coverageFile });
      await recorder.note(
        pageReporting({
          instrumentation: INSTRUMENTATION,
          modules: [{ file: 'price.js', hits: [0], shared: [0] }],
        }),
        'tests/checkout.spec.ts',
      );
      recorder.mark('tests/checkout.spec.ts', false);
      await recorder.close();

      expect((await readTestCoverage(coverageFile)).tests[0]!.complete).toBe(false);
    });
  });

  it('writes nothing when the application has no collector in it', async () => {
    await inRoot(async (root) => {
      const coverageFile = resolve(root, 'coverage.bin');
      const { modulesFile } = await inventory(root);
      const recorder = createExecutionRecorder({ root, modulesFile, coverageFile });

      await recorder.note(pageReporting(undefined), 'tests/checkout.spec.ts');
      await recorder.close();

      await expect(readTestCoverage(coverageFile)).rejects.toThrow();
    });
  });
});
