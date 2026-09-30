import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { digestString } from '@variance-authority/core/format';
import { commitRunsFile, landRun, readCommitRuns, readTestCoverage, type TestCoverage } from '@variance-authority/sense/test-selection';
import { describe, expect, it } from 'vitest';
import { readingFrom, wholeEntry, withoutFiles } from './since-base.mjs';
import { readChange, selectedFiles } from './since-change.mjs';

/**
 * Where `yarn test:since` reads a change from, for each test.
 *
 * A leg of `--at-distance` lands its run and stamps the snapshot at `HEAD`, so
 * every test the leg did not run still stands on the text it last ran on. Read
 * from the snapshot's commit alone, the next leg would find nothing changed and
 * skip the far half of the loop, which no other check would notice: a run of
 * nothing is always green.
 */

type Git = (...args: string[]) => string;

async function repository(): Promise<{ at: string; git: Git; commit: (files: Record<string, string>, message: string) => Promise<string> }> {
  const at = await mkdtemp(resolve(tmpdir(), 'va-since-start-'));
  const git: Git = (...args) =>
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...args], {
      cwd: at,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  const commit = async (files: Record<string, string>, message: string): Promise<string> => {
    for (const [file, text] of Object.entries(files)) {
      await mkdir(resolve(at, file, '..'), { recursive: true });
      await writeFile(resolve(at, file), text);
    }
    git('add', '.');
    git('commit', '-q', '-m', message);
    return git('rev-parse', 'HEAD').trim();
  };
  git('init', '-q', '-b', 'work');
  return { at, git, commit };
}

const NAMES = ['far', 'near', 'other'];
const source = (name: string, value: number) => ({ [`src/${name}.ts`]: `export const ${name} = ${value};\n` });

/** `mainline` is M, holding three modules. The branch changes `src/other.ts` (P), then `src/far.ts` (H). */
async function history() {
  const repo = await repository();
  await repo.commit(Object.assign({}, ...NAMES.map((name) => source(name, 1))), 'M');
  repo.git('branch', 'mainline');
  const P = await repo.commit(source('other', 2), 'P');
  const H = await repo.commit(source('far', 2), 'H');
  return { ...repo, P, H };
}

const tests = NAMES.map((name) => `test/${name}.test.ts`);
const runsAt = (commit: string, over: string, files = ['test/near.test.ts'], standing?: { commit: string; files: string[] }[]) => ({
  commit,
  over,
  first: '',
  latest: '',
  runs: 1,
  files,
  ...(standing === undefined ? {} : { standing }),
});

describe('a change is read from where each test last ran, not from where the last leg left the snapshot', () => {
  it('charges what changed after a test last ran whole for that test, and reads the rest from the snapshot\'s commit', async () => {
    const { git, P, H } = await history();
    const runs = runsAt(H, P, ['test/near.test.ts'], [{ commit: P, files: ['test/far.test.ts', 'test/other.test.ts'] }]);

    const start = readingFrom({ commit: H, ref: undefined, runs, tests, git });

    expect(start).toEqual({
      base: H,
      from: P,
      stands: [{ commit: P, tests: ['test/far.test.ts', 'test/other.test.ts'], whole: ['src/far.ts'] }],
      says: `where 2 test(s) the runs at ${H.slice(0, 12)} did not run last ran; 1 file(s) changed up to ${H.slice(0, 12)}, where the snapshot was recorded, are read whole for the 2 test(s) that last ran before it`,
    });
  });

  it('reads a test the record does not list from `over`, and says so', async () => {
    const { git, P, H } = await history();
    const start = readingFrom({ commit: H, ref: undefined, runs: runsAt(H, P), tests, git });
    expect(start.stands).toEqual([{ commit: P, tests: ['test/far.test.ts', 'test/other.test.ts'], whole: ['src/far.ts'] }]);
    const assumed = `the runs record beside the snapshot does not say where 2 test(s) last ran, so they are read from ${P.slice(0, 12)}, where its runs started`;
    expect(start.assumed).toBe(assumed);
    expect(start.says).toMatch(new RegExp(`; ${assumed.replace(/[()]/g, '\\$&')}$`));
  });

  it('reads from the snapshot\'s commit when the runs are another commit\'s or are absent, and says it assumed so', async () => {
    const { git, P, H } = await history();
    const at = H.slice(0, 12);
    const assumed = {
      [`the runs record beside the snapshot is ${P.slice(0, 12)}'s, not ${at}'s, so every test is read as though it last ran at ${at}`]: runsAt(P, P),
      [`no runs record lies beside the snapshot, so every test is read as though it last ran at ${at}`]: undefined,
    };
    for (const [sentence, runs] of Object.entries(assumed)) {
      expect(readingFrom({ commit: H, ref: undefined, runs, tests, git })).toEqual({
        base: H,
        from: H,
        stands: [],
        says: `where the snapshot was recorded; ${sentence}`,
        assumed: sentence,
      });
    }
  });

  it('reads from the snapshot\'s commit, assuming nothing, when its runs ran every test', async () => {
    const { git, P, H } = await history();
    expect(readingFrom({ commit: H, ref: undefined, runs: runsAt(H, P, tests), tests, git })).toEqual({
      base: H,
      from: H,
      stands: [],
      says: 'where the snapshot was recorded',
    });
  });

  it('charges a path whole however git would quote it in a name list', async () => {
    const { git, commit, H } = await history();
    const odd = [' lead.ts', 'src/back\\slash.ts', 'src/tab\tname.ts'];
    const Q = await commit(Object.fromEntries(odd.map((path) => [path, '1\n'])), 'Q');
    const runs = runsAt(Q, H, ['test/near.test.ts'], [{ commit: H, files: ['test/far.test.ts', 'test/other.test.ts'] }]);

    expect(readingFrom({ commit: Q, ref: undefined, runs, tests, git }).stands).toEqual([
      { commit: H, tests: ['test/far.test.ts', 'test/other.test.ts'], whole: odd },
    ]);
  });

  it('takes a ref as a lower bound: its merge base replaces every later stand, the snapshot\'s commit included', async () => {
    const { git, P, H } = await history();
    const merged = git('rev-parse', 'mainline').trim();
    const start = readingFrom({ commit: H, ref: 'mainline', runs: runsAt(H, P, tests), tests, git });
    expect(start).toMatchObject({ base: H, from: merged, stands: [{ commit: merged, tests, whole: ['src/far.ts', 'src/other.ts'] }] });
    expect(start.says).toMatch(/^the merge base with mainline; 2 file\(s\) changed up to /);
  });

  it('starts at a stand older than the ref\'s merge base, which the merge base does not replace', async () => {
    const { git, P, H } = await history();
    const M = git('rev-parse', 'mainline').trim();
    git('branch', 'at-p', P);
    const runs = runsAt(H, P, ['test/near.test.ts'], [{ commit: M, files: ['test/far.test.ts'] }]);

    const start = readingFrom({ commit: H, ref: 'at-p', runs, tests, git });

    expect(start).toMatchObject({
      base: H,
      from: M,
      stands: [
        { commit: M, tests: ['test/far.test.ts'], whole: ['src/far.ts', 'src/other.ts'] },
        { commit: P, tests: ['test/near.test.ts', 'test/other.test.ts'], whole: ['src/far.ts'] },
      ],
    });
    expect(start.says).toMatch(/^where 1 test\(s\) the runs at /);
  });

  it('keeps the runs when the ref\'s merge base is the snapshot\'s commit, so naming it reads no less than naming nothing', async () => {
    const { git, P, H } = await history();
    const runs = runsAt(H, P);
    expect(readingFrom({ commit: H, ref: H, runs, tests, git })).toEqual(readingFrom({ commit: H, ref: undefined, runs, tests, git }));
  });

  it('reads from the snapshot\'s commit when the ref\'s merge base is not before it, and says so', async () => {
    const { git, P } = await history();
    expect(readingFrom({ commit: P, ref: 'HEAD', runs: undefined, tests, git })).toEqual({
      base: P,
      from: P,
      stands: [],
      says: `where the snapshot was recorded; the merge base with HEAD is not before it; no runs record lies beside the snapshot, so every test is read as though it last ran at ${P.slice(0, 12)}`,
      assumed: `no runs record lies beside the snapshot, so every test is read as though it last ran at ${P.slice(0, 12)}`,
    });
  });

  it('measures a snapshot that names no commit from the merge base alone', async () => {
    const { git } = await history();
    const merged = git('rev-parse', 'mainline').trim();
    expect(readingFrom({ commit: undefined, ref: 'mainline', runs: undefined, git })).toEqual({
      base: merged,
      from: merged,
      stands: [],
      says: 'the merge base with mainline',
    });
  });

  it('refuses a ref git cannot read, by name', async () => {
    const { git, H } = await history();
    expect(readingFrom({ commit: H, ref: 'no-such-branch', runs: undefined, tests, git })).toEqual({
      refused: '`no-such-branch` is not a commit this checkout knows',
    });
  });

  it('runs the whole suite when a stand the runs name is not in this checkout', async () => {
    const { git, H } = await history();
    const gone = 'e'.repeat(40);
    const start = readingFrom({ commit: H, ref: undefined, runs: runsAt(H, gone), tests, git });
    expect(start.widened).toBe(`${gone.slice(0, 12)}, where 2 test(s) last ran, is not in this checkout`);
    const decided = selectedFiles({ suite: ['a.test.ts'], whole: new Set(['a.test.ts']), entered: new Set(), touched: [], moved: [], base: H, unstarted: start.widened });
    expect(decided).toEqual({ widened: `${start.widened}, so the change cannot be read from where it started` });
  });
});

describe('a file charged whole is cut out of the hunk diff by its header, however git spells it', () => {
  it('drops every section of a named file and keeps the rest', async () => {
    const { at, git, H } = await history();
    await writeFile(resolve(at, 'src/far.ts'), 'export const far = 3;\n');
    await writeFile(resolve(at, 'src/near.ts'), 'export const near = 2;\n');
    const diff = git('diff', '--no-renames', H);

    const cut = withoutFiles(diff, ['src/far.ts', 'src/*.ts']);
    expect(cut).toContain('+++ b/src/near.ts');
    expect(cut).not.toContain('src/far.ts');
    expect(withoutFiles(diff, [])).toBe(diff);
  });

  it('reads a quoted header back to the path, whether git quoted it or not', async () => {
    const { at, git, H } = await history();
    await writeFile(resolve(at, 'src/été "x".ts'), '1\n');
    await writeFile(resolve(at, 'src/a b.ts'), '1\n');
    await writeFile(resolve(at, 'src/tab\tname.ts'), '1\n');
    await writeFile(resolve(at, 'src/back\\slash.ts'), '1\n');
    git('add', '.');
    const quoted = git('diff', '--cached', H);
    expect(quoted).toContain('"a/src/\\303\\251t\\303\\251 \\"x\\".ts"');
    expect(quoted).toContain('"a/src/tab\\tname.ts"');

    for (const diff of [quoted, git('-c', 'core.quotePath=false', 'diff', '--cached', H)]) {
      const cut = withoutFiles(diff, ['src/été "x".ts', 'src/a b.ts', 'src/tab\tname.ts', 'src/back\\slash.ts']);
      expect(cut.trim()).toBe('');
    }
    expect(wholeEntry('src/a.ts')).toBe('diff --git a/src/a.ts b/src/a.ts');
  });
});

/**
 * Snapshots laid down the way `yarn test` lays them, through `landRun`, and
 * read the way `yarn test:since` reads them, through `readChange`.
 */
describe('legs at two commits leave each test read from where it last ran', () => {
  // What a leg records: the tests it ran, and the modules they loaded, with the
  // digest of the text on disk, so the merge re-cuts only what moved.
  const run = (at: string, commit: string, names: readonly string[]): TestCoverage => ({
    version: 3,
    instrumentation: 'probe-recipe',
    commit,
    tests: names.map((name) => ({ file: `test/${name}.test.ts`, complete: true, preconditions: [] })),
    modules: names
      .filter((name) => NAMES.includes(name))
      .map((name) => ({
        file: `src/${name}.ts`,
        sourceDigest: digestString(readFileSync(resolve(at, `src/${name}.ts`), 'utf8')),
        instrumented: true,
        blocks: [
          { ordinal: 0, kind: 'module' as const, digest: `block:${name}`, name: '', path: 'module', startLine: 1, endLine: 1, source: true, testFiles: [`test/${name}.test.ts`] },
        ],
      })),
  });

  /** P runs everything, H runs `near`, C runs `other`; M → P → H → C change `other`, `far` and `near`. */
  async function legs() {
    const repo = await repository();
    // The cache sits outside the checkout, where it does not read as a change.
    const file = resolve(await mkdtemp(resolve(tmpdir(), 'va-since-cache-')), 'coverage.bin');
    await repo.commit(Object.assign({}, ...NAMES.map((name) => source(name, 1))), 'M');
    const P = await repo.commit(source('other', 2), 'P');
    await landRun(file, run(repo.at, P, [...NAMES, 'gone']), repo.at);
    const H = await repo.commit(source('far', 2), 'H');
    await landRun(file, run(repo.at, H, ['near']), repo.at);
    const C = await repo.commit(source('near', 2), 'C');
    await landRun(file, run(repo.at, C, ['other']), repo.at);
    const read = async (suite = tests) =>
      readChange({
        root: repo.at,
        git: repo.git,
        diffOfNew: () => '',
        snapshotFile: file,
        coverage: await readTestCoverage(file),
        runs: await readCommitRuns(file),
        ref: undefined,
        suite,
        stemOf: (path: string) => path,
        graph: async () => ({}),
        say: () => {},
      });
    return { ...repo, file, P, H, C, read };
  }

  it('selects a test that last ran two commits back, for a file changed after it ran', async () => {
    const { read, P, H, C } = await legs();

    const reading = await read();

    expect(reading.start.stands.map((stand: { commit: string; tests: string[] }) => [stand.commit, stand.tests])).toEqual([
      [P, ['test/far.test.ts']],
      [H, ['test/near.test.ts']],
    ]);
    expect(reading.start.base).toBe(C);
    expect([...reading.narrowing.entered].sort()).toEqual(['test/far.test.ts', 'test/near.test.ts']);
    expect(reading.decided).toEqual({ selected: ['test/far.test.ts', 'test/near.test.ts'] });
  });

  it('does not charge a test the runs at the snapshot\'s commit observed for what changed before it ran', async () => {
    const { read, file, C, at } = await legs();
    await landRun(file, run(at, C, ['far']), at);

    const reading = await read();

    expect([...reading.narrowing.entered].sort()).toEqual(['test/near.test.ts']);
    expect(reading.decided).toEqual({ selected: ['test/near.test.ts'] });
  });

  it('lets no test the suite no longer collects hold the reading at the commit it last ran at', async () => {
    const { read, file, C, at } = await legs();
    await landRun(file, run(at, C, ['far', 'near']), at);

    expect((await readCommitRuns(file))?.standing?.flatMap((stand) => stand.files)).toEqual(['test/gone.test.ts']);
    expect(await read()).toEqual({ nothing: [`test:since: nothing has changed since ${C.slice(0, 12)}.`, '  Nothing to run.'] });
  });

  it('has something to run while a collected test has no row, even with nothing changed', async () => {
    const { read, file, C, at } = await legs();
    await landRun(file, run(at, C, ['far', 'near']), at);

    const reading = await read([...tests, 'test/new.test.ts']);

    expect(reading.nothing).toBeUndefined();
    expect(reading.decided).toEqual({ selected: ['test/new.test.ts'] });
  });

  it('says what it assumed when it finds nothing to run without the runs record', async () => {
    const { read, file, C, at } = await legs();
    await landRun(file, run(at, C, ['far', 'near']), at);
    await rm(commitRunsFile(file));

    const at12 = C.slice(0, 12);
    expect(await read()).toEqual({
      nothing: [
        `test:since: nothing has changed since ${at12}.`,
        `  No runs record lies beside the snapshot, so every test is read as though it last ran at ${at12}.`,
        '  Nothing to run.',
      ],
    });
  });
});
