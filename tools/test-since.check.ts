import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { INERT, inSnapshotCoordinates } from './test-since.mjs';
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
    expect(manifest.scripts['test:since']).toBe('node tools/test-since.mjs');
  });
});
