import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { scanRelations } from '../scan.js';
import { INSTRUMENTATION_ID, instrumentationId } from '../instrument/index.js';
import { decodeTestCoverage } from './format.js';
import { deviationOfTests, selectTestFiles } from './index.js';
import { withTestSelection } from './vitest.js';

const execute = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const repository = resolve(here, '../../../..');
const fixture = resolve(repository, 'packages/sense/test/fixtures/external-vitest');
const entriesFixture = resolve(repository, 'packages/sense/test/fixtures/entries-vitest');
const unenteredFixture = resolve(repository, 'packages/sense/test/fixtures/unentered-vitest');
const vitest = resolve(repository, 'node_modules/vitest/vitest.mjs');
const temporary: string[] = [];

afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe('the Vitest integration', () => {
  it('adds one product plugin, setup file, and reporter to an ordinary configuration', () => {
    const configured = withTestSelection({}, { coverageFile: '/tmp/coverage.bin' });

    expect(configured.plugins).toHaveLength(1);
    expect(configured.test?.setupFiles).toHaveLength(1);
    expect(configured.test?.reporters).toHaveLength(2);
  });

  it('runs under the default include, which leaves the seam\'s own setup module alone', async () => {
    // The setup module is a JavaScript file under the root like any other, and
    // instrumented it would ask for the counter factory it has not yet installed.
    const directory = await mkdtemp(resolve(tmpdir(), 'variance-authority-vitest-'));
    temporary.push(directory);
    const coverageFile = resolve(directory, 'coverage.bin');

    await execute(
      process.execPath,
      [vitest, 'run', 'test/beta.case.ts', '--config', resolve(fixture, 'vitest.default.config.ts')],
      { cwd: fixture, env: { ...process.env, VARIANCE_AUTHORITY_COVERAGE: coverageFile, XDG_CACHE_HOME: directory } },
    );

    const coverage = decodeTestCoverage(await readFile(coverageFile));
    expect(coverage.tests.map((test) => [test.file, test.complete])).toEqual([['test/beta.case.ts', true]]);
    // The default instruments every file under the root, the suite's own
    // setup included; the seam's setup module is not among them.
    expect(coverage.modules.map((module) => module.file)).toEqual(['src/decide.ts', 'test/beta.case.ts', 'test/setup.ts']);
  });

  it('records a file the runner transformed for a document', async () => {
    // jsdom puts the file through Vite's web pipeline, where every specifier
    // the seam's setup module names is resolved by the runner rather than left
    // to Node. Nothing else in this fixture takes that path, and a setup module
    // that reaches outside the runner fails here first.
    const directory = await mkdtemp(resolve(tmpdir(), 'variance-authority-vitest-'));
    temporary.push(directory);
    const coverageFile = resolve(directory, 'coverage.bin');

    await execute(
      process.execPath,
      [vitest, 'run', '--config', resolve(fixture, 'vitest.jsdom.config.ts')],
      { cwd: fixture, env: { ...process.env, VARIANCE_AUTHORITY_COVERAGE: coverageFile, XDG_CACHE_HOME: directory } },
    );

    const coverage = decodeTestCoverage(await readFile(coverageFile));
    expect(coverage.tests.map((test) => test.file)).toEqual(['test/browser.dom.ts']);
    expect(coverage.modules[0]?.blocks[0]?.testFiles).toEqual(['test/browser.dom.ts']);
  }, 20_000);

  it('counts a module every file consumed when the runner shares one module graph across files', async () => {
    // `--no-isolate` evaluates `src/decide.ts` once, for the first file; the
    // others consume its exports without its top level running again. Each
    // file installs its own factory, and a module that meets a new factory
    // counts its own block once, so an edit to a top-level line reaches every
    // file that consumed the module and not only the first — and not delta,
    // which ran in the same worker and never entered it.
    const directory = await mkdtemp(resolve(tmpdir(), 'variance-authority-vitest-'));
    temporary.push(directory);
    const coverageFile = resolve(directory, 'coverage.bin');

    await execute(
      process.execPath,
      [vitest, 'run', '--no-isolate', '--no-file-parallelism', '--config', resolve(fixture, 'vitest.config.ts')],
      { cwd: fixture, env: { ...process.env, VARIANCE_AUTHORITY_COVERAGE: coverageFile, XDG_CACHE_HOME: directory } },
    );

    const coverage = decodeTestCoverage(await readFile(coverageFile));
    expect(coverage.tests.map((test) => test.file)).toContain('test/delta.case.ts');
    expect(coverage.modules[0]?.blocks[0]?.testFiles).toEqual([
      'test/alpha.case.ts',
      'test/beta.case.ts',
      'test/gamma.case.ts',
    ]);
  });

  it('records functions only under the entries recipe, and which of them ran before the first test', async () => {
    const directory = await mkdtemp(resolve(tmpdir(), 'variance-authority-vitest-'));
    temporary.push(directory);
    const coverageFile = resolve(directory, 'coverage.bin');

    await execute(
      process.execPath,
      [vitest, 'run', '--config', resolve(entriesFixture, 'vitest.config.ts')],
      { cwd: entriesFixture, env: { ...process.env, VARIANCE_AUTHORITY_COVERAGE: coverageFile, XDG_CACHE_HOME: directory } },
    );

    const coverage = decodeTestCoverage(await readFile(coverageFile));
    expect(coverage.instrumentation).toBe(instrumentationId('entries'));
    const eager = coverage.modules.find((module) => module.file === 'src/eager.ts');
    // No branch of `cold` is a region: three rows for a module with two functions.
    expect(eager?.blocks.map((block) => [block.kind, block.name, block.testFiles, block.loadedBy])).toEqual([
      ['module', '', ['test/eager.case.ts'], ['test/eager.case.ts']],
      ['function', 'warm', ['test/eager.case.ts'], ['test/eager.case.ts']],
      ['function', 'cold', ['test/eager.case.ts'], undefined],
    ]);
  }, 20_000);

  it('separates a module the test loaded from a module the test entered', async () => {
    // Two spellings of one shape, and the shape is what a reduction reader
    // needs: a named import that no execution ever reaches. `branch.dom.tsx`
    // imports `HeavyChart` through the module under test and never takes the
    // branch that renders it; `spy.dom.tsx` imports `formatTotal` and puts a
    // spy in front of it. Both files are loaded, both are reached on the import
    // graph, and neither has anything below its top level entered.
    const directory = await mkdtemp(resolve(tmpdir(), 'variance-authority-vitest-'));
    temporary.push(directory);
    const coverageFile = resolve(directory, 'coverage.bin');

    await execute(
      process.execPath,
      [vitest, 'run', '--config', resolve(unenteredFixture, 'vitest.config.ts')],
      { cwd: unenteredFixture, env: { ...process.env, VARIANCE_AUTHORITY_COVERAGE: coverageFile, XDG_CACHE_HOME: directory } },
    );

    const coverage = decodeTestCoverage(await readFile(coverageFile));
    const regions = (file: string) => coverage.modules.find((module) => module.file === file)
      ?.blocks.map((block) => [block.kind, block.name, block.testFiles, block.loadedBy]);

    // The branch never taken. The module root was crossed *because the module
    // loaded* — `loadedBy` says so — and `HeavyChart` was crossed by nobody.
    expect(regions('src/heavy-chart.tsx')).toEqual([
      ['module', '', ['test/branch.dom.tsx'], ['test/branch.dom.tsx']],
      ['function', 'HeavyChart', [], undefined],
      ['function', 'HeavyChart/reduce.arg0', [], undefined],
    ]);
    // The spy standing in front of the import, recorded identically.
    expect(regions('src/format-total.ts')).toEqual([
      ['module', '', ['test/spy.dom.tsx'], ['test/spy.dom.tsx']],
      ['function', 'formatTotal', [], undefined],
    ]);
    // And the control: a module the test did enter, so the reading above is
    // about these two files and not about every file in the run.
    expect(regions('src/panel.tsx')).toEqual([
      ['module', '', ['test/branch.dom.tsx'], ['test/branch.dom.tsx']],
      ['function', 'Panel', ['test/branch.dom.tsx'], undefined],
    ]);
  }, 20_000);

  it('records external tests and selects only the test file that covered a changed path', async () => {
    const directory = await mkdtemp(resolve(tmpdir(), 'variance-authority-vitest-'));
    temporary.push(directory);
    const coverageFile = resolve(directory, 'coverage.bin');

    for (const testFile of ['test/alpha.case.ts', 'test/beta.case.ts', 'test/gamma.case.ts']) {
      await execute(
        process.execPath,
        [vitest, 'run', testFile, '--config', resolve(fixture, 'vitest.config.ts')],
        {
          cwd: fixture,
          env: { ...process.env, VARIANCE_AUTHORITY_COVERAGE: coverageFile, XDG_CACHE_HOME: directory },
        },
      );
    }

    const source = await readFile(resolve(fixture, 'src/decide.ts'), 'utf8');
    const line = source.slice(0, source.indexOf("return 'A'")).split('\n').length;
    const diff = `--- a/src/decide.ts
+++ b/src/decide.ts
@@ -${line},1 +${line},1 @@
-    return 'A';
+    return 'Alpha';`;
    await expect(selectTestFiles(coverageFile, diff)).resolves.toEqual(['test/alpha.case.ts']);
    // gamma entered the `G` branch, reset the registry, and evaluated the
    // module again: the second evaluation must not zero what the first counted.
    const gammaLine = source.slice(0, source.indexOf("return 'G'")).split('\n').length;
    await expect(selectTestFiles(coverageFile, `--- a/src/decide.ts
+++ b/src/decide.ts
@@ -${gammaLine},1 +${gammaLine},1 @@
-    return 'G';
+    return 'Gamma';`)).resolves.toEqual(['test/gamma.case.ts']);

    const coverage = decodeTestCoverage(await readFile(coverageFile));
    expect(coverage.instrumentation).toBe(INSTRUMENTATION_ID);
    expect(coverage.tests.map((test) => ({
      file: test.file,
      complete: test.complete,
      preconditions: test.preconditions.map((precondition) => precondition.name),
    }))).toEqual([
      {
        file: 'test/alpha.case.ts',
        complete: false,
        preconditions: ['src/decide.ts', 'test/alpha.case.ts', 'test/setup.ts', 'vitest.config.ts'],
      },
      {
        file: 'test/beta.case.ts',
        complete: true,
        preconditions: ['src/decide.ts', 'test/beta.case.ts', 'test/setup.ts', 'vitest.config.ts'],
      },
      {
        file: 'test/gamma.case.ts',
        complete: true,
        preconditions: ['src/decide.ts', 'test/gamma.case.ts', 'test/setup.ts', 'vitest.config.ts'],
      },
    ]);
    expect(coverage.modules[0]).toMatchObject({
      file: 'src/decide.ts',
      sourceDigest: expect.stringMatching(/^v1:/),
      instrumented: true,
    });
    expect(coverage.modules[0]?.blocks[0]).toMatchObject({
      ordinal: 0,
      digest: expect.stringMatching(/^v1:/),
    });
    expect(coverage.modules[0]?.blocks[0]?.owner).toBeUndefined();
    expect(coverage.modules[0]?.blocks.slice(1).every((block) => block.owner !== undefined))
      .toBe(true);

    const records = await scanRelations({ root: fixture, dirs: ['src', 'test'], digests: false });
    const deviation = await deviationOfTests(coverageFile, { root: fixture, records });
    expect(deviation).toEqual({
      baseline: { files: 1, loc: 9 },
      coverage: { files: 1, loc: 9 },
      coverageRatio: 1,
      sensitivity: ((5 / 9) + (3 / 9) + (6 / 9)) / 3,
      tests: [
        {
          testFile: 'test/alpha.case.ts',
          baseline: { files: 1, loc: 9 },
          slice: { files: 1, loc: 5 },
          sensitivity: 5 / 9,
          deviation: 1 - (5 / 9),
        },
        {
          testFile: 'test/beta.case.ts',
          baseline: { files: 1, loc: 9 },
          slice: { files: 1, loc: 3 },
          sensitivity: 3 / 9,
          deviation: 1 - (3 / 9),
        },
        {
          // Both branches: `G` before the registry reset, `B` after it.
          testFile: 'test/gamma.case.ts',
          baseline: { files: 1, loc: 9 },
          slice: { files: 1, loc: 6 },
          sensitivity: 6 / 9,
          deviation: 1 - (6 / 9),
        },
      ],
    });
  }, 20_000);
});
