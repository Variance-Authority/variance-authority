import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { moduleId } from './captured-modules.js';
import { decodeTestCoverage } from './format.js';
import SelectionReporter from './jest-reporter.js';
import { RUN_DIRECTORY_VARIABLE } from './jest.js';
import journalFormat from './journal-format.cjs';

const { encodeJournal } = journalFormat;
const SOURCE = 'module.exports = 1;\n';
const temporary: string[] = [];

afterEach(async () => {
  delete process.env[RUN_DIRECTORY_VARIABLE];
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe('the phases the Jest reporter records', () => {
  it('splits a file\'s time into collect and cases where its journal says jest-circus started its run', async () => {
    const root = await mkdtemp(resolve(tmpdir(), 'variance-authority-jest-phases-'));
    temporary.push(root);
    await mkdir(resolve(root, 'src'));
    await mkdir(resolve(root, 'test'));
    const [coverageFile, test] = [resolve(root, 'coverage.bin'), resolve(root, 'test/alpha.case.js')];
    await writeFile(resolve(root, 'src/one.js'), SOURCE);
    await writeFile(test, '// alpha\n');
    const reporter = new SelectionReporter(undefined, { root, coverageFile, preconditions: [] });
    reporter.onRunStart();
    const runDirectory = process.env[RUN_DIRECTORY_VARIABLE]!;
    await mkdir(runDirectory, { recursive: true });
    const hits = new Map([[moduleId('src/one.js', SOURCE), Uint32Array.of(1)]]);
    await writeFile(resolve(runDirectory, 'a.va'), encodeJournal(test, hits, new Map(), 1_600));

    await reporter.onRunComplete(new Set([{ config: { cacheDirectory: resolve(root, 'cache'), id: 'project' } }]), {
      testResults: [{
        testFilePath: test,
        skipped: false,
        testResults: [{ status: 'passed' }],
        perfStats: {
          loadTestEnvironmentStart: 1_000, loadTestEnvironmentEnd: 1_010,
          setupFilesStart: 1_010, setupFilesEnd: 1_015,
          setupAfterEnvStart: 1_015, setupAfterEnvEnd: 1_020,
          end: 1_650,
        },
      }],
    });

    expect(decodeTestCoverage(await readFile(coverageFile)).tests.map((test) => test.phases)).toEqual([
      { environment: 10, setup: 10, collect: 580, cases: 50 },
    ]);
  });
});
