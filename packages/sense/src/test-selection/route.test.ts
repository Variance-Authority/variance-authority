import { relationsOf, relationsOfFiles } from '@variance-authority/core/relate';
import { describe, expect, it } from 'vitest';
import { narrowByJourneys } from './execution-select.js';
import { encodeTestCoverage } from './format.js';
import { openTestCoverage } from './format-view.js';
import type { ExecutionIndex } from './reverse.js';
import { routeOf, unmeasuredOf } from './route.js';
import { narrowByExecutionFromView } from './select.js';
import { coverage } from './__fixtures__/coverage.js';

describe('the route a changed file takes', () => {
  it('sends a file the record measured to coverage, whatever the suite says of relations', () => {
    expect(routeOf(true, 'relations')).toBe('coverage');
    expect(routeOf(true, 'nothing')).toBe('coverage');
  });

  it('sends a file the record did not measure to relations, unless the suite declines them', () => {
    expect(routeOf(false, undefined)).toBe('relations');
    expect(routeOf(false, 'relations')).toBe('relations');
    expect(routeOf(false, 'nothing')).toBe('nothing');
  });
});

describe('what a suite does with a file its record did not measure', () => {
  it('asks the graph unless the suite declares relations false', () => {
    expect(unmeasuredOf(undefined)).toBeUndefined();
    expect(unmeasuredOf({ name: 'unit', kind: 'unit' })).toBeUndefined();
    expect(unmeasuredOf({ name: 'unit', kind: 'unit', relations: true })).toBeUndefined();
    expect(unmeasuredOf({ name: 'e2e', kind: 'e2e', relations: false })).toBe('nothing');
  });
});

describe('a file added after the record, read off a snapshot', () => {
  const view = () => openTestCoverage(encodeTestCoverage(coverage));
  const file = (name: string) => ({ kind: 'file', name }) as const;
  // `test/alpha.test.ts` imports a module the recorded run never saw.
  const relations = relationsOf({
    relations: [{ from: file('test/alpha.test.ts'), to: file('src/added.ts'), kind: 'imports' }],
  });
  const added = `--- /dev/null
+++ b/src/added.ts
@@ -0,0 +1,1 @@
+export const added = 1;`;
  const edit = (path: string) => `--- a/${path}
+++ b/${path}
@@ -1,1 +1,1 @@
-old
+new`;

  it('selects the first tests that import it', () => {
    const narrowing = narrowByExecutionFromView(view(), added, { relations });

    expect(narrowing.entered).toEqual(['test/alpha.test.ts']);
    expect(narrowing.because).toEqual([
      { test: 'test/alpha.test.ts', via: [{ kind: 'importer', trail: ['src/added.ts', 'test/alpha.test.ts'] }] },
    ]);
    expect(narrowing.declined).toBeUndefined();
  });

  it('selects nothing in a suite that declines relations, and names it declined', () => {
    const narrowing = narrowByExecutionFromView(view(), added, { relations, unmeasured: 'nothing' });

    expect(narrowing).toMatchObject({ entered: [], because: [], unread: [], declined: ['src/added.ts'] });
  });

  it('declines a path nothing knows rather than reporting it unread, because the graph was not asked', () => {
    expect(narrowByExecutionFromView(view(), edit('README.md'), { relations, unmeasured: 'nothing' })).toMatchObject({
      unread: [],
      declined: ['README.md'],
    });
  });

  it('still answers a measured file by its regions in a suite that declines relations', () => {
    const diff = `--- a/src/decide.ts
+++ b/src/decide.ts
@@ -4,1 +4,1 @@
-    return 'A';
+    return 'a';`;

    expect(narrowByExecutionFromView(view(), diff, { relations, unmeasured: 'nothing' })).toMatchObject({
      entered: ['test/alpha.test.ts'],
      declined: [],
    });
  });

  it('still runs the tests that declare a changed file, which the record says and no relation does', () => {
    expect(narrowByExecutionFromView(view(), edit('vitest.config.ts'), { relations, unmeasured: 'nothing' })).toMatchObject({
      entered: ['test/aaa.test.ts', 'test/alpha.test.ts', 'test/beta.test.ts'],
      declined: [],
    });
  });
});

describe('a file added after the record, read off a journey file', () => {
  const index: ExecutionIndex = {
    tests: [
      { id: 'card > a', file: 'test/card.test.ts', name: 'a' },
      { id: 'other > a', file: 'test/other.test.ts', name: 'a' },
    ],
    modules: [
      {
        file: 'src/card.ts',
        blocks: [
          { kind: 'function', name: 'render', path: 'render', startLine: 1, endLine: 5, source: true, crossings: [{ test: 0, distance: 0 }] },
        ],
      },
    ],
  };
  const relations = relationsOfFiles([
    { file: 'src/added.ts' },
    { file: 'test/other.test.ts', edges: [{ to: 'src/added.ts', kind: 'imports' }] },
  ]);
  const added = new Map([['src/added.ts', [{ start: 1, end: 1 }]]]);

  it('selects the first tests that import it', () => {
    const narrowing = narrowByJourneys(index, added, { relations });

    expect(narrowing.entered).toEqual(['test/other.test.ts']);
    expect(narrowing.declined).toBeUndefined();
  });

  it('selects nothing in a suite that declines relations, and names it declined', () => {
    expect(narrowByJourneys(index, added, { relations, unmeasured: 'nothing' })).toMatchObject({
      entered: [],
      unread: [],
      declined: ['src/added.ts'],
    });
  });

  it('runs a changed test file the record holds a case of, relations or none', () => {
    expect(narrowByJourneys(index, new Map([['test/other.test.ts', []]]), { relations, unmeasured: 'nothing' }))
      .toMatchObject({ entered: ['test/other.test.ts'], declined: [] });
  });

  it('still answers a measured module by its regions in a suite that declines relations', () => {
    expect(narrowByJourneys(index, new Map([['src/card.ts', [{ start: 2, end: 2 }]]]), { relations, unmeasured: 'nothing' }))
      .toMatchObject({ entered: ['test/card.test.ts'], declined: [] });
  });
});
