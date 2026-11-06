import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { instrumentationId } from '../instrument/index.js';
import { caseSectionsOf } from './case-record.js';
import { decodeTestCoverage } from './format.js';
import { selectTestFiles } from './index.js';

const execute = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const repository = resolve(here, '../../../..');
const fixture = resolve(repository, 'packages/sense/test/fixtures/external-vitest');
const vitest = resolve(repository, 'node_modules/vitest/vitest.mjs');
// Every recorded name is relative to the checkout, and the fixture sits inside it.
const ext = (path: string): string => `${relative(repository, fixture)}/${path}`;
const temporary: string[] = [];

afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe('the Vitest integration under the loads recipe', () => {
  it('records which files each test loaded under the loads recipe, and selects every test that loaded a changed file', async () => {
    const directory = await mkdtemp(resolve(tmpdir(), 'variance-authority-vitest-'));
    temporary.push(directory);
    const coverageFile = resolve(directory, 'coverage.bin');

    for (const testFile of ['test/alpha.case.ts', 'test/beta.case.ts', 'test/delta.case.ts']) {
      await execute(
        process.execPath,
        [vitest, 'run', testFile, '--config', resolve(fixture, 'vitest.loads.config.ts')],
        { cwd: fixture, env: { ...process.env, VARIANCE_AUTHORITY_COVERAGE: coverageFile, VARIANCE_AUTHORITY_CACHE: directory } },
      );
    }

    const coverage = decodeTestCoverage(await readFile(coverageFile));
    expect(coverage.instrumentation).toBe(instrumentationId('loads'));
    expect(coverage.modules.map((module) => [module.file, module.instrumented, module.blocks])).toEqual([
      [ext('src/decide.ts'), false, []],
    ]);
    // A file is loaded before its first case opens, so a case of its own says
    // nothing the file does not: the run keeps one bucket per file and writes
    // no case index.
    const { index, before, last, eyes } = caseSectionsOf(await readFile(coverageFile));
    expect({ index, before, last, eyes }).toEqual({ index: undefined, before: undefined, last: undefined, eyes: undefined });
    const source = await readFile(resolve(fixture, 'src/decide.ts'), 'utf8');
    const line = source.slice(0, source.indexOf("return 'A'")).split('\n').length;
    // Alpha alone took the `A` branch, and beta loaded the file too: nothing
    // says what in it ran, so both are selected. Delta never loaded it.
    await expect(selectTestFiles(coverageFile, `--- a/${ext('src/decide.ts')}
+++ b/${ext('src/decide.ts')}
@@ -${line},1 +${line},1 @@
-    return 'A';
+    return 'Alpha';`)).resolves.toEqual([ext('test/alpha.case.ts'), ext('test/beta.case.ts')]);
  }, 30_000);

  it('records a module for every test file of a shared realm, though the realm evaluated it once', async () => {
    const directory = await mkdtemp(resolve(tmpdir(), 'variance-authority-vitest-'));
    temporary.push(directory);
    const coverageFile = resolve(directory, 'coverage.bin');

    // One worker and no isolation: `src/decide.ts` is evaluated for whichever
    // of the two files runs first, and only read from the module cache by the other.
    await execute(
      process.execPath,
      [vitest, 'run', 'test/alpha.case.ts', 'test/beta.case.ts', '--config', resolve(fixture, 'vitest.loads.config.ts'), '--no-isolate', '--no-file-parallelism'],
      { cwd: fixture, env: { ...process.env, VARIANCE_AUTHORITY_COVERAGE: coverageFile, VARIANCE_AUTHORITY_CACHE: directory } },
    );

    await expect(selectTestFiles(coverageFile, `--- a/${ext('src/decide.ts')}
+++ b/${ext('src/decide.ts')}
@@ -1,1 +1,1 @@
-x
+y`)).resolves.toEqual([ext('test/alpha.case.ts'), ext('test/beta.case.ts')]);
  }, 30_000);
});
