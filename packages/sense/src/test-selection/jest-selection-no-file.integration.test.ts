import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { at, ended, FOUND, jest, jestSelection, UNFOUND } from './__fixtures__/jest-selection.js';

// How a selected Jest run ends when no file is left to run: because the
// selection dropped every file, or because Jest found none to select from.
const { run, runWith, runConfig, runProjects } = jestSelection();

describe('a Jest run with no file left to run', () => {
  const NOTHING = ['--testPathPatterns', 'no-such-case'];

  it('exits 0 when the selection dropped every file it found, and prints that none runs', async () => {
    const { code, stderr } = await ended(run('none', FOUND));

    expect(stderr).toContain('variance-authority: selected none of 5, so none of them runs');
    expect(code).toBe(0);
  });

  it('exits 0 when the selection dropped every file of every project', async () => {
    const skip = ['alpha', 'beta'].map((name) => at(`test/${name}.case.ts`));
    const { code, stderr } = await ended(runConfig('jest.projects.config.mjs', 'none-projects', { FIXTURE_SKIP: JSON.stringify(skip) }));

    expect(stderr).toContain('variance-authority: selected none of 1, so none of them runs');
    expect(code).toBe(0);
  });

  it('fails as Jest fails when a selected run found no file, because nothing was there to select from', async () => {
    const { code, stderr } = await ended(run('none-found', [], ...NOTHING));

    expect(stderr).toContain(UNFOUND);
    expect(code).toBe(1);
  });

  it('fails when a testMatch that matches nothing leaves the selection no file', async () => {
    const { code, stderr } = await ended(runWith('broken-match', { FIXTURE_SKIP: '[]', FIXTURE_TEST_MATCH: '<rootDir>/test/*.no-such-case.ts' }));

    expect(stderr).toContain(UNFOUND);
    expect(code).toBe(1);
  });

  it('fails on every shard when no shard found a file', async () => {
    expect((await ended(run('none-found-shard', [], ...NOTHING, '--shard=1/2'))).code).toBe(1);
  });

  it('fails a sharded run whose sequencer the command line replaced, as the seam says it does', async () => {
    const sequencer = createRequire(createRequire(jest).resolve('jest-cli')).resolve('@jest/test-sequencer');
    const { code, stderr } = await ended(run('none-found-replaced', [], ...NOTHING, '--shard=1/2', `--testSequencer=${sequencer}`));

    expect(stderr).toContain('so Jest fails both');
    expect(code).toBe(1);
  });

  it('fails when no project found a file', async () => {
    const { code, stderr } = await ended(runProjects('none-found-projects', [], ['alpha', 'beta']));

    expect(stderr).toContain(UNFOUND);
    expect(code).toBe(1);
  });

  it('exits 0 when one project found no file and the selection dropped every file of the other', async () => {
    const { code, stderr } = await ended(runProjects('one-found-none-kept', [at('test/alpha.case.ts')], ['beta']));

    expect(stderr).not.toContain(UNFOUND);
    expect(code).toBe(0);
  });

  it('runs a project that found files beside one that found none, as Jest does', async () => {
    const { code, ran } = await ended(runProjects('one-found-one-kept', [], ['beta']));

    expect(ran).toEqual([at('test/alpha.case.ts')]);
    expect(code).toBe(0);
  });

  it('passes a selected run that found no file when the configuration says such a run passes', async () => {
    expect((await ended(runWith('none-found-set', { FIXTURE_SKIP: '[]', FIXTURE_PASS_WITH_NO_TESTS: 'true' }, ...NOTHING))).code).toBe(0);
  });

  it('passes a selected run that found no file under --passWithNoTests', async () => {
    expect((await ended(run('none-found-flag', [], ...NOTHING, '--passWithNoTests'))).code).toBe(0);
  });

  it('lists no file and exits 0 under --listTests, as Jest does', async () => {
    expect((await ended(run('none-found-listed', [], ...NOTHING, '--listTests'))).code).toBe(0);
  });

  it('leaves the exit to Jest under --skipFilter, where nothing is selected', async () => {
    const { code, stderr } = await ended(run('none-found-unfiltered', [], ...NOTHING, '--skipFilter'));

    expect(stderr).not.toContain(UNFOUND);
    expect(code).toBe(1);
  });

  it('keeps Jest\'s exit 1 when no selection was handed in', async () => {
    expect((await ended(runWith('unselected', {}, ...NOTHING))).code).toBe(1);
  });

  it('keeps a passWithNoTests the configuration sets on a run with no selection', async () => {
    expect((await ended(runWith('set-true', { FIXTURE_PASS_WITH_NO_TESTS: 'true' }, ...NOTHING))).code).toBe(0);
  });
});
