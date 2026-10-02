/**
 * A run's processes write concurrently, and what they wrote is read back the
 * same way whichever of them finished first.
 *
 * No clock orders two workers the same way twice, so a reader that follows the
 * order the files were written in — or the order a listing returns names that
 * are only unique — folds the same run differently each time it runs.
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { inspectCaseRun } from './case-fold.js';
import { readJournals } from './finished-files.js';
// The runner's modules `require` the collectors, so they are loaded built, and
// through the export a runner's author imports.
const { observeTestFile, startRecording, RECORDING_VARIABLE } =
  (await import('@variance-authority/sense/runner')) as typeof import('./runner.js');

const temporary: string[] = [];

afterEach(async () => {
  delete process.env[RECORDING_VARIABLE];
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

// Six workers, each finishing one test file: a reader in any order but what
// they wrote agrees with itself once in 720 runs.
const workers = Array.from({ length: 6 }, (_, at) => `test/case-${at}.test.mjs`);

/** A run whose workers finished in `order`, each through the runner's own writer. */
async function finishedIn(
  root: string,
  order: readonly string[],
): Promise<{ runDirectory: string; caseDirectory: string }> {
  startRecording({ root, coverageFile: resolve(root, 'coverage.bin') });
  const { runDirectory, caseDirectory } = JSON.parse(process.env[RECORDING_VARIABLE]!) as {
    runDirectory: string;
    caseDirectory: string;
  };
  temporary.push(runDirectory, caseDirectory);
  for (const file of order) {
    const observer = observeTestFile(resolve(root, file))!;
    observer.case(['runs', file], () => undefined);
    observer.finish();
  }
  delete process.env[RECORDING_VARIABLE];
  return { runDirectory, caseDirectory };
}

describe('what a run wrote, read back', () => {
  it('reads the journals of the test files the same whichever worker finished first', async () => {
    const root = await mkdtemp(resolve(tmpdir(), 'variance-authority-write-order-'));
    temporary.push(root);
    const forwards = await finishedIn(root, workers);
    const backwards = await finishedIn(root, [...workers].reverse());

    expect(JSON.stringify(await readJournals(backwards.runDirectory)))
      .toBe(JSON.stringify(await readJournals(forwards.runDirectory)));
  });

  it('names the cases the same whichever worker finished first', async () => {
    const root = await mkdtemp(resolve(tmpdir(), 'variance-authority-write-order-'));
    temporary.push(root);
    const forwards = await inspectCaseRun((await finishedIn(root, workers)).caseDirectory, root);
    const backwards = await inspectCaseRun((await finishedIn(root, [...workers].reverse())).caseDirectory, root);

    expect(backwards.tests).toEqual(forwards.tests);
    expect(backwards.tests).toHaveLength(workers.length);
  });
});
