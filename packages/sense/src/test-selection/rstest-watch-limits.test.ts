import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FinishedFile } from './selection-fold.js';
import { withTestSelection } from './rstest.js';

const settled = vi.hoisted(() => [] as (readonly FinishedFile[])[]);

// A reporter alone writes no case row: those come from the probes a run's
// bundle leaves. What the cycle hands the fold is the reporter's whole answer.
vi.mock('./selection-fold.js', async (actual) => ({
  ...await actual<typeof import('./selection-fold.js')>(),
  foldRun: () => async (files: readonly FinishedFile[]) => {
    settled.push(files);
  },
}));

const temporary: string[] = [];

afterEach(async () => {
  settled.length = 0;
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

interface Watching {
  onTestCaseStart(test: object): void;
  onTestRunStart(): unknown;
  onTestRunEnd(payload: object): Promise<void>;
}

describe('a watching Rstest', () => {
  it('hands on the limit a case ran under this cycle, not a longer one an earlier cycle held it to', async () => {
    const directory = await mkdtemp(resolve(tmpdir(), 'variance-authority-rstest-watch-'));
    temporary.push(directory);
    const testPath = resolve(directory, 'a.test.ts');
    await writeFile(testPath, '// a\n', 'utf8');
    const config = withTestSelection({ root: directory }, { coverageFile: resolve(directory, 'coverage.bin') });
    const reporter = (config.reporters as ReadonlyArray<Watching>)[1]!;
    const cycle = async (timeout: number) => {
      await reporter.onTestRunStart();
      reporter.onTestCaseStart({ testPath, name: 'waits', timeout });
      await reporter.onTestRunEnd({
        results: [{ testPath, status: 'pass', results: [{ name: 'waits', status: 'pass', duration: 1 }] }],
        rerunTestPaths: [testPath],
      });
    };

    await cycle(60_000);
    await cycle(5_000);

    expect(settled.map((files) => files[0]!.cases?.[0]?.limit)).toEqual([60_000, 5_000]);
  });
});
