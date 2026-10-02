/**
 * Every fold that replays what a run's processes wrote replays it in the order
 * it was written, every run.
 *
 * The writers name their files and the readers list a directory, and nothing
 * else carries the order between them. A name that is only unique, or a
 * listing in whatever order the file system keeps, folds the same run
 * differently each time it runs.
 */

import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { inspectCaseRun } from './case-fold.js';
import { readCaseJournals, unpackCase, unpackFrames } from './cases.js';
import { readFinished, readJournals } from './finished-files.js';
import journalFormat from './journal-format.cjs';
import { runJournals } from './run-fold.js';
import { caseRunnerSource, setupSource } from './worker-source.js';
// The runner's modules `require` the collectors, so they are loaded built, and
// through the export a runner's author imports.
const { observeTestFile, startRecording, RECORDING_VARIABLE } =
  (await import('@variance-authority/sense/runner')) as typeof import('./runner.js');

const temporary: string[] = [];

afterEach(async () => {
  delete process.env[RECORDING_VARIABLE];
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function directory(): Promise<string> {
  const made = await mkdtemp(resolve(tmpdir(), 'variance-authority-write-order-'));
  temporary.push(made);
  return made;
}

// Thirty-two writes: a reader in any order but the writes' gets them back in
// order once in 32! runs, so one that follows anything else fails every run.
const WRITES = 32;
const written = Array.from({ length: WRITES }, (_, at) => `test/case-${String(at).padStart(2, '0')}.test.mjs`);

/** A run that observed {@link written} one file after another, through the runner's own writer. */
async function observed(): Promise<{ root: string; runDirectory: string; caseDirectory: string }> {
  const root = await directory();
  startRecording({ root, coverageFile: resolve(root, 'coverage.bin') });
  const { runDirectory, caseDirectory } = JSON.parse(process.env[RECORDING_VARIABLE]!) as {
    runDirectory: string;
    caseDirectory: string;
  };
  temporary.push(runDirectory, caseDirectory);
  for (const file of written) {
    const observer = observeTestFile(resolve(root, file))!;
    observer.case('runs', () => undefined);
    observer.finish();
  }
  return { root, runDirectory, caseDirectory };
}

describe('what a run wrote, read back', () => {
  it('replays the journals of the test files in the order they were written', async () => {
    const { root, runDirectory } = await observed();
    const names = await Promise.all((await runJournals(runDirectory)).map(async (path) =>
      journalFormat.decodeJournal(await readFile(path)).testFile));
    expect(names).toEqual(written.map((file) => resolve(root, file)));
    expect((await readJournals(runDirectory)).map((journal) => journal.testFile))
      .toEqual(written.map((file) => resolve(root, file)));
  });

  it('replays the case journals in the order they were written', async () => {
    const { root, caseDirectory } = await observed();
    const files = await Promise.all((await inspectCaseRun(caseDirectory, root)).paths.map(async (path) =>
      unpackCase(journalFormat.decodeJournal(unpackFrames(await readFile(path))[0]!).testFile).file));
    expect(files).toEqual(written.map((file) => resolve(root, file)));
    expect([...new Set((await readCaseJournals(caseDirectory, root)).map((journal) => journal.file))]).toEqual(written);
  });

  it('reads the files the case runners finished in the order they were written', async () => {
    const finished = resolve(await directory(), 'finished');
    await mkdir(finished, { recursive: true });
    // As the runner Vitest loads writes them: one tree per worker, named by
    // the same call.
    for (const file of written) {
      await writeFile(
        resolve(finished, `${journalFormat.writtenName()}.json`),
        JSON.stringify([{ filepath: file, mode: 'run', result: { state: 'pass' }, tasks: [] }]),
      );
    }
    expect((await readFinished(finished)).map((file) => file.filepath)).toEqual(written);
  });

  it('names every journal the Vitest and Rstest workers write through that one call', () => {
    const setup = setupSource('/run', '/cases');
    expect(setup).toContain('const stamp = journalFormat.writtenName();');
    expect(setup).not.toContain('randomUUID');
    const runner = caseRunnerSource({ finished: '/finished' });
    expect(runner).toContain("+ journalFormat.writtenName() + '.json'");
    expect(runner).not.toContain('randomUUID');
  });
});
