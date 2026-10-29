import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Relations } from '@variance-authority/core/relate';
import { scanRelations } from '../scan.js';
import { runGraphOf } from '../taint/graph.js';
import { unreachedLoads } from './closed-world.js';
import { decodeTestCoverage } from './format.js';

const execute = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const repository = resolve(here, '../../../..');
const FIXTURE = 'packages/sense/test/fixtures/closed-world-jest';
const SETUP = `${FIXTURE}/test/setup.ts`;
const fixture = resolve(repository, FIXTURE);
const jest = resolve(repository, 'node_modules/jest/bin/jest.js');
const temporary: string[] = [];
let relations: Relations;

beforeAll(async () => {
  const records = await scanRelations({ root: repository, dirs: [FIXTURE], before: [SETUP], digests: false });
  relations = await runGraphOf(records, { root: repository });
});

afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

/** The record a Jest run of the fixture writes, with `args` passed to Jest and `env` beside it. */
async function recorded(args: readonly string[], env: Record<string, string> = {}) {
  const directory = await mkdtemp(resolve(tmpdir(), 'variance-authority-closed-world-'));
  temporary.push(directory);
  const coverageFile = resolve(directory, 'coverage.bin');
  await execute(process.execPath, [jest, '--config', resolve(fixture, 'jest.config.mjs'), '--watchman=false', ...args], {
    cwd: fixture,
    env: {
      ...process.env,
      ...env,
      VARIANCE_AUTHORITY_COVERAGE: coverageFile,
      VARIANCE_AUTHORITY_JEST_CACHE: resolve(directory, 'cache'),
      VARIANCE_AUTHORITY_CACHE: directory,
    },
  });
  return decodeTestCoverage(await readFile(coverageFile));
}

describe('a Jest project set up as people set it up, read as a closed world', () => {
  it('loads nothing its imports do not reach: mapper, alias, __mocks__, factory mocks, isolated registries, a setup file', async () => {
    const coverage = await recorded(['--testPathIgnorePatterns', 'dynamic', 'automock']);

    expect(coverage.tests.map((test) => test.file).sort()).toEqual([
      `${FIXTURE}/test/button.case.ts`,
      `${FIXTURE}/test/counter.case.ts`,
      `${FIXTURE}/test/math.case.ts`,
      `${FIXTURE}/test/profile.case.ts`,
    ]);
    expect(unreachedLoads(relations, coverage.modules, [SETUP])).toEqual([]);
  });

  it('loads nothing its imports do not reach with automock on', async () => {
    const coverage = await recorded(['test/automock.case.ts'], { FIXTURE_AUTOMOCK: 'on' });

    expect(coverage.tests.map((test) => test.file)).toEqual([`${FIXTURE}/test/automock.case.ts`]);

    expect(unreachedLoads(relations, coverage.modules, [SETUP])).toEqual([]);
  });

  it('names the one file a test loaded by a name it computed, and the test', async () => {
    const coverage = await recorded(['test/dynamic.case.ts']);

    expect(unreachedLoads(relations, coverage.modules, [SETUP])).toEqual([
      { file: `${FIXTURE}/src/math.ts`, test: `${FIXTURE}/test/dynamic.case.ts` },
    ]);
  });
});
