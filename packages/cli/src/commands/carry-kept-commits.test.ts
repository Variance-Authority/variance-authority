import { existsSync } from 'node:fs';
import { readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { OperatorError } from '../exit.js';
import { testCoverageFile } from '@variance-authority/sense/test-selection';
import { BUNDLE } from './carry-bundle.js';
import { keepPushed, movePushed, takePushed } from './carry-pushed.js';
import { carry, commitIn, git, pullRequest, runsAt, streams } from './carry-pushed.fixture.js';

/**
 * The commits a kept record names that no remote holds, kept beside it, and a
 * take a run's other jobs repeat over the directory the first take handed on.
 *
 * A workflow that merges a pull request's head with the commit the mainline's
 * record was made at, as `carry merge` does, runs on a merge no remote holds,
 * and the record it keeps names that merge. `keep` writes it beside the
 * records, and `take` reads it from there before asking the remote for the
 * rest, so the next push stands on what this one ran.
 */

/** A pull request's earlier push in its own clone, run on a merge of a head with the mainline's commit that no remote holds. */
async function mergedPush(): Promise<{ clone: string; earlier: string; kept: string; merge: string; head: string }> {
  const { clone, kept } = await pullRequest();
  const earlier = join(dirname(clone), 'earlier');
  git(dirname(clone), 'clone', '-q', '--no-local', join(dirname(clone), 'upstream'), earlier);
  const head = await commitIn(earlier, 'c.ts', 'c\n');
  git(earlier, 'checkout', '-q', '--detach', kept);
  git(earlier, '-c', 'user.name=t', '-c', 'user.email=t@t', 'merge', '-q', '--no-ff', '--no-edit', head);
  return { clone, earlier, kept, merge: git(earlier, 'rev-parse', 'HEAD'), head };
}

/** Lay `runs` in `clone` as the suite's own record, as a run leaves it. */
async function recorded(clone: string, suite: string, runs: object): Promise<void> {
  const at = join(clone, '.recorded');
  await carry(at, suite, runs);
  const own = dirname(testCoverageFile(clone, { suite }));
  const { cp } = await import('node:fs/promises');
  await cp(join(at, suite), own, { recursive: true });
}

const MAINLINE = 'refs/remotes/origin/main';

describe('a merge no remote holds travels beside the records', () => {
  it('is kept by `keep` and laid by `take` in a clone that never saw it', async () => {
    const { clone, earlier, kept, merge, head } = await mergedPush();
    await recorded(earlier, 'unit', runsAt(merge, [kept]));
    const pushed = join(earlier, '.pushed');

    expect(await keepPushed(earlier, pushed, MAINLINE)).toEqual({ kept: ['unit'], bundled: [merge] });
    expect(git(earlier, 'for-each-ref', 'refs/carried/')).toBe('');
    expect(() => git(clone, 'cat-file', '-e', `${merge}^{commit}`)).toThrow();
    git(clone, 'remote', 'set-url', 'origin', join(dirname(clone), 'nowhere'));

    expect(await takePushed(clone, pushed)).toEqual({ taken: ['unit'], left: [] });
    expect(git(clone, 'rev-parse', `${merge}^2`)).toBe(head);
    expect(git(clone, 'for-each-ref', 'refs/carried/')).toBe('');
  });

  it('keeps the commits the clone holds, and not the ones it lacks', async () => {
    const { earlier, kept, merge } = await mergedPush();
    const lost = 'f'.repeat(40);
    await recorded(earlier, 'unit', runsAt(kept, [merge, lost]));

    expect(await keepPushed(earlier, join(earlier, '.pushed'), MAINLINE)).toEqual({ kept: ['unit'], bundled: [merge] });
  });

  it('keeps no commit when every one the records name is on the mainline', async () => {
    const { earlier, kept } = await mergedPush();
    await recorded(earlier, 'unit', runsAt(kept));
    const pushed = join(earlier, '.pushed');

    expect(await keepPushed(earlier, pushed, MAINLINE)).toEqual({ kept: ['unit'], bundled: [] });
    expect(existsSync(join(pushed, BUNDLE))).toBe(false);
  });

  it('keeps no commit, and says so, when no mainline is named or the clone lacks it', async () => {
    const { earlier, merge } = await mergedPush();
    await recorded(earlier, 'unit', runsAt(merge));
    const pushed = join(earlier, '.pushed');

    const nameless = await keepPushed(earlier, pushed, undefined);
    const lacking = await keepPushed(earlier, pushed, 'refs/remotes/origin/nowhere');

    expect(nameless).toEqual({ kept: ['unit'], bundled: [], unbundled: 'no mainline is named, so nothing marks which commits every clone holds' });
    expect(lacking).toEqual({ kept: ['unit'], bundled: [], unbundled: 'this clone has no refs/remotes/origin/nowhere, the mainline every clone holds' });
    expect(existsSync(join(pushed, BUNDLE))).toBe(false);
  });

  it('keeps what the mainline lacks when named by its branch, and says what it kept', async () => {
    const { earlier, kept, merge } = await mergedPush();
    await recorded(earlier, 'unit', runsAt(merge, [kept]));
    const pushed = join(earlier, '.pushed');
    const { said, streams: to } = streams();

    await movePushed({ command: 'carry', direction: 'keep', dir: pushed, format: 'github' }, earlier, to, 'main');

    expect(said.out).toBe('kept=unit\n');
    expect(said.err).toBe(`kept unit in ${pushed}.\n1 commit no remote holds is kept in ${join(pushed, BUNDLE)}.\n`);
  });

  it('says the kept commits did not read, and leaves the suite that stands on them', async () => {
    const { clone, merge } = await mergedPush();
    const carried = join(clone, '.carried');
    await carry(carried, 'unit', runsAt(merge));
    await writeFile(join(carried, BUNDLE), 'not a bundle');

    const taken = await takePushed(clone, carried);

    expect(taken.left).toEqual([{ suite: 'unit', missing: [merge] }]);
    expect(taken.unbundled).toMatch(/commits\.bundle/u);
  });
});

describe('a run of several jobs takes one push', () => {
  it('hands on only the suites it took, with the commits they stand on', async () => {
    const { clone, earlier, kept, merge } = await mergedPush();
    await recorded(earlier, 'unit', runsAt(merge));
    await recorded(earlier, 'chromium', runsAt(kept, ['f'.repeat(40)]));
    const pushed = join(earlier, '.pushed');
    await keepPushed(earlier, pushed, MAINLINE);

    expect(await takePushed(clone, pushed)).toMatchObject({ taken: ['unit'], left: [{ suite: 'chromium' }] });
    expect((await readdir(pushed)).sort()).toEqual([BUNDLE, 'taken.json', 'unit']);
  });

  it('stops a later take that leaves a suite the first one took, and names it', async () => {
    const { clone, earlier, merge } = await mergedPush();
    await recorded(earlier, 'unit', runsAt(merge));
    const pushed = join(earlier, '.pushed');
    await keepPushed(earlier, pushed, MAINLINE);
    await takePushed(clone, pushed);

    const later = join(dirname(clone), 'later');
    git(dirname(clone), 'clone', '-q', '--no-local', join(dirname(clone), 'upstream'), later);
    await writeFile(join(pushed, BUNDLE), 'not a bundle');

    const stopped = takePushed(later, pushed);
    await expect(stopped).rejects.toBeInstanceOf(OperatorError);
    await expect(takePushed(later, pushed)).rejects.toThrow(/an earlier take of this run took unit/u);
  });

  it('stops a later take over a directory that lost a suite the first one took', async () => {
    const { clone, earlier, merge } = await mergedPush();
    await recorded(earlier, 'unit', runsAt(merge));
    const pushed = join(earlier, '.pushed');
    await keepPushed(earlier, pushed, MAINLINE);
    await takePushed(clone, pushed);
    await rm(join(pushed, 'unit'), { recursive: true });

    await expect(takePushed(clone, pushed)).rejects.toThrow(/an earlier take of this run took unit/u);
  });

  it('lets a later take that takes what the first one took go on', async () => {
    const { clone, earlier, merge } = await mergedPush();
    await recorded(earlier, 'unit', runsAt(merge));
    const pushed = join(earlier, '.pushed');
    await keepPushed(earlier, pushed, MAINLINE);
    await takePushed(clone, pushed);

    const later = join(dirname(clone), 'later');
    git(dirname(clone), 'clone', '-q', '--no-local', join(dirname(clone), 'upstream'), later);

    expect(await takePushed(later, pushed)).toEqual({ taken: ['unit'], left: [] });
  });
});

describe("`carry take` is the next push's first step", () => {
  it('takes a push kept with nothing beyond the mainline, with no bundle, no remote and no fetch', async () => {
    const { clone, earlier, kept } = await mergedPush();
    await recorded(earlier, 'unit', runsAt(kept));
    const pushed = join(earlier, '.pushed');
    await movePushed({ command: 'carry', direction: 'keep', dir: pushed, format: 'github' }, earlier, streams().streams, 'main');
    git(clone, 'remote', 'set-url', 'origin', join(dirname(clone), 'nowhere'));
    expect(existsSync(join(pushed, BUNDLE))).toBe(false);
    const { said, streams: to } = streams();

    await movePushed({ command: 'carry', direction: 'take', dir: pushed, format: 'github' }, clone, to);

    expect(said.out).toBe('taken=unit\nleft=\n');
    expect(existsSync(testCoverageFile(clone, { suite: 'unit' }))).toBe(true);
    expect(existsSync(join(clone, '.git', 'FETCH_HEAD'))).toBe(false);
  });
});
