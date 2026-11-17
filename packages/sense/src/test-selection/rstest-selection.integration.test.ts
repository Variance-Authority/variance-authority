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
const fixture = resolve(repository, 'packages/sense/test/fixtures/external-rstest');
// Recorded names are relative to the checkout, and the fixture sits inside it.
const at = (path: string): string => `${relative(repository, fixture)}/${path}`;
const rstest = resolve(repository, 'node_modules/@rstest/core/bin/rstest.js');

let directory: string;
beforeAll(async () => {
  directory = await mkdtemp(resolve(tmpdir(), 'variance-authority-rstest-selected-'));
});
afterAll(async () => {
  await rm(directory, { recursive: true, force: true });
});

/** One run of the fixture's two test files, with `env`: what it said on stderr and which test files it recorded. */
async function run(name: string, env: Record<string, string>, config = 'rstest.selected.config.mjs') {
  const coverageFile = resolve(directory, `${name}.bin`);
  // A selection the run of this test was handed is not the fixture's.
  const { VARIANCE_AUTHORITY_SINCE: _since, VARIANCE_AUTHORITY_AT_DISTANCE: _distance, VARIANCE_AUTHORITY_GRAIN: _grain, ...inherited } = process.env;
  const { stderr } = await execute(process.execPath, [rstest, 'run', '-c', resolve(fixture, config)], {
    cwd: fixture,
    env: { ...inherited, VARIANCE_AUTHORITY_COVERAGE: coverageFile, VARIANCE_AUTHORITY_CACHE: resolve(directory, name), ...env },
  });
  const ran = existsSync(coverageFile)
    ? decodeTestCoverage(await readFile(coverageFile)).tests.map((test) => test.file).sort()
    : [];
  return { stderr, ran };
}

describe('an Rstest run handed a selection', () => {
  it('runs what the selection kept, and counts it against what Rstest found', async () => {
    const { stderr, ran } = await run('kept', { FIXTURE_SKIP: JSON.stringify([at('test/beta.case.ts')]) });

    expect(ran).toEqual([at('test/alpha.case.ts')]);
    expect(stderr).toContain('variance-authority: selected 1 of 2');
  });

  it.each([['<rootDir>/test/*.case.ts'], ['./test/*.case.ts'], ['**/test/*.case.ts']])(
    'counts the files Rstest finds by an `include` of %s',
    async (include) => {
      const { stderr, ran } = await run(`include-${include.replace(/\W/g, '')}`, {
        FIXTURE_INCLUDE: include,
        FIXTURE_SKIP: JSON.stringify([at('test/beta.case.ts')]),
      });

      expect(ran).toEqual([at('test/alpha.case.ts')]);
      expect(stderr).toContain('variance-authority: selected 1 of 2');
    },
  );

  it('runs nothing and passes when the selection skips every file', async () => {
    const { stderr, ran } = await run('none', {
      FIXTURE_SKIP: JSON.stringify([at('test/alpha.case.ts'), at('test/beta.case.ts')]),
    });

    expect(ran).toEqual([]);
    expect(stderr).toContain('variance-authority: selected none of 2, so none of them runs');
  });

  it('selects in each project of a `projects` configuration, and says so for each', async () => {
    const { stderr, ran } = await run('projects', { FIXTURE_SKIP: JSON.stringify([at('test/beta.case.ts')]) }, 'rstest.projects.config.mjs');

    expect(ran).toEqual([at('test/alpha.case.ts')]);
    expect(stderr.split('variance-authority: selected 1 of 2')).toHaveLength(3);
  });

  it('runs nothing and passes when the selection skips every file of every project', async () => {
    const { ran } = await run(
      'projects-none',
      { FIXTURE_SKIP: JSON.stringify([at('test/alpha.case.ts'), at('test/beta.case.ts')]) },
      'rstest.projects.config.mjs',
    );

    expect(ran).toEqual([]);
  });

  it('refuses `VARIANCE_AUTHORITY_GRAIN=case`, which it cannot keep, rather than running whole files', async () => {
    const refused = run('grain', { VARIANCE_AUTHORITY_SINCE: 'HEAD', VARIANCE_AUTHORITY_GRAIN: 'case' });

    await expect(refused).rejects.toMatchObject({
      stderr: expect.stringContaining('VARIANCE_AUTHORITY_GRAIN=case'),
    });
  });
});
