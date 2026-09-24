import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { decodeTestCoverage } from './format.js';
import { selectTestFiles } from './index.js';
import { decodeExecutionIndex } from './execution-format.js';

const execute = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const repository = resolve(here, '../../../..');
const fixture = resolve(repository, 'packages/sense/test/fixtures/external-rstest');
// Recorded names are relative to the checkout, and the fixture sits inside it.
const at = (path: string): string => `${relative(repository, fixture)}/${path}`;
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
    const lineOf = (returned: string): number =>
      source.slice(0, source.indexOf(`return '${returned}'`)).split('\n').length;
    const changing = (returned: string, to: string): string => `--- a/${at('src/decide.ts')}
+++ b/${at('src/decide.ts')}
@@ -${lineOf(returned)},1 +${lineOf(returned)},1 @@
-    return '${returned}';
+    return '${to}';`;

    // The lines are the author's, not the bundle's: SWC moved every one of them
    // and the loader read them back through the map it was handed.
    await expect(selectTestFiles(coverageFile, changing('A', 'Alpha')))
      .resolves.toEqual([at('test/alpha.case.ts')]);

    // `alpha.case.ts` holds an `it.skip` whose body would reach the `B` branch,
    // and it is still not selected when that branch changes: a skipped test
    // does not run, so it cannot fail, and excluding the file it sits in costs
    // nothing. Removing the `.skip` is an edit to `test/alpha.case.ts`, which is
    // a precondition of alpha's own record, so the record stops applying the
    // moment that test could run.
    const onB = await selectTestFiles(coverageFile, changing('B', 'Beta'));
    expect(onB).toContain(at('test/beta.case.ts'));
    expect(onB).not.toContain(at('test/alpha.case.ts'));

    const coverage = decodeTestCoverage(await readFile(coverageFile));
    expect(coverage.modules.map((module) => module.file)).toContain(at('src/decide.ts'));
    // Whole, skipped test and all — see `usableOutcome` in `finished-files.ts`
    // for why a skip leaves the record usable as evidence where a failure does
    // not.
    expect(coverage.tests.map((test) => [test.file, test.complete])).toEqual([
      [at('test/alpha.case.ts'), true],
      [at('test/beta.case.ts'), true],
    ]);
    // The project's setup file stayed configured and is a precondition of every
    // observation. `src/decide.ts` is not one: a precondition is a file the
    // answer depended on that the instrument could not see inside, and an
    // instrumented module is one it could.
    expect(coverage.tests[0]!.preconditions.map((precondition) => precondition.name)).toEqual([
      at('rstest.config.mjs'),
      at('test/alpha.case.ts'),
      at('test/setup.mjs'),
    ]);
  }, 120_000);

  it('names the individual cases of a file, and gives a branch only to the case that walked it', async () => {
    const directory = await mkdtemp(resolve(tmpdir(), 'variance-authority-rstest-cases-'));
    temporary.push(directory);
    const coverageFile = resolve(directory, 'coverage.bin');
    await run('rstest.cases.config.mjs', directory);

    // Beside the snapshot, never inside it.
    const index = decodeExecutionIndex(await readFile(`${coverageFile}.cases.bin`));
    // `globals` is off here, so the registrars under test are the ones on the
    // object an import of `@rstest/core` compiles to, and the coordinate is
    // read off `expect.getState()` at call time. Two of
    // `alpha.case.ts`'s three cases are absent for different reasons: the
    // skipped one never reaches the registrar's callback, and the one that only
    // reads a global crossed nothing.
    expect(index.tests.map((test) => test.id)).toEqual([
      at('test/alpha.case.ts > takes the alpha path'),
      at('test/beta.case.ts > takes the beta path'),
    ]);

    const decide = index.modules.find((module) => module.file === at('src/decide.ts'));
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
    expect(walking('A')).toEqual([at('test/alpha.case.ts > takes the alpha path')]);
    expect(walking('B')).toEqual([at('test/beta.case.ts > takes the beta path')]);
  }, 120_000);

  it('names a case declared with the realm\'s registrars, the spelling the other configurations never take', async () => {
    const directory = await mkdtemp(resolve(tmpdir(), 'variance-authority-rstest-injected-'));
    temporary.push(directory);
    const coverageFile = resolve(directory, 'coverage.bin');
    await run('rstest.injected.config.mjs', directory);

    // The seam wraps the registrars on the realm and on the object an import
    // of `@rstest/core` compiles to. Two placements is two things to be wrong
    // about, and a placement no configuration exercises is one that records
    // nothing without saying so — which is how the equivalent hole in the Jest
    // seam survived until somebody outside the project read the page.
    const index = decodeExecutionIndex(await readFile(`${coverageFile}.cases.bin`));
    expect(index.tests.map((test) => test.id)).toEqual([
      at('test/gamma.injected.ts > takes the gamma path with the registrars on the realm'),
    ]);

    const decide = index.modules.find((module) => module.file === at('src/decide.ts'));
    expect(decide).toBeDefined();
    const source = await readFile(resolve(fixture, 'src/decide.ts'), 'utf8');
    const line = source.slice(0, source.indexOf("return 'G'")).split('\n').length;
    const block = decide!.blocks
      .filter((candidate) => candidate.startLine <= line && line <= candidate.endLine)
      .sort((left, right) => left.startLine - right.startLine)
      .at(-1);
    expect(block).toBeDefined();
    // Named in the index *and* holding the branch it walked: a case the seam
    // reaches halfway is worse than one it misses, because it reads as an
    // answer.
    expect(block!.crossings.map((crossing) => index.tests[crossing.test]!.id)).toEqual([
      at('test/gamma.injected.ts > takes the gamma path with the registrars on the realm'),
    ]);
  }, 120_000);
});
