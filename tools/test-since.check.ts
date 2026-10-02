import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { recordOfCases, testCoverageFile, writeTestCoverage } from '@variance-authority/sense/test-selection';
import { describe, expect, it } from 'vitest';
import { selectedFiles } from './since-change.mjs';
import { inSnapshotCoordinates } from './since-diff.mjs';
import { costLine, explain, findingLines, readingLines, recordLine, runningLines } from './since-report.mjs';
import { recordToRead, snapshotReading } from './test-since.mjs';
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

    const read = await recordToRead(path, { cacheRoot });
    expect(read).toEqual({ from: 'primary', file: testCoverageFile(primary, { cacheRoot }) });
    expect(read.file).not.toBe(testCoverageFile(path, { cacheRoot }));
    expect(recordLine(read)).toEqual([
      `  record   the primary checkout's, at ${read.file}; this worktree has recorded none of its own`,
    ]);
  });

  it('finds the one declared suite\'s record the same way', async () => {
    const { primary, path, cacheRoot } = await layered({ suites: { unit: { kind: 'unit' } } });
    await writeTestCoverage(testCoverageFile(primary, { suite: 'unit', cacheRoot }), snapshot);

    expect(await recordToRead(path, { cacheRoot })).toEqual({
      from: 'primary',
      suite: 'unit',
      file: testCoverageFile(primary, { suite: 'unit', cacheRoot }),
    });
  });

  it('prefers the worktree\'s own record once a run has landed one', async () => {
    const { primary, path, cacheRoot } = await layered();
    await writeTestCoverage(testCoverageFile(primary, { cacheRoot }), snapshot);
    await writeTestCoverage(testCoverageFile(path, { cacheRoot }), snapshot);

    const read = await recordToRead(path, { cacheRoot });
    expect(read).toEqual({ from: 'own', file: testCoverageFile(path, { cacheRoot }) });
    expect(recordLine(read)).toEqual([`  record   this checkout's, at ${read.file}`]);
  });

  it('names the mainline\'s record by the note `select` prints, and the primary checkout\'s as a fallback with the reason', () => {
    const note = 'record of "unit": read from mainline main, published at abc, 2 commits behind; kept at /cache/share/read/unit/abc/coverage.bin';
    expect(recordLine({ from: 'mainline', file: '/cache/share/read/unit/abc/coverage.bin', note })).toEqual([`  record   ${note}`]);

    const missed = 'record of "unit": the mainline\'s was not read; mainline main: the share could not be reached';
    expect(recordLine({ from: 'primary', file: '/primary/coverage.bin', note: missed })).toEqual([
      "  record   the primary checkout's, at /primary/coverage.bin, as an offline fallback; this worktree has recorded none of its own",
      `  mainline ${missed}`,
    ]);
  });
});

describe('a record whose run instrumented nothing narrows nothing', () => {
  async function recordHolding(bytes: Uint8Array | string): Promise<string> {
    const file = resolve(await mkdtemp(resolve(tmpdir(), 'va-since-record-')), 'coverage.bin');
    await writeFile(file, bytes);
    return file;
  }

  it('reads as no opinion, so the slice runs whole and says why', async () => {
    const file = await recordHolding(recordOfCases({ index: Buffer.from('cases') }));

    expect(await snapshotReading(file)).toEqual({
      whole: [
        'test:since: the execution snapshot holds cases and no coverage, so the whole slice runs, and records itself.',
        `  at ${file}`,
        '  The run that wrote it instrumented nothing, so it says nothing about which tests a change reaches.',
      ],
    });
  });

  it('still refuses bytes this build cannot read', async () => {
    const file = await recordHolding('not a record');

    const reading = await snapshotReading(file);
    expect(reading.status).toBe(1);
    expect(reading.lines?.[0]).toMatch(/^test:since: the execution snapshot is not one this build can read: /u);
  });

  it('hands over what it read from a record that holds coverage', async () => {
    const file = await recordHolding('');
    await writeTestCoverage(file, { version: 3, instrumentation: 'probe-recipe', tests: [{ file: 'a.test.ts', complete: true, preconditions: [] }], modules: [] });

    expect((await snapshotReading(file)).coverage?.tests.map((test) => test.file)).toEqual(['a.test.ts']);
  });
});
