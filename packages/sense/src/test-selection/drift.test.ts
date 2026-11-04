import { relationsOfFiles } from '@variance-authority/core/relate';
import { describe, expect, it } from 'vitest';
import type { BaseEdges } from './base-edges.js';
import { driftFromWalk } from './drift.js';

/**
 * `test/a.test.ts` imports `src/a.ts`, which imports `src/b.ts`, which imports
 * the package `ms`. `src/c.ts` is imported by nothing. Under `__mocks__` sit
 * what a runner may serve for `src/b.ts` (it imports `src/fake.ts`), for
 * `src/c.ts`, and for the packages `ms` and `left-pad`. `test/setup.ts` runs
 * before every test and imports `src/clock.ts`.
 */
const FILES = [
  { file: 'test/a.test.ts', edges: [{ to: 'src/a.ts', kind: 'imports' as const }] },
  { file: 'src/a.ts', edges: [{ to: 'src/b.ts', kind: 'imports' as const }] },
  { file: 'src/b.ts', packages: [{ to: 'ms', kind: 'imports' as const }] },
  { file: 'src/c.ts' },
  { file: 'src/fake.ts' },
  { file: 'src/__mocks__/b.ts', edges: [{ to: 'src/fake.ts', kind: 'imports' as const }] },
  { file: 'src/__mocks__/c.ts' },
  { file: '__mocks__/ms.ts' },
  { file: '__mocks__/left-pad.ts' },
  { file: 'test/setup.ts', edges: [{ to: 'src/clock.ts', kind: 'imports' as const }] },
  { file: 'src/clock.ts' },
];
const RELATIONS = relationsOfFiles(FILES);

const loaded = (file: string, ...testFiles: string[]) => ({ file, blocks: [{ kind: 'module', testFiles }] });

describe('drift from the walk', () => {
  it('is nothing when every file a test loaded is one it imports, itself included', () => {
    const modules = [loaded('test/a.test.ts', 'test/a.test.ts'), loaded('src/a.ts', 'test/a.test.ts'), loaded('src/b.ts', 'test/a.test.ts')];
    expect(driftFromWalk(RELATIONS, modules, []).rows).toEqual([]);
  });

  it('names the file and the test when a test loaded a file no import of it reaches', () => {
    const modules = [loaded('src/a.ts', 'test/a.test.ts'), loaded('src/c.ts', 'test/a.test.ts')];
    expect(driftFromWalk(RELATIONS, modules, []).rows).toEqual([{ file: 'src/c.ts', test: 'test/a.test.ts' }]);
  });

  it('holds a file a before-file imports as reached by every test', () => {
    const modules = [loaded('src/clock.ts', 'test/a.test.ts')];
    expect(driftFromWalk(RELATIONS, modules, ['test/setup.ts']).rows).toEqual([]);
  });

  it('names a mock the runner served as it names any other load, whether or not the test reaches what it stands in for', () => {
    const modules = [
      loaded('src/__mocks__/b.ts', 'test/a.test.ts'),
      loaded('src/fake.ts', 'test/a.test.ts'),
      loaded('__mocks__/ms.ts', 'test/a.test.ts'),
      loaded('__mocks__/left-pad.ts', 'test/a.test.ts'),
    ];
    expect(driftFromWalk(RELATIONS, modules, []).rows).toEqual([
      { file: '__mocks__/left-pad.ts', test: 'test/a.test.ts' },
      { file: '__mocks__/ms.ts', test: 'test/a.test.ts' },
      { file: 'src/__mocks__/b.ts', test: 'test/a.test.ts' },
      { file: 'src/fake.ts', test: 'test/a.test.ts' },
    ]);
  });

  it('never enters a module the test mocks, so loading it is drift', () => {
    const shadowed = relationsOfFiles(FILES, { shadows: new Map([['test/a.test.ts', ['src/b.ts']]]) });
    const modules = [loaded('src/b.ts', 'test/a.test.ts')];
    expect(driftFromWalk(shadowed, modules, []).rows).toEqual([{ file: 'src/b.ts', test: 'test/a.test.ts' }]);
  });

  it('walks a file the record holds under its built name from the source it was built from', () => {
    const modules = [loaded('dist/b.js', 'test/a.test.ts')];
    const sourceOf = (file: string) => (file === 'dist/b.js' ? 'src/b.ts' : file);
    expect(driftFromWalk(RELATIONS, modules, [], { sourceOf }).rows).toEqual([]);
  });

  it('reads only the module region, the one that says a test loaded the file', () => {
    const modules = [{ file: 'src/c.ts', blocks: [{ kind: 'function', testFiles: ['test/a.test.ts'] }] }];
    expect(driftFromWalk(RELATIONS, modules, []).rows).toEqual([]);
  });

  it.todo('names the importer whose request the runner answered with each load, so a row speaks for every test the walk takes through that importer — needs the record run to keep the importer of each load, from Vitest\'s resolveId and Node\'s resolve hook');
});

const id = (name: string) => RELATIONS.index.get(`file:${name}`)!;
const base = (edges: Partial<BaseEdges>): BaseEdges => ({ added: new Map(), removed: new Map(), created: new Set(), unknown: new Set(), ...edges });

describe('drift from the walk at the merge base', () => {
  it('does not walk an import the change added, so a load through it was drift before the change', () => {
    const modules = [loaded('src/b.ts', 'test/a.test.ts')];
    const edges = base({ added: new Map([[id('src/a.ts'), new Set([id('src/b.ts')])]]) });
    expect(driftFromWalk(RELATIONS, modules, [], { base: edges }).rows).toEqual([{ file: 'src/b.ts', test: 'test/a.test.ts' }]);
  });

  it('walks an import the change removed, so a load through it was no drift before the change', () => {
    const modules = [loaded('src/c.ts', 'test/a.test.ts')];
    const edges = base({ removed: new Map([[id('src/a.ts'), [id('src/c.ts')]]]) });
    expect(driftFromWalk(RELATIONS, modules, [], { base: edges }).rows).toEqual([]);
  });

  it('never enters a file the change created', () => {
    const modules = [loaded('src/a.ts', 'test/a.test.ts')];
    const edges = base({ created: new Set([id('src/a.ts')]) });
    expect(driftFromWalk(RELATIONS, modules, [], { base: edges }).rows).toEqual([{ file: 'src/a.ts', test: 'test/a.test.ts' }]);
  });

  it('reads no test whose walk enters a file it cannot read the merge base of, nor one that loaded a file the change deleted', () => {
    const modules = [loaded('src/a.ts', 'test/a.test.ts'), loaded('src/gone.ts', 'test/b.test.ts')];
    const edges = base({ unknown: new Set(['src/b.ts', 'src/gone.ts']) });
    expect(driftFromWalk(RELATIONS, modules, [], { base: edges })).toEqual({
      rows: [],
      unread: [
        { file: 'src/b.ts', test: 'test/a.test.ts' },
        { file: 'src/gone.ts', test: 'test/b.test.ts' },
      ],
    });
  });
});
