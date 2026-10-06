import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkoutRead } from './commands/checkout-read.js';
import type { Config } from './config.js';
import { distanceFrom, headPast, readerMainline } from './share-lines.js';

/**
 * A distance read in a shallow clone. Git walks what the clone holds as if it
 * were the whole history, so a count whose walk reaches the cut stops there,
 * prints a smaller number and exits 0. Every count a reader prints is asked
 * here twice: in a full clone, where it is git's own, and in a clone that holds
 * the record but not all of the history between it and `HEAD`, where it is
 * refused rather than printed short.
 */

let made: string[] = [];
afterEach(async () => {
  await Promise.all(made.map((at) => rm(at, { recursive: true, force: true })));
  made = [];
});

const git = (at: string, ...args: string[]): string =>
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...args], {
    cwd: at,
    stdio: 'pipe',
    encoding: 'utf8',
  }).trim();

const commits = (at: string, prefix: string, n: number): void => {
  for (let i = 1; i <= n; i += 1) git(at, 'commit', '-q', '--allow-empty', '-m', `${prefix}${String(i)}`);
};

const config = { share: { kind: 'directory', root: '/nowhere', mainlines: ['main'] } } as unknown as Pick<Config, 'share'>;

/**
 * `main`: r0, the record, four commits, then a merge of `side`, eight commits
 * off r0. `feature` is `main` with a merge of `topic`, eight more off r0. A
 * clone of `feature` seven deep holds the record and cuts both side branches.
 */
async function history(depth?: number): Promise<{ clone: string; record: string }> {
  const origin = await mkdtemp(join(tmpdir(), 'variance-clone-cut-'));
  const clone = await mkdtemp(join(tmpdir(), 'variance-clone-cut-clone-'));
  made.push(origin, clone);
  git(origin, 'init', '-q', '-b', 'main');
  git(origin, 'commit', '-q', '--allow-empty', '-m', 'r0');
  const r0 = git(origin, 'rev-parse', 'HEAD');
  git(origin, 'commit', '-q', '--allow-empty', '-m', 'record');
  const record = git(origin, 'rev-parse', 'HEAD');
  commits(origin, 'r', 4);
  git(origin, 'checkout', '-q', '-b', 'side', r0);
  commits(origin, 's', 8);
  git(origin, 'checkout', '-q', 'main');
  git(origin, 'merge', '-q', '--no-ff', 'side', '-m', 'side');
  git(origin, 'checkout', '-q', '-b', 'topic', r0);
  commits(origin, 't', 8);
  git(origin, 'checkout', '-q', '-b', 'feature', 'main');
  git(origin, 'merge', '-q', '--no-ff', 'topic', '-m', 'topic');
  const deep = depth === undefined ? [] : ['--depth', String(depth)];
  git(clone, 'clone', '-q', ...deep, '--no-single-branch', '--branch', 'feature', pathToFileURL(origin).href, '.');
  return { clone, record };
}

/** The note a checkout's own record gives, pinned on the record. */
const note = (clone: string, record: string): Promise<string> =>
  checkoutRead('unit', clone, { layer: { pinned: { mainline: 'main', commit: record }, ran: [] } });

describe('a distance in a clone that holds all of it', () => {
  it('is counted exactly', async () => {
    const { clone, record } = await history();
    // Past the record: four on main, eight on side, its merge; eight on topic, its merge.
    expect(await headPast(record, clone)).toBe(22);
    expect(await distanceFrom(config, 'main', record, clone)).toBe(13);
    expect(await readerMainline(config, {}, clone)).toEqual({ name: 'main', since: 9 });
    expect(await note(clone, record)).toContain('22 commit(s) before HEAD');
  });
});

describe('a distance in a shallow clone that holds the record', () => {
  it('is one this clone cannot count when the walk to it reaches the cut', async () => {
    const { clone, record } = await history(7);
    expect(git(clone, 'cat-file', '-t', record)).toBe('commit');
    expect(git(clone, 'merge-base', '--is-ancestor', record, 'HEAD')).toBe('');
    // Git still answers, short, and says nothing of the cut.
    expect(Number(git(clone, 'rev-list', '--count', `${record}..HEAD`))).toBeLessThan(22);

    expect.soft(await headPast(record, clone)).toBeUndefined();
    expect.soft(await distanceFrom(config, 'main', record, clone)).toBeUndefined();
    expect.soft(await readerMainline(config, {}, clone)).toEqual({ name: 'main' });
    expect.soft(await note(clone, record)).toContain('at a distance this clone cannot count');
  });

  it('is counted exactly when the record is cut and a commit below its cut came in another way', async () => {
    // root → record, and root → side; merge = (record, side). A clone of the
    // record one deep, then a plain fetch of the merge: the record stays a cut
    // commit, and root arrives through side, so `record..merge` walks root.
    const origin = await mkdtemp(join(tmpdir(), 'variance-clone-cut-porous-'));
    const clone = await mkdtemp(join(tmpdir(), 'variance-clone-cut-porous-clone-'));
    made.push(origin, clone);
    git(origin, 'init', '-q', '-b', 'main');
    git(origin, 'commit', '-q', '--allow-empty', '-m', 'root');
    git(origin, 'checkout', '-q', '-b', 'side');
    git(origin, 'commit', '-q', '--allow-empty', '-m', 'side');
    git(origin, 'checkout', '-q', 'main');
    git(origin, 'commit', '-q', '--allow-empty', '-m', 'record');
    const record = git(origin, 'rev-parse', 'HEAD');
    git(origin, 'branch', 'record');
    git(origin, 'merge', '-q', '--no-ff', 'side', '-m', 'merge');
    git(clone, 'clone', '-q', '--depth', '1', '--branch', 'record', pathToFileURL(origin).href, '.');
    git(clone, 'fetch', '-q', 'origin', 'main:refs/remotes/origin/main');
    git(clone, 'checkout', '-q', '--detach', 'origin/main');
    expect(git(clone, 'rev-parse', '--git-path', 'shallow')).toBeTruthy();
    // Past the record: side and the merge. Git also counts root, which the record's cut hides from it.
    expect(Number(git(clone, 'rev-list', '--count', `${record}..HEAD`))).toBe(3);

    expect.soft(await headPast(record, clone)).toBe(2);
    expect.soft(await note(clone, record)).toContain('2 commit(s) before HEAD');
  });
});

/** The argv of every git process `run` started, read from git's own trace. */
async function gitStarted(at: string, run: () => Promise<unknown>): Promise<string[][]> {
  const trace = join(at, '.git', 'variance-trace.json');
  await rm(trace, { force: true });
  vi.stubEnv('GIT_TRACE2_EVENT', trace);
  try {
    await run();
  } finally {
    vi.unstubAllEnvs();
  }
  const events = existsSync(trace) ? readFileSync(trace, 'utf8').trim().split('\n') : [];
  return events
    .map((line) => JSON.parse(line) as { event: string; argv?: string[] })
    .filter((event) => event.event === 'start')
    .map((event) => (event.argv ?? []).slice(1));
}

describe('the git a reader starts', () => {
  it('asks once whether HEAD contains a commit several states of the note were run at', async () => {
    const { clone, record } = await history();
    const head = git(clone, 'rev-parse', 'HEAD');
    const state = (commit: string, file: string) => ({ commit, files: [file] });
    let said = '';
    const started = await gitStarted(clone, async () => {
      said = await checkoutRead('unit', clone, {
        layer: {
          pinned: { mainline: 'main', commit: record },
          ran: [state(record, 'a.test.ts'), state(head, 'b.test.ts'), { ...state(head, 'c.test.ts'), tree: head }, state(head, 'd.test.ts')],
        },
      });
    });

    const asked = started.filter((argv) => argv.includes('--is-ancestor')).map((argv) => argv.at(-2));
    expect(asked.sort()).toEqual([head, record].sort());
    expect(said).toContain('4 test file(s) ran here');
  });

  it('counts nothing for a record at the merge base itself', async () => {
    const { clone } = await history();
    const base = git(clone, 'merge-base', 'HEAD', 'refs/remotes/origin/main');
    let distance: number | undefined;
    const started = await gitStarted(clone, async () => {
      distance = await distanceFrom(config, 'main', base, clone);
    });

    expect(distance).toBe(0);
    expect(started.filter((argv) => argv[0] === 'rev-list')).toEqual([]);
  });

  it('finds the shallow list once for every count a reader makes in one checkout', async () => {
    const { clone, record } = await history();
    const started = await gitStarted(clone, async () => {
      await readerMainline(config, {}, clone);
      await distanceFrom(config, 'main', record, clone);
      await note(clone, record);
    });

    expect(started.filter((argv) => argv.includes('rev-list')).length).toBeGreaterThan(1);
    expect(started.filter((argv) => argv.includes('--git-path'))).toHaveLength(1);
  });
});
