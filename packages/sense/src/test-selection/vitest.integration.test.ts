import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { scanRelations } from '../scan.js';
import { INSTRUMENTATION_ID, instrumentationId } from '../instrument/index.js';
import { countCrossings } from './cases.js';
import { decodeTestCoverage } from './format.js';
import { coveringTests, type ExecutionIndex } from './reverse.js';
import { deviationOfTests, narrowByExecution, selectTestFiles } from './index.js';
import { withTestSelection } from './vitest.js';
import { decodeExecutionIndex } from './execution-format.js';

const execute = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const repository = resolve(here, '../../../..');
const fixture = resolve(repository, 'packages/sense/test/fixtures/external-vitest');
const entriesFixture = resolve(repository, 'packages/sense/test/fixtures/entries-vitest');
const unenteredFixture = resolve(repository, 'packages/sense/test/fixtures/unentered-vitest');
const casesFixture = resolve(repository, 'packages/sense/test/fixtures/cases-vitest');
const vitest = resolve(repository, 'node_modules/vitest/vitest.mjs');
// Every recorded name is relative to the checkout, and these fixtures sit inside it.
const inCheckout = (at: string) => (path: string): string => `${relative(repository, at)}/${path}`;
const ext = inCheckout(fixture);
const entries = inCheckout(entriesFixture);
const unentered = inCheckout(unenteredFixture);
const cased = inCheckout(casesFixture);
const temporary: string[] = [];

afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe('the Vitest integration', () => {
  it('adds one product plugin, setup file, and reporter to an ordinary configuration', () => {
    // A root of its own, because constructing the configuration writes this
    // seam's shims under it — and this one never runs, so nothing settles to
    // take them off again.
    const configured = withTestSelection({}, { root: tmpdir(), coverageFile: '/tmp/coverage.bin' });

    expect(configured.plugins).toHaveLength(1);
    expect(configured.test?.setupFiles).toHaveLength(1);
    expect(configured.test?.reporters).toHaveLength(2);
  });

  it('runs under the default include, which leaves the seam\'s own setup module alone', async () => {
    // The setup module is a JavaScript file under the root like any other, and
    // instrumented it would ask for the probe log it has not yet installed.
    const directory = await mkdtemp(resolve(tmpdir(), 'variance-authority-vitest-'));
    temporary.push(directory);
    const coverageFile = resolve(directory, 'coverage.bin');

    await execute(
      process.execPath,
      [vitest, 'run', 'test/beta.case.ts', '--config', resolve(fixture, 'vitest.default.config.ts')],
      { cwd: fixture, env: { ...process.env, VARIANCE_AUTHORITY_COVERAGE: coverageFile, XDG_CACHE_HOME: directory } },
    );

    const coverage = decodeTestCoverage(await readFile(coverageFile));
    expect(coverage.tests.map((test) => [test.file, test.complete])).toEqual([[ext('test/beta.case.ts'), true]]);
    // The default instruments every file under the root, the suite's own
    // setup included; the seam's setup module is not among them.
    expect(coverage.modules.map((module) => module.file)).toEqual([ext('src/decide.ts'), ext('test/beta.case.ts'), ext('test/setup.ts')]);
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
    expect(coverage.tests.map((test) => test.file)).toEqual([ext('test/browser.dom.ts')]);
    expect(coverage.modules[0]?.blocks[0]?.testFiles).toEqual([ext('test/browser.dom.ts')]);
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
    expect(coverage.tests.map((test) => test.file)).toContain(ext('test/delta.case.ts'));
    expect(coverage.modules[0]?.blocks[0]?.testFiles).toEqual([
      ext('test/alpha.case.ts'),
      ext('test/beta.case.ts'),
      ext('test/gamma.case.ts'),
    ]);
  });

  it('refuses a file where every test is skipped, which leaves no record to exclude it by', async () => {
    // A file with no runnable test is still collected — its imports run — so it
    // reaches everything it imports and breaks when one of those throws at load.
    // But the runner runs none of that file's hooks, so the `afterAll` that
    // writes its journal never fires, and skipping is a usable outcome: recorded
    // whole, the file would claim an empty reach and be excluded from every diff
    // there will ever be. Material UI recorded four such files, and a throw
    // placed in `mui-utils/src/clamp/clamp.ts` broke three of them.
    const directory = await mkdtemp(resolve(tmpdir(), 'variance-authority-vitest-'));
    temporary.push(directory);
    const coverageFile = resolve(directory, 'coverage.bin');

    await execute(
      process.execPath,
      [vitest, 'run', '--config', resolve(fixture, 'vitest.skipped.config.ts')],
      { cwd: fixture, env: { ...process.env, VARIANCE_AUTHORITY_COVERAGE: coverageFile, XDG_CACHE_HOME: directory } },
    );

    const coverage = decodeTestCoverage(await readFile(coverageFile));
    expect(coverage.tests.map((test) => [test.file, test.complete])).toEqual([[ext('test/skipped.only.ts'), false]]);
    // Nothing credited it, which is the whole reason its record cannot be whole.
    expect(coverage.modules.flatMap((module) => module.blocks.flatMap((block) => block.testFiles))).toEqual([]);

    // So the snapshot is not entitled to speak for it: a change anywhere leaves
    // it out of `whole`, and a caller narrowing by this answer runs it.
    const source = await readFile(resolve(fixture, 'src/decide.ts'), 'utf8');
    const line = source.slice(0, source.indexOf("return 'A'")).split('\n').length;
    const narrowing = await narrowByExecution(coverageFile, `--- a/${ext('src/decide.ts')}
+++ b/${ext('src/decide.ts')}
@@ -${line},1 +${line},1 @@
-    return 'A';
+    return 'Alpha';`);
    expect(narrowing.entered).toEqual([]);
    expect(narrowing.whole).toEqual([]);
  });

  it('refuses a file whose fixture threw, which the runner reports as tests skipped', async () => {
    // The shape a flaky database, server or browser fixture leaves behind. A
    // `beforeAll` throws; the runner marks every test under it skipped and
    // fails the suite, and the file's own `afterAll` still runs, so a journal
    // is written and the record looks like any other. Skipping is a usable
    // outcome, so read leaf by leaf this file is whole — and it is not: one of
    // its two tests ran, and `locked`, which only the other one enters, is
    // recorded as reached by nobody.
    const directory = await mkdtemp(resolve(tmpdir(), 'variance-authority-vitest-'));
    temporary.push(directory);
    const coverageFile = resolve(directory, 'coverage.bin');

    // The run is red by construction, and a red run still publishes a snapshot.
    await execute(
      process.execPath,
      [vitest, 'run', '--config', resolve(fixture, 'vitest.hook.config.ts')],
      { cwd: fixture, env: { ...process.env, VARIANCE_AUTHORITY_COVERAGE: coverageFile, XDG_CACHE_HOME: directory } },
    ).catch(() => undefined);

    const coverage = decodeTestCoverage(await readFile(coverageFile));
    expect(coverage.tests.map((test) => [test.file, test.complete])).toEqual([[ext('test/hook.throws.ts'), false]]);
    // The amputation this is about: the region behind the thrown hook.
    const gate = coverage.modules.find((module) => module.file === ext('src/gate.ts'));
    expect(gate?.blocks.find((block) => block.name === 'locked')?.testFiles).toEqual([]);

    // So a change inside that region must leave the file out of `whole`. Were
    // it in, the caller's skip list would hold the one file that reads the line
    // that moved — and nothing would ever run it again to correct its record,
    // because every diff it still answers to is a diff somewhere else.
    const source = await readFile(resolve(fixture, 'src/gate.ts'), 'utf8');
    const line = source.slice(0, source.indexOf('return `locked')).split('\n').length;
    const narrowing = await narrowByExecution(coverageFile, `--- a/${ext('src/gate.ts')}
+++ b/${ext('src/gate.ts')}
@@ -${line},1 +${line},1 @@
-  return \`locked:\${value}\`;
+  return \`LOCKED:\${value}\`;`);
    expect(narrowing.entered).toEqual([]);
    expect(narrowing.whole).toEqual([]);
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
    const eager = coverage.modules.find((module) => module.file === entries('src/eager.ts'));
    // No branch of `cold` is a region: three rows for a module with two functions.
    expect(eager?.blocks.map((block) => [block.kind, block.name, block.testFiles, block.loadedBy])).toEqual([
      ['module', '', [entries('test/eager.case.ts')], [entries('test/eager.case.ts')]],
      ['function', 'warm', [entries('test/eager.case.ts')], [entries('test/eager.case.ts')]],
      ['function', 'cold', [entries('test/eager.case.ts')], undefined],
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
    expect(regions(unentered('src/heavy-chart.tsx'))).toEqual([
      ['module', '', [unentered('test/branch.dom.tsx')], [unentered('test/branch.dom.tsx')]],
      ['function', 'HeavyChart', [], undefined],
      ['function', 'HeavyChart/reduce.arg0', [], undefined],
    ]);
    // The spy standing in front of the import, recorded identically.
    expect(regions(unentered('src/format-total.ts'))).toEqual([
      ['module', '', [unentered('test/spy.dom.tsx')], [unentered('test/spy.dom.tsx')]],
      ['function', 'formatTotal', [], undefined],
    ]);
    // And the control: a module the test did enter, so the reading above is
    // about these two files and not about every file in the run.
    expect(regions(unentered('src/panel.tsx'))).toEqual([
      ['module', '', [unentered('test/branch.dom.tsx')], [unentered('test/branch.dom.tsx')]],
      ['function', 'Panel', [unentered('test/branch.dom.tsx')], undefined],
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
    const diff = `--- a/${ext('src/decide.ts')}
+++ b/${ext('src/decide.ts')}
@@ -${line},1 +${line},1 @@
-    return 'A';
+    return 'Alpha';`;
    await expect(selectTestFiles(coverageFile, diff)).resolves.toEqual([ext('test/alpha.case.ts')]);
    // gamma entered the `G` branch, reset the registry, and evaluated the
    // module again: the second evaluation must not zero what the first counted.
    const gammaLine = source.slice(0, source.indexOf("return 'G'")).split('\n').length;
    await expect(selectTestFiles(coverageFile, `--- a/${ext('src/decide.ts')}
+++ b/${ext('src/decide.ts')}
@@ -${gammaLine},1 +${gammaLine},1 @@
-    return 'G';
+    return 'Gamma';`)).resolves.toEqual([ext('test/gamma.case.ts')]);

    const coverage = decodeTestCoverage(await readFile(coverageFile));
    expect(coverage.instrumentation).toBe(INSTRUMENTATION_ID);
    // `src/decide.ts` is instrumented, so it is not a precondition of anything:
    // a precondition is a file the answer depended on that the instrument could
    // not see inside, and this one it could.
    expect(coverage.tests.map((test) => ({
      file: test.file,
      complete: test.complete,
      preconditions: test.preconditions.map((precondition) => precondition.name),
    }))).toEqual([
      {
        file: ext('test/alpha.case.ts'),
        complete: false,
        preconditions: [ext('test/alpha.case.ts'), ext('test/setup.ts'), ext('vitest.config.ts')],
      },
      {
        file: ext('test/beta.case.ts'),
        complete: true,
        preconditions: [ext('test/beta.case.ts'), ext('test/setup.ts'), ext('vitest.config.ts')],
      },
      {
        file: ext('test/gamma.case.ts'),
        complete: true,
        preconditions: [ext('test/gamma.case.ts'), ext('test/setup.ts'), ext('vitest.config.ts')],
      },
    ]);
    expect(coverage.modules[0]).toMatchObject({
      file: ext('src/decide.ts'),
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

    const records = await scanRelations({ root: repository, dirs: [ext('src'), ext('test')], digests: false });
    const deviation = await deviationOfTests(coverageFile, { root: repository, records });
    expect(deviation).toEqual({
      baseline: { files: 1, loc: 9 },
      coverage: { files: 1, loc: 9 },
      coverageRatio: 1,
      sensitivity: ((5 / 9) + (3 / 9) + (6 / 9)) / 3,
      tests: [
        {
          testFile: ext('test/alpha.case.ts'),
          baseline: { files: 1, loc: 9 },
          slice: { files: 1, loc: 5 },
          sensitivity: 5 / 9,
          deviation: 1 - (5 / 9),
        },
        {
          testFile: ext('test/beta.case.ts'),
          baseline: { files: 1, loc: 9 },
          slice: { files: 1, loc: 3 },
          sensitivity: 3 / 9,
          deviation: 1 - (3 / 9),
        },
        {
          // Both branches: `G` before the registry reset, `B` after it.
          testFile: ext('test/gamma.case.ts'),
          baseline: { files: 1, loc: 9 },
          slice: { files: 1, loc: 6 },
          sensitivity: 6 / 9,
          deviation: 1 - (6 / 9),
        },
      ],
    });
  }, 20_000);

  describe('recording which case entered a region, rather than which file', () => {
    /** The fixture run once, under either recipe, with whatever it wrote. */
    async function record(
      config: string,
      env: Readonly<Record<string, string>> = {},
    ): Promise<{ coverage: Buffer; index?: ExecutionIndex }> {
      const directory = await mkdtemp(resolve(tmpdir(), 'variance-authority-vitest-'));
      temporary.push(directory);
      const coverageFile = resolve(directory, 'coverage.bin');

      await execute(
        process.execPath,
        [vitest, 'run', '--config', resolve(casesFixture, config)],
        {
          cwd: casesFixture,
          env: {
            ...process.env,
            VARIANCE_AUTHORITY_COVERAGE: coverageFile,
            XDG_CACHE_HOME: directory,
            ...env,
          },
        },
      );

      const coverage = await readFile(coverageFile);
      const index = await readFile(`${coverageFile}.cases.bin`).catch(() => undefined);
      return { coverage, ...(index === undefined ? {} : { index: decodeExecutionIndex(index) }) };
    }

    const named = (index: ExecutionIndex, line: number): readonly string[] =>
      coveringTests(index, { file: cased('src/decide.ts'), line }).map((test) => test.name);

    it('separates two cases in one file that entered different branches', async () => {
      const { index } = await record('vitest.config.ts');
      if (index === undefined) throw new Error('the run wrote no execution index');

      // The whole point, in one assertion: three cases in one test file reach
      // one function, and each branch of it names the one case that walked it.
      // A file-level record answers `branch.case.ts` to all three.
      expect(named(index, 3)).toEqual(['decide > takes the alpha branch']);
      expect(named(index, 6)).toEqual(['decide > takes the gamma branch']);
      expect(named(index, 8)).toEqual(['decide > falls through to B']);

      // And the function they share still names all three, so nothing was
      // narrowed that should not have been. Only three: a line inside `decide`
      // is answered by `decide`, not by the module root that also spans it.
      expect(named(index, 1)).toEqual([
        'decide > falls through to B',
        'decide > takes the alpha branch',
        'decide > takes the gamma branch',
      ]);
    }, 20_000);

    it('names the same cases without an async context, which is the default', async () => {
      // No `continuations`: the case running now is a variable the probe reads
      // out of a closure, which is what a suite that runs its cases one at a
      // time is paying for. The answer is the one above.
      const { index } = await record('vitest.sequential.config.ts');
      if (index === undefined) throw new Error('the run wrote no execution index');

      expect(named(index, 3)).toEqual(['decide > takes the alpha branch']);
      expect(named(index, 6)).toEqual(['decide > takes the gamma branch']);
      expect(named(index, 8)).toEqual(['decide > falls through to B']);
    }, 20_000);

    it('refuses a concurrent file rather than charging one case to another', async () => {
      // A variable cannot hold two cases, and guessing which one owns a
      // crossing is the direction `selecting.md` forbids. So the run fails, and
      // says which mode records it.
      const concurrent = { VARIANCE_AUTHORITY_FILES: 'test/concurrent.case.ts' };
      const failed = await record('vitest.sequential.config.ts', concurrent)
        .then(() => undefined, (error: { stdout?: string; stderr?: string }) => error);
      if (failed === undefined) throw new Error('the concurrent fixture recorded without a scope');

      const output = `${failed.stdout ?? ''}${failed.stderr ?? ''}`;
      expect(output).toContain('takes the alpha branch while the other case is open was still running');
      expect(output).toContain('continuations: true');
    }, 20_000);

    it('keeps two concurrent cases apart across the awaits they interleave on', async () => {
      const { index } = await record('vitest.config.ts');
      if (index === undefined) throw new Error('the run wrote no execution index');

      // `describe.concurrent`: both cases are in flight, and each awaits inside
      // the module under test, so every continuation of one resumes while the
      // other is open. Snapshot-and-subtract credits the outer case with both
      // branches here — see `cases.concurrency.test.ts`.
      expect(named(index, 14)).toEqual(['slowly > takes the alpha branch while the other case is open']);
      expect(named(index, 17)).toEqual(['slowly > takes the fallthrough while the other case is open']);
    }, 20_000);

    it('leaves the snapshot CI reads byte for byte what it was', async () => {
      // The file-level journal under per-case recording is the bitwise union of
      // the case buckets and the ambient one. Presence is all a reader of it
      // asks for, so the union is the same record the flat collector wrote —
      // and the cost of turning cases on is not paid by anyone reading this.
      const [cased, flat] = await Promise.all([
        record('vitest.config.ts'),
        record('vitest.config.ts', { VARIANCE_AUTHORITY_CASES: 'off' }),
      ]);

      expect(cased.coverage.equals(flat.coverage)).toBe(true);
      expect(flat.index).toBeUndefined();
    }, 30_000);

    it('costs one crossing per case and region where a file costs one per file', async () => {
      const { coverage, index } = await record('vitest.config.ts');
      if (index === undefined) throw new Error('the run wrote no execution index');

      const files = decodeTestCoverage(coverage).modules
        .filter((module) => module.file === cased('src/decide.ts'))
        .flatMap((module) => module.blocks)
        .reduce((total, block) => total + block.testFiles.length, 0);

      // Sixteen regions of one module, seventeen file-level crossings — the
      // two files barely overlap. The same regions cost twenty-seven crossings
      // per case, a multiplier of 1.6 for 2.5 cases a file: what a case costs
      // is its own reach, not the file's, and only a region cases *share* is
      // recorded more than once.
      expect(files).toBe(17);
      expect(countCrossings(index)).toBe(27);
    }, 20_000);

    it('names a case declared with the realm\'s registrars under `globals: true`', async () => {
      const { index } = await record('vitest.injected.config.ts');
      if (index === undefined) throw new Error('the run wrote no execution index');

      // `runTask` is handed the task by the runner, so which registrar
      // declared a case cannot reach it — and *cannot* is a claim about the
      // code, which is the kind of claim that had the Jest seam quietly
      // recording nothing for a spelling nobody ran. Both spellings are run
      // for every host now.
      expect(index.tests.map((test) => test.name)).toEqual([
        'takes the gamma path with the registrars on the realm',
      ]);
      expect(named(index, 6)).toEqual(['takes the gamma path with the registrars on the realm']);
    }, 20_000);
  });
});
