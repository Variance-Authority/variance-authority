import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { decodeTestCoverage } from './format.js';
import { statusesComplete } from './finished-files.js';
import { runOf } from './selection-run.js';
import { SELECTION_LOADER, withTestSelection, type RstestConfig, type RstestTestSelectionOptions } from './rstest.js';
import instrumentModule from './rstest-loader.js';
import probeAfter, { type AfterLoaderContext } from './rstest-after-loader.js';

const temporary: string[] = [];

afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function root(): Promise<string> {
  const directory = await mkdtemp(resolve(tmpdir(), 'variance-authority-rstest-config-'));
  temporary.push(directory);
  return directory;
}

interface Rules {
  readonly module: { readonly rules: ReadonlyArray<{ readonly enforce?: string; readonly use: ReadonlyArray<{ readonly loader: string; readonly options: { readonly coverageFile: string } }> }> };
}

describe('what a wrapped Rstest configuration becomes', () => {
  it('adds a pre loader carrying the snapshot the reporter will write, last of the rules, and the probes loader first, without replacing the project\'s own', async () => {
    const directory = await root();
    const coverageFile = resolve(directory, 'coverage.bin');
    const mine = { module: { rules: [] } };
    const config = withTestSelection(
      { root: directory, tools: { rspack: mine, swc: {} } },
      { coverageFile },
    );

    const rspack = (config.tools as { rspack: readonly unknown[] }).rspack;
    expect(rspack[0]).toBe(mine);
    // `tools.swc` is the project's and is untouched: a seam that spread only
    // the key it writes would drop every sibling.
    expect((config.tools as { swc?: unknown }).swc).toEqual({});

    // Applied the way Rsbuild applies a function, to the rules every entry
    // before it wrote: theirs, and one post loader of the project's.
    const theirs = { test: /\.ts$/, enforce: 'post', use: [{ loader: 'their-post-loader', options: {} }] };
    const applied = { module: { rules: [theirs] as Rules['module']['rules'] } };
    (rspack[1] as (config: typeof applied) => void)(applied);
    const [probes, kept, rule] = applied.module.rules;
    // The post rule first, so it runs after every other post loader, theirs
    // included: a compiler that reads syntax never reads a probe.
    expect(probes!.enforce).toBe('post');
    expect(kept).toBe(theirs);
    // The pre rule last, so it runs ahead of every other pre loader, on the
    // file as it is on disk.
    expect(rule!.enforce).toBe('pre');
    expect(rule!.use[0]!.loader).toBe(SELECTION_LOADER);
    // The one string that names a run: a loader is loaded by path and can be
    // handed options, never the object the configuration built.
    expect(rule!.use[0]!.options.coverageFile).toBe(coverageFile);
    expect(runOf(coverageFile)?.root).toBe(directory);
  });

  it('puts its setup shim first and keeps the project\'s, and imports the runner Rstest spells', async () => {
    const directory = await root();
    const config = withTestSelection(
      { root: directory, setupFiles: './test/setup.mjs' },
      { coverageFile: resolve(directory, 'coverage.bin') },
    );

    const setupFiles = config.setupFiles as readonly string[];
    expect(setupFiles).toHaveLength(2);
    expect(setupFiles[1]).toBe('./test/setup.mjs');
    // First, so a setup file of the project's that loads an instrumented
    // module finds the probe log its header resolves.
    const shim = await readFile(setupFiles[0]!, 'utf8');
    expect(shim).toContain("from \"@rstest/core\"");
    // Every run records cases, so the shim wraps the injected registrars.
    expect(shim).toContain('wrapCase');
  });

  it('keeps one bucket per test file under the loads recipe, so its setup shim wraps no case', async () => {
    const directory = await root();
    const config = withTestSelection({ root: directory }, { coverageFile: resolve(directory, 'coverage.bin'), mode: 'loads' });

    const shim = await readFile((config.setupFiles as readonly string[])[0]!, 'utf8');
    expect(shim).toContain('.flat(globalThis)');
    expect(shim).not.toContain('wrapCase');
  });

  it('wraps the registrars a suite imports, which is a configuration without globals', async () => {
    const directory = await root();
    const config = withTestSelection(
      { root: directory },
      { coverageFile: resolve(directory, 'coverage.bin') },
    );
    const shim = await readFile((config.setupFiles as readonly string[])[0]!, 'utf8');
    expect(shim).toContain('wrapCase');
    // `@rstest/core` is an Rspack external of type `global`, so an import of it
    // is a read of this property and wrapping the property is wrapping the
    // import. Nothing about it is configured, which is why recording cases asks
    // the project for nothing.
    expect(shim).toContain('globalThis["@rstest/core"]');
  });

  it('wraps the registrars on the realm as well, for a suite that runs with globals', async () => {
    const directory = await root();
    const config = withTestSelection(
      { root: directory, globals: true },
      { coverageFile: resolve(directory, 'coverage.bin') },
    );
    const shim = await readFile((config.setupFiles as readonly string[])[0]!, 'utf8');
    // Both holders, in one shim: a suite may spell it either way, file by file,
    // and the seam is not told which.
    expect(shim).toContain('for (const holder of [globalThis, globalThis["@rstest/core"]])');
  });

  it('gives a projects layout the reporter and nothing else, since nothing is bundled under it', async () => {
    const directory = await root();
    const config = withTestSelection(
      { root: directory, projects: ['./packages/*'] },
      { coverageFile: resolve(directory, 'coverage.bin') },
    );
    expect(config.setupFiles).toBeUndefined();
    expect(config.tools).toBeUndefined();
    expect((config.reporters as readonly unknown[])).toHaveLength(2);
  });

  it('rests a named project\'s tests on its own setup files and not on another project\'s', async () => {
    const directory = await root();
    const coverageFile = resolve(directory, 'coverage.bin');
    for (const project of ['node', 'dom']) {
      await mkdir(resolve(directory, project));
      for (const file of ['setup.ts', 'a.test.ts']) {
        await writeFile(resolve(directory, project, file), `// ${project}/${file}\n`, 'utf8');
      }
    }
    const described = withTestSelection({ root: directory, projects: ['./node', './dom'] }, { coverageFile });
    for (const project of ['node', 'dom']) {
      withTestSelection({ root: resolve(directory, project), name: project, setupFiles: ['./setup.ts'] }, { coverageFile });
    }
    const reporter = (described.reporters as ReadonlyArray<{ onTestRunEnd?: (payload: object) => Promise<void> }>)[1]!;

    await reporter.onTestRunEnd!({
      results: ['node', 'dom'].map((project) => ({
        testPath: resolve(directory, project, 'a.test.ts'),
        status: 'pass',
        results: [{ status: 'pass' }],
        project,
      })),
    });

    const preconditions = new Map(decodeTestCoverage(await readFile(coverageFile)).tests
      .map((test) => [test.file, test.preconditions.map((precondition) => precondition.name).sort()]));
    expect(preconditions.get('node/a.test.ts')).toEqual(['node/a.test.ts', 'node/setup.ts']);
    expect(preconditions.get('dom/a.test.ts')).toEqual(['dom/a.test.ts', 'dom/setup.ts']);
  });
});

describe('a watching Rstest', () => {
  it('folds every cycle, only the files that cycle ran, and takes its shim off at exit with the directory it made', async () => {
    const directory = await root();
    const coverageFile = resolve(directory, 'coverage.bin');
    for (const file of ['a.test.ts', 'b.test.ts', 'c.test.ts']) await writeFile(resolve(directory, file), `// ${file}\n`, 'utf8');
    const config = withTestSelection({ root: directory }, { coverageFile });
    const reporter = (config.reporters as ReadonlyArray<Watching>)[1]!;
    const shims = async () => (await readdir(resolve(directory, '.variance-authority'))).filter((name) => name.startsWith('test-selection-setup-'));
    const result = (file: string) => ({ testPath: resolve(directory, file), status: 'pass', results: [{ status: 'pass' }] });
    const recorded = async () => decodeTestCoverage(await readFile(coverageFile)).tests.map((test) => test.file);

    await reporter.onTestRunStart();
    await reporter.onTestRunEnd({ results: [result('a.test.ts')], rerunTestPaths: [resolve(directory, 'a.test.ts')] });
    expect(await recorded()).toEqual(['a.test.ts']);
    expect(await shims()).toHaveLength(1);

    // The session reports every file it holds, `c` among them, and this
    // cycle ran only `b`.
    await reporter.onTestRunStart();
    await reporter.onTestRunEnd({
      results: ['a.test.ts', 'b.test.ts', 'c.test.ts'].map(result),
      rerunTestPaths: [resolve(directory, 'b.test.ts')],
    });
    expect(await recorded()).toEqual(['a.test.ts', 'b.test.ts']);
    expect(await shims()).toHaveLength(1);

    await reporter.onExit();
    // Nothing held the directory before the run, and nothing is left in it.
    await expect(shims()).rejects.toMatchObject({ code: 'ENOENT' });
  });
});

interface Watching {
  onTestRunStart(): unknown;
  onTestRunEnd(payload: object): Promise<void>;
  onExit(): unknown;
}

describe('what a finished Rstest file is worth', () => {
  // A `beforeAll` that throws leaves the file failed and every test in it
  // skipped, which read leaf by leaf is the shape of a file that ran
  // everything it meant to. The file's own status is what tells them apart.
  it('refuses a file whose fixture threw, and keeps one whose tests were skipped by their own text', () => {
    expect(statusesComplete('fail', ['pass', 'skip'], false)).toBe(false);
    expect(statusesComplete('pass', ['pass', 'skip', 'todo'], false)).toBe(true);
    expect(statusesComplete('pass', ['pass', 'fail'], false)).toBe(false);
    // Nothing ran, so there is nothing to be evidence of.
    expect(statusesComplete('pass', [], false)).toBe(false);
  });
});

describe('the Rstest loader', () => {
  /** What the two loaders hand Rspack for `code` at `file`, one after the other, and the run they recorded into. */
  async function loaded(
    file: string,
    code: string,
    files: Readonly<Record<string, string>> = {},
    config: RstestConfig = {},
    options: RstestTestSelectionOptions = {},
  ) {
    const directory = await root();
    const coverageFile = resolve(directory, 'coverage.bin');
    // The loader is handed a module the checkout holds.
    for (const [path, text] of Object.entries({ [file]: code, ...files })) {
      await mkdir(resolve(directory, path, '..'), { recursive: true });
      await writeFile(resolve(directory, path), text);
    }
    withTestSelection({ root: directory, ...config }, { coverageFile, ...options });
    let handed: string | undefined;
    let map: Parameters<AfterLoaderContext['callback']>[2];
    const resourcePath = resolve(directory, file);
    instrumentModule.call(
      { resourcePath, getOptions: () => ({ coverageFile }), callback: (_error, text, given) => { handed = text; map = given as typeof map; } },
      code,
    );
    probeAfter.call(
      { resourcePath, getOptions: () => ({ coverageFile }), callback: (error, text) => { if (error) throw error; handed = text; } },
      handed!,
      map,
    );
    return { handed, modules: [...runOf(coverageFile)!.modules.values()] };
  }

  it('records a module loaded from its build under the source its own map file names', async () => {
    const built = 'export const pick = (value) => (value ? 1 : 2);\n//# sourceMappingURL=pick.js.map\n';
    const { handed, modules } = await loaded('dist/pick.js', built, {
      'dist/pick.js': built,
      'src/pick.ts': 'export const pick = (value: boolean): number => (value ? 1 : 2);\n',
      'dist/pick.js.map': JSON.stringify({ version: 3, sources: ['../src/pick.ts'], names: [], mappings: 'AAAA' }),
    });

    expect(handed).not.toBe(built);
    expect(modules.map((module) => module.file)).toEqual(['src/pick.ts']);
  });

  it('hands a module it cannot parse back marked as loaded, recorded as not instrumented', async () => {
    const broken = 'export const pick = (;\n';
    const { handed, modules } = await loaded('src/pick.ts', broken);

    expect(handed).toMatch(/^export const pick = \(;\n\n;globalThis\.__VA__\.m\("[^"\n]*"\);$/);
    expect(modules).toEqual([expect.objectContaining({ file: 'src/pick.ts', instrumented: false, blocks: [] })]);
  });

  it('hands a module named unprobed back marked as loaded, though include accepts it, recorded as not instrumented', async () => {
    const page = 'export const tag = () => \'#text\';\n';
    const { handed, modules } = await loaded('src/page.ts', page, { 'src/page.ts': page }, {}, { unprobed: (file) => file.endsWith('page.ts') });

    expect(handed).toMatch(/^export const tag = \(\) => '#text';\n\n;globalThis\.__VA__\.m\("[^"\n]*"\);$/);
    expect(handed).not.toMatch(/__va\(\d+\)/);
    expect(modules).toEqual([expect.objectContaining({ file: 'src/page.ts', instrumented: false, blocks: [] })]);
  });

  const TEST = "it('adds', () => {\n  expect(1 + 1).toBe(2);\n});\n";

  it('cuts a file the project counts as a test, and probes nothing `include` refuses', async () => {
    const { handed, modules } = await loaded('src/add.test.ts', TEST);

    expect(handed).toContain('  __vaC(2);expect(1 + 1)');
    expect(modules).toEqual([]);
  });

  it('probes a test file `include` takes, and then cuts it', async () => {
    const { handed, modules } = await loaded('spec/add.check.ts', TEST, {}, { include: ['spec/**/*.check.ts'] });

    expect(handed).toContain('__va(1);');
    expect(handed).toContain('  __vaC(2);expect(1 + 1)');
    expect(modules).toEqual([expect.objectContaining({ file: 'spec/add.check.ts', instrumented: true })]);
  });

  it('counts what `include` names as a test, and nothing else', async () => {
    const config = { include: ['spec/**/*.check.ts'] };

    expect((await loaded('spec/add.check.ts', TEST, {}, config)).handed).toContain('__vaC(2);');
    expect((await loaded('src/add.test.ts', TEST, {}, config)).handed).not.toContain('__vaC(');
  });

  it('leaves a test file as it is when `cadence` is off', async () => {
    expect((await loaded('src/add.test.ts', TEST, {}, {}, { cadence: false })).handed).toBe(TEST);
  });

  it('leaves a test file as it is under the loads recipe, which cuts nothing', async () => {
    expect((await loaded('src/add.test.ts', TEST, {}, {}, { mode: 'loads' })).handed).toBe(TEST);
  });

  it('marks a module as loaded under the loads recipe, and probes nothing in it', async () => {
    const add = 'export const add = (a, b) => a + b;\n';
    const { handed, modules } = await loaded('src/add.ts', add, { 'src/add.ts': add }, {}, { mode: 'loads' });

    expect(handed).toMatch(/^export const add = \(a, b\) => a \+ b;\n\n;globalThis\.__VA__\.m\("[^"\n]*"\);$/);
    expect(handed).not.toMatch(/__va\(\d+\)/);
    expect(modules).toEqual([expect.objectContaining({ file: 'src/add.ts', instrumented: false, blocks: [] })]);
  });
});
