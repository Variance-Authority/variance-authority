import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { digestString } from '@variance-authority/core/format';
import { inSnapshotCoordinates, outOfFrame } from './since-diff.mjs';
import { explain, selectedFiles } from './test-since.mjs';
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

describe('the frame check reads only the paths it has a digest to compare against', () => {
  const coverage = {
    commit: 'a'.repeat(40),
    modules: [
      { file: 'packages/dom/src/collect.ts', instrumented: true, sourceDigest: digestString('kept') },
      { file: 'packages/dom/dist/collect.js', instrumented: true, sourceDigest: digestString('built') },
      { file: 'packages/event/dist/log.js', instrumented: true, sourceDigest: digestString('built') },
      { file: 'packages/dom/src/unread.ts', instrumented: false, sourceDigest: digestString('kept') },
    ],
  };
  // Every changed path, in the shape a wide diff arrives in: two with a source
  // row, and the rest of it fixtures, manifests and a stem the snapshot holds
  // only a built twin for.
  const changed = [
    'packages/dom/src/collect.ts',
    'packages/dom/src/unread.ts',
    'packages/event/src/log.ts',
    'fixtures/one.json',
    'package.json',
  ];

  const asking = (): { asked: string[]; sourceAtFor: (paths: readonly string[]) => (file: string) => string } => {
    const asked: string[] = [];
    return {
      asked,
      sourceAtFor: (paths) => {
        asked.push(...paths);
        return (file) => (file === 'packages/dom/src/collect.ts' ? 'moved on' : 'kept');
      },
    };
  };

  it('never asks about a path with no source row, whatever else the diff names', () => {
    const { asked, sourceAtFor } = asking();
    outOfFrame(coverage, changed, sourceAtFor);

    // `unread.ts` has a row the build could not read, `log.ts` only a built
    // twin whose digest is of other text, and the last two no row at all.
    expect(asked).toEqual(['packages/dom/src/collect.ts']);
  });

  it('reports the module whose text moved and leaves the unasked ones alone', () => {
    const { sourceAtFor } = asking();
    expect([...outOfFrame(coverage, changed, sourceAtFor)]).toEqual([
      'packages/dom/src/collect.ts',
    ]);
  });

  it('asks nothing at all when the diff meets no source row', () => {
    const { asked, sourceAtFor } = asking();
    expect([...outOfFrame(coverage, ['fixtures/one.json'], sourceAtFor)]).toEqual([]);
    expect(asked).toEqual([]);
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
  });
});
