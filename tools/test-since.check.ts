import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { digestString } from '@variance-authority/core/format';
import { inSnapshotCoordinates, outOfFrame } from './since-diff.mjs';
import { INERT, explain } from './test-since.mjs';
import { ROOT } from './workspaces.js';

/**
 * The one list `yarn test:since` is allowed to skip on, and the rewrite it
 * narrows through.
 *
 * Everything else a diff touches and the snapshot has no row for widens the run
 * to the whole suite, which is the safe direction and needs no checking. These
 * two do not have that property. {@link INERT} is where the tool decides a
 * change cannot matter *without* consulting any evidence, and
 * `inSnapshotCoordinates` is where a changed `src` file is looked up under the
 * `dist` name every other package's tests actually loaded — get that wrong and
 * the narrowing quietly stops seeing cross-package reach, which looks exactly
 * like a clean diff.
 */

/** Where the suite collects from, per `vitest.config.mts`. */
const COLLECTED = ['packages/', 'examples/', 'cases/'];

describe('nothing skipped without evidence is inside the suite', () => {
  it.each(INERT)('%s is there', (entry: string) => {
    const path = join(ROOT, entry.replace(/\/$/, ''));
    expect(existsSync(path), `${entry} names nothing in this repository`).toBe(true);
    expect(statSync(path).isDirectory(), `${entry} is written as a ${entry.endsWith('/') ? 'directory' : 'file'}`).toBe(
      entry.endsWith('/'),
    );
  });

  it.each(INERT)('%s is outside every workspace', (entry: string) => {
    expect(COLLECTED.filter((group) => entry.startsWith(group))).toEqual([]);
  });

  it('collides with nothing the runner collects', () => {
    const config = readFileSync(join(ROOT, 'vitest.config.mts'), 'utf8');
    const include = [...config.matchAll(/'([^']*\*[^']*)'/g)].map((match) => match[1]!);
    expect(include.length, 'no include patterns found — has the config moved?').toBeGreaterThan(0);

    const overlapping = include.filter((pattern) =>
      INERT.some((entry: string) => pattern.startsWith(entry)),
    );
    expect(overlapping, 'the suite collects from a directory the tool treats as unreachable').toEqual(
      [],
    );
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
    expect(manifest.scripts['test:since']).toBe('node tools/test-since.mjs');
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
