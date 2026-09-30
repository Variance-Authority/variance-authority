import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { narrowByExecution, testCoverageFile, writeTestCoverage, type TestCoverage } from '@variance-authority/sense/test-selection';
import { describe, expect, it } from 'vitest';
import { excluding, readingFrom, wholeEntry } from './since-base.mjs';
import { inSnapshotCoordinates } from './since-diff.mjs';
import { costLine, explain, findingLines, readingLines, recordLine, runningLines } from './since-report.mjs';
import { recordToRead, selectedFiles } from './test-since.mjs';
import { ROOT } from './workspaces.js';

/**
 * The decision `yarn test:since` makes, and the rewrite it narrows through.
 *
 * {@link selectedFiles} is where a reading becomes a run, and its one claim that
 * no other check can see is a negative: a changed path no test ran keeps no
 * test in the run and does not turn the answer into the whole suite. A widening
 * that crept back would fail nothing else, because a whole suite is always green
 * where a narrow one is. `inSnapshotCoordinates` is where a changed `src` file
 * is looked up under the `dist` name every other package's tests actually
 * loaded — get that wrong and the narrowing quietly stops seeing cross-package
 * reach, which looks exactly like a clean diff.
 */

describe('a file runs because the reading placed it, never because a path went unmeasured', () => {
  const suite = ['a.test.ts', 'b.test.ts', 'c.test.ts'];
  const base = 'f'.repeat(40);

  it('keeps only the files the snapshot never saw whole when a change entered nothing', () => {
    expect(
      selectedFiles({ suite, whole: new Set(['a.test.ts', 'b.test.ts']), entered: new Set(), touched: [], moved: [], base }),
    ).toEqual({ selected: ['c.test.ts'] });
  });

  it('adds what the change entered and the test files it edited', () => {
    expect(
      selectedFiles({
        suite,
        whole: new Set(suite),
        entered: new Set(['a.test.ts']),
        touched: ['b.test.ts'],
        moved: [],
        base,
      }),
    ).toEqual({ selected: ['a.test.ts', 'b.test.ts'] });
  });

  it('runs everything when the install could not be compared', () => {
    const decided = selectedFiles({ suite, whole: new Set(suite), entered: new Set(), touched: [], moved: undefined, base });
    expect(decided.selected).toBeUndefined();
    expect(decided.widened).toContain(base.slice(0, 12));
  });

  it('runs everything when the snapshot saw none of this suite whole', () => {
    const decided = selectedFiles({ suite, whole: new Set(['elsewhere.test.ts']), entered: new Set(), touched: [], moved: [], base });
    expect(decided.selected).toBeUndefined();
    expect(decided.widened).toContain('no whole observation');
  });
});

describe('a changed source file is asked about under every name it was loaded by', () => {
  const HUNK = '@@ -12,2 +12,2 @@\n-before\n+after';
  const byStem = new Map([
    ['packages/dom/src/collect', ['packages/dom/dist/collect.js', 'packages/dom/src/collect.ts']],
    ['packages/event/src/log', ['../../../packages/event/dist/log.js']],
  ]);

  it('repeats the hunk under the dist twin, line numbers untouched', () => {
    const rewritten = inSnapshotCoordinates(
      `--- a/packages/dom/src/collect.ts\n+++ b/packages/dom/src/collect.ts\n${HUNK}`,
      byStem,
    );
    expect(rewritten.split('\n').filter((line) => line.startsWith('@@'))).toEqual([
      '@@ -12,2 +12,2 @@',
      '@@ -12,2 +12,2 @@',
    ]);
    expect(rewritten).toContain('--- a/packages/dom/dist/collect.js');
    expect(rewritten).toContain('--- a/packages/dom/src/collect.ts');
  });

  it('follows a worktree link out of the checkout and back', () => {
    const rewritten = inSnapshotCoordinates(
      `--- a/packages/event/src/log.ts\n+++ b/packages/event/src/log.ts\n${HUNK}`,
      byStem,
    );
    expect(rewritten).toContain('--- a/../../../packages/event/dist/log.js');
  });

  it('keeps a deleted file under the name it had', () => {
    const rewritten = inSnapshotCoordinates(
      `--- a/packages/dom/src/collect.ts\n+++ /dev/null\n${HUNK}`,
      byStem,
    );
    expect(rewritten).toContain('--- a/packages/dom/dist/collect.js');
  });

  it('reads a hunk by the counts in its header, so a removed line that starts with dashes is body', () => {
    const rewritten = inSnapshotCoordinates(
      `--- a/packages/dom/src/collect.ts\n+++ b/packages/dom/src/collect.ts\n@@ -12,2 +12,2 @@\n--- a comment of dashes\n+++ another\n`,
      byStem,
    );
    expect(rewritten.split('\n').filter((line) => line.startsWith('--- a/'))).toEqual([
      '--- a/packages/dom/dist/collect.js',
      '--- a/packages/dom/src/collect.ts',
    ]);
    expect(rewritten).toContain('--- a comment of dashes');
  });

  it('passes a file named without a hunk through under its own name', () => {
    const rewritten = inSnapshotCoordinates(
      `diff --git a/logo.png b/logo.png\nBinary files a/logo.png and b/logo.png differ\ndiff --git a/packages/dom/src/collect.ts b/packages/dom/src/collect.ts\n--- a/packages/dom/src/collect.ts\n+++ b/packages/dom/src/collect.ts\n${HUNK}`,
      byStem,
    );
    expect(rewritten).toContain('diff --git a/logo.png b/logo.png');
    expect(rewritten).toContain('--- a/packages/dom/dist/collect.js');
  });

  it('leaves a file the snapshot never saw under its own name', () => {
    const rewritten = inSnapshotCoordinates(
      `--- a/packages/dom/src/nothing-knows-this.ts\n+++ b/packages/dom/src/nothing-knows-this.ts\n${HUNK}`,
      byStem,
    );
    expect(rewritten).toContain('--- a/packages/dom/src/nothing-knows-this.ts');
  });
});

describe('the tool is reachable the way its comments say', () => {
  it('is wired to a script', () => {
    const manifest = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };
    expect(manifest.scripts['test:since']).toBe('variance index && node tools/test-since.mjs');
  });
});

describe('why a file runs is printed in one line', () => {
  it('names the region, the precondition, or the trail, and counts the rest', () => {
    expect(
      explain({
        test: 't',
        via: [
          { kind: 'region', file: 'packages/core/src/a.ts', name: 'a', path: 'if#0/then', startLine: 3, endLine: 5 },
          { kind: 'precondition', name: 'package.json' },
        ],
      }),
    ).toBe('packages/core/src/a.ts:3-5 if#0/then (+1)');
    expect(explain({ test: 't', via: [{ kind: 'precondition', name: 'package.json' }] })).toBe(
      'precondition package.json',
    );
    expect(
      explain({ test: 't', via: [{ kind: 'importer', trail: ['src/rules.ts', 'src/decide.ts'] }] }),
    ).toBe('src/rules.ts → src/decide.ts');
    expect(
      explain({ test: 't', via: [{ kind: 'region', file: 'src/a.ts', name: '', path: 'module', startLine: 1, endLine: 8 }] }),
    ).toBe('src/a.ts:1-8');
  });

  it('prints a reason several files share once, over them', () => {
    const why = (file: string): string => (file === 'c.test.ts' ? 'precondition package.json' : 'src/a.ts:1-8');
    expect(runningLines(['a.test.ts', 'b.test.ts', 'c.test.ts'], () => '  1', why)).toEqual([
      '  src/a.ts:1-8:',
      '    1  a.test.ts',
      '    1  b.test.ts',
      '    1  c.test.ts  precondition package.json',
    ]);
  });
});

describe('a reason is printed once, however many files share it', () => {
  it('folds reasons that differ only in their counts into a range', () => {
    const unmeasured = (test: string, stranded: number) => ({
      test,
      bearing: 'unmeasured',
      because: `it ran ${stranded} other module(s) the graph cannot connect it to`,
    });
    expect(
      findingLines([
        unmeasured('a.test.ts', 22),
        unmeasured('b.test.ts', 49),
        unmeasured('c.test.ts', 30),
        { test: 'd.test.ts', bearing: 'unmeasured', because: 'the graph does not hold d.test.ts' },
      ]),
    ).toEqual([
      'No distance was measurable for some of these, because:',
      '  it ran 22–49 other module(s) the graph cannot connect it to (3 files)',
      '  the graph does not hold d.test.ts',
      '',
    ]);
  });
});

describe('a reader and a reading are printed where the reader looks', () => {
  it('names the value, the file that declares it, and where it was read', () => {
    const region = { kind: 'region', file: 'src/slider.ts', name: 'Slider', path: 'Slider', startLine: 4, endLine: 9 };
    expect(
      explain({ test: 't', via: [{ kind: 'reader', name: 'LIMIT', file: 'src/limits.ts', reader: 'src/slider.ts', region }] }),
    ).toBe('reads LIMIT of src/limits.ts at src/slider.ts:4-9 Slider');
    expect(explain({ test: 't', via: [{ kind: 'reader', name: 'LIMIT', file: 'src/limits.ts', reader: 'src/slider.test.ts' }] })).toBe(
      'reads LIMIT of src/limits.ts at src/slider.test.ts',
    );
  });

  it('prints one line per changed file: the verdict, or why there was none', () => {
    expect(
      readingLines([
        { file: 'src/limits.ts', verdict: 'values', names: ['LIMIT'], unseen: ['test/fill.test.js'] },
        { file: 'src/wrap.ts', verdict: 'load', names: [], effects: ['src/wrap.ts'] },
        { file: 'src/a.ts', unread: 'hunk' },
      ]),
    ).toEqual([
      '',
      '  read src/limits.ts: values (LIMIT) — the readers of the changed values and the changed regions are charged',
      '  unseen test/fill.test.js: loaded src/limits.ts by an import the file graph does not list; named, not selected',
      '  read src/wrap.ts: load (`sideEffects` declares src/wrap.ts) — every test that loaded it is charged',
      '  read src/a.ts: unread (the diff does not apply to the recorded text) — its changed lines are charged',
    ]);
    expect(readingLines([])).toEqual([]);
  });
});

describe('what a run costs is summed from what the runner reported', () => {
  const recorded = new Map([['a.test.ts', 1200], ['b.test.ts', 350]]);

  it('sums the files it knows, and counts the ones it does not apart', () => {
    expect(costLine(['a.test.ts', 'b.test.ts', 'c.test.ts'], recorded))
      .toBe('  cost     1.6 s recorded for 2 of 3 file(s); 1 without a recorded duration');
    expect(costLine(['b.test.ts'], recorded)).toBe('  cost     350 ms recorded for 1 of 1 file(s)');
  });

  it('says the cost is unknown rather than printing a zero', () => {
    expect(costLine(['c.test.ts'], recorded))
      .toBe('  cost     unknown: none of these 1 file(s) has a recorded duration');
  });
});

describe('a worktree that has not run reads the record the primary checkout made', () => {
  const snapshot = {
    version: 3,
    instrumentation: 'probe-recipe',
    tests: [{ file: 'a.test.ts', complete: true, preconditions: [] }],
    modules: [],
  } as const;

  async function layered(config?: unknown): Promise<{ primary: string; path: string; cacheRoot: string }> {
    const at = await mkdtemp(resolve(tmpdir(), 'va-since-layers-'));
    const primary = resolve(at, 'primary');
    const gitdir = resolve(primary, '.git', 'worktrees', 'feature');
    await mkdir(gitdir, { recursive: true });
    const path = resolve(at, 'feature');
    await mkdir(path, { recursive: true });
    await writeFile(resolve(path, '.git'), `gitdir: ${gitdir}\n`);
    if (config !== undefined) {
      for (const where of [primary, path]) await writeFile(resolve(where, 'variance.config.json'), JSON.stringify(config));
    }

    return { primary, path, cacheRoot: resolve(at, 'cache') };
  }

  it('finds the repository record under the base layer, and makes no copy of it', async () => {
    const { primary, path, cacheRoot } = await layered();
    await writeTestCoverage(testCoverageFile(primary, { cacheRoot }), snapshot);

    const read = await recordToRead(path, cacheRoot);
    expect(read).toEqual({ file: testCoverageFile(primary, { cacheRoot }), own: false });
    expect(read.file).not.toBe(testCoverageFile(path, { cacheRoot }));
    expect(recordLine(read.file, read.own)).toBe(
      `  record   the primary checkout's, at ${read.file}; this worktree has recorded none of its own`,
    );
  });

  it('finds the one declared suite\'s record the same way', async () => {
    const { primary, path, cacheRoot } = await layered({ suites: { unit: { kind: 'unit' } } });
    await writeTestCoverage(testCoverageFile(primary, { suite: 'unit', cacheRoot }), snapshot);

    expect(await recordToRead(path, cacheRoot)).toEqual({ file: testCoverageFile(primary, { suite: 'unit', cacheRoot }), own: false });
  });

  it('prefers the worktree\'s own record once a run has landed one', async () => {
    const { primary, path, cacheRoot } = await layered();
    await writeTestCoverage(testCoverageFile(primary, { cacheRoot }), snapshot);
    await writeTestCoverage(testCoverageFile(path, { cacheRoot }), snapshot);

    const read = await recordToRead(path, cacheRoot);
    expect(read).toEqual({ file: testCoverageFile(path, { cacheRoot }), own: true });
    expect(recordLine(read.file, read.own)).toBe(`  record   this checkout's, at ${read.file}`);
  });
});

describe('a change is read from where it started, not from where the last leg left the snapshot', () => {
  // `mainline` holds three modules. The branch changes `src/other.ts` (P), then
  // `src/far.ts` (H). A leg at H landed its run over the snapshot P recorded, so
  // the snapshot names H while every test the leg did not run stands on P.
  async function history(): Promise<{ at: string; git: (...args: string[]) => string; P: string; H: string }> {
    const at = await mkdtemp(resolve(tmpdir(), 'va-since-start-'));
    const git = (...args: string[]): string =>
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
    const names = ['far', 'near', 'other'];
    await commit(Object.fromEntries(names.map((name) => [`src/${name}.ts`, `export const ${name} = 1;\n`])), 'M');
    git('branch', 'mainline');
    const P = await commit({ 'src/other.ts': 'export const other = 2;\n' }, 'P');
    const H = await commit({ 'src/far.ts': 'export const far = 2;\n' }, 'H');
    return { at, git, P, H };
  }

  const runsAt = (commit: string, over: string) => ({ commit, over, first: '', latest: '', runs: 1, files: ['test/far.test.ts'] });

  const snapshot = (commit: string): TestCoverage => ({
    version: 3,
    instrumentation: 'probe-recipe',
    commit,
    tests: ['far', 'near', 'other'].map((name) => ({ file: `test/${name}.test.ts`, complete: true, preconditions: [] })),
    modules: ['far', 'near', 'other'].map((name) => ({
      file: `src/${name}.ts`,
      sourceDigest: `source:${name}`,
      instrumented: true,
      blocks: [
        {
          ordinal: 0,
          kind: 'module' as const,
          digest: `block:${name}`,
          name: '',
          path: 'module',
          startLine: 1,
          endLine: 1,
          source: true,
          testFiles: [`test/${name}.test.ts`],
        },
      ],
    })),
  });

  it('selects the tests of a file changed between the runs\' start and the snapshot\'s commit, beside a hunk after it', async () => {
    const { at, git, P, H } = await history();
    await writeFile(resolve(at, 'src/near.ts'), 'export const near = 2;\n');
    const file = resolve(at, 'coverage.bin');
    await writeTestCoverage(file, snapshot(H));

    const start = readingFrom({ commit: H, ref: undefined, runs: runsAt(H, P), git });
    const hunks = git('diff', '--no-renames', start.base, ...excluding(start.whole));
    expect(hunks).toContain('+++ b/src/near.ts');
    const diff = [hunks, ...start.whole.map(wholeEntry)].join('\n');
    expect([...(await narrowByExecution(file, diff)).entered].sort()).toEqual(['test/far.test.ts', 'test/near.test.ts']);

    expect(start).toEqual({
      base: H,
      from: P,
      whole: ['src/far.ts'],
      says: `where the snapshot stood before the runs at ${H.slice(0, 12)}; 1 file(s) changed up to ${H.slice(0, 12)}, where the snapshot was recorded, are read whole`,
    });
  });

  it('leaves a file charged whole out of the hunk diff, by its literal name', async () => {
    const { at, git, H } = await history();
    await writeFile(resolve(at, 'src/far.ts'), 'export const far = 3;\n');
    await writeFile(resolve(at, 'src/near.ts'), 'export const near = 2;\n');
    const hunks = git('diff', '--no-renames', H, ...excluding(['src/far.ts', 'src/*.ts']));
    expect(hunks).toContain('+++ b/src/near.ts');
    expect(hunks).not.toContain('src/far.ts');
    expect(excluding([])).toEqual([]);
  });

  it('reads from the snapshot\'s commit when the runs are another commit\'s, or absent', async () => {
    const { git, P, H } = await history();
    const fromCommit = { base: H, from: H, whole: [], says: 'where the snapshot was recorded' };
    expect(readingFrom({ commit: H, ref: undefined, runs: runsAt(P, P), git })).toEqual(fromCommit);
    expect(readingFrom({ commit: H, ref: undefined, runs: undefined, git })).toEqual(fromCommit);
  });

  it('honours a ref: from its merge base, whatever the runs say', async () => {
    const { git, P, H } = await history();
    const start = readingFrom({ commit: H, ref: 'mainline', runs: runsAt(H, P), git });
    expect(start).toMatchObject({ base: H, from: git('rev-parse', 'mainline').trim(), whole: ['src/far.ts', 'src/other.ts'] });
    expect(start.says).toMatch(/^the merge base with mainline; 2 file\(s\) changed up to /);
  });

  it('reads from the snapshot\'s commit when the ref\'s merge base is not before it, and says so', async () => {
    const { git, P, H } = await history();
    expect(readingFrom({ commit: H, ref: 'HEAD', runs: undefined, git })).toEqual({
      base: H,
      from: H,
      whole: [],
      says: 'where the snapshot was recorded',
    });
    expect(readingFrom({ commit: P, ref: 'HEAD', runs: undefined, git })).toEqual({
      base: P,
      from: P,
      whole: [],
      says: 'where the snapshot was recorded; the merge base with HEAD is not before it',
    });
  });

  it('measures a snapshot that names no commit from the merge base alone', async () => {
    const { git } = await history();
    const merged = git('rev-parse', 'mainline').trim();
    expect(readingFrom({ commit: undefined, ref: 'mainline', runs: undefined, git })).toEqual({
      base: merged,
      from: merged,
      whole: [],
      says: 'the merge base with mainline',
    });
  });

  it('runs the whole suite when the start the runs name is not in this checkout', async () => {
    const { git, H } = await history();
    const gone = 'e'.repeat(40);
    const start = readingFrom({ commit: H, ref: undefined, runs: runsAt(H, gone), git });
    expect(start.widened).toBe(`${gone.slice(0, 12)}, where the snapshot stood before the runs at ${H.slice(0, 12)}, is not in this checkout`);
    const decided = selectedFiles({
      suite: ['a.test.ts'],
      whole: new Set(['a.test.ts']),
      entered: new Set(),
      touched: [],
      moved: [],
      base: H,
      unstarted: start.widened,
    });
    expect(decided).toEqual({ widened: `${start.widened}, so the change cannot be read from where it started` });
  });
});
