import { execFile } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { decodeTestCoverage } from './format.js';
import { selectTestFiles } from './index.js';

const execute = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const repository = resolve(here, '../../../..');
const fixture = resolve(repository, 'packages/sense/test/fixtures/external-jest');
const jest = resolve(repository, 'node_modules/jest/bin/jest.js');
const temporary: string[] = [];

afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe('the Jest integration', () => {
  it('records tests transformed by @swc/jest beside the project\'s own setup file and reporter, and selects the one that covered a changed line', async () => {
    const directory = await mkdtemp(resolve(tmpdir(), 'variance-authority-jest-'));
    temporary.push(directory);
    const coverageFile = resolve(directory, 'coverage.bin');
    const cacheDirectory = resolve(directory, 'cache');
    const run = (testFile: string): Promise<unknown> => execute(
      process.execPath,
      [jest, '--config', resolve(fixture, 'jest.config.mjs'), '--watchman=false', testFile],
      {
        cwd: fixture,
        env: {
          ...process.env,
          VARIANCE_AUTHORITY_COVERAGE: coverageFile,
          VARIANCE_AUTHORITY_JEST_CACHE: cacheDirectory,
          XDG_CACHE_HOME: directory,
        },
      },
    );

    await run('test/alpha.case.ts');
    await run('test/beta.case.ts');
    await run('test/gamma.case.ts');

    const source = await readFile(resolve(fixture, 'src/decide.ts'), 'utf8');
    const line = source.slice(0, source.indexOf("return 'A'")).split('\n').length;
    const diff = `--- a/src/decide.ts
+++ b/src/decide.ts
@@ -${line},1 +${line},1 @@
-    return 'A';
+    return 'Alpha';`;
    await expect(selectTestFiles(coverageFile, diff)).resolves.toEqual(['test/alpha.case.ts']);
    // gamma entered the `G` branch, reset the registry, and required the module
    // again: the second evaluation must not zero what the first counted.
    const gammaLine = source.slice(0, source.indexOf("return 'G'")).split('\n').length;
    await expect(selectTestFiles(coverageFile, `--- a/src/decide.ts
+++ b/src/decide.ts
@@ -${gammaLine},1 +${gammaLine},1 @@
-    return 'G';
+    return 'Gamma';`)).resolves.toEqual(['test/gamma.case.ts']);

    // `alpha.case.ts` holds an `it.skip` whose body would reach the `B` branch,
    // and it is still not selected when that branch changes: a skipped test does
    // not run, so it cannot fail, and excluding the file it sits in costs
    // nothing. Removing the `.skip` is an edit to `test/alpha.case.ts`, which is
    // a precondition of alpha's own record, so the record stops applying the
    // moment that test could run.
    const betaLine = source.slice(0, source.indexOf("return 'B'")).split('\n').length;
    const onB = await selectTestFiles(coverageFile, `--- a/src/decide.ts
+++ b/src/decide.ts
@@ -${betaLine},1 +${betaLine},1 @@
-  return 'B';
+  return 'Beta';`);
    expect(onB).toContain('test/beta.case.ts');
    expect(onB).not.toContain('test/alpha.case.ts');

    const coverage = decodeTestCoverage(await readFile(coverageFile));
    expect(coverage.modules.map((module) => module.file)).toEqual(['src/decide.ts']);
    // Whole, skipped test and all — see `usableOutcome` in `vitest.ts` for why a
    // skip leaves the record usable as evidence where a failure does not.
    expect(coverage.tests.map((test) => [test.file, test.complete])).toEqual([
      ['test/alpha.case.ts', true],
      ['test/beta.case.ts', true],
      ['test/gamma.case.ts', true],
    ]);
    // The project's setup files stayed configured and are preconditions of
    // every observation. `src/decide.ts` is not one: a precondition is a file
    // the answer depended on that the instrument could not see inside, and an
    // instrumented module is one it could — its digest is on its own row and a
    // change to its text is caught by re-cutting its regions.
    expect(coverage.tests[0]!.preconditions.map((precondition) => precondition.name)).toEqual([
      'jest.config.mjs',
      'test/alpha.case.ts',
      'test/polyfill.cjs',
      'test/setup.cjs',
    ]);
    // The project's reporter stayed configured and ran.
    await expect(readFile(resolve(directory, 'user-reporter.txt'), 'utf8')).resolves.toBe('ran\n');

    // A warm run: Jest serves the probed text from its cache without calling
    // the transformer, and the inventory written beside it still attributes.
    const inventories = resolve(cacheDirectory, 'variance-authority-test-selection');
    const written = async (): Promise<Record<string, number>> => Object.fromEntries(
      await Promise.all((await readdir(inventories)).map(async (name) => [
        name,
        (await stat(resolve(inventories, name))).mtimeMs,
      ])),
    );
    const before = await written();
    await run('test/alpha.case.ts');
    expect(await written()).toEqual(before);
    await expect(selectTestFiles(coverageFile, diff)).resolves.toEqual(['test/alpha.case.ts']);
  }, 120_000);
});
