import { execFile } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { decodeTestCoverage } from './format.js';
import { decodeExecutionIndex } from './execution-format.js';
import { coveringTests } from './reverse.js';

const execute = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const repository = resolve(here, '../../../..');
const fixture = resolve(repository, 'packages/sense/test/fixtures/cases-vitest');
const vitest = resolve(repository, 'node_modules/vitest/vitest.mjs');
const cased = (path: string): string => `${relative(repository, fixture)}/${path}`;
const temporary: string[] = [];

afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe('a run whose reporters were replaced on the command line', () => {
  // An editor that runs one test from the gutter passes `--reporter` of its
  // own, which replaces the configured reporters, the seam's with them.
  it('still writes the record and the case index', async () => {
    const directory = await mkdtemp(resolve(tmpdir(), 'variance-authority-vitest-'));
    temporary.push(directory);
    const coverageFile = resolve(directory, 'coverage.bin');

    await execute(
      process.execPath,
      [vitest, 'run', 'test/branch.case.ts', '--reporter', 'dot', '--config', resolve(fixture, 'vitest.config.ts')],
      { cwd: fixture, env: { ...process.env, VARIANCE_AUTHORITY_COVERAGE: coverageFile, XDG_CACHE_HOME: directory } },
    );

    const coverage = decodeTestCoverage(await readFile(coverageFile));
    expect(coverage.tests.map((test) => [test.file, test.complete])).toEqual([[cased('test/branch.case.ts'), true]]);
    const index = decodeExecutionIndex(await readFile(`${coverageFile}.cases.bin`));
    expect(coveringTests(index, { file: cased('src/decide.ts'), line: 3 }).map((test) => test.name))
      .toEqual(['decide > takes the alpha branch']);
    // Nothing the run staged is left beside the record.
    expect((await readdir(directory)).filter((name) => name.startsWith('.run-'))).toEqual([]);
  }, 20_000);
});
