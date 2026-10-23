import { relationsOf } from '@variance-authority/core/relate';
import { describe, expect, it } from 'vitest';
import { encodeTestCoverage } from './format.js';
import { openTestCoverage } from './format-view.js';
import {
  changeOfDiff,
  changeOfFiles,
  dependsReachFromView,
  graphReachFromView,
  ignoredChange,
  importersFromView,
  narrowByChangeFromView,
  narrowByExecutionFromView,
  readRowlessFromView,
  routesFromView,
  testsDeclaringFromView,
  testsEnteringFromView,
  testsLoadingFromView,
} from './index.js';
import { coverage } from './__fixtures__/coverage.js';

/**
 * Each stage of selection asked alone, with its inputs as values: invented
 * files and ranges, a graph built in place, and no checkout behind any of it.
 */
describe('a selection stage asked on its own', () => {
  const file = (name: string) => ({ kind: 'file', name }) as const;
  const view = () => openTestCoverage(encodeTestCoverage(coverage));
  const module = { kind: 'region', file: 'src/decide.ts', name: '', path: 'module', startLine: 1, endLine: 8 } as const;
  const then = { kind: 'region', file: 'src/decide.ts', name: 'decide', path: 'if#0/then', startLine: 3, endLine: 5 } as const;
  const atLine = (path: string, line: number) => ({ lines: new Map([[path, [{ start: line, end: line }]]]), hunks: new Map() });

  it('takes a list of files as a change, each changed whole', () => {
    expect(changeOfFiles(['src/b.ts', 'src/a.ts', 'src/a.ts'])).toEqual({
      lines: new Map([
        ['src/a.ts', []],
        ['src/b.ts', []],
      ]),
      hunks: new Map(),
    });
  });

  it('cuts a change by the suite’s ignore globs', () => {
    const { kept, ignored } = ignoredChange(changeOfFiles(['src/logo.png', 'src/decide.ts']), ['**/*.png']);

    expect(ignored).toEqual(['src/logo.png']);
    expect([...kept.lines.keys()]).toEqual(['src/decide.ts']);
  });

  it('routes each file by whether the record measured it, and by what the suite does with one it did not', () => {
    expect(routesFromView(view(), ['src/decide.ts', 'src/rules.css'])).toEqual(
      new Map([
        ['src/decide.ts', 'coverage'],
        ['src/rules.css', 'relations'],
      ]),
    );
    expect(routesFromView(view(), ['src/rules.css'], { unmeasured: 'nothing' })).toEqual(new Map([['src/rules.css', 'nothing']]));
  });

  it('answers a list of files by every test that loaded each, and names a file the record holds no row for', () => {
    expect(testsLoadingFromView(view(), ['src/decide.ts', 'src/rules.css'])).toEqual({
      entered: ['test/alpha.test.ts', 'test/beta.test.ts'],
      because: [
        { test: 'test/alpha.test.ts', via: [module, then] },
        { test: 'test/beta.test.ts', via: [module] },
      ],
      unanswered: ['src/rules.css'],
    });
  });

  it('answers invented ranges by the regions they fall in, at the precision asked', () => {
    expect(testsEnteringFromView(view(), atLine('src/decide.ts', 4))).toMatchObject({
      entered: ['test/alpha.test.ts'],
      because: [{ test: 'test/alpha.test.ts', via: [then] }],
      unanswered: [],
      stale: [],
    });
    expect(testsEnteringFromView(view(), atLine('src/decide.ts', 4), { precision: 'function-use' }).entered).toEqual([
      'test/alpha.test.ts',
      'test/beta.test.ts',
    ]);
    expect(testsEnteringFromView(view(), atLine('src/rules.css', 1)).unanswered).toEqual(['src/rules.css']);
  });

  it('answers the same ranges the composed narrowing does', () => {
    const diff = `--- a/src/decide.ts
+++ b/src/decide.ts
@@ -4,1 +4,1 @@
-    return 'A';
+    return 'Alpha';`;

    expect(testsEnteringFromView(view(), changeOfDiff(diff)).entered).toEqual(narrowByExecutionFromView(view(), diff).entered);
    expect(narrowByChangeFromView(view(), changeOfDiff(diff))).toEqual(narrowByExecutionFromView(view(), diff));
    expect(narrowByChangeFromView(view(), atLine('src/decide.ts', 4)).entered).toEqual(['test/alpha.test.ts']);
  });

  it('answers a file by the tests that declared it as a precondition', () => {
    expect(testsDeclaringFromView(view(), changeOfFiles(['vitest.config.ts', 'src/decide.ts']))).toEqual({
      entered: ['test/aaa.test.ts', 'test/alpha.test.ts', 'test/beta.test.ts'],
      because: ['test/aaa.test.ts', 'test/alpha.test.ts', 'test/beta.test.ts'].map((test) => ({
        test,
        via: [{ kind: 'precondition', name: 'vitest.config.ts' }],
      })),
      unanswered: ['src/decide.ts'],
    });
  });

  it('walks a file with no row to the nearest file the record measured', () => {
    const relations = relationsOf({ relations: [{ from: file('src/decide.ts'), to: file('src/rules.css'), kind: 'asset' }] });
    const trail = { kind: 'importer', trail: ['src/rules.css', 'src/decide.ts'] };

    expect(importersFromView(view(), changeOfFiles(['src/rules.css', 'docs/notes.md']), { relations })).toEqual({
      entered: ['test/alpha.test.ts', 'test/beta.test.ts'],
      because: [
        { test: 'test/alpha.test.ts', via: [trail] },
        { test: 'test/beta.test.ts', via: [trail] },
      ],
      unanswered: ['docs/notes.md'],
    });
  });

  it('follows a `/// <depends>` on an ignored file, and nothing else', () => {
    const relations = relationsOf({
      relations: [
        { from: file('src/decide.ts'), to: file('src/logo.png'), kind: 'depends' },
        { from: file('test/aaa.test.ts'), to: file('src/logo.png'), kind: 'asset' },
      ],
    });
    const trail = { kind: 'importer', trail: ['src/logo.png', 'src/decide.ts'] };

    expect(dependsReachFromView(view(), ['src/logo.png'], { relations })).toEqual({
      entered: ['test/alpha.test.ts', 'test/beta.test.ts'],
      because: [
        { test: 'test/alpha.test.ts', via: [trail] },
        { test: 'test/beta.test.ts', via: [trail] },
      ],
      unanswered: [],
    });
  });

  it('walks the graph from every changed file to every test that imports it, as `file` precision adds', () => {
    const relations = relationsOf({ relations: [{ from: file('test/aaa.test.ts'), to: file('src/decide.ts'), kind: 'imports' }] });

    expect(graphReachFromView(view(), ['src/decide.ts'], { relations })).toEqual({
      entered: ['test/aaa.test.ts'],
      because: [{ test: 'test/aaa.test.ts', via: [{ kind: 'importer', trail: ['src/decide.ts', 'test/aaa.test.ts'] }] }],
      unanswered: [],
    });
  });

  it('names a rowless file it holds no old text for as unanswered, for the importer walk to take', () => {
    const relations = relationsOf({ relations: [{ from: file('test/aaa.test.ts'), to: file('src/rules.ts'), kind: 'imports' }] });

    expect(readRowlessFromView(view(), atLine('src/rules.ts', 1), { relations })).toEqual({
      entered: [],
      because: [],
      unanswered: ['src/rules.ts'],
      readings: [],
    });
  });
});
