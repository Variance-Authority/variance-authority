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
import { driftChange, type DriftSide } from './drift-change.js';
import { driftFromWalk } from './drift.js';
import { decodeTestCoverage } from './format.js';

const execute = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const repository = resolve(here, '../../../..');
const FIXTURE = 'packages/sense/test/fixtures/drift-jest';
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
  const directory = await mkdtemp(resolve(tmpdir(), 'variance-authority-drift-'));
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

/** The drift of a record, every test file it holds observed whole. */
function side(coverage: Awaited<ReturnType<typeof recorded>>): DriftSide {
  const tests = new Set(coverage.tests.map((test) => test.file));
  return { rows: driftFromWalk(relations, coverage.modules, [SETUP]).rows, observed: tests, held: tests };
}

const present = () => true;

describe('a Jest project set up as people set it up, read for drift from the walk', () => {
  it('drifts only by the mocks the runner served: mapper, alias, factory mocks, isolated registries and a setup file are walked', async () => {
    const coverage = await recorded(['--testPathIgnorePatterns', 'dynamic', 'automock']);

    expect(coverage.tests.map((test) => test.file).sort()).toEqual([
      `${FIXTURE}/test/button.case.ts`,
      `${FIXTURE}/test/counter.case.ts`,
      `${FIXTURE}/test/math.case.ts`,
      `${FIXTURE}/test/profile.case.ts`,
    ]);
    expect(driftFromWalk(relations, coverage.modules, [SETUP]).rows).toEqual([
      { file: `${FIXTURE}/__mocks__/ms.ts`, test: `${FIXTURE}/test/profile.case.ts` },
      { file: `${FIXTURE}/src/__mocks__/api.ts`, test: `${FIXTURE}/test/profile.case.ts` },
    ]);
  });

  it('does not drift with automock on', async () => {
    const coverage = await recorded(['test/automock.case.ts'], { FIXTURE_AUTOMOCK: 'on' });

    expect(coverage.tests.map((test) => test.file)).toEqual([`${FIXTURE}/test/automock.case.ts`]);

    expect(driftFromWalk(relations, coverage.modules, [SETUP]).rows).toEqual([]);
  });

  it('names the one file a test loaded by a name it computed, and the test', async () => {
    const coverage = await recorded(['test/dynamic.case.ts']);

    expect(driftFromWalk(relations, coverage.modules, [SETUP]).rows).toEqual([
      { file: `${FIXTURE}/src/math.ts`, test: `${FIXTURE}/test/dynamic.case.ts` },
    ]);
  });

  it('reviewed against itself, changes no shape', async () => {
    const coverage = await recorded(['--testPathIgnorePatterns', 'automock']);

    expect(driftChange(side(coverage), side(coverage), { present })).toMatchObject({ compared: 5, grown: [], shrunk: [], first: [] });
  });

  it('grows by exactly the one row a computed-name load adds, and shrinks by it when the load goes', async () => {
    const without = side(await recorded(['test/dynamic.case.ts'], { FIXTURE_COMPUTED: 'off' }));
    const with_ = side(await recorded(['test/dynamic.case.ts']));
    const row = { file: `${FIXTURE}/src/math.ts`, test: `${FIXTURE}/test/dynamic.case.ts` };

    expect(driftChange(without, with_, { present })).toMatchObject({ compared: 1, grown: [row], shrunk: [] });
    expect(driftChange(with_, without, { present })).toMatchObject({ compared: 1, grown: [], shrunk: [row] });
  });

  it.todo('reads a Vitest record the same way: `resolve.alias`, `vi.mock` with and without a factory, `importOriginal` and `vi.resetModules` report no shape change against themselves and one grown row for an added computed-name load — needs a Vitest twin of this fixture');
});
