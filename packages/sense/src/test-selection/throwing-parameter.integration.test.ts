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
 * A call that throws while its parameters bind has entered the function.
 *
 * Each form in `forms.js` destructures its second parameter, which has no
 * default, and each test leaves it out, so the call throws before the body is
 * reached — a generator when it is called, not when it is iterated, and an
 * async function as its rejection. The edit that gives the parameter a default
 * is exactly what changes that test's outcome, so it has to select it: the
 * function's region has to be entered before its parameters bind.
 *
 * A first parameter that is an object pattern keeps its text, because runners
 * read fixture names out of it: `fixtures.js` is a `test.extend` fixture in a
 * module the seam instruments, and the recording run fails if its text moved.
 */

const execute = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const repository = resolve(here, '../../../..');
const fixture = resolve(repository, 'packages/sense/test/fixtures/throwing-parameter-vitest');
const vitest = resolve(repository, 'node_modules/vitest/vitest.mjs');
const named = (path: string): string => `${relative(repository, fixture)}/${path}`;
const forms = named('src/forms.js');
const fixtures = named('src/fixtures.js');

let directory: string;
let coverageFile: string;

beforeAll(async () => {
  directory = await mkdtemp(resolve(tmpdir(), 'variance-authority-throwing-parameter-'));
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

/** `}) {` on `line` becomes `} = {}) {`: the parameter gets a default. */
function defaulted(line: number, indent = ''): string {
  return `diff --git a/${forms} b/${forms}
--- a/${forms}
+++ b/${forms}
@@ -${line} +${line} @@
-${indent}}) {
+${indent}} = {}) {
`;
}

const ROWS = [
  ['a function', 'called', 'test/function.test.js', defaulted(3)],
  ['an arrow with a block body', 'arrow', 'test/arrow.test.js', `diff --git a/${forms} b/${forms}
--- a/${forms}
+++ b/${forms}
@@ -9 +9 @@
-}) => {
+} = {}) => {
`],
  ['a generator', 'generated', 'test/generator.test.js', defaulted(15)],
  ['an async function', 'awaited', 'test/async.test.js', defaulted(21)],
  ['a constructor', 'Constructed/constructor', 'test/constructor.test.js', defaulted(28, '  ')],
] as const;

describe('a parameter that throws while it binds', () => {
  it('has every form loaded by its own test, and entered by it', async () => {
    const coverage = decodeTestCoverage(await readFile(coverageFile));
    const regions = coverage.modules.find((module) => module.file === forms)
      ?.blocks.map((block) => [block.kind, block.name, block.testFiles]);

    // The premise: every test loaded the module, and nothing else ran.
    expect(regions?.[0]).toEqual(['module', '', ROWS.map(([, , test]) => named(test)).sort()]);
    expect(regions?.filter(([kind]) => kind === 'function')).toEqual(
      ROWS.map(([, name, test]) => ['function', name, [named(test)]]),
    );
  });

  it('leaves a first parameter a fixture parser reads as it was written', async () => {
    const coverage = decodeTestCoverage(await readFile(coverageFile));
    const regions = coverage.modules.find((module) => module.file === fixtures)
      ?.blocks.filter((block) => block.kind === 'function').map((block) => block.testFiles);

    // The recording run passed, so Vitest read `{ task }`; and the fixture ran.
    expect(regions).toEqual([[named('test/fixture.test.js')]]);
  });

  it.each(ROWS)('in %s selects the test that called it', async (_, _name, test, diff) => {
    await expect(selectTestFiles(coverageFile, diff)).resolves.toEqual([named(test)]);
  });
});
