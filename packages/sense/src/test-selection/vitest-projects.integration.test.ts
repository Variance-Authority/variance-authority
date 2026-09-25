import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { decodeTestCoverage } from './format.js';

const execute = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const repository = resolve(here, '../../../..');
const fixture = resolve(repository, 'packages/sense/test/fixtures/projects-vitest');
const at = (path: string): string => `${relative(repository, fixture)}/${path}`;
const vitest = resolve(repository, 'node_modules/vitest/vitest.mjs');

let directory: string;
let preconditions: Map<string, readonly string[]>;

beforeAll(async () => {
  directory = await mkdtemp(resolve(tmpdir(), 'variance-authority-projects-'));
  const coverageFile = resolve(directory, 'coverage.bin');
  await execute(process.execPath, [vitest, 'run', '--config', 'vitest.config.ts'], {
    cwd: fixture,
    env: { ...process.env, VARIANCE_AUTHORITY_COVERAGE: coverageFile, XDG_CACHE_HOME: directory },
  });
  preconditions = new Map(
    decodeTestCoverage(await readFile(coverageFile)).tests
      .map((test) => [test.file, test.preconditions.map((precondition) => precondition.name)]),
  );
}, 30_000);

afterAll(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe('a Vitest run over two projects', () => {
  it('rests each test on its own project\'s config, the module it imports and its setup file', () => {
    expect(preconditions.get(at('unit/unit.case.ts'))).toEqual(expect.arrayContaining([
      at('unit/vitest.config.ts'),
      at('unit/timeout.ts'),
      at('unit/setup.ts'),
    ]));
  });

  it('rests no test on the other project\'s configuration', () => {
    expect(preconditions.get(at('unit/unit.case.ts'))?.filter((name) => name.startsWith(at('dom/'))))
      .toEqual([]);
    expect(preconditions.get(at('dom/dom.case.ts'))?.filter((name) => name.startsWith(at('unit/'))))
      .toEqual([]);
  });

  it('rests every test on the configuration that describes the run', () => {
    for (const test of ['unit/unit.case.ts', 'dom/dom.case.ts']) {
      expect(preconditions.get(at(test))).toContain(at('vitest.config.ts'));
    }
  });
});
