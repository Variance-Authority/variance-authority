import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
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
const fixture = resolve(repository, 'packages/sense/test/fixtures/external-jest');
const at = (path: string): string => `${relative(repository, fixture)}/${path}`;
const jest = resolve(repository, 'node_modules/jest/bin/jest.js');
const FOUND = ['alpha', 'beta', 'delta', 'each', 'gamma'].map((name) => at(`test/${name}.case.ts`));

let directory: string;
beforeAll(async () => {
  directory = await mkdtemp(resolve(tmpdir(), 'variance-authority-jest-selected-'));
});
afterAll(async () => {
  await rm(directory, { recursive: true, force: true });
});

/** One run of the Jest fixture, handed `skip`: what it printed and which test files it recorded. */
async function run(name: string, skip: readonly string[], ...args: string[]) {
  const coverageFile = resolve(directory, `${name}.bin`);
  const { stdout, stderr } = await execute(
    process.execPath,
    [jest, '--config', resolve(fixture, 'jest.config.mjs'), '--watchman=false', ...args],
    {
      cwd: fixture,
      env: {
        ...process.env,
        VARIANCE_AUTHORITY_COVERAGE: coverageFile,
        VARIANCE_AUTHORITY_JEST_CACHE: resolve(directory, 'jest-cache'),
        VARIANCE_AUTHORITY_CACHE: resolve(directory, name),
        FIXTURE_SKIP: JSON.stringify(skip),
      },
    },
  );
  const ran = existsSync(coverageFile)
    ? [...new Set(decodeTestCoverage(await readFile(coverageFile)).tests.map((test) => test.file))].sort()
    : [];
  return { stdout, stderr, ran };
}

describe('a Jest run handed a selection', () => {
  it('runs what the selection kept, and counts it against what Jest found', async () => {
    const { stderr, ran } = await run('kept', [at('test/alpha.case.ts'), at('test/gamma.case.ts')]);

    expect(ran).toEqual(FOUND.filter((file) => !/alpha|gamma/.test(file)));
    expect(stderr).toContain('variance-authority: selected 3 of 5');
  }, 60_000);

  it('splits what the selection kept across shards, never what it skipped', async () => {
    const skip = [at('test/alpha.case.ts'), at('test/gamma.case.ts')];
    const first = await run('first', skip, '--shard', '1/2');
    const second = await run('second', skip, '--shard', '2/2');

    expect([...first.ran, ...second.ran].sort()).toEqual(FOUND.filter((file) => !/alpha|gamma/.test(file)));
  }, 60_000);

  it('lists only what the selection kept', async () => {
    const { stdout } = await run('listed', [at('test/alpha.case.ts')], '--listTests');

    expect(stdout).not.toContain('alpha.case.ts');
    expect(stdout).toContain('beta.case.ts');
  }, 60_000);
});
