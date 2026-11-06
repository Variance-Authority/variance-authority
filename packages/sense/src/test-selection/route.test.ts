import { relationsOf, relationsOfFiles } from '@variance-authority/core/relate';
import { describe, expect, it } from 'vitest';
import { narrowByJourneys } from './execution-select.js';
import { encodeTestCoverage } from './format.js';
import { openTestCoverage } from './format-view.js';
import type { ExecutionIndex } from './reverse.js';
import { ignoredBy, routeOf, unmeasuredOf } from './route.js';
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

  it('selects no test that imports it for its types alone', () => {
    const typesOnly = relationsOf({
      relations: [{ from: file('test/alpha.test.ts'), to: file('src/added.ts'), kind: 'type' }],
    });

    expect(narrowByExecutionFromView(view(), added, { relations: typesOnly }).entered).toEqual([]);
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

  it('selects no test that imports it for its types alone', () => {
    const typesOnly = relationsOfFiles([
      { file: 'src/added.ts' },
      { file: 'test/card.test.ts', edges: [{ to: 'src/added.ts', kind: 'type' }] },
      { file: 'test/other.test.ts', edges: [{ to: 'src/added.ts', kind: 'imports' }] },
    ]);

    expect(narrowByJourneys(index, added, { relations: typesOnly }).entered).toEqual(['test/other.test.ts']);
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

describe('the changed files a suite ignores', () => {
  it('are the ones its patterns match, from the repository root, dotfiles too', () => {
    expect(ignoredBy(['**/*.css', '**/*.png'], ['src/b.css', 'src/a.ts', 'assets/logo.png', 'src/.hidden/x.css'])).toEqual([
      'assets/logo.png',
      'src/.hidden/x.css',
      'src/b.css',
    ]);
    expect(ignoredBy(['src/*.css'], ['src/deep/b.css'])).toEqual([]);
  });

  it('are the ones every pattern but a negated one matches', () => {
    expect(ignoredBy(['**/*.css', '!src/keep.css'], ['src/a.ts', 'src/b.css', 'src/keep.css'])).toEqual(['src/b.css']);
  });

  it('are none when the suite declares no pattern', () => {
    expect(ignoredBy(undefined, ['src/b.css'])).toEqual([]);
  });
});

describe('a file the suite ignores, read off a snapshot', () => {
  const view = () => openTestCoverage(encodeTestCoverage(coverage));
  const file = (name: string) => ({ kind: 'file', name }) as const;
  const relations = relationsOf({
    relations: [{ from: file('test/alpha.test.ts'), to: file('src/card.css'), kind: 'imports' }],
  });
  const edit = (path: string, line = 1) => `--- a/${path}
+++ b/${path}
@@ -${line},1 +${line},1 @@
-old
+new`;

  it('selects the tests that import it when the suite ignores nothing', () => {
    expect(narrowByExecutionFromView(view(), edit('src/card.css'), { relations }).entered).toEqual(['test/alpha.test.ts']);
  });

  it('selects nothing for it, and names it ignored', () => {
    const narrowing = narrowByExecutionFromView(view(), edit('src/card.css'), { relations, ignore: ['**/*.css'] });

    expect(narrowing).toMatchObject({ entered: [], because: [], unread: [], ignored: ['src/card.css'] });
  });

  it('ignores a file the record measured as well', () => {
    expect(narrowByExecutionFromView(view(), edit('src/decide.ts', 4), { relations, ignore: ['src/**'] })).toMatchObject({
      entered: [],
      ignored: ['src/decide.ts'],
    });
  });

  it('reads every other file of the same change', () => {
    const diff = `${edit('src/card.css')}\n${edit('src/decide.ts', 4)}`;

    expect(narrowByExecutionFromView(view(), diff, { relations, ignore: ['**/*.css'] })).toMatchObject({
      entered: ['test/alpha.test.ts'],
      ignored: ['src/card.css'],
    });
  });

  it('still runs a test that declared the file as its precondition, which the record saw and no glob can undo', () => {
    expect(narrowByExecutionFromView(view(), edit('vitest.config.ts'), { relations, ignore: ['*.config.ts'] })).toMatchObject({
      entered: ['test/aaa.test.ts', 'test/alpha.test.ts', 'test/beta.test.ts'],
      unread: [],
      ignored: ['vitest.config.ts'],
    });
  });

  it('still follows a `/// <depends>` on it, an edge drawn on purpose, and no import or asset edge', () => {
    // `src/decide.ts` declares it reads the image; `src/legacy-widget.js` only
    // imports it, and `test/alpha.test.ts` imports the stylesheet beside it.
    const reads = relationsOf({
      relations: [
        { from: file('src/legacy-widget.js'), to: file('src/logo.png'), kind: 'asset' },
        { from: file('src/decide.ts'), to: file('src/logo.png'), kind: 'depends' },
        { from: file('test/alpha.test.ts'), to: file('src/card.css'), kind: 'imports' },
      ],
    });
    const diff = `${edit('src/logo.png')}\n${edit('src/card.css')}`;

    expect(narrowByExecutionFromView(view(), diff, { relations: reads, ignore: ['**/*.png', '**/*.css'] })).toMatchObject({
      entered: ['test/alpha.test.ts', 'test/beta.test.ts'],
      because: [
        { test: 'test/alpha.test.ts', via: [{ kind: 'importer', trail: ['src/logo.png', 'src/decide.ts'] }] },
        { test: 'test/beta.test.ts', via: [{ kind: 'importer', trail: ['src/logo.png', 'src/decide.ts'] }] },
      ],
      unread: [],
      ignored: ['src/card.css', 'src/logo.png'],
    });
  });

  it('still follows a `/// <depends>` on it in a suite that declines relations', () => {
    const reads = relationsOf({ relations: [{ from: file('src/decide.ts'), to: file('src/logo.png'), kind: 'depends' }] });

    expect(
      narrowByExecutionFromView(view(), edit('src/logo.png'), { relations: reads, ignore: ['**/*.png'], unmeasured: 'nothing' }),
    ).toMatchObject({ entered: ['test/alpha.test.ts', 'test/beta.test.ts'], ignored: ['src/logo.png'] });
  });

  it('walks on from a module that declares it and holds no row to its importers, as from any file the record did not measure', () => {
    const reads = relationsOf({
      relations: [
        { from: file('src/reader.ts'), to: file('src/logo.png'), kind: 'depends' },
        { from: file('test/alpha.test.ts'), to: file('src/reader.ts'), kind: 'imports' },
      ],
    });

    expect(narrowByExecutionFromView(view(), edit('src/logo.png'), { relations: reads, ignore: ['**/*.png'] })).toMatchObject({
      entered: ['test/alpha.test.ts'],
      because: [{ test: 'test/alpha.test.ts', via: [{ kind: 'importer', trail: ['src/logo.png', 'src/reader.ts', 'test/alpha.test.ts'] }] }],
      unread: [],
      ignored: ['src/logo.png'],
    });
  });

  it('declines a module that declares it and holds no row in a suite that declines relations', () => {
    const reads = relationsOf({
      relations: [
        { from: file('src/reader.ts'), to: file('src/logo.png'), kind: 'depends' },
        { from: file('test/alpha.test.ts'), to: file('src/reader.ts'), kind: 'imports' },
      ],
    });

    expect(
      narrowByExecutionFromView(view(), edit('src/logo.png'), { relations: reads, ignore: ['**/*.png'], unmeasured: 'nothing' }),
    ).toMatchObject({ entered: [], declined: ['src/reader.ts'], ignored: ['src/logo.png'] });
  });

  it('still follows a `/// <depends>` on it from a module the suite ignores as well', () => {
    const reads = relationsOf({ relations: [{ from: file('src/decide.ts'), to: file('src/logo.png'), kind: 'depends' }] });
    const diff = `${edit('src/logo.png')}\n${edit('src/decide.ts', 4)}`;

    expect(narrowByExecutionFromView(view(), diff, { relations: reads, ignore: ['src/**'] })).toMatchObject({
      entered: ['test/alpha.test.ts', 'test/beta.test.ts'],
      ignored: ['src/decide.ts', 'src/logo.png'],
    });
  });

  it('runs the tests that declare a module that declares it and holds no row', () => {
    const reads = relationsOf({ relations: [{ from: file('vitest.config.ts'), to: file('src/logo.png'), kind: 'depends' }] });

    expect(narrowByExecutionFromView(view(), edit('src/logo.png'), { relations: reads, ignore: ['**/*.png'] })).toMatchObject({
      entered: ['test/aaa.test.ts', 'test/alpha.test.ts', 'test/beta.test.ts'],
      unread: [],
    });
  });

  it('ignores at a graph precision too', () => {
    expect(
      narrowByExecutionFromView(view(), edit('src/card.css'), { relations, ignore: ['**/*.css'], precision: 'file' }),
    ).toMatchObject({ entered: [], ignored: ['src/card.css'] });
  });
});

describe('a file the suite ignores, read off a journey file', () => {
  const index: ExecutionIndex = {
    tests: [{ id: 'card > a', file: 'test/card.test.ts', name: 'a' }],
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
    { file: 'src/card.css' },
    { file: 'src/card.ts', edges: [{ to: 'src/card.css', kind: 'imports' }] },
    { file: 'test/card.test.ts', edges: [{ to: 'src/card.ts', kind: 'imports' }] },
  ]);
  const changed = new Map([['src/card.css', [{ start: 1, end: 1 }]]]);

  it('selects the tests that import it when the suite ignores nothing', () => {
    expect(narrowByJourneys(index, changed, { relations }).entered).toEqual(['test/card.test.ts']);
  });

  it('selects nothing for it, and names it ignored', () => {
    expect(narrowByJourneys(index, changed, { relations, ignore: ['**/*.css'] })).toMatchObject({
      entered: [],
      unread: [],
      ignored: ['src/card.css'],
    });
  });
});
