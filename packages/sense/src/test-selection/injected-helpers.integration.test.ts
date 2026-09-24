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
 * A region the transform wrote is on no line of the file.
 *
 * `decorated.ts` holds one decorated method and then `later`. To run the
 * decorator, esbuild writes about forty lines of helpers above the author's
 * first line, and the source map gives them no origin. Counted in the generated
 * text, those helpers land on lines 4 to 47 of a 27-line file, over `later`.
 * An edit to `later` then selects the test that constructed the class and not
 * the test that called `later`. An edit to a line of `later` must reach
 * `later`'s caller and nothing else.
 */

const execute = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const repository = resolve(here, '../../../..');
const fixture = resolve(repository, 'packages/sense/test/fixtures/decorated-vitest');
const vitest = resolve(repository, 'node_modules/vitest/vitest.mjs');
const named = (path: string): string => `${relative(repository, fixture)}/${path}`;
const temporary: string[] = [];

afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function record(): Promise<string> {
  const directory = await mkdtemp(resolve(tmpdir(), 'variance-authority-injected-'));
  temporary.push(directory);
  const coverageFile = resolve(directory, 'coverage.bin');
  await execute(
    process.execPath,
    [vitest, 'run', '--config', resolve(fixture, 'vitest.config.ts')],
    { cwd: fixture, env: { ...process.env, VARIANCE_AUTHORITY_COVERAGE: coverageFile, XDG_CACHE_HOME: directory } },
  );
  return coverageFile;
}

const decorated = named('src/decorated.ts');

const edit = (line: number, removed: string, added: string): string => `diff --git a/${decorated} b/${decorated}
--- a/${decorated}
+++ b/${decorated}
@@ -${line},1 +${line},1 @@
-${removed}
+${added}
`;

describe('a helper the transform injected', () => {
  it('is recorded with no lines, and an edit below it reaches only the caller of what was edited', async () => {
    const coverageFile = await record();

    // The premise: the helpers ran, the run test entered the method, and only
    // the later test entered `later` — in the lines the author wrote.
    const coverage = decodeTestCoverage(await readFile(coverageFile));
    const blocks = coverage.modules.find((module) => module.file === decorated)?.blocks ?? [];
    const helper = blocks.find((block) => block.name === '__runInitializers' && block.path === 'entry');
    expect(helper?.testFiles).toEqual([named('test/run.test.js')]);
    expect(helper?.startLine).toBeUndefined();
    expect(helper?.endLine).toBeUndefined();
    const placed = blocks
      .filter((block) => block.startLine !== undefined)
      .map((block) => [block.name, block.startLine, block.endLine, block.testFiles]);
    expect(placed).toEqual([
      ['', 1, 27, [named('test/later.test.js'), named('test/run.test.js')]],
      ['tag', 1, 5, [named('test/later.test.js'), named('test/run.test.js')]],
      ['tag/anon#0', 2, 4, [named('test/later.test.js'), named('test/run.test.js')]],
      ['Decorated/constructor', 7, 7, [named('test/run.test.js')]],
      ['Decorated/run', 9, 11, [named('test/run.test.js')]],
      ['later', 14, 27, [named('test/later.test.js')]],
    ]);

    // Line 16 is where `__runInitializers` landed, and line 24 fell between two
    // helpers and selected nothing.
    await expect(selectTestFiles(coverageFile, edit(16, '  total += 1;', '  total += 100;'))).resolves.toEqual([
      named('test/later.test.js'),
    ]);
    await expect(selectTestFiles(coverageFile, edit(24, '  total += 9;', '  total += 900;'))).resolves.toEqual([
      named('test/later.test.js'),
    ]);
  }, 20_000);
});
