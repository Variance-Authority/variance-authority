import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { relative, resolve } from 'node:path';
import { promisify } from 'node:util';
import { expect, it } from 'vitest';
import { decodeTestCoverage } from './format.js';
import { selectTestFiles } from './index.js';

const execute = promisify(execFile);
const root = resolve(import.meta.dirname, '../../../..');
const fixture = resolve(root, 'packages/sense/test/fixtures/external-jest-environment');
const at = (file: string): string => relative(root, resolve(fixture, file));

it('records a custom environment dependency as an input, while recording its test-VM execution separately, cold and cached', async () => {
  const directory = await mkdtemp(resolve(tmpdir(), 'variance-environment-'));
  try {
    const coverageFile = resolve(directory, 'coverage.bin');
    const run = () => execute(process.execPath, [resolve(root, 'node_modules/jest/bin/jest.js'), '--config', resolve(fixture, 'jest.config.mjs'), '--runInBand', '--watchman=false'], {
      cwd: fixture,
      env: { ...process.env, FIXTURE_COVERAGE: coverageFile, FIXTURE_CACHE: resolve(directory, 'cache') },
    });
    for (const _ of [0, 1]) {
      await run();
      const record = decodeTestCoverage(await readFile(coverageFile));
      expect(record.tests).toHaveLength(2);
      expect(record.tests.every((test) => test.complete)).toBe(true);
      for (const test of record.tests) {
        expect(test.preconditions.map(({ name }) => name)).toContain(at('src/environment-only.js'));
        expect(test.preconditions.map(({ name }) => name)).toContain(at('src/shared.js'));
        expect(test.preconditions.map(({ name }) => name)).toContain(at('src/environment-data.json'));
      }
      const shared = record.modules.find((module) => module.file === at('src/shared.js') && module.instrumented);
      expect(shared?.blocks.filter((block) => block.kind === 'function').map((block) => block.testFiles)).toEqual([[at('test/one.case.js')]]);
      expect(await selectTestFiles(coverageFile, `--- a/${at('src/environment-only.js')}\n+++ b/${at('src/environment-only.js')}\n@@ -1 +1 @@\n-export function setting() { return 'environment'; }\n+export function setting() { return 'changed'; }\n`)).toEqual([at('test/one.case.js'), at('test/two.case.js')]);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}, 60_000);


const ASYNC_PRESET = { FIXTURE_PRESET: '<rootDir>/preset-async.mjs' };
const JEST_DEFAULT = { FIXTURE_NO_TRANSFORM: '1', FIXTURE_ENVIRONMENT: 'node', FIXTURE_MATCH: '<rootDir>/docblock/plain.case.js' };

it.each(['--runInBand', '--maxWorkers=2'])('records a run whose preset only `import` can read, under %s', async (workers) => {
  const directory = await mkdtemp(resolve(tmpdir(), 'variance-async-preset-'));
  try {
    const coverageFile = resolve(directory, 'coverage.bin');
    await execute(process.execPath, [resolve(root, 'node_modules/jest/bin/jest.js'), '--config', resolve(fixture, 'jest.config.mjs'), workers, '--watchman=false'], {
      cwd: fixture,
      env: { ...process.env, ...ASYNC_PRESET, FIXTURE_COVERAGE: coverageFile, FIXTURE_CACHE: resolve(directory, 'cache') },
    });
    const record = decodeTestCoverage(await readFile(coverageFile));
    expect(record.tests.length).toBeGreaterThan(0);
    expect(record.tests.every(({ complete }) => complete)).toBe(true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}, 60_000);

// Babel's JSON files are in `require.cache` with no `children`, as `import` leaves a JSON file.
it.each([['no preset', {}], ['a preset only `import` can read', ASYNC_PRESET]])('passes under Jest\'s default transformer and %s', async (_, preset) => {
  const directory = await mkdtemp(resolve(tmpdir(), 'variance-default-transformer-'));
  try {
    const run = execute(process.execPath, [resolve(root, 'node_modules/jest/bin/jest.js'), '--config', resolve(fixture, 'jest.config.mjs'), '--runInBand', '--watchman=false'], {
      cwd: fixture,
      env: { ...process.env, ...JEST_DEFAULT, ...preset, FIXTURE_COVERAGE: resolve(directory, 'coverage.bin'), FIXTURE_CACHE: resolve(directory, 'cache') },
    });
    await expect(run).resolves.toBeDefined();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}, 60_000);

it.each(['native-environment.mjs', 'native/environment.js', 'mixed-environment.cjs'])('refuses unobservable native inputs in %s rather than claiming complete inputs', async (environment) => {
  const directory = await mkdtemp(resolve(tmpdir(), 'variance-native-environment-'));
  try {
    await expect(execute(process.execPath, [resolve(root, 'node_modules/jest/bin/jest.js'), '--config', resolve(fixture, 'jest.config.mjs'), '--runInBand', '--watchman=false'], {
      cwd: fixture,
      env: {
        ...process.env,
        FIXTURE_COVERAGE: resolve(directory, 'coverage.bin'),
        FIXTURE_CACHE: resolve(directory, 'cache'),
        FIXTURE_ENVIRONMENT: `<rootDir>/${environment}`,
      },
    })).rejects.toMatchObject({ stderr: expect.stringContaining('cannot read the dependency registry of environment') });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}, 60_000);

it.each([
  ['Jest\'s runtime', {}],
  ['the project\'s runtime', { FIXTURE_RUNTIME: '<rootDir>/runtime.cjs', FIXTURE_PROJECT_RUNTIME: '1' }],
  ['the runtime its preset names', { FIXTURE_PRESET: '<rootDir>/preset.cjs', FIXTURE_PROJECT_RUNTIME: '1' }],
  ['a runtime only its resolver finds', { FIXTURE_RUNTIME: 'project-runtime', FIXTURE_RESOLVER: '<rootDir>/resolver.cjs', FIXTURE_PROJECT_RUNTIME: '1' }],
])('charges a docblock environment, entry and dependencies, to the file that names it alone, under %s, cold and cached', async (_, runtime) => {
  const directory = await mkdtemp(resolve(tmpdir(), 'variance-docblock-environment-'));
  // Installed, so ignored: the package an environment loads a repository file through.
  const installed = resolve(fixture, 'node_modules/load-setting');
  await mkdir(installed, { recursive: true });
  await writeFile(resolve(installed, 'index.js'), 'module.exports = (file) => require(file);\n');
  try {
    const coverageFile = resolve(directory, 'coverage.bin');
    // One worker: both files, with different environments, run in it.
    const run = () => execute(process.execPath, [resolve(root, 'node_modules/jest/bin/jest.js'), '--config', resolve(fixture, 'jest.config.mjs'), '--runInBand', '--watchman=false'], {
      cwd: fixture,
      env: {
        ...process.env,
        ...runtime,
        FIXTURE_COVERAGE: coverageFile,
        FIXTURE_CACHE: resolve(directory, 'cache'),
        FIXTURE_ENVIRONMENT: 'node',
        FIXTURE_MATCH: '<rootDir>/docblock/*.case.js',
      },
    });
    const inputs = [at('environment.ts'), at('src/environment-only.js'), at('src/shared.js'), at('src/environment-data.json')];
    const packaged = [at('packaged-environment.cjs'), at('src/packaged-setting.cjs')];
    const change = (file: string) => `--- a/${at(file)}\n+++ b/${at(file)}\n@@ -1 +1 @@\n-${'x'}\n+${'y'}\n`;
    for (const _ of [0, 1]) {
      await run();
      const record = decodeTestCoverage(await readFile(coverageFile));
      expect(record.tests.map(({ file }) => file).sort()).toEqual([at('docblock/local.case.js'), at('docblock/packaged.case.js'), at('docblock/plain.case.js')]);
      expect(record.tests.every((test) => test.complete)).toBe(true);
      const names = (file: string) => record.tests.find((test) => test.file === at(file))!.preconditions.map(({ name }) => name);
      expect(names('docblock/local.case.js')).toEqual(expect.arrayContaining(inputs));
      expect(names('docblock/packaged.case.js')).toEqual(expect.arrayContaining(packaged));
      expect(names('docblock/local.case.js').filter((name) => packaged.includes(name))).toEqual([]);
      expect(names('docblock/packaged.case.js').filter((name) => inputs.includes(name))).toEqual([]);
      expect(names('docblock/plain.case.js').filter((name) => [...inputs, ...packaged].includes(name))).toEqual([]);
      expect(await selectTestFiles(coverageFile, change('environment.ts'))).toEqual([at('docblock/local.case.js')]);
      expect(await selectTestFiles(coverageFile, change('src/environment-only.js'))).toEqual([at('docblock/local.case.js')]);
      expect(await selectTestFiles(coverageFile, change('src/packaged-setting.cjs'))).toEqual([at('docblock/packaged.case.js')]);
    }
  } finally {
    await rm(installed, { recursive: true, force: true });
    await rm(directory, { recursive: true, force: true });
  }
}, 60_000);
