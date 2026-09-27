import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { decodeTestCoverage } from './format.js';
import { decodeExecutionIndex } from './execution-format.js';
import type { TestCoverage } from './index.js';
import { coveringTests, type ExecutionIndex } from './reverse.js';

const execute = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const repository = resolve(here, '../../../..');
const fixture = resolve(repository, 'packages/sense/test/fixtures/serializer-vitest');
const vitest = resolve(repository, 'node_modules/vitest/vitest.mjs');
const named = (path: string): string => `${relative(repository, fixture)}/${path}`;

let directory: string;
let coverage: TestCoverage;
let index: ExecutionIndex;

// Vitest loads `snapshotSerializers` and the `diff` file once a worker, after
// the runner and before any setup file. The fixture's serializer imports
// `src/shape.ts`, so its probes fire before the setup module has run. Neither
// test file imports anything of the product: `shape.case.ts` reaches it by
// printing through the serializer, and `other.case.ts` only by being the file
// its worker loaded the serializer for.
beforeAll(async () => {
  directory = await mkdtemp(resolve(tmpdir(), 'variance-authority-vitest-'));
  const coverageFile = resolve(directory, 'coverage.bin');
  await execute(
    process.execPath,
    [vitest, 'run', '--config', resolve(fixture, 'vitest.config.ts')],
    { cwd: fixture, env: { ...process.env, VARIANCE_AUTHORITY_COVERAGE: coverageFile, XDG_CACHE_HOME: directory } },
  );
  coverage = decodeTestCoverage(await readFile(coverageFile));
  index = decodeExecutionIndex(await readFile(`${coverageFile}.cases.bin`));
}, 30_000);

afterAll(async () => {
  if (directory !== undefined) await rm(directory, { recursive: true, force: true });
});

describe('a project whose snapshot serializer imports product source', () => {
  it('runs every file, and credits the case that printed through the serializer', () => {
    expect(coverage.tests.map((test) => [test.file, test.complete])).toEqual([
      [named('test/other.case.ts'), true],
      [named('test/shape.case.ts'), true],
    ]);
    expect(coveringTests(index, { file: named('src/shape.ts'), line: 11 }).map((test) => test.name))
      .toEqual(['shape > prints a triangle through the project serializer']);
    // The other branch is one no case took.
    expect(coveringTests(index, { file: named('src/shape.ts'), line: 13 })).toEqual([]);
  });

  it('counts what the serializer evaluated as loaded by every file it was loaded for', () => {
    // A change to the module's top level fails the serializer's load, and with
    // it every file in the worker, whether or not the file prints a shape.
    const shape = coverage.modules.find((module) => module.file === named('src/shape.ts'));
    expect(shape?.blocks[0]).toMatchObject({
      kind: 'module',
      testFiles: [named('test/other.case.ts'), named('test/shape.case.ts')],
      loadedBy: [named('test/other.case.ts'), named('test/shape.case.ts')],
    });
  });

  it('declares the serializer and the diff file as preconditions of every file', () => {
    for (const test of coverage.tests) {
      expect(test.preconditions.map((precondition) => precondition.name))
        .toEqual(expect.arrayContaining([named('test/serializer.ts'), named('test/diff.ts')]));
    }
  });
});
