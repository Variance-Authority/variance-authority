import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { decodeTestCoverage } from '@variance-authority/sense/test-selection';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const execute = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const repository = resolve(here, '../../..');
const fixture = resolve(here, '../fixture');
const at = (path: string): string => `${relative(repository, fixture)}/${path}`;
// The Vitest this case installs, not the repository's own: the run under test is Vitest 4's.
const vitest = resolve(here, '../node_modules/vitest/vitest.mjs');

let directory: string;
beforeAll(async () => {
  directory = await mkdtemp(resolve(tmpdir(), 'variance-authority-vitest-4-'));
});
afterAll(async () => {
  await rm(directory, { recursive: true, force: true });
});

/** One run of the fixture under Vitest 4, handed `skip`: how it exited, what it said on stderr, and which test files it recorded. */
async function run(name: string, skip: readonly string[], ...args: string[]) {
  const coverageFile = resolve(directory, `${name}.bin`);
  // A selection the run of this test was handed is not the fixture's.
  const { VARIANCE_AUTHORITY_SINCE: _since, VARIANCE_AUTHORITY_AT_DISTANCE: _distance, ...inherited } = process.env;
  const finished = await execute(process.execPath, [vitest, 'run', ...args], {
    cwd: fixture,
    env: {
      ...inherited,
      VARIANCE_AUTHORITY_COVERAGE: coverageFile,
      VARIANCE_AUTHORITY_CACHE: resolve(directory, name),
      FIXTURE_SKIP: JSON.stringify(skip),
    },
  }).then(
    ({ stderr }) => ({ code: 0, stderr }),
    (error: { code?: number; stderr?: string }) => ({ code: error.code, stderr: error.stderr ?? '' }),
  );
  const ran = existsSync(coverageFile)
    ? decodeTestCoverage(await readFile(coverageFile)).tests.map((test) => test.file).sort()
    : [];
  return { ...finished, ran };
}

describe('a Vitest 4 run handed a selection', () => {
  it('passes, running nothing, when the selection skips every file', async () => {
    const { code, stderr, ran } = await run('none', [at('one.case.ts'), at('two.case.ts')]);

    expect(stderr).toContain('variance-authority: selected none of 2');
    expect(code).toBe(0);
    expect(ran).toEqual([]);
  }, 60_000);

  it('passes the shard the selection left nothing to run', async () => {
    const { code, stderr } = await run('shard', [at('two.case.ts')], '--shard', '2/2');

    expect(stderr).toContain('variance-authority: selected 1 of 2');
    expect(code).toBe(0);
  }, 60_000);

  it('runs what the selection kept', async () => {
    const { code, ran } = await run('kept', [at('two.case.ts')]);

    expect(code).toBe(0);
    expect(ran).toEqual([at('one.case.ts')]);
  }, 60_000);
});

describe('a Vitest 4 run under --shard', () => {
  it('passes a shard left no file, because there are fewer files than shards', async () => {
    const { code, stderr } = await run('more-shards', [], '--shard', '3/3');

    expect(stderr).toContain('variance-authority: shard 3/3 by file count: 0 of 2 files');
    expect(code).toBe(0);
  }, 60_000);
});
