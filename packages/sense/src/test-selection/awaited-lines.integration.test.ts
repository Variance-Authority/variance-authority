import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { decodeTestCoverage } from './format.js';
import { selectTestFiles } from './index.js';

/**
 * The lines inside an `await` run before it settles.
 *
 * A resume is the code after an `await` comes back, and its region spans the
 * awaited expression, so on every line but the first it holds text the
 * function evaluates on the way in: an argument, an element of
 * `Promise.all([…])`, a `.then` step chained onto the awaited promise. A test
 * whose await rejects evaluated that text and never resumed, and an edit to it
 * is an edit to what that test ran.
 */

const execute = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const repository = resolve(here, '../../../..');
const fixture = resolve(repository, 'packages/sense/test/fixtures/awaited-lines-vitest');
const vitest = resolve(repository, 'node_modules/vitest/vitest.mjs');
const named = (path: string): string => `${relative(repository, fixture)}/${path}`;
const load = named('src/load.js');
const resolves = named('test/resolves.test.js');

let directory: string;
let coverageFile: string;

beforeAll(async () => {
  directory = await mkdtemp(resolve(tmpdir(), 'variance-authority-awaited-lines-'));
  coverageFile = resolve(directory, 'coverage.bin');
  await execute(
    process.execPath,
    [vitest, 'run', '--config', resolve(fixture, 'vitest.config.ts')],
    { cwd: fixture, env: { ...process.env, VARIANCE_AUTHORITY_COVERAGE: coverageFile, XDG_CACHE_HOME: directory } },
  );
}, 20_000);

afterAll(async () => {
  await rm(directory, { recursive: true, force: true });
});

const hunk = (body: string): string => `diff --git a/${load} b/${load}
--- a/${load}
+++ b/${load}
${body}`;

const ROWS = [
  ['an argument line', 'test/load-rejects.test.js', hunk(`@@ -3 +3 @@
-    'key',
+    'other',
`)],
  ['a deleted argument line', 'test/load-rejects.test.js', hunk(`@@ -2,3 +2,2 @@
   const value = await fetcher(
-    'key',
   );
`)],
  ['an element of `Promise.all`', 'test/all-rejects.test.js', hunk(`@@ -10 +10 @@
-    first(),
+    first().catch(() => undefined),
`)],
  ['a `.then` step', 'test/chain-rejects.test.js', hunk(`@@ -18 +18 @@
-    .then((found) => found.toUpperCase());
+    .then((found) => found.toLowerCase());
`)],
] as const;

describe('a line inside a multi-line await', () => {
  it('was evaluated by the test that rejected, which never resumed', async () => {
    const coverage = decodeTestCoverage(await readFile(coverageFile));
    const regions = coverage.modules.find((module) => module.file === load)
      ?.blocks.map((block) => [block.kind, block.name, block.testFiles]);

    // The premise: each rejecting test entered its function and never resumed.
    expect(regions).toEqual([
      [
        'module',
        '',
        [named('test/all-rejects.test.js'), named('test/chain-rejects.test.js'), named('test/load-rejects.test.js'), resolves],
      ],
      ['function', 'load', [named('test/load-rejects.test.js'), resolves]],
      ['resume', 'load', [resolves]],
      ['function', 'loadAll', [named('test/all-rejects.test.js'), resolves]],
      ['resume', 'loadAll', [resolves]],
      ['function', 'loadChain', [named('test/chain-rejects.test.js'), resolves]],
      ['resume', 'loadChain', [resolves]],
      ['function', 'loadChain/then.arg0', [resolves]],
    ]);
  });

  it.each(ROWS)('in %s selects the test that rejected there', async (_, rejected, diff) => {
    await expect(selectTestFiles(coverageFile, diff)).resolves.toEqual([named(rejected), resolves].sort());
  });
});
