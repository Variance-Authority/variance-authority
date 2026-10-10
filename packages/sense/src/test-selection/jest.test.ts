import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { decodeTestCoverage } from './format.js';
import SelectionReporter from './jest-reporter.js';
import { createTransformer, type JestTransformRequest } from './jest-transform.js';
import {
  RUN_DIRECTORY_VARIABLE,
  SELECTION_GLOBALS,
  SELECTION_REPORTER,
  SELECTION_SETUP,
  SELECTION_TRANSFORM,
  TRACE_ENVIRONMENT,
  withJourneyCoverage,
  withTestSelection,
} from './jest.js';
import { deriveModules, moduleId } from './captured-modules.js';
import journalFormat from './journal-format.cjs';
import { EVALUATING } from '../instrument/index.js';

const { encodeJournal } = journalFormat;

/**
 * Counters that would have produced these crossings: a region entered while the
 * module evaluated counts from `EVALUATING`, and one the file entered itself
 * counts from one.
 */
const counters = (hits: readonly number[], shared: readonly number[]): Uint32Array => {
  const values = new Uint32Array(Math.max(...hits, ...shared) + 1);
  for (const ordinal of hits) values[ordinal] = 1;
  for (const ordinal of shared) values[ordinal] = EVALUATING + 1;
  return values;
};

const temporary: string[] = [];

afterEach(async () => {
  delete process.env[RUN_DIRECTORY_VARIABLE];
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe('withJourneyCoverage for Jest', () => {
  it('records journeys without configuring a test-selection snapshot', () => {
    const configured = withJourneyCoverage(
      { rootDir: '/repo', transform: { '\\.tsx?$': '@swc/jest' } },
      { journeyFile: 'artifacts/shard-3.journeys.bin', preconditions: ['test/environment.ts'] },
    );

    expect(configured.transform).toEqual({
      '\\.tsx?$': [SELECTION_TRANSFORM, {
        root: '/repo',
        transformer: '@swc/jest',
        exclude: ['/repo/test/environment.ts'],
      }],
    });
    expect(configured.setupFiles).toEqual([SELECTION_GLOBALS]);
    expect(configured.setupFilesAfterEnv).toEqual([SELECTION_SETUP]);
    expect(configured.reporters).toEqual([
      'default',
      [SELECTION_REPORTER, { root: '/repo', journeyFile: '/repo/artifacts/shard-3.journeys.bin' }],
    ]);
  });

  it('runs the project environment through one that requires the trace once per worker', () => {
    const rootDir = resolve(import.meta.dirname, '../..');
    const configured = withJourneyCoverage(
      { rootDir, testEnvironmentOptions: { customExportConditions: ['node'] } },
      { journeyFile: 'journeys.bin', trace: '<rootDir>/test/sentry.cjs' },
    );

    expect(configured.testEnvironment).toBe(TRACE_ENVIRONMENT);
    expect(configured.testEnvironmentOptions).toEqual({
      customExportConditions: ['node'],
      varianceAuthority: {
        // Unset is Jest's `node`, resolved the way Jest resolves a name.
        environment: expect.stringMatching(/jest-environment-node\/build\/index\.js$/),
        trace: resolve(rootDir, 'test/sentry.cjs'),
      },
    });
    expect(() => withJourneyCoverage({ rootDir }, { journeyFile: 'journeys.bin', trace: '@sentry/node' }))
      .toThrow(/is not a path/);
  });

  it.todo('marks the modules `unprobed` names as loaded, as withTestSelection does — needs `unprobed` on JestJourneyCoverageOptions');
});

async function project(): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), 'variance-authority-jest-'));
  temporary.push(root);
  await mkdir(resolve(root, 'src'), { recursive: true });
  await mkdir(resolve(root, 'test'), { recursive: true });
  await writeFile(resolve(root, 'package.json'), '{"name":"fixture","private":true}\n');
  // Shaped like `@swc/jest`: a factory, a synchronous `process`, and a key of its own.
  await writeFile(
    resolve(root, 'transformer.cjs'),
    `module.exports = {
  createTransformer: (config) => ({
    canInstrument: false,
    process: (source) => ({ code: source.replace('__PLACEHOLDER__', config.value) }),
    getCacheKey: (source, path) => 'inner:' + config.value + ':' + source.length + ':' + path,
  }),
};
`,
  );
  // Shaped like an ES-only transformer with nothing synchronous to offer.
  await writeFile(
    resolve(root, 'transformer.mjs'),
    `export default {
  async processAsync(source) { return { code: source.replace('__PLACEHOLDER__', '1') } },
};
`,
  );
  // Shaped like Jira's Babel transformer: CommonJS exports the Promise of the
  // transformer after asynchronously loading the project's Babel options.
  await writeFile(
    resolve(root, 'transformer-async.cjs'),
    `module.exports = Promise.resolve({
  process: (source) => ({ code: source.replace('__PLACEHOLDER__', '2') }),
});
`,
  );
  return root;
}

const SOURCE = `const flag = __PLACEHOLDER__;
function pick(value) {
  if (value) {
    return 'left';
  }
  return 'right';
}
module.exports = { pick, flag };
`;

function transformOptions(root: string, id = 'project'): JestTransformRequest {
  return {
    config: { cacheDirectory: resolve(root, 'cache'), id, testMatch: [`${root}/test/*.case.js`] },
    configString: '{}',
    instrument: false,
  };
}

describe('withTestSelection for Jest', () => {
  it('composes with the setup files, reporters, and transforms the configuration already has', () => {
    const configured = withTestSelection(
      {
        rootDir: '/repo',
        testEnvironment: '<rootDir>/test/environment.ts',
        setupFiles: ['<rootDir>/test/polyfills.js'],
        setupFilesAfterEnv: ['<rootDir>/test/setup.ts'],
        reporters: ['default', ['jest-junit', { outputDirectory: 'reports' }]],
        transform: {
          '\\.tsx?$': ['@swc/jest', { jsc: { parser: { syntax: 'typescript' } } }],
          '\\.css$': 'jest-transform-css',
        },
      },
      { coverageFile: 'coverage.bin', preconditions: ['tsconfig.json'] },
    );

    expect(configured.setupFiles).toEqual([SELECTION_GLOBALS, '<rootDir>/test/polyfills.js']);
    expect(configured.setupFilesAfterEnv).toEqual(['<rootDir>/test/setup.ts', SELECTION_SETUP]);
    expect(configured.reporters).toEqual([
      'default',
      ['jest-junit', { outputDirectory: 'reports' }],
      [SELECTION_REPORTER, {
        root: '/repo',
        coverageFile: '/repo/coverage.bin',
        preconditions: [
          '/repo/test/environment.ts',
          '/repo/test/polyfills.js',
          '/repo/test/setup.ts',
          '/repo/tsconfig.json',
        ],
        declared: ['/repo/tsconfig.json'],
      }],
    ]);
    expect(configured.transform).toEqual({
      '\\.tsx?$': [SELECTION_TRANSFORM, {
        root: '/repo',
        transformer: ['@swc/jest', { jsc: { parser: { syntax: 'typescript' } } }],
        exclude: ['/repo/test/environment.ts', '/repo/tsconfig.json'],
      }],
      '\\.css$': [SELECTION_TRANSFORM, {
        root: '/repo',
        transformer: 'jest-transform-css',
        exclude: ['/repo/test/environment.ts', '/repo/tsconfig.json'],
      }],
    });
  });

  it('instruments every project of a multi-project configuration, and reports once', () => {
    // `transform` and the setup phases are a project's own — Jest inherits none
    // of them from the top level — and reporters are the run's. Wrapped only at
    // the top, a project would run uninstrumented and its every test file would
    // be recorded as complete with nothing entered, which is the skip.
    const configured = withTestSelection(
      {
        rootDir: '/repo',
        projects: [
          { displayName: 'node', rootDir: '<rootDir>/packages/node', setupFiles: ['<rootDir>/setup.js'] },
          { displayName: 'dom', testEnvironment: 'jsdom', transform: { '\\.tsx?$': '@swc/jest' } },
        ],
      },
      { coverageFile: 'coverage.bin' },
    );

    expect(configured.transform).toBeUndefined();
    expect(configured.setupFiles).toBeUndefined();
    expect(configured.projects).toEqual([
      {
        displayName: 'node',
        rootDir: '/repo/packages/node',
        transform: { '\\.[jt]sx?$': [SELECTION_TRANSFORM, { root: '/repo', transformer: 'babel-jest' }] },
        // The sandbox learns its project's name from here, for the case ids.
        globals: { 'variance-authority.project': 'node' },
        setupFiles: [SELECTION_GLOBALS, '<rootDir>/setup.js'],
        setupFilesAfterEnv: [SELECTION_SETUP],
      },
      {
        displayName: 'dom',
        testEnvironment: 'jsdom',
        rootDir: '/repo',
        transform: { '\\.tsx?$': [SELECTION_TRANSFORM, { root: '/repo', transformer: '@swc/jest' }] },
        globals: { 'variance-authority.project': 'dom' },
        setupFiles: [SELECTION_GLOBALS],
        setupFilesAfterEnv: [SELECTION_SETUP],
      },
    ]);
    expect(configured.reporters).toEqual([
      'default',
      [SELECTION_REPORTER, { root: '/repo', coverageFile: '/repo/coverage.bin', preconditions: ['/repo/packages/node/setup.js'] }],
    ]);
  });

  it('hands the recipe to every transform and to the reporter', () => {
    const configured = withTestSelection(
      { rootDir: '/repo', transform: { '\\.tsx?$': '@swc/jest' } },
      { coverageFile: 'coverage.bin', mode: 'entries' },
    );

    expect(configured.transform).toEqual({
      '\\.tsx?$': [SELECTION_TRANSFORM, { root: '/repo', transformer: '@swc/jest', mode: 'entries' }],
    });
    expect(configured.reporters).toEqual([
      'default',
      [SELECTION_REPORTER, { root: '/repo', coverageFile: '/repo/coverage.bin', preconditions: [], mode: 'entries' }],
    ]);
  });

  it('hands every transform the modules named unprobed, as globs under rootDir', () => {
    const configured = withTestSelection(
      { rootDir: '/repo', transform: { '\\.tsx?$': '@swc/jest' } },
      { coverageFile: 'coverage.bin', unprobed: ['src/page/**', '/elsewhere/world.ts'] },
    );

    expect(configured.transform).toEqual({
      '\\.tsx?$': [SELECTION_TRANSFORM, { root: '/repo', transformer: '@swc/jest', unprobed: ['/repo/src/page/**', '/elsewhere/world.ts'] }],
    });
  });

  it('refuses a project named by path rather than instrumenting half the run', () => {
    expect(() => withTestSelection({ projects: ['<rootDir>/packages/node'] }, { coverageFile: 'coverage.bin' }))
      .toThrow(/named by path/);
  });

  it('leaves a setup entry that names a package out of the preconditions', () => {
    // `jest-canvas-mock`, `dotenv/config`: resolved by Jest as modules, not
    // files of the project's. Read as paths they are missing files, and the
    // reporter that failed on one wrote no snapshot for the run.
    const configured = withTestSelection(
      { rootDir: '/repo', setupFiles: ['jest-canvas-mock', './test/polyfills.js'], setupFilesAfterEnv: ['@testing-library/jest-dom'] },
      { coverageFile: 'coverage.bin' },
    );

    expect(configured.setupFiles).toEqual([SELECTION_GLOBALS, 'jest-canvas-mock', './test/polyfills.js']);
    expect(configured.reporters?.[1]).toEqual([
      SELECTION_REPORTER,
      { root: '/repo', coverageFile: '/repo/coverage.bin', preconditions: ['/repo/test/polyfills.js'] },
    ]);
  });

  it('wraps what Jest would have run when the configuration names no transform', () => {
    const configured = withTestSelection({ rootDir: '/repo' }, { coverageFile: 'coverage.bin' });
    expect(configured.transform).toEqual({
      '\\.[jt]sx?$': [SELECTION_TRANSFORM, { root: '/repo', transformer: 'babel-jest' }],
    });
    expect(configured.reporters).toEqual(['default', [SELECTION_REPORTER, expect.anything()]]);

    const plain = withTestSelection({ rootDir: '/repo', transform: {} }, { coverageFile: 'coverage.bin' });
    expect(plain.transform).toEqual({ '\\.[jt]sx?$': [SELECTION_TRANSFORM, { root: '/repo' }] });
  });
});

describe('the Jest transformer', () => {
  it("places probes on the project's text, runs the wrapped transformer on it, and names that text in the probes", async () => {
    const root = await project();
    const options = transformOptions(root);
    const path = resolve(root, 'src/pick.js');
    const transformer = await createTransformer({
      root,
      transformer: [resolve(root, 'transformer.cjs'), { value: 'true' }],
    });

    const { code } = transformer.process!(SOURCE, path, options);

    expect(code).toContain('const flag = true;');
    expect(code).toContain('globalThis.__VA__');
    const id = moduleId('src/pick.js', SOURCE);
    expect(code).toContain(JSON.stringify(id));
    await writeFile(path, SOURCE);
    const module = (await deriveModules(root, [id], undefined)).get(id);
    expect(module).toEqual(expect.objectContaining({ file: 'src/pick.js', instrumented: true }));
    expect(module!.blocks.length).toBeGreaterThanOrEqual(4);
  });

  it('places only module and function probes under the entries recipe', async () => {
    const root = await project();
    const options = transformOptions(root);
    const path = resolve(root, 'src/pick.js');
    const transformer = await createTransformer({ root, mode: 'entries' });

    const text = SOURCE.replace('__PLACEHOLDER__', '1');
    transformer.process!(text, path, options);

    await writeFile(path, text);
    const id = moduleId('src/pick.js', text);
    const module = (await deriveModules(root, [id], 'entries')).get(id);
    expect(module!.blocks.map((block) => block.kind)).toEqual(['module', 'function']);
  });

  it('keys the cache by the wrapped transformer and its options, so a changed option is a new text and a new record', async () => {
    const root = await project();
    const options = transformOptions(root);
    const path = resolve(root, 'src/pick.js');
    const keys = await Promise.all(['true', 'false'].map(async (value) => {
      const transformer = await createTransformer({
        root,
        transformer: [resolve(root, 'transformer.cjs'), { value }],
      });
      return transformer.getCacheKey!(SOURCE, path, options);
    }));

    expect(keys[0]).toMatch(/^[0-9a-f]{32}$/);
    expect(keys[0]).not.toBe(keys[1]);
  });

  it('leaves the test files the configuration names alone', async () => {
    const root = await project();
    const transformer = await createTransformer({ root });
    const byGlob = transformer.process!(SOURCE, resolve(root, 'test/pick.case.js'), transformOptions(root));
    const byRegex = transformer.process!(SOURCE, resolve(root, 'src/pick.js'), {
      ...transformOptions(root),
      config: { cacheDirectory: resolve(root, 'cache'), testRegex: 'src/.*\\.js$' },
    });
    const product = transformer.process!(SOURCE, resolve(root, 'src/pick.js'), transformOptions(root));

    expect(byGlob.code).toBe(SOURCE);
    expect(byRegex.code).toBe(SOURCE);
    expect(product.code).toContain('globalThis.__VA__');
  });

  it('offers no synchronous process over a transformer that has none', async () => {
    const root = await project();
    const options = transformOptions(root);
    const transformer = await createTransformer({ root, transformer: resolve(root, 'transformer.mjs') });

    expect(transformer.process).toBeUndefined();
    const { code } = await transformer.processAsync!(SOURCE, resolve(root, 'src/pick.js'), options);
    expect(code).toContain('const flag = 1;');
    expect(code).toContain('globalThis.__VA__');
  });

  it('awaits a CommonJS transformer exported as a Promise', async () => {
    const root = await project();
    const options = transformOptions(root);
    const transformer = await createTransformer({
      root,
      transformer: resolve(root, 'transformer-async.cjs'),
    });

    const { code } = transformer.process!(SOURCE, resolve(root, 'src/pick.js'), options);
    expect(code).toContain('const flag = 2;');
    expect(code).toContain('globalThis.__VA__');
  });

  it('transforms a declared precondition without placing probes in it', async () => {
    const root = await project();
    const options = transformOptions(root);
    const path = resolve(root, 'src/pick.js');
    const transformer = await createTransformer({
      root,
      transformer: [resolve(root, 'transformer.cjs'), { value: 'true' }],
      exclude: [path],
    });

    const { code } = transformer.process!(SOURCE, path, options);
    expect(code).toContain('const flag = true;');
    expect(code).not.toContain('globalThis.__VA__');
  });
});

describe('the Jest reporter', () => {
  it('names the run before workers fork, cuts the modules the journals name from the checkout, and lands the snapshot', async () => {
    const root = await project();
    const options = transformOptions(root);
    const coverageFile = resolve(root, 'coverage.bin');
    await writeFile(resolve(root, 'src/pick.js'), SOURCE);
    const id = moduleId('src/pick.js', SOURCE);
    for (const name of ['alpha', 'beta', 'gamma']) await writeFile(resolve(root, `test/${name}.case.js`), `// ${name}\n`);

    const reporter = new SelectionReporter(undefined, { root, coverageFile, preconditions: [] });
    reporter.onRunStart();
    const runDirectory = process.env[RUN_DIRECTORY_VARIABLE]!;
    expect(runDirectory).toBeDefined();
    await mkdir(runDirectory, { recursive: true });
    const journal = (name: string, hits: number[], shared: number[]): Buffer =>
      encodeJournal(
        resolve(root, `test/${name}.case.js`),
        hits.length === 0 ? new Map() : new Map([[id, counters(hits, shared)]]),
      );
    // What the module did while evaluating — ordinals 0 and 1 — is every
    // file's that entered it, and gamma never did.
    await writeFile(resolve(runDirectory, 'a.va'), journal('alpha', [0, 1, 2], [0, 1]));
    await writeFile(resolve(runDirectory, 'b.va'), journal('beta', [0, 3], [0]));
    await writeFile(resolve(runDirectory, 'c.va'), journal('gamma', [], []));

    await reporter.onRunComplete(new Set([{ config: options.config }]), {
      testResults: [
        { testFilePath: resolve(root, 'test/alpha.case.js'), skipped: false, testResults: [{ status: 'passed' }] },
        { testFilePath: resolve(root, 'test/beta.case.js'), skipped: false, testResults: [{ status: 'passed' }, { status: 'pending' }] },
        { testFilePath: resolve(root, 'test/gamma.case.js'), skipped: false, testResults: [{ status: 'passed' }] },
      ],
    });

    expect(process.env[RUN_DIRECTORY_VARIABLE]).toBeUndefined();
    await expect(stat(runDirectory)).rejects.toThrow();
    const coverage = decodeTestCoverage(await readFile(coverageFile));
    expect(coverage.tests.map((test) => [test.file, test.complete])).toEqual([
      ['test/alpha.case.js', true],
      // A `pending` assertion is a skipped one, and it leaves the file's record
      // usable: see `usableOutcome` in `vitest.ts`.
      ['test/beta.case.js', true],
      ['test/gamma.case.js', true],
    ]);
    // The test file, and nothing the instrument could see inside: `src/pick.js`
    // is instrumented, so its text is a digest on its own row rather than a
    // precondition repeated under every test that reached it.
    expect(coverage.tests[0]!.preconditions.map((precondition) => precondition.name)).toEqual([
      'test/alpha.case.js',
    ]);
    const [module] = coverage.modules;
    expect(module!.file).toBe('src/pick.js');
    const testsOf = (ordinal: number): readonly string[] =>
      module!.blocks.find((block) => block.ordinal === ordinal)!.testFiles;
    expect(testsOf(0)).toEqual(['test/alpha.case.js', 'test/beta.case.js']);
    expect(testsOf(1)).toEqual(['test/alpha.case.js', 'test/beta.case.js']);
    expect(testsOf(2)).toEqual(['test/alpha.case.js']);
    expect(testsOf(3)).toEqual(['test/beta.case.js']);
  });
});
