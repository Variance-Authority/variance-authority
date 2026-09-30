import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { digestString } from '@variance-authority/core/format';
import { INSTRUMENTATION_ID } from '@variance-authority/sense/instrument';
import {
  commitRunsFile,
  landRun,
  readCommitRuns,
  readTestCoverage,
  seedTestCoverage,
  testCoverageFile,
  writeTestCoverage,
  type TestCoverage,
} from '@variance-authority/sense/test-selection';
import { afterEach, describe, expect, it } from 'vitest';
import { readChange } from './since-change.mjs';

/**
 * Where `yarn test:since` reads a change from in a git worktree, for each test
 * the worktree has not run itself.
 *
 * The primary checkout's record is the base every worktree starts from, so a
 * test the worktree has not run last ran where that record says it did. The
 * record and the runs beside it are laid down the way a seam lays them — seed,
 * then `landRun` — and read the way `yarn test:since` reads them, through
 * `readChange`.
 */

type Git = (...args: string[]) => string;

const NAMES = ['far', 'near', 'other'];
const tests = NAMES.map((name) => `test/${name}.test.ts`);
const source = (name: string, value: number) => ({ [`src/${name}.ts`]: `export const ${name} = ${value};\n` });

let made: string[] = [];
afterEach(async () => {
  await Promise.all(made.map((dir) => rm(dir, { recursive: true, force: true })));
  made = [];
});

function gitIn(at: string): Git {
  return (...args) =>
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...args], {
      cwd: at,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
}

async function commitIn(at: string, files: Record<string, string>, message: string): Promise<string> {
  for (const [file, text] of Object.entries(files)) {
    await mkdir(resolve(at, file, '..'), { recursive: true });
    await writeFile(resolve(at, file), text);
  }
  const git = gitIn(at);
  git('add', '.');
  git('commit', '-q', '-m', message);
  return git('rev-parse', 'HEAD').trim();
}

/**
 * What a run at `at` records: the tests it ran, and the modules they loaded,
 * with the digest of the text on disk. The instrumentation is the shipped one,
 * so a carried module whose text moved is cut again the way a real run cuts it.
 */
const run = (at: string, commit: string, names: readonly string[]): TestCoverage => ({
  version: 3,
  instrumentation: INSTRUMENTATION_ID,
  commit,
  tests: names.map((name) => ({ file: `test/${name}.test.ts`, complete: true, preconditions: [] })),
  modules: names.map((name) => ({
    file: `src/${name}.ts`,
    sourceDigest: digestString(readFileSync(resolve(at, `src/${name}.ts`), 'utf8')),
    instrumented: true,
    blocks: [
      { ordinal: 0, kind: 'module' as const, digest: `block:${name}`, name: '', path: 'module', startLine: 1, endLine: 1, source: true, testFiles: [`test/${name}.test.ts`] },
    ],
  })),
});

/**
 * A primary checkout at M, whose record is a whole run at M, and a git worktree
 * of it at M that has run nothing. The cache sits outside both checkouts.
 */
async function primaryAndWorktree() {
  // Real, because git records a worktree's primary checkout by its real path.
  const home = await realpath(await mkdtemp(resolve(tmpdir(), 'va-since-worktree-')));
  made.push(home);
  const primary = resolve(home, 'primary');
  const cacheRoot = resolve(home, 'cache');
  await mkdir(primary);
  gitIn(primary)('init', '-q', '-b', 'main');
  const M = await commitIn(primary, Object.assign({}, ...NAMES.map((name) => source(name, 1))), 'M');
  const base = testCoverageFile(primary, { cacheRoot });
  await landRun(base, run(primary, M, NAMES), primary);
  const worktree = resolve(home, 'feature');
  gitIn(primary)('worktree', 'add', '-q', '-b', 'feature', worktree);
  const own = testCoverageFile(worktree, { cacheRoot });

  /** One run in the worktree, as a seam lands it: seed first, then the run. */
  const ranHere = async (commit: string, names: readonly string[]) => {
    await seedTestCoverage(own, worktree, cacheRoot);
    await landRun(own, run(worktree, commit, names), worktree);
  };
  const read = async () =>
    readChange({
      root: worktree,
      git: gitIn(worktree),
      diffOfNew: () => '',
      snapshotFile: own,
      coverage: await readTestCoverage(own),
      runs: await readCommitRuns(own),
      ref: undefined,
      suite: tests,
      stemOf: (path: string) => path,
      graph: async () => ({}),
      say: () => {},
    });
  return { primary, worktree, cacheRoot, base, own, M, ranHere, read };
}

describe('a worktree reads a test it has not run from where the primary checkout\'s record says it last ran', () => {
  it('selects `far.test` two partial runs after `far.ts` changed, where it last ran at the base', async () => {
    const { worktree, own, M, ranHere, read } = await primaryAndWorktree();
    const H = await commitIn(worktree, source('far', 2), 'H');
    await ranHere(H, ['near']);
    const H2 = await commitIn(worktree, source('near', 2), 'H2');
    await ranHere(H2, ['near']);

    const reading = await read();
    expect(reading.decided).toEqual({ selected: ['test/far.test.ts'] });
    expect(reading.start.assumed).toBeUndefined();
    expect(await readCommitRuns(own)).toMatchObject({
      commit: H2,
      over: H,
      files: ['test/near.test.ts'],
      standing: [{ commit: M, files: ['test/far.test.ts', 'test/other.test.ts'] }],
    });
  });

  it('assumes, when the primary checkout has no runs record, that every test in its record last ran at its commit', async () => {
    const { worktree, base, own, M, ranHere, read } = await primaryAndWorktree();
    await rm(commitRunsFile(base));
    const H = await commitIn(worktree, source('far', 2), 'H');
    await ranHere(H, ['near']);
    const H2 = await commitIn(worktree, source('near', 2), 'H2');
    await ranHere(H2, ['near']);

    expect((await readCommitRuns(own))?.standing).toEqual([{ commit: M, files: ['test/far.test.ts', 'test/other.test.ts'] }]);
    expect((await read()).decided).toEqual({ selected: ['test/far.test.ts'] });
  });

  it('carries the primary checkout\'s `standing`, so a test its last partial run did not run reads from further back', async () => {
    const { primary, worktree, cacheRoot, base, own, M, read } = await primaryAndWorktree();
    // The primary checkout moves on to M2, which changes `far.ts`, and runs only `near` there.
    const M2 = await commitIn(primary, source('far', 2), 'M2');
    await landRun(base, run(primary, M2, ['near']), primary);
    expect(await readCommitRuns(base)).toMatchObject({ commit: M2, over: M, files: ['test/near.test.ts'] });
    gitIn(worktree)('merge', '-q', '--ff-only', M2);

    await seedTestCoverage(own, worktree, cacheRoot);
    expect(await readCommitRuns(own)).toEqual({
      commit: M2,
      first: expect.any(String),
      latest: expect.any(String),
      runs: 0,
      files: ['test/near.test.ts'],
      standing: [{ commit: M, files: ['test/far.test.ts', 'test/other.test.ts'] }],
    });

    const H = await commitIn(worktree, source('near', 2), 'H');
    await landRun(own, run(worktree, H, ['near']), worktree);
    const reading = await read();
    expect(reading.start.stands.map((stand: { commit: string; tests: string[] }) => [stand.commit, stand.tests])).toEqual([
      [M, ['test/far.test.ts', 'test/other.test.ts']],
    ]);
    expect(reading.decided).toEqual({ selected: ['test/far.test.ts'] });
  });

  it('starts its first run at the base\'s own commit where the base stood, as one more run is not what it is', async () => {
    const { worktree, own, M, ranHere, read } = await primaryAndWorktree();
    await ranHere(M, ['near']);
    // `over` is where this checkout's change starts, which `variance review` reads.
    expect(await readCommitRuns(own)).toMatchObject({
      commit: M,
      over: M,
      runs: 1,
      files: ['test/near.test.ts'],
      standing: [{ commit: M, files: ['test/far.test.ts', 'test/other.test.ts'] }],
    });

    const H = await commitIn(worktree, source('far', 2), 'H');
    await ranHere(H, ['near']);
    const H2 = await commitIn(worktree, source('near', 2), 'H2');
    await ranHere(H2, ['near']);
    const reading = await read();
    expect(reading.start.assumed).toBeUndefined();
    expect(reading.decided).toEqual({ selected: ['test/far.test.ts'] });
  });

  it('seeds no runs record when the primary checkout\'s names another commit than its record, and the reading says what it assumed', async () => {
    const { primary, worktree, cacheRoot, base, own, ranHere, read } = await primaryAndWorktree();
    // A landing writes the record without listing its run, so the runs beside it still name M.
    const L = await commitIn(primary, source('other', 2), 'L');
    await writeTestCoverage(base, run(primary, L, NAMES));
    gitIn(worktree)('merge', '-q', '--ff-only', L);

    await seedTestCoverage(own, worktree, cacheRoot);
    expect(await readCommitRuns(own)).toBeUndefined();

    const H = await commitIn(worktree, source('far', 2), 'H');
    await ranHere(H, ['near']);
    const H2 = await commitIn(worktree, source('near', 2), 'H2');
    await ranHere(H2, ['near']);
    expect((await readCommitRuns(own))?.standing).toBeUndefined();
    expect((await read()).start.assumed).toBe(
      `the runs record beside the snapshot does not say where 2 test(s) last ran, so they are read from ${H.slice(0, 12)}, where its runs started`,
    );
  });
});
