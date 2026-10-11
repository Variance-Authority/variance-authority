import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import type { Page, TestInfo } from '@playwright/test';
import { moduleId } from '@variance-authority/sense/journal';
import { decodeExecutionIndex, recordedEyesAt } from '@variance-authority/sense/test-selection';
import { describe, expect, it, vi } from 'vitest';
import { varianceCompletedFixtures } from './completed.js';
import { createExecutionRecorder, type ExecutionRecorder } from './execution.js';

// These drive the fixture with a `TestInfo` cut to what recording reads, which
// carries none of the worker internals a hook's describe is read from; that
// read is the real run in `preconditions.chromium.test.ts`, and is cut here.
vi.mock('./preconditions.js', async (original) => ({
  ...(await original<typeof import('./preconditions.js')>()),
  enterDescribes: async () => {},
}));

const CASE_SCOPE = Symbol.for('variance-authority.test-selection.cases');
const INSTRUMENTATION = 'sense:instrument/presence-v5';
const SOURCE = ['export function price(amount) {', '  return amount * 2;', '}'].join('\n');

interface Scope {
  readonly root: string;
  eyes(journal: Readonly<Record<string, unknown>>): boolean;
  watch(): void;
}

const scopeNow = (): Scope | undefined => (globalThis as { [CASE_SCOPE]?: Scope })[CASE_SCOPE];

/** One test, run the way the runner runs it: through the fixture every spec gets. */
async function ran(
  recorder: ExecutionRecorder,
  root: string,
  testInfo: Partial<TestInfo>,
  body: () => Promise<void>,
): Promise<void> {
  const declared = varianceCompletedFixtures.varianceCompleted as unknown as readonly [
    (args: { varianceRecorder: ExecutionRecorder | undefined }, use: () => Promise<void>, testInfo: TestInfo) => Promise<void>,
  ];
  await declared[0]({ varianceRecorder: recorder }, body, {
    project: { name: 'chromium' },
    file: resolve(root, 'tests/checkout.spec.ts'),
    titlePath: ['chromium', 'tests/checkout.spec.ts', 'checkout', 'pays'],
    testId: 'runner-id-1',
    retry: 0,
    status: 'passed',
    duration: 1,
    ...testInfo,
  } as unknown as TestInfo);
}

describe('the case a Playwright test runs as', () => {
  it('takes each attempt\'s journal under the case the index names, counting attempts from 1', async () => {
    const root = await mkdtemp(resolve(tmpdir(), 'variance-playwright-case-scope-'));
    try {
      const cacheRoot = resolve(root, 'cache');
      await writeFile(resolve(root, 'price.js'), SOURCE, 'utf8');
      const coverageFile = resolve(root, 'coverage.bin');
      const recorder = createExecutionRecorder({ root, cacheRoot, coverageFile });
      const page = {
        evaluate: async () => ({ instrumentation: INSTRUMENTATION, modules: [{ id: moduleId('price.js', SOURCE), hits: [0], shared: [] }] }),
      } as unknown as Page;

      const found = scopeNow();
      for (const [retry, status] of [[0, 'failed'], [1, 'passed']] as const) {
        await ran(recorder, root, { retry, status }, async () => {
          await recorder.note(page, 'tests/checkout.spec.ts', { name: 'checkout > pays', id: 'runner-id-1' });
          expect(scopeNow()!.root).toBe(root);
          expect(scopeNow()!.eyes({ complete: true, attention: [], seen: retry })).toBe(true);
        });
      }
      // The case is over: the realm holds what it held before the test.
      expect(scopeNow()).toBe(found);
      await recorder.close();

      const index = decodeExecutionIndex(await readFile(coverageFile));
      expect(index.tests.map((test) => [test.id, test.name])).toEqual([
        ['tests/checkout.spec.ts > checkout > pays', 'checkout > pays'],
      ]);
      expect(recordedEyesAt(coverageFile)).toEqual({
        watched: ['tests/checkout.spec.ts > checkout > pays'],
        journals: [
          { case: 'tests/checkout.spec.ts > checkout > pays', attempt: 1, journal: { complete: true, attention: [], seen: 0 } },
          { case: 'tests/checkout.spec.ts > checkout > pays', attempt: 2, journal: { complete: true, attention: [], seen: 1 } },
        ],
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('names a case whose test opened a journal and handed none over, apart from a run that opened none', async () => {
    const root = await mkdtemp(resolve(tmpdir(), 'variance-playwright-case-scope-'));
    try {
      const cacheRoot = resolve(root, 'cache');
      await writeFile(resolve(root, 'price.js'), SOURCE, 'utf8');
      const coverageFile = resolve(root, 'coverage.bin');
      const recorder = createExecutionRecorder({ root, cacheRoot, coverageFile });
      const page = {
        evaluate: async () => ({ instrumentation: INSTRUMENTATION, modules: [{ id: moduleId('price.js', SOURCE), hits: [0], shared: [] }] }),
      } as unknown as Page;
      await ran(recorder, root, {}, async () => {
        scopeNow()!.watch();
        await recorder.note(page, 'tests/checkout.spec.ts', { name: 'checkout > pays', id: 'runner-id-1' });
      });
      await recorder.close();
      expect(recordedEyesAt(coverageFile)).toEqual({ watched: ['|chromium| tests/checkout.spec.ts > checkout > pays'], journals: [] });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('keeps no Eyes section for a run whose tests handed none', async () => {
    const root = await mkdtemp(resolve(tmpdir(), 'variance-playwright-case-scope-'));
    try {
      const cacheRoot = resolve(root, 'cache');
      await writeFile(resolve(root, 'price.js'), SOURCE, 'utf8');
      const coverageFile = resolve(root, 'coverage.bin');
      const recorder = createExecutionRecorder({ root, cacheRoot, coverageFile });
      const page = {
        evaluate: async () => ({ instrumentation: INSTRUMENTATION, modules: [{ id: moduleId('price.js', SOURCE), hits: [0], shared: [] }] }),
      } as unknown as Page;
      await ran(recorder, root, {}, () =>
        recorder.note(page, 'tests/checkout.spec.ts', { name: 'checkout > pays', id: 'runner-id-1' }));
      await recorder.close();
      expect(recordedEyesAt(coverageFile)).toBeUndefined();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('leaves the realm\'s scope as it found it, and a scope something installed during the test where it put it', async () => {
    const root = await mkdtemp(resolve(tmpdir(), 'variance-playwright-case-scope-'));
    const holder = globalThis as { [CASE_SCOPE]?: unknown };
    const found = holder[CASE_SCOPE];
    try {
      const recorder = createExecutionRecorder({
        root, cacheRoot: resolve(root, 'cache'), coverageFile: resolve(root, 'coverage.bin'),
      });
      const installed = { root: 'another collector' };
      holder[CASE_SCOPE] = installed;
      await ran(recorder, root, {}, async () => {
        expect(scopeNow()!.root).toBe(root);
      });
      expect(holder[CASE_SCOPE]).toBe(installed);

      const replaced = { root: 'installed by the test' };
      await ran(recorder, root, {}, async () => {
        holder[CASE_SCOPE] = replaced;
      });
      expect(holder[CASE_SCOPE]).toBe(replaced);

      // A realm with no scope is left with none, not with one set to `undefined`.
      delete holder[CASE_SCOPE];
      await ran(recorder, root, {}, async () => {
        expect(scopeNow()!.root).toBe(root);
      });
      expect(CASE_SCOPE in holder).toBe(false);
    } finally {
      holder[CASE_SCOPE] = found;
      if (found === undefined) delete holder[CASE_SCOPE];
      await rm(root, { recursive: true, force: true });
    }
  });
});
