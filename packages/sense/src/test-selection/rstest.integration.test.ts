import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
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
const fixture = resolve(repository, 'packages/sense/test/fixtures/external-rstest');
const rstest = resolve(repository, 'node_modules/@rstest/core/bin/rstest.js');
const temporary: string[] = [];

/** The config is named absolutely: Rstest resolves a relative one against the nearest package. */
const run = (config: string, directory: string): Promise<unknown> => execute(
  process.execPath,
  [rstest, 'run', '-c', resolve(fixture, config)],
  {
    cwd: fixture,
    env: {
      ...process.env,
      VARIANCE_AUTHORITY_COVERAGE: resolve(directory, 'coverage.bin'),
      XDG_CACHE_HOME: directory,
    },
  },
);

afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe('the Rstest integration', () => {
  it('records modules Rspack bundled and SWC transpiled, and selects the test that covered a changed line', async () => {
    const directory = await mkdtemp(resolve(tmpdir(), 'variance-authority-rstest-'));
    temporary.push(directory);
    const coverageFile = resolve(directory, 'coverage.bin');
    await run('rstest.config.mjs', directory);

    const source = await readFile(resolve(fixture, 'src/decide.ts'), 'utf8');
    const at = (returned: string): number =>
      source.slice(0, source.indexOf(`return '${returned}'`)).split('\n').length;
    const changing = (returned: string, to: string): string => `--- a/src/decide.ts
+++ b/src/decide.ts
@@ -${at(returned)},1 +${at(returned)},1 @@
-    return '${returned}';
+    return '${to}';`;

    // The lines are the author's, not the bundle's: SWC moved every one of them
    // and the loader read them back through the map it was handed.
    await expect(selectTestFiles(coverageFile, changing('A', 'Alpha')))
      .resolves.toEqual(['test/alpha.case.ts']);

    // `alpha.case.ts` holds an `it.skip` whose body would reach the `B` branch,
    // and it is still not selected when that branch changes: a skipped test
    // does not run, so it cannot fail, and excluding the file it sits in costs
    // nothing. Removing the `.skip` is an edit to `test/alpha.case.ts`, which is
    // a precondition of alpha's own record, so the record stops applying the
    // moment that test could run.
    const onB = await selectTestFiles(coverageFile, changing('B', 'Beta'));
    expect(onB).toContain('test/beta.case.ts');
    expect(onB).not.toContain('test/alpha.case.ts');

    const coverage = decodeTestCoverage(await readFile(coverageFile));
    expect(coverage.modules.map((module) => module.file)).toContain('src/decide.ts');
    // Whole, skipped test and all — see `usableOutcome` in `finished-files.ts`
    // for why a skip leaves the record usable as evidence where a failure does
    // not.
    expect(coverage.tests.map((test) => [test.file, test.complete])).toEqual([
      ['test/alpha.case.ts', true],
      ['test/beta.case.ts', true],
    ]);
    // The project's setup file stayed configured and is a precondition of every
    // observation. `src/decide.ts` is not one: a precondition is a file the
    // answer depended on that the instrument could not see inside, and an
    // instrumented module is one it could.
    expect(coverage.tests[0]!.preconditions.map((precondition) => precondition.name)).toEqual([
      'rstest.config.mjs',
      'test/alpha.case.ts',
      'test/setup.mjs',
    ]);
  }, 120_000);

  it('names the individual cases of a file, and gives a branch only to the case that walked it', async () => {
    const directory = await mkdtemp(resolve(tmpdir(), 'variance-authority-rstest-cases-'));
    temporary.push(directory);
    const coverageFile = resolve(directory, 'coverage.bin');
    await run('rstest.cases.config.mjs', directory);

    // Beside the snapshot, never inside it: the file CI reads is the same file
    // a run without `cases` writes.
    const index = JSON.parse(await readFile(`${coverageFile}.cases.json`, 'utf8')) as {
      tests: ReadonlyArray<{ id: string; file: string; name: string }>;
      modules: ReadonlyArray<{
        file: string;
        blocks: ReadonlyArray<{
          startLine: number;
          endLine: number;
          crossings: ReadonlyArray<{ test: number }>;
        }>;
      }>;
    };
    // Rstest has no runner option, so the bracket is around the injected `it`
    // and the coordinate is read off `expect.getState()` at call time. Two of
    // `alpha.case.ts`'s three cases are absent for different reasons: the
    // skipped one never reaches the registrar's callback, and the one that only
    // reads a global crossed nothing.
    expect(index.tests.map((test) => test.id)).toEqual([
      'test/alpha.case.ts > takes the alpha path',
      'test/beta.case.ts > takes the beta path',
    ]);

    const decide = index.modules.find((module) => module.file === 'src/decide.ts');
    expect(decide).toBeDefined();
    const source = await readFile(resolve(fixture, 'src/decide.ts'), 'utf8');
    // The innermost region holding the branch's line: the module's own region
    // holds it too, and that one is the file's evaluation rather than its turn.
    const walking = (returned: string): readonly string[] => {
      const line = source.slice(0, source.indexOf(`return '${returned}'`)).split('\n').length;
      const block = decide!.blocks
        .filter((candidate) => candidate.startLine <= line && line <= candidate.endLine)
        .sort((left, right) => left.startLine - right.startLine)
        .at(-1);
      expect(block, returned).toBeDefined();
      return block!.crossings.map((crossing) => index.tests[crossing.test]!.id).sort();
    };
    // One branch, one case. The other case of the suite imported the same
    // module and never took this turn, and the ambient bucket every case is
    // credited with holds the file's evaluation, not its branches.
    expect(walking('A')).toEqual(['test/alpha.case.ts > takes the alpha path']);
    expect(walking('B')).toEqual(['test/beta.case.ts > takes the beta path']);
  }, 120_000);
});
