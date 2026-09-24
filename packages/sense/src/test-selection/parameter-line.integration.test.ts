import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { decodeTestCoverage } from './format.js';
import { selectTestFiles } from './index.js';

/**
 * A parameter belongs to the function it declares.
 *
 * `factory` runs while `consumer.js` loads and returns an arrow whose
 * destructured parameter sits on a line of its own. Every test that imports the
 * consumer crosses `factory`; only the test that calls the arrow enters it. An
 * edit that adds a parameter and reads it in the body changes what the arrow
 * does, and nothing `factory` does, so it reaches the caller and not the test
 * that only imported the module.
 *
 * On a large repository the same shape is a factory every test file loads, and
 * a parameter line charged to it selects all of them.
 */

const execute = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const repository = resolve(here, '../../../..');
const fixture = resolve(repository, 'packages/sense/test/fixtures/returned-vitest');
const vitest = resolve(repository, 'node_modules/vitest/vitest.mjs');
const named = (path: string): string => `${relative(repository, fixture)}/${path}`;
const temporary: string[] = [];

afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function record(): Promise<string> {
  const directory = await mkdtemp(resolve(tmpdir(), 'variance-authority-parameter-'));
  temporary.push(directory);
  const coverageFile = resolve(directory, 'coverage.bin');
  await execute(
    process.execPath,
    [vitest, 'run', '--config', resolve(fixture, 'vitest.config.ts')],
    { cwd: fixture, env: { ...process.env, VARIANCE_AUTHORITY_COVERAGE: coverageFile, XDG_CACHE_HOME: directory } },
  );
  return coverageFile;
}

const factory = named('src/factory.js');

const addedParameter = `diff --git a/${factory} b/${factory}
--- a/${factory}
+++ b/${factory}
@@ -2,5 +2,6 @@ export function factory() {
   const returned = ({
     enabled,
+    shouldClaim,
   }) => {
-    return enabled;
+    return enabled && (shouldClaim?.() ?? true);
   };
`;

describe('a parameter line', () => {
  it('is charged to the function it declares, not to the one that ran at load', async () => {
    const coverageFile = await record();

    // The premise: both tests loaded the factory, and only one called what it returned.
    const coverage = decodeTestCoverage(await readFile(coverageFile));
    const regions = coverage.modules.find((module) => module.file === factory)
      ?.blocks.map((block) => [block.kind, block.name, block.testFiles]);
    expect(regions).toEqual([
      ['module', '', [named('test/calls.test.js'), named('test/imports-only.test.js')]],
      ['function', 'factory', [named('test/calls.test.js'), named('test/imports-only.test.js')]],
      ['function', 'factory/returned', [named('test/calls.test.js')]],
    ]);

    await expect(selectTestFiles(coverageFile, addedParameter)).resolves.toEqual([named('test/calls.test.js')]);
  }, 20_000);
});
