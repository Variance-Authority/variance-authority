import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { decodeTestCoverage } from './format.js';
import { statusesComplete } from './finished-files.js';
import { runOf } from './selection-run.js';
import { SELECTION_LOADER, withTestSelection } from './rstest.js';
import instrumentModule from './rstest-loader.js';

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
  it('adds a pre loader carrying the snapshot the reporter will write, without replacing the project\'s own', async () => {
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

    const rule = (rspack[1] as Rules).module.rules[0]!;
    // After the project's loaders and after SWC, so the probes land on
    // JavaScript and the map back to the author's lines is the bundler's own.
    expect(rule.enforce).toBe('pre');
    expect(rule.use[0]!.loader).toBe(SELECTION_LOADER);
    // The one string that names a run: a loader is loaded by path and can be
    // handed options, never the object the configuration built.
    expect(rule.use[0]!.options.coverageFile).toBe(coverageFile);
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
    expect(statusesComplete('fail', ['pass', 'skip'])).toBe(false);
    expect(statusesComplete('pass', ['pass', 'skip', 'todo'])).toBe(true);
    expect(statusesComplete('pass', ['pass', 'fail'])).toBe(false);
    // Nothing ran, so there is nothing to be evidence of.
    expect(statusesComplete('pass', [])).toBe(false);
  });
});

describe('the Rstest loader', () => {
  /** What the loader hands Rspack for `code` at `file`, and the run it recorded into. */
  async function loaded(file: string, code: string, files: Readonly<Record<string, string>> = {}) {
    const directory = await root();
    const coverageFile = resolve(directory, 'coverage.bin');
    for (const [path, text] of Object.entries(files)) {
      await mkdir(resolve(directory, path, '..'), { recursive: true });
      await writeFile(resolve(directory, path), text);
    }
    withTestSelection({ root: directory }, { coverageFile });
    let handed: string | undefined;
    instrumentModule.call(
      { resourcePath: resolve(directory, file), getOptions: () => ({ coverageFile }), callback: (_error, text) => { handed = text; } },
      code,
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

  it('hands a module it cannot parse back as it arrived, recorded as not instrumented', async () => {
    const broken = 'export const pick = (;\n';
    const { handed, modules } = await loaded('src/pick.ts', broken);

    expect(handed).toBe(broken);
    expect(modules).toEqual([expect.objectContaining({ file: 'src/pick.ts', instrumented: false, blocks: [] })]);
  });
});
