import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SelectionRun } from './selection-run.js';
import { BROWSER_JOURNAL } from './worker-source.js';

/** Built, as `page.test.ts` reads the story: the format `require`s its neighbours by the names the build gives them. */
const { selectionReporter } = (await import('../../dist/test-selection/vitest-reporter.js')) as typeof import('./vitest-reporter.js');

const directories: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

// A case in a page, as its task's `meta` carries it to the reporter.
const meta = {
  [BROWSER_JOURNAL]: {
    file: 'tests/shop.test.ts',
    name: 'pays',
    id: 'a1',
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

    await reporter.onFinished([{ type: 'suite', tasks: [{ type: 'test', meta, result: { state: 'pass' } }] }]);
    expect(readdirSync(directory)).toHaveLength(1);
    await reporter.onTestRunEnd([{
      moduleId: '/tests/shop.test.ts',
      state: () => 'passed',
      children: { allTests: () => [{ meta: () => meta, result: () => ({ state: 'passed' }) }] },
    }]);

    expect(readdirSync(directory)).toHaveLength(1);
  });
});
