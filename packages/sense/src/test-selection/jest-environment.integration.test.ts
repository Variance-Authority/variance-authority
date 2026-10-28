import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
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
