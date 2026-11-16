import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const execute = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const repository = resolve(here, '../../../..');
const fixture = resolve(repository, 'packages/sense/test/fixtures/external-jest');
const jest = resolve(repository, 'node_modules/jest/bin/jest.js');
// The fixture's sources, every one of which the record holds: two a case requires,
// one a test file requires at its top, one its setup does.
const RECORDED = /\/src\/[^/]+\.ts$/;
const WARMED = 'variance-authority: transformed';
const LAZY = '<rootDir>/test/*.lazy.cjs';
const EAGER = '<rootDir>/test/*.eager.cjs';
const BOTH = '<rootDir>/test/*.{lazy,eager}.cjs';

let directory: string;
beforeAll(async () => {
  directory = await mkdtemp(resolve(tmpdir(), 'variance-authority-jest-prewarm-'));
});
afterAll(async () => {
  await rm(directory, { recursive: true, force: true });
});

/**
 * One run of the fixture's tests matching `match`, on a cache of its own,
 * recording to `record`: what it printed, which recorded files a case
 * transformed while it ran, and which a process that ran no test did.
 */
async function run(name: string, record: string, match: string, fixtureEnv: Record<string, string>) {
  const log = resolve(directory, `${name}.transforms`);
  await writeFile(log, '');
  const { stderr } = await execute(
    process.execPath,
    [jest, '--config', resolve(fixture, 'jest.config.mjs'), '--watchman=false', '--maxWorkers=2'],
    {
      cwd: fixture,
      env: {
        ...process.env,
        VARIANCE_AUTHORITY_COVERAGE: resolve(directory, record),
        VARIANCE_AUTHORITY_JEST_CACHE: resolve(directory, `${name}-jest-cache`),
        VARIANCE_AUTHORITY_CACHE: resolve(directory, name),
        FIXTURE_TEST_MATCH: match,
        FIXTURE_TRANSFORM_LOG: log,
        ...fixtureEnv,
      },
    },
  );
  const lines = (await readFile(log, 'utf8')).split('\n').filter(Boolean).map((line) => line.split(' '));
  const testing = new Set(lines.filter(([, mark]) => mark === 'begin').map(([pid]) => pid!));
  const casing = new Set<string>();
  const inCases: string[] = [];
  const outsideTests: string[] = [];
  for (const [pid, mark, path] of lines) {
    if (mark === 'begin') casing.add(pid!);
    else if (mark === 'end') casing.delete(pid!);
    else if (RECORDED.test(path!)) {
      const source = path!.replace(/^.*\/src\//, 'src/');
      if (casing.has(pid!)) inCases.push(source);
      else if (!testing.has(pid!)) outsideTests.push(source);
    }
  }
  const sorted = (paths: string[]) => [...new Set(paths)].sort();
  return { stderr, inCases: sorted(inCases), outsideTests: sorted(outsideTests) };
}

describe('a selected Jest run', () => {
  beforeAll(async () => {
    await run('recorded', 'both.bin', BOTH, {});
  });

  it('transforms what its tests require inside a case before the workers start, so no case transforms one', async () => {
    const { stderr, inCases, outsideTests } = await run('lazy', 'both.bin', LAZY, { FIXTURE_SKIP: '[]' });

    expect(inCases).toEqual([]);
    expect(outsideTests).toEqual(['src/later.ts', 'src/sooner.ts']);
    expect(stderr).toContain(`${WARMED} 2 files`);
  });

  it('leaves to the test what a test file requires before its first case', async () => {
    const { stderr, inCases, outsideTests } = await run('mixed', 'both.bin', BOTH, { FIXTURE_SKIP: '[]' });

    expect(inCases).toEqual([]);
    expect(outsideTests).toEqual(['src/later.ts', 'src/sooner.ts']);
    expect(stderr).toContain(`${WARMED} 2 files`);
  });

  it('starts no warm-up when its tests require everything before their first case', async () => {
    const { stderr, outsideTests } = await run('eager', 'both.bin', EAGER, { FIXTURE_SKIP: '[]' });

    expect(stderr).not.toContain(WARMED);
    expect(outsideTests).toEqual([]);
  });
});

describe('a Jest run whose tests require lazily', () => {
  it('transforms in the cases, as Jest does, when no selection was asked', async () => {
    const { stderr, inCases } = await run('unselected', 'unselected.bin', LAZY, {});

    expect(stderr).not.toContain(WARMED);
    expect(inCases).toEqual(['src/later.ts', 'src/sooner.ts']);
  });

  it('transforms in the cases, as Jest does, when the selection has no record to read', async () => {
    const { stderr, inCases } = await run('unrecorded', 'missing.bin', LAZY, { FIXTURE_SKIP: '[]' });

    expect(stderr).not.toContain(WARMED);
    expect(inCases).toEqual(['src/later.ts', 'src/sooner.ts']);
  });
});
