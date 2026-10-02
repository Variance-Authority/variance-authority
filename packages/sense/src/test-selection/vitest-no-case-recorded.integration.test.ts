import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { lastCaseRunOf } from './case-landing.js';
import { caseSectionsAt, keepsCases } from './case-record.js';
import { CrossingSets } from './crossing-sets.js';
import { decodeExecutionIndex } from './execution-format.js';
import { encodeSetExecutionIndex } from './execution-set-format.js';
import { writeTestCoverage } from './index.js';
import { coveringTests } from './reverse.js';

const execute = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const repository = resolve(here, '../../../..');
// Only the configuration that describes the run is wrapped; the project it
// lists is not, so the run instruments nothing, records no case and finishes
// no file. The fixture is this file's alone, because its shim directory is
// what it asserts on.
const unwrapped = resolve(repository, 'packages/sense/test/fixtures/unwrapped-projects-vitest');
// Wrapped, with one case that crosses `add` or nothing as the run says: a run
// that records no case and still finishes its file.
const idle = resolve(repository, 'packages/sense/test/fixtures/idle-case-vitest');
const shimDirectory = resolve(unwrapped, '.variance-authority');
const at = (fixture: string, path: string): string => `${relative(repository, fixture)}/${path}`;
const vitest = resolve(repository, 'node_modules/vitest/vitest.mjs');
const CASE = 'adds under a project nobody wrapped';

let directory: string;
let coverageFile: string;

beforeEach(async () => {
  directory = await mkdtemp(resolve(tmpdir(), 'variance-authority-no-case-'));
  coverageFile = resolve(directory, 'coverage.bin');
  await rm(shimDirectory, { recursive: true, force: true });
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
  await rm(shimDirectory, { recursive: true, force: true });
});

/** Run a fixture once, and answer with what it said on stderr. */
async function run(fixture: string, env: Record<string, string> = {}): Promise<string> {
  const { stderr } = await execute(process.execPath, [vitest, 'run', '--config', 'vitest.config.ts'], {
    cwd: fixture,
    env: { ...process.env, VARIANCE_AUTHORITY_COVERAGE: coverageFile, VARIANCE_AUTHORITY_CACHE: directory, ...env },
  });
  return stderr;
}

/** An index an earlier run wrote, when the unwrapped fixture's one case was recorded calling `add`. */
function earlierIndex(): Buffer {
  const sets = new CrossingSets(1);
  sets.intern([]);
  const called = sets.intern([0]);
  return encodeSetExecutionIndex({
    tests: [{ id: CASE, file: at(unwrapped, 'unit/unit.case.ts'), name: CASE }],
    modules: [{
      file: at(unwrapped, 'src/add.ts'),
      blocks: [{ kind: 'function', name: 'add', path: 'add', startLine: 1, endLine: 3, source: true }],
      called: Uint32Array.of(called),
      loaded: Uint8Array.of(0),
    }],
    sets: sets.pool(),
  });
}

it('keeps no cases in the record of a run that recorded no case and finished no file, and takes off the directory it made for its shims', async () => {
  expect(await run(unwrapped)).toContain('instrumented 0 modules across 1 test file(s)');

  expect(existsSync(coverageFile)).toBe(true);
  expect(keepsCases(coverageFile)).toBe(false);
  expect(caseSectionsAt(coverageFile)).toEqual({});
  expect(existsSync(shimDirectory)).toBe(false);
}, 30_000);

it('leaves the cases an earlier run kept in the record and their layers as they were, and the directory the project already had', async () => {
  const earlier = earlierIndex();
  await writeTestCoverage(coverageFile, { version: 3, instrumentation: 'earlier', tests: [], modules: [] }, { index: earlier });
  await mkdir(shimDirectory);

  await run(unwrapped);

  const { index, before, last } = caseSectionsAt(coverageFile);
  expect(index === undefined ? undefined : Buffer.compare(Buffer.from(index), earlier)).toBe(0);
  // The run neither names itself the last one nor sets aside the cases of the
  // file it was handed as though it had replaced them.
  expect(last).toBeUndefined();
  expect(before).toBeUndefined();
  expect(await readdir(shimDirectory)).toEqual([]);
}, 30_000);

it('retires what an earlier run recorded for a case whose file finished and which entered nothing this time', async () => {
  const covering = async (): Promise<readonly string[]> =>
    coveringTests(
      decodeExecutionIndex(await readFile(coverageFile)),
      { file: at(idle, 'src/add.ts'), function: 'add' },
    ).map((test) => test.name);

  await run(idle, { VARIANCE_AUTHORITY_CALL: '1' });
  expect(await covering()).toEqual(['adds when asked']);

  await run(idle, { VARIANCE_AUTHORITY_CALL: '0' });
  expect(await covering()).toEqual([]);
  expect(lastCaseRunOf(caseSectionsAt(coverageFile))).toMatchObject({ cases: [] });
}, 60_000);

it.todo('a Vitest 4 run whose configuration lists its projects in `test.projects`, none of them wrapped, keeps no cases in the record and leaves the cases of an earlier run and their layers as they were — needs a Vitest 4 fixture with `test.projects`');
