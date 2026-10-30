import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SelectionRun } from './selection-run.js';
import { BROWSER_JOURNAL } from './worker-source.js';
import { reportedCases, taskCases } from './case-durations.js';
import type { ReportedModule, RunnerTask } from './finished-files.js';

/** Built, as `page.test.ts` reads the story: the format `require`s its neighbours by the names the build gives them. */
const { decodeStory } = (await import('../../dist/story/format.cjs')).default as typeof import('../story/format.cjs');
const { selectionReporter } = (await import('../../dist/test-selection/vitest-reporter.js')) as typeof import('./vitest-reporter.js');

const directories: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

// A case in a page, as its task's `meta` carries it to the reporter.
const meta = {
  [BROWSER_JOURNAL]: {
    story: { tape: [0], taped: 1, visits: 1, notes: [], lines: [], unnoted: 0, held: [], rows: { ids: ['a'], counts: [1], bases: [0] } },
  },
};

describe('the reporter of a run whose cases write stories', () => {
  it('writes a page case once when the runner announces the end through both hooks', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'reporter-stories-'));
    directories.push(directory);
    // Each reading a clock tick apart, so a second one is a second file.
    let now = 1;
    vi.spyOn(Date, 'now').mockImplementation(() => now++);
    const run = { settled: false } as SelectionRun;
    const reporter = selectionReporter(run, async () => {
      run.settled = true;
    }, directory) as unknown as {
      onFinished(files: unknown[]): Promise<void>;
      onTestRunEnd(modules: unknown[]): Promise<void>;
    };

    await reporter.onFinished([{ filepath: '/tests/shop.test.ts', tasks: [{ name: 'pays', id: 'a1', meta, result: { state: 'pass' } }] }]);
    expect(readdirSync(directory)).toHaveLength(1);
    await reporter.onTestRunEnd([{
      moduleId: '/tests/shop.test.ts',
      state: () => 'passed',
      children: { allTests: () => [{ fullName: 'pays', id: 'a1', meta: () => meta, result: () => ({ state: 'passed' }) }] },
    }]);

    expect(readdirSync(directory)).toHaveLength(1);
  });

  it('names a page case as the record names it, through either hook', async () => {
    const vitest2 = { filepath: '/tests/shop.test.ts', tasks: [{ name: 'checkout', tasks: [{ name: 'pays', id: 'a1', meta, result: { state: 'fail' } }] }] } as RunnerTask;
    const vitest4 = {
      moduleId: '/tests/shop.test.ts',
      children: { allTests: () => [{ fullName: 'checkout > pays', id: 'a1', meta: () => meta, result: () => ({ state: 'failed' }) }] },
    } as ReportedModule;
    for (const [hook, end, record] of [
      ['onFinished', vitest2, taskCases(vitest2).cases!] as const,
      ['onTestRunEnd', vitest4, reportedCases(vitest4).cases!] as const,
    ]) {
      expect(written(await announced(hook, end))).toMatchObject({ file: '/tests/shop.test.ts', name: record[0]!.name, stopped: true });
    }
  });

  it('writes no story for a page case whose result leaves its name out, and one for a case it gives no id', async () => {
    const nameless = { moduleId: '/tests/shop.test.ts', children: { allTests: () => [{ id: 'a1', meta: () => meta, result: () => ({ state: 'passed' }) }] } };
    expect(readdirSync(await announced('onTestRunEnd', nameless))).toEqual([]);
    const unnumbered = { moduleId: '/tests/shop.test.ts', children: { allTests: () => [{ fullName: 'pays', meta: () => meta, result: () => ({ state: 'passed' }) }] } };
    expect(written(await announced('onTestRunEnd', unnumbered))).toMatchObject({ file: '/tests/shop.test.ts', name: 'pays' });
  });
});

/** The story directory after the reporter heard one end through `hook`. */
async function announced(hook: 'onFinished' | 'onTestRunEnd', end: unknown): Promise<string> {
  const directory = mkdtempSync(join(tmpdir(), 'reporter-stories-'));
  directories.push(directory);
  const run = { settled: false } as SelectionRun;
  const reporter = selectionReporter(run, async () => {
    run.settled = true;
  }, directory) as unknown as Record<typeof hook, (ends: unknown[]) => Promise<void>>;
  await reporter[hook]([end]);
  return directory;
}

function written(directory: string) {
  const [only, ...more] = readdirSync(directory);
  expect(more).toEqual([]);
  return decodeStory(readFileSync(join(directory, only!)));
}
