import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { commitRunsFile, landRun, readCommitRuns, type TestCoverage } from '@variance-authority/sense/test-selection';
import { git, laidWorktree, LOCAL, publishedNext, ranAlone, refetch } from './milestone-pin.fixture.js';
import { suiteBase } from './suite-base.js';

/**
 * Where the runs record stands a checkout's tests once its milestone moves to
 * a newer snapshot: the ledger says which tests are the checkout's, and the
 * runs record where each of them stands and which runs ran it in part.
 */

let home: string;

beforeEach(async () => {
  // Real, because git records a worktree's primary checkout by its real path.
  home = await realpath(await mkdtemp(join(tmpdir(), 'variance-milestone-repin-')));
});

afterEach(async () => {
  delete process.env['VARIANCE_AUTHORITY_CACHE'];
  await rm(home, { recursive: true, force: true });
});

/** A run of `other` at `commit` that a filter cut to some of its cases. */
function inPart(commit: string): TestCoverage {
  return { ...ranAlone(commit, 'test/other.test.ts'), tests: [{ file: 'test/other.test.ts', complete: false, preconditions: [] }] };
}

describe('the runs record under a repinned checkout', () => {
  it('keeps the runs that ran a test file in part beside the place the file stood at, which it leaves where it was', async () => {
    const { ci, first, worktree, own } = await laidWorktree(home);
    const next = await publishedNext(home, ci);
    await git(worktree, 'fetch', '--quiet', 'origin');
    await git(worktree, 'checkout', '--quiet', '--detach', next);
    // A filter matched some of `other`'s cases, twice: its others ran where it stood, at the old milestone.
    await landRun(own, inPart(next), worktree);
    await git(worktree, 'commit', '--quiet', '--allow-empty', '-m', 'later');
    const later = await git(worktree, 'rev-parse', 'HEAD');
    await landRun(own, ranAlone(later, 'test/total.test.ts'), worktree);
    await landRun(own, inPart(later), worktree);
    const held = (await readCommitRuns(own))!;
    expect(held.standing!.map((stand) => [stand.commit, stand.files, stand.partly])).toEqual([[first, ['test/other.test.ts'], undefined], [next, [], ['test/other.test.ts']]]);
    expect(held.landings.map((landing) => [landing.files, landing.partly])).toEqual([[['test/total.test.ts'], undefined], [[], ['test/other.test.ts']]]);
    await refetch(home, worktree, next);

    expect(await suiteBase(worktree, { env: LOCAL })).toMatchObject({ repin: { repinned: true, to: next, kept: ['test/other.test.ts', 'test/total.test.ts'] } });

    expect(await readCommitRuns(own)).toEqual({ commit: later, over: next, latest: held.latest, runs: held.runs, standing: held.standing, landings: held.landings });
  });

  it('drops a run that ran a test file in part when the file moves to the newer snapshot', async () => {
    const { ci, first, worktree, own } = await laidWorktree(home);
    await landRun(own, inPart(first), worktree);
    expect((await readCommitRuns(own))!.landings.map((landing) => landing.partly)).toEqual([['test/other.test.ts']]);
    const next = await publishedNext(home, ci);
    await git(worktree, 'fetch', '--quiet', 'origin');
    await git(worktree, 'checkout', '--quiet', '--detach', next);
    await refetch(home, worktree, next);

    expect(await suiteBase(worktree, { env: LOCAL })).toMatchObject({ repin: { repinned: true, kept: [], dropped: ['test/other.test.ts'] } });

    const runs = await readCommitRuns(own);
    expect(runs).toMatchObject({ over: next, landings: [] });
    expect(runs!.standing).toEqual([{ commit: next, files: ['test/other.test.ts', 'test/total.test.ts'], first: '2026-01-01T00:00:00.000Z', latest: '2026-01-01T00:00:00.000Z', runs: 1 }]);
  });

  it('writes no runs record for a record that holds none, which does not say where its tests stand', async () => {
    const { ci, worktree, own } = await laidWorktree(home);
    const next = await publishedNext(home, ci);
    await git(worktree, 'fetch', '--quiet', 'origin');
    await git(worktree, 'checkout', '--quiet', '--detach', next);
    await landRun(own, ranAlone(next, 'test/total.test.ts'), worktree);
    await rm(commitRunsFile(own));
    await refetch(home, worktree, next);

    expect(await suiteBase(worktree, { env: LOCAL })).toMatchObject({ repin: { repinned: true, to: next, kept: ['test/total.test.ts'] } });

    expect(await readCommitRuns(own)).toBeUndefined();
  });
  it('stands a kept test the runs record places nowhere where its runs started, assumed', async () => {
    const { ci, first, worktree, own } = await laidWorktree(home);
    const next = await publishedNext(home, ci);
    await git(worktree, 'fetch', '--quiet', 'origin');
    await git(worktree, 'checkout', '--quiet', '--detach', next);
    // A run over a snapshot whose runs record names another commit says where it started, not where its tests stand.
    const runs = commitRunsFile(own);
    await writeFile(runs, JSON.stringify({ ...JSON.parse(await readFile(runs, 'utf8')), commit: 'f'.repeat(40) }));
    await landRun(own, inPart(next), worktree);
    const held = (await readCommitRuns(own))!;
    expect([held.commit, held.over, held.standing]).toEqual([next, first, undefined]);
    await refetch(home, worktree, next);

    expect(await suiteBase(worktree, { env: LOCAL })).toMatchObject({ repin: { repinned: true, to: next, kept: ['test/other.test.ts'] } });

    expect((await readCommitRuns(own))!.standing!.map((stand) => [stand.commit, stand.files, stand.assumed])).toEqual([
      [next, ['test/total.test.ts'], undefined],
      [first, ['test/other.test.ts'], true],
    ]);
  });

  it('says nothing of where its tests stand when the runs record places a kept test nowhere and names no start', async () => {
    const { ci, worktree, own } = await laidWorktree(home);
    const next = await publishedNext(home, ci);
    await git(worktree, 'fetch', '--quiet', 'origin');
    await git(worktree, 'checkout', '--quiet', '--detach', next);
    await landRun(own, inPart(next), worktree);
    const runs = commitRunsFile(own);
    const { over: _over, standing: _standing, ...held } = JSON.parse(await readFile(runs, 'utf8')) as Record<string, unknown>;
    await writeFile(runs, JSON.stringify(held));
    await refetch(home, worktree, next);

    expect(await suiteBase(worktree, { env: LOCAL })).toMatchObject({ repin: { repinned: true, to: next, kept: ['test/other.test.ts'] } });

    const repinned = (await readCommitRuns(own))!;
    expect([repinned.commit, repinned.over, repinned.standing]).toEqual([next, next, undefined]);
  });
});
