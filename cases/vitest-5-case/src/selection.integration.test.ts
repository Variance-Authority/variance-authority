import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import {
  caseIndexOf,
  coveringTests,
  decodeExecutionIndex,
  decodeTestCoverage,
} from '@variance-authority/sense/test-selection';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const execute = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const repository = resolve(here, '../../..');
const fixture = resolve(here, '../fixture');
const at = (path: string): string => `${relative(repository, fixture)}/${path}`;
// The Vitest this case installs, not the repository's own: the run under test is Vitest 5's.
const vitest = resolve(here, '../node_modules/vitest/vitest.mjs');

let directory: string;
beforeAll(async () => {
  directory = await mkdtemp(resolve(tmpdir(), 'variance-authority-vitest-5-'));
});
afterAll(async () => {
  await rm(directory, { recursive: true, force: true });
});

/** One run of the fixture under Vitest 5, handed `skip`: how it exited, what it said, and where it recorded. */
async function run(name: string, skip?: readonly string[]) {
  const coverageFile = resolve(directory, `${name}.bin`);
  // A selection the run of this test was handed is not the fixture's.
  const { VARIANCE_AUTHORITY_SINCE: _since, VARIANCE_AUTHORITY_AT_DISTANCE: _distance, FIXTURE_SKIP: _skip, ...inherited } = process.env;
  const finished = await execute(process.execPath, [vitest, 'run'], {
    cwd: fixture,
    env: {
      ...inherited,
      VARIANCE_AUTHORITY_COVERAGE: coverageFile,
      VARIANCE_AUTHORITY_CACHE: resolve(directory, name),
      ...(skip === undefined ? {} : { FIXTURE_SKIP: JSON.stringify(skip) }),
    },
  }).then(
    ({ stdout, stderr }) => ({ code: 0, output: `${stdout}${stderr}` }),
    (error: { code?: number; stdout?: string; stderr?: string }) => ({
      code: error.code,
      output: `${error.stdout ?? ''}${error.stderr ?? ''}`,
    }),
  );
  return { ...finished, coverageFile };
}

describe('a Vitest 5 run that shares a module graph and runs its cases concurrently', () => {
  it('records every file it ran', async () => {
    const { code, output, coverageFile } = await run('whole');

    expect(output).not.toContain('@vitest/runner');
    expect(code, output).toBe(0);
    const coverage = decodeTestCoverage(await readFile(coverageFile));
    expect(coverage.tests.map((test) => [test.file, test.complete]).sort()).toEqual([
      [at('one.case.ts'), true],
      [at('two.case.ts'), true],
    ]);
  }, 60_000);

  it('names the case that walked each branch, across the awaits concurrent cases interleave on', async () => {
    const { code, output, coverageFile } = await run('cases');
    expect(code, output).toBe(0);
    const stored = await caseIndexOf(coverageFile);
    if (stored === undefined) throw new Error('the run wrote no execution index');
    const index = decodeExecutionIndex(stored);
    const named = (line: number): readonly string[] =>
      coveringTests(index, { file: at('add.ts'), line }).map((test) => `${test.file}: ${test.name}`).sort();

    // Both cases of `one.case.ts` are in flight at once and resume inside
    // `add` while the other is open; each branch still names the case that
    // took it.
    expect(named(4)).toEqual([`${at('one.case.ts')}: add > adds one`]);
    expect(named(7)).toEqual([`${at('one.case.ts')}: add > adds more`, `${at('two.case.ts')}: adds two`]);
  }, 60_000);

  it('runs what the selection kept', async () => {
    const { code, output, coverageFile } = await run('kept', [at('two.case.ts')]);

    expect(code, output).toBe(0);
    const ran = existsSync(coverageFile)
      ? decodeTestCoverage(await readFile(coverageFile)).tests.map((test) => test.file)
      : [];
    expect(ran).toEqual([at('one.case.ts')]);
  }, 60_000);
});
