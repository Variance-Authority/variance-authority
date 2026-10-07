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
const fixture = resolve(repository, 'packages/sense/test/fixtures/projects-vitest');
const at = (path: string): string => `${relative(repository, fixture)}/${path}`;
const vitest = resolve(repository, 'node_modules/vitest/vitest.mjs');

let directory: string;
beforeAll(async () => {
  directory = await mkdtemp(resolve(tmpdir(), 'variance-authority-selected-'));
});
afterAll(async () => {
  await rm(directory, { recursive: true, force: true });
});

/** One run of the two-project fixture, handed `skip`: what it said on stderr and which test files it recorded. */
async function run(name: string, skip: readonly string[], ...args: string[]) {
  const coverageFile = resolve(directory, `${name}.bin`);
  const { stderr } = await execute(process.execPath, [vitest, 'run', '--config', 'vitest.config.ts', ...args], {
    cwd: fixture,
    env: environment(name, { FIXTURE_SKIP: JSON.stringify(skip) }),
  });
  const ran = existsSync(coverageFile)
    ? decodeTestCoverage(await readFile(coverageFile)).tests.map((test) => test.file).sort()
    : [];
  return { stderr, ran };
}

function environment(name: string, fixture: Record<string, string>): NodeJS.ProcessEnv {
  return {
    ...process.env,
    VARIANCE_AUTHORITY_COVERAGE: resolve(directory, `${name}.bin`),
    VARIANCE_AUTHORITY_CACHE: resolve(directory, name),
    ...fixture,
  };
}

describe('a Vitest run over two projects, handed a selection', () => {
  it('runs what the selection kept, and counts it against what Vitest found', async () => {
    const { stderr, ran } = await run('kept', [at('unit/unit.case.ts')]);

    expect(ran).toEqual([at('dom/dom.case.ts')]);
    expect(stderr).toContain('variance-authority: selected 1 of 2');
  }, 30_000);

  it('splits what the selection kept across shards, never what it skipped', async () => {
    const first = await run('first', [at('unit/unit.case.ts')], '--shard', '1/2');
    const second = await run('second', [at('unit/unit.case.ts')], '--shard', '2/2');

    expect([...first.ran, ...second.ran]).toEqual([at('dom/dom.case.ts')]);
  }, 30_000);

  it('runs nothing and passes when the selection skips every file', async () => {
    const { stderr, ran } = await run('none', [at('unit/unit.case.ts'), at('dom/dom.case.ts')]);

    expect(ran).toEqual([]);
    expect(stderr).toContain('variance-authority: selected none of 2');
  }, 30_000);

  it('fails the run, exiting 1, when the selection refuses the record it read', async () => {
    const refused = execute(process.execPath, [vitest, 'run', '--config', 'vitest.config.ts'], {
      cwd: fixture,
      env: environment('refused', { FIXTURE_REFUSE: 'the record at coverage.bin could not be read' }),
    });

    await expect(refused).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringContaining('the record at coverage.bin could not be read'),
    });
    expect(existsSync(resolve(directory, 'refused.bin'))).toBe(false);
  }, 30_000);
});
